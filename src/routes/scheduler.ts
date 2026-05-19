// ─── Daily Analysis Scheduler ───────────────────────────────────────────────
// Runs every 24 hours (configured as cron in devvit.json).
// Scores all users, updates community baseline, saves ranked sorted set.
//
// PERFORMANCE RULES:
// - Process users sequentially (not in parallel) to prevent Redis rate limiting
// - Per-user try/catch so one bad user never stops the batch
// - Must complete within Devvit's scheduler timeout (~30s for 1000 users)

import { Hono } from 'hono';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';
import { reddit } from '@devvit/web/server';
import {
  getUserProfile,
  getAllUsernames,

  appendScoreHistory,
  updateUserScore,
  removeUserScore,
  saveUserProfile,
  getCommunityBaseline,
  saveCommunityBaseline,
  isUserDismissed,
  getClearedUsernames,
  getAllPendingAppeals,
  getAutoActionSettings,
  setAppealStatus,
  appendAuditEntry,
} from '../storage/index.js';
import {
  computeRiskScore,
  MIN_ACTIVITY_FOR_SCORE,
  MIN_BASELINE_DAYS,
  MIN_BASELINE_SAMPLE,
} from '../scoring/riskScore.js';
import {
  computeInterArrivalCV,
  computeCircadianEntropy,
  computePostCommentRatio,
  computeEditRate,
} from '../signals/index.js';
import { detectCoordinatedGroups } from '../scoring/coordinatedDetector.js';
import { DEFAULT_BASELINE } from '../types/index.js';
import type { CommunityBaseline, ScoredUser, UserProfile } from '../types/index.js';
import { pushSharedThreat } from '../storage/threats.js';

export const scheduler = new Hono();

const REDACTED_USERNAMES = new Set(['[redacted]', '[deleted]']);

function isValidUsername(raw: string | undefined | null): raw is string {
  return !!raw && !REDACTED_USERNAMES.has(raw);
}

async function repairProfileUsername(
  usernameKey: string,
  profile: UserProfile
): Promise<void> {
  if (!usernameKey) {
    console.error('BotPrints: Invalid username key for repair', { usernameKey });
    return;
  }
  if (isValidUsername(profile.username)) return;

  let resolved: string | undefined;

  if (profile.userId) {
    try {
      const user = await reddit.getUserById(profile.userId as `t2_${string}`);
      resolved = user?.username;
    } catch (err) {
      console.warn('BotPrints: Could not repair username by id', {
        usernameKey,
        userId: profile.userId,
        err,
      });
    }
  }

  if (!isValidUsername(resolved) && isValidUsername(usernameKey)) {
    try {
      const user = await reddit.getUserByUsername(usernameKey);
      resolved = user?.username;
    } catch {
      // fall through
    }
  }

  if (!isValidUsername(resolved)) {
    console.error('BotPrints: Could not repair missing username', {
      usernameKey,
      userId: profile.userId,
    });
    return;
  }

  profile.username = resolved;
  await saveUserProfile(usernameKey, profile);
  console.log(`BotPrints: Repaired missing username for key ${usernameKey}`);
}

scheduler.post('/daily-analysis', async (c) => {
  await c.req.json<TaskRequest>();
  console.log(`BotPrints: Starting daily analysis at ${new Date().toISOString()}`);

  try {
    await runDailyAnalysis();
  } catch (err) {
    console.error('BotPrints: Fatal error in daily analysis:', err);
  }

  return c.json<TaskResponse>({ status: 'ok' }, 200);
});

