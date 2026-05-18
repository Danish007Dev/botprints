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
  getCommunityBaseline,
  saveCommunityBaseline,
  isUserDismissed,
  getAllPendingAppeals,
  getAutoActionSettings,
  setAppealStatus,
  appendAuditEntry,
} from '../storage/index.js';
import { computeRiskScore } from '../scoring/riskScore.js';
import {
  computeInterArrivalCV,
  computeCircadianEntropy,
  computePostCommentRatio,
  computeEditRate,
} from '../signals/index.js';
import { detectCoordinatedGroups } from '../scoring/coordinatedDetector.js';
import { detectBehavioralShift } from '../scoring/shiftDetector.js';
import { DEFAULT_BASELINE } from '../types/index.js';
import type { CommunityBaseline, ScoredUser } from '../types/index.js';
import { pushSharedThreat } from '../storage/threats.js';

export const scheduler = new Hono();

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

  if (usernames.length === 0) {
    console.log('BotPrints: No users to analyze yet');
    return;
  }

  const baseline = await getCommunityBaseline();
  const minPosts = 1; // Temporarily reduced to 1 for easier playtesting!

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
      console.log(`BotPrints: u/${username} stats - Posts: ${profile.posts}, Comments: ${profile.comments}`);

      const scoreBreakdown = computeRiskScore(profile, baseline, minPosts);

      if (!scoreBreakdown.hasEnoughData) {
        console.log(`BotPrints: Skipped u/${username} - Not enough data (requires at least ${minPosts} posts)`);
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
  await recomputeCommunityBaseline(usernames);

  // Re-run coordinated group detection on top users
  const topUsers = await getAllUsernames();
  const scoredUsers: ScoredUser[] = [];
  
  // We need to score everyone to check for rings
  for (const username of topUsers) {
    try {
      const profile = await getUserProfile(username);
      const breakdown = computeRiskScore(profile, baseline, minPosts);
      scoredUsers.push({ 
        username, 
        score: breakdown.total, 
        breakdown, 
        shift: { shifted: false, magnitude: 0, direction: 'stable', daysSinceNormal: 0 }, 
        profile 
      });
    } catch { /* skip */ }
  }

  const coordGroups = detectCoordinatedGroups(scoredUsers);
  const currentSubreddit = await reddit.getCurrentSubreddit();
  
  for (const group of coordGroups) {
    if (group.members.length >= 3 && group.avgCorrelation > 0.9) {
      await pushSharedThreat(currentSubreddit.name, group.members, group.avgCorrelation);
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
  usernames: string[]
): Promise<void> {
  const values = {
    cv: [] as number[],
    entropy: [] as number[],
    ratio: [] as number[],
    editRate: [] as number[],
  };

  for (const username of usernames) {
    try {
      const profile = await getUserProfile(username);
      if (profile.posts < 5) continue;

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
    } catch (err) {
      console.log(`BotPrints: Error computing baseline for ${username}:`, err);
    }
  }

  const avg = (arr: number[], fallback: number): number =>
    arr.length > 0
      ? arr.reduce((a, b) => a + b, 0) / arr.length
      : fallback;

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
    sampleSize: usernames.length,
    lastComputed: Date.now(),
  };

  await saveCommunityBaseline(newBaseline);
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