export async function runDailyAnalysis(): Promise<void> {
  const startTime = Date.now();
  const usernames = await getAllUsernames();
  const subreddit = await reddit.getCurrentSubreddit();

  if (usernames.length === 0) {
    console.log('BotPrints: No users to analyze yet');
    return;
  }

  const baseline = await getCommunityBaseline(subreddit.id);

  // Score all users
  let analyzed = 0;
  let topScore = 0;
  let topUser = '';

  console.log(`BotPrints: Fetched ${usernames.length} users from storage to analyze.`);

  for (const username of usernames) {
    try {
      if (await isUserDismissed(username)) {
        console.log(`BotPrints: Skipped u/${username} - User was previously dismissed.`);
        continue;
      }

      console.log(`BotPrints: Analyzing u/${username}...`);
      const profile = await getUserProfile(username);
      await repairProfileUsername(username, profile);
      console.log(`BotPrints: u/${username} stats - Posts: ${profile.posts}, Comments: ${profile.comments}`);

      const scoreBreakdown = computeRiskScore(profile, baseline);

      if (!scoreBreakdown.hasEnoughData) {
        await removeUserScore(username);
        console.log(`BotPrints: Skipped u/${username} - Not enough data for scoring`);
        continue;
      }

      await appendScoreHistory(username, scoreBreakdown.total);
      await updateUserScore(username, scoreBreakdown.total);

      analyzed++;
      console.log(`BotPrints: Scored u/${username} -> ${scoreBreakdown.total}`);

      if (scoreBreakdown.total > topScore) {
        topScore = scoreBreakdown.total;
        topUser = username;
      }
    } catch (err) {
      console.log(`BotPrints: Error analyzing ${username}:`, err);
    }
  }

  // Recompute community baseline from all profiles
  const baselineStartedAt = baseline.signalBaselineStartedAt ?? 0;
  const baselineAgeDays = baselineStartedAt
    ? (Date.now() - baselineStartedAt) / (24 * 60 * 60 * 1000)
    : 0;
  const baselineSampleSize = baseline.signalSampleSize ?? 0;
  const baselineMature =
    baselineStartedAt > 0 &&
    baselineAgeDays >= MIN_BASELINE_DAYS &&
    baselineSampleSize >= MIN_BASELINE_SAMPLE;
  const now = new Date();
  const isSundayMidnight = now.getUTCDay() === 0 && now.getUTCHours() === 0;

  if (!baselineMature || isSundayMidnight) {
    await recomputeCommunityBaseline(usernames, baseline, subreddit.id);
  }

  // Re-run coordinated group detection on top users
  const topUsers = await getAllUsernames();
  const scoredUsers: ScoredUser[] = [];
  
  // We need to score everyone to check for rings
  for (const username of topUsers) {
    try {
      const profile = await getUserProfile(username);
      const breakdown = computeRiskScore(profile, baseline);
      scoredUsers.push({ 
        username, 
        score: breakdown.total, 
        breakdown, 
        shift: { shifted: false, magnitude: 0, direction: 'stable', daysSinceNormal: 0 }, 
        profile 
      });
    } catch { /* skip */ }
  }

  const coordGroups = detectCoordinatedGroups(scoredUsers, 0);
  
  for (const group of coordGroups) {
    if (group.members.length >= 3 && group.avgCorrelation > 0.9) {
      await pushSharedThreat(subreddit.name, group.members, group.avgCorrelation);
      console.log(`BotPrints: Confirmed ring pushed to shared threat layer. Group ${group.id}`);
    }
  }

  // Process Appeal Expirations
  await processAppealsExpirations();

  const elapsed = Date.now() - startTime;
  console.log(
    `BotPrints daily analysis: ${analyzed}/${usernames.length} users in ${elapsed}ms. Top risk: u/${topUser} (${topScore})`
  );
}

// Helper: recompute baseline averages from all user profiles
async function recomputeCommunityBaseline(
  usernames: string[],
  currentBaseline: CommunityBaseline,
  subredditId: string
): Promise<void> {
  const values = {
    cv: [] as number[],
    entropy: [] as number[],
    ratio: [] as number[],
    editRate: [] as number[],
  };
  const signals = {
    temporal: [] as number[],
    circadian: [] as number[],
    engagement: [] as number[],
    editRate: [] as number[],
    burstSilence: [] as number[],
    voteCorrelation: [] as number[],
  };

  const pendingAppeals = await getAllPendingAppeals();
  const pendingSet = new Set(pendingAppeals.map((a) => a.username));
  const clearedSet = new Set(await getClearedUsernames());
  let sampleCount = 0;

  for (const username of usernames) {
    if (pendingSet.has(username) || clearedSet.has(username)) continue;
    try {
      const profile = await getUserProfile(username);
      const activityCount = (profile.posts || 0) + (profile.comments || 0);
      if (activityCount < MIN_ACTIVITY_FOR_SCORE) continue;

      sampleCount++;

      const cv = computeInterArrivalCV(profile.postTimestamps);
      const entropy = computeCircadianEntropy(profile.hourBuckets);
      const ratio = computePostCommentRatio(profile.posts, profile.comments);
      const editRateVal = computeEditRate(
        profile.edits,
        profile.posts,
        profile.comments
      );

      if (cv !== -1) values.cv.push(cv);
      if (entropy !== -1) values.entropy.push(entropy);
      if (ratio !== -1) values.ratio.push(ratio);
      if (editRateVal !== -1) values.editRate.push(editRateVal);

      const breakdown = computeRiskScore(profile, currentBaseline);
      signals.temporal.push(breakdown.temporal);
      signals.circadian.push(breakdown.circadian);
      signals.engagement.push(breakdown.engagement);
      signals.editRate.push(breakdown.editRate);
      signals.burstSilence.push(breakdown.burstSilence);
      signals.voteCorrelation.push(breakdown.voteCorrelation);
    } catch (err) {
      console.log(`BotPrints: Error computing baseline for ${username}:`, err);
    }
  }

  const avg = (arr: number[], fallback: number): number =>
    arr.length > 0
      ? arr.reduce((a, b) => a + b, 0) / arr.length
      : fallback;

  const mean = (arr: number[]): number =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const stdDev = (arr: number[], meanVal: number): number => {
    if (arr.length <= 1) return 0;
    const variance = arr.reduce((s, v) => s + (v - meanVal) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  };

  const signalMeans = {
    temporal: mean(signals.temporal),
    circadian: mean(signals.circadian),
    engagement: mean(signals.engagement),
    editRate: mean(signals.editRate),
    burstSilence: mean(signals.burstSilence),
    voteCorrelation: mean(signals.voteCorrelation),
  };

  const signalStdDevs = {
    temporal: stdDev(signals.temporal, signalMeans.temporal),
    circadian: stdDev(signals.circadian, signalMeans.circadian),
    engagement: stdDev(signals.engagement, signalMeans.engagement),
    editRate: stdDev(signals.editRate, signalMeans.editRate),
    burstSilence: stdDev(signals.burstSilence, signalMeans.burstSilence),
    voteCorrelation: stdDev(signals.voteCorrelation, signalMeans.voteCorrelation),
  };

  const now = Date.now();
  const baselineStartedAt =
    currentBaseline.signalBaselineStartedAt || (sampleCount > 0 ? now : 0);

  const newBaseline: CommunityBaseline = {
    avgInterArrivalCV: avg(values.cv, DEFAULT_BASELINE.avgInterArrivalCV),
    avgCircadianEntropy: avg(
      values.entropy,
      DEFAULT_BASELINE.avgCircadianEntropy
    ),
    avgPostCommentRatio: avg(
      values.ratio,
      DEFAULT_BASELINE.avgPostCommentRatio
    ),
    avgEditRate: avg(values.editRate, DEFAULT_BASELINE.avgEditRate),
    sampleSize: sampleCount,
    lastComputed: now,
    signalMeans,
    signalStdDevs,
    signalSampleSize: sampleCount,
    signalBaselineStartedAt: baselineStartedAt,
    signalBaselineUpdatedAt: now,
  };

  await saveCommunityBaseline(newBaseline, subredditId);
}

// Helper: Process pending appeals that have expired
async function processAppealsExpirations(): Promise<void> {
  try {
    const appeals = await getAllPendingAppeals();
    if (appeals.length === 0) return;
    
    const settings = await getAutoActionSettings();
    const now = Date.now();
    
    for (const appeal of appeals) {
      if (appeal.expiresAt && now > appeal.expiresAt) {
        if (settings.autoEscalate) {
          // Auto-escalate to Ban
          try {
            const subreddit = await reddit.getCurrentSubreddit();
            await subreddit.banUser({
              username: appeal.username,
              reason: 'BotPrints Auto-Action Escalation (Tier 3)',
              note: 'Escalated from pending appeal timeout',
            });
            
            await setAppealStatus(appeal.username, {
              status: 'denied',
              removalReason: 'Auto-escalated to Ban (Timeout)',
              createdAt: Date.now(),
            });

            await appendAuditEntry({
              timestamp: Date.now(),
              action: 'ban-report',
              username: appeal.username,
              performedBy: 'BotPrints (Auto)',
              details: `Appeal timeout expired. Auto-escalation enabled: User permanently banned.`,
            });
            console.log(`BotPrints: Auto-escalated u/${appeal.username} (Appeal Timeout)`);
          } catch (e) {
            console.warn(`BotPrints: Could not auto-ban u/${appeal.username}:`, e);
          }
        } else {
          // Auto-escalate disabled. Send modmail reminder.
          try {
            const subreddit = await reddit.getCurrentSubreddit();
            await reddit.modMail.createModInboxConversation({
              subredditId: subreddit.id as any,
              subject: `BotPrints Alert: Appeal Timeout for u/${appeal.username}`,
              bodyMarkdown: `**Appeal Timeout Expired**\n\nu/${appeal.username} has not responded to their Tier 2 appeal within the configured ${settings.appealTimeout} window.\n\n*Auto-escalation is currently DISABLED in your settings.*\n\nPlease review this user in the BotPrints Dashboard and take manual action.`,
            });
            
            // We do NOT clear the appeal status here so mods can still action it in the dashboard,
            // but we might extend the timer so it doesn't spam every day? Let's just bump the timer 24h.
            await setAppealStatus(appeal.username, {
              ...appeal,
              expiresAt: now + 24 * 60 * 60 * 1000,
            });
            
            console.log(`BotPrints: Sent modmail reminder for expired appeal (u/${appeal.username})`);
          } catch (e) {
            console.warn(`BotPrints: Could not send appeal reminder modmail:`, e);
          }
        }
      }
    }
  } catch (err) {
    console.error('BotPrints: Error processing appeal expirations:', err);
  }
}
