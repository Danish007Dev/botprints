// ─── BotPrints API Routes ───────────────────────────────────────────────────
import { Hono } from 'hono';
import { redis } from '@devvit/redis';
import { reddit } from '@devvit/web/server';
import {
  getUserProfile,
  getAllUsernames,
  getTopRiskyUsers,
  getScoreHistory,
  getCommunityBaseline,
  saveUserProfile,
  registerUser,
  appendScoreHistory,
  updateUserScore,
  removeUserScore,
  dismissUser,
  undismissUser,
  getClearedUsernames,
  addToWatchlist,
  isUserWatched,
  addToFilterList,
  removeFromFilterList,
  isUserFiltered,
  setAppealStatus,
  getAppealStatus,
  appendAuditEntry,
  markUserActioned,
  unmarkUserActioned,
  isUserActioned,
  getActionedUsernames,
  // Raid Detection
  getRaidState,
  clearRaidState,
  getRaidSettings,
  saveRaidSettings,
  // Auto-Action Settings
  getAutoActionSettings,
  saveAutoActionSettings,
  // Audit
  getAuditLog,
  // Appeals
  getAllPendingAppeals,
  incrementMetric,
  getDashboardMetrics,
  storeBanFingerprint,
} from '../storage/index.js';
import {
  computeRiskScore,
  MIN_ACTIVITY_FOR_SCORE,
  MIN_ACTIVITY_FOR_SIGNALS,
  MIN_BASELINE_SAMPLE,
  MIN_BASELINE_DAYS,
} from '../scoring/riskScore.js';
import { detectBehavioralShift } from '../scoring/shiftDetector.js';
import { detectCoordinatedGroups } from '../scoring/coordinatedDetector.js';
import { DEMO_PROFILES, DEMO_AUDIT_ENTRIES } from '../data/demoData.js';
import { DEFAULT_BASELINE } from '../types/index.js';
import type {
  ScoredUser,
  SubredditSummary,
  RaidSettings,
  AutoActionSettings,
  MonitoredUser,
  UserProfile,
  CommunityBaseline,
} from '../types/index.js';

export const api = new Hono();

const DAY_MS = 24 * 60 * 60 * 1000;

function getCalibrationStatus(baseline: CommunityBaseline): {
  ready: boolean;
  sampleSize: number;
  daysSinceStart: number;
  minSampleSize: number;
  minDays: number;
  reason: 'sample' | 'time' | 'missing' | 'ready';
} {
  const sampleSize = baseline.signalSampleSize ?? 0;
  const startedAt = baseline.signalBaselineStartedAt ?? 0;
  const daysSinceStart = startedAt > 0
    ? Math.floor((Date.now() - startedAt) / DAY_MS)
    : 0;
  const hasStats = !!(baseline.signalMeans && baseline.signalStdDevs);

  if (hasStats && sampleSize >= MIN_BASELINE_SAMPLE && daysSinceStart >= MIN_BASELINE_DAYS) {
    return {
      ready: true,
      sampleSize,
      daysSinceStart,
      minSampleSize: MIN_BASELINE_SAMPLE,
      minDays: MIN_BASELINE_DAYS,
      reason: 'ready',
    };
  }

  const reason = sampleSize < MIN_BASELINE_SAMPLE
    ? 'sample'
    : daysSinceStart < MIN_BASELINE_DAYS
      ? 'time'
      : 'missing';

  return {
    ready: false,
    sampleSize,
    daysSinceStart,
    minSampleSize: MIN_BASELINE_SAMPLE,
    minDays: MIN_BASELINE_DAYS,
    reason,
  };
}

api.get('/health', (c) => c.json({ status: 'ok', app: 'botprints', version: '0.2.0' }));

// ─── Dashboard Data ─────────────────────────────────────────────────────────
api.get('/dashboard', async (c) => {
  try {
    // ─── SECURITY: Verify the requesting user is a moderator ──────────
    const currentUser = await reddit.getCurrentUser();
    const subreddit = await reddit.getCurrentSubreddit();

    if (!currentUser) {
      return c.json({ error: 'unauthorized', message: 'Not logged in' }, 403);
    }

    const mods = await reddit.getModerators({
      subredditName: subreddit.name,
      username: currentUser.username,
    }).all();

    if (mods.length === 0) {
      return c.json({ error: 'forbidden', message: 'Moderator access required' }, 403);
    }
    // ──────────────────────────────────────────────────────────────────────

    const topUsers = await getTopRiskyUsers(20);
    const baseline = await getCommunityBaseline(subreddit.id);
    const calibration = getCalibrationStatus(baseline);
    const allUsernames = await getAllUsernames();
    const settings = await getAutoActionSettings();
    const scoredUsers: ScoredUser[] = [];
    const monitoredUsers: MonitoredUser[] = [];

    const clearedUsernames = await getClearedUsernames();
    const clearedSet = new Set(clearedUsernames);
    const scoredUsernames = new Set<string>();

    const profileCache = new Map<string, UserProfile>();
    const activityCache = new Map<string, { activityCount: number; accountAgeDays: number }>();
    const ringCandidates: { username: string; profile: UserProfile; score: number }[] = [];

    for (const username of allUsernames) {
      try {
        const profile = await getUserProfile(username);
        profileCache.set(username, profile);
        const activityCount = (profile.posts || 0) + (profile.comments || 0);
        const accountAgeDays = Math.max(
          0,
          Math.round((Date.now() - profile.firstSeen) / (1000 * 60 * 60 * 24))
        );
        activityCache.set(username, { activityCount, accountAgeDays });
        ringCandidates.push({ username, profile, score: 0 });
      } catch { /* skip */ }
    }

    // Coordinated group detection (independent of score volume)
    const coordGroups = detectCoordinatedGroups(ringCandidates, 0);
    const coordMemberMap = new Map<string, (typeof coordGroups)[number]>();
    for (const group of coordGroups) {
      for (const member of group.members) {
        coordMemberMap.set(member, group);
      }
    }

    for (const { username } of topUsers) {
      try {
        const profile = profileCache.get(username) || (await getUserProfile(username));
        const breakdown = computeRiskScore(profile, baseline);
        const history = await getScoreHistory(username);
        const shift = detectBehavioralShift(history);
        const isWatched = await isUserWatched(username);
        const isFiltered = await isUserFiltered(username);
        
        if (await isUserActioned(username)) {
          continue;
        }

        const activityMeta = activityCache.get(username) || {
          activityCount: (profile.posts || 0) + (profile.comments || 0),
          accountAgeDays: Math.max(
            0,
            Math.round((Date.now() - profile.firstSeen) / (1000 * 60 * 60 * 24))
          ),
        };
        const isNewAccount = activityMeta.accountAgeDays < settings.newAccountThresholdDays;
        const inRing = coordMemberMap.has(username);
        const hasBanEvasion = !!profile.banEvasionMatch;

        if (!breakdown.hasEnoughData && !inRing && !hasBanEvasion) {
          continue;
        }

        const entry: ScoredUser = {
          username,
          score: breakdown.total,
          breakdown,
          shift,
          profile,
          isWatched,
          isFiltered,
          insufficientData: !breakdown.hasEnoughData,
          activityCount: activityMeta.activityCount,
          activityThreshold: MIN_ACTIVITY_FOR_SCORE,
          accountAgeDays: activityMeta.accountAgeDays,
          isNewAccount,
        };

        // New Account Amplifier (only after minimum data threshold)
        if (settings.newAccountAmplifier && breakdown.hasEnoughData && isNewAccount) {
          entry.amplifiedScore = Math.min(
            100,
            Math.round(breakdown.total * settings.newAccountMultiplier)
          );
        }

        if (profile.banEvasionMatch) {
          entry.banEvasionMatch = profile.banEvasionMatch;
        }

        const group = coordMemberMap.get(username);
        if (group) {
          entry.coordGroup = group.id;
          if (group.suggestedRule !== undefined) {
            entry.suggestedRule = group.suggestedRule;
          }
          if (group.ruleReason !== undefined) {
            entry.ruleReason = group.ruleReason;
          }
        }

        scoredUsers.push(entry);
        scoredUsernames.add(username);
      } catch { /* skip */ }
    }

    // Add ring or ban-evasion exceptions even if below threshold
    for (const username of allUsernames) {
      if (scoredUsernames.has(username)) continue;
      const profile = profileCache.get(username);
      if (!profile) continue;

      const group = coordMemberMap.get(username);
      const hasBanEvasion = !!profile.banEvasionMatch;
      if (!group && !hasBanEvasion) continue;

      if (await isUserActioned(username)) continue;

      try {
        const breakdown = computeRiskScore(profile, baseline);
        const history = await getScoreHistory(username);
        const shift = detectBehavioralShift(history);
        const isWatched = await isUserWatched(username);
        const isFiltered = await isUserFiltered(username);
        const activityMeta = activityCache.get(username) || {
          activityCount: (profile.posts || 0) + (profile.comments || 0),
          accountAgeDays: Math.max(
            0,
            Math.round((Date.now() - profile.firstSeen) / (1000 * 60 * 60 * 24))
          ),
        };
        const isNewAccount = activityMeta.accountAgeDays < settings.newAccountThresholdDays;

        const entry: ScoredUser = {
          username,
          score: breakdown.total,
          breakdown,
          shift,
          profile,
          isWatched,
          isFiltered,
          insufficientData: !breakdown.hasEnoughData,
          activityCount: activityMeta.activityCount,
          activityThreshold: MIN_ACTIVITY_FOR_SCORE,
          accountAgeDays: activityMeta.accountAgeDays,
          isNewAccount,
        };

        if (settings.newAccountAmplifier && breakdown.hasEnoughData && isNewAccount) {
          entry.amplifiedScore = Math.min(
            100,
            Math.round(breakdown.total * settings.newAccountMultiplier)
          );
        }

        if (profile.banEvasionMatch) {
          entry.banEvasionMatch = profile.banEvasionMatch;
        }

        if (group) {
          entry.coordGroup = group.id;
          if (group.suggestedRule !== undefined) {
            entry.suggestedRule = group.suggestedRule;
          }
          if (group.ruleReason !== undefined) {
            entry.ruleReason = group.ruleReason;
          }
        }

        scoredUsers.push(entry);
        scoredUsernames.add(username);
      } catch { /* skip */ }
    }

    const clearedUsers: ScoredUser[] = [];
    for (const username of clearedUsernames) {
      try {
        const profile = profileCache.get(username) || (await getUserProfile(username));
        const breakdown = computeRiskScore(profile, baseline);
        const history = await getScoreHistory(username);
        const shift = detectBehavioralShift(history);
        const isWatched = await isUserWatched(username);
        const isFiltered = await isUserFiltered(username);
        const activityMeta = activityCache.get(username) || {
          activityCount: (profile.posts || 0) + (profile.comments || 0),
          accountAgeDays: Math.max(
            0,
            Math.round((Date.now() - profile.firstSeen) / (1000 * 60 * 60 * 24))
          ),
        };
        clearedUsers.push({
          username,
          score: breakdown.total,
          breakdown,
          shift,
          profile,
          isWatched,
          isFiltered,
          isCleared: true,
          insufficientData: !breakdown.hasEnoughData,
          activityCount: activityMeta.activityCount,
          activityThreshold: MIN_ACTIVITY_FOR_SCORE,
          accountAgeDays: activityMeta.accountAgeDays,
        });
      } catch { /* skip */ }
    }

    // Build monitored list (below threshold, not in exceptions or cleared)
    for (const username of allUsernames) {
      if (scoredUsernames.has(username)) continue;
      if (clearedSet.has(username)) continue;
      const profile = profileCache.get(username);
      const activityMeta = activityCache.get(username);
      if (!profile || !activityMeta) continue;
      if (activityMeta.activityCount >= MIN_ACTIVITY_FOR_SCORE) continue;

      monitoredUsers.push({
        username,
        profile,
        activityCount: activityMeta.activityCount,
        activityThreshold: MIN_ACTIVITY_FOR_SCORE,
        accountAgeDays: activityMeta.accountAgeDays,
        isNewAccount: activityMeta.accountAgeDays < settings.newAccountThresholdDays,
      });
    }

    // Subreddit summary (exclude insufficient-data users)
    const scoredForSummary = scoredUsers.filter(u => !u.insufficientData);
    const highRiskCount = scoredForSummary.filter(u => u.score >= 70).length;
    const shiftedCount = scoredForSummary.filter(u => u.shift?.shifted).length;
    const avgRisk = scoredForSummary.length > 0
      ? scoredForSummary.reduce((s, u) => s + u.score, 0) / scoredForSummary.length
      : 0;

    const summary: SubredditSummary = {
      totalTracked: allUsernames.length,
      highRiskCount,
      shiftedCount,
      coordGroupCount: coordGroups.length,
      healthScore: Math.round(Math.max(0, 100 - avgRisk)),
      lastScan: baseline.lastComputed || Date.now(),
    };

    const isDemoLoaded = allUsernames.includes('AutoShill_9000');

    return c.json({
      subredditName: subreddit.name,
      users: scoredUsers,
      monitoredUsers,
      clearedUsers,
      coordGroups,
      summary,
      baseline,
      calibration,
      thresholds: {
        minActivityForScore: MIN_ACTIVITY_FOR_SCORE,
        minActivityForSignals: MIN_ACTIVITY_FOR_SIGNALS,
      },
      isDemoLoaded,
    });
  } catch (err) {
    console.error('BotPrints API error:', err);
    return c.json({
      users: [],
      monitoredUsers: [],
      clearedUsers: [],
      coordGroups: [],
      baseline: DEFAULT_BASELINE,
      calibration: getCalibrationStatus(DEFAULT_BASELINE),
      thresholds: {
        minActivityForScore: MIN_ACTIVITY_FOR_SCORE,
        minActivityForSignals: MIN_ACTIVITY_FOR_SIGNALS,
      },
      summary: { totalTracked: 0, highRiskCount: 0, shiftedCount: 0, coordGroupCount: 0, healthScore: 100, lastScan: 0 },
    });
  }
});

// ─── Load Demo Data ─────────────────────────────────────────────────────────
api.post('/load-demo', async (c) => {
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const baseline = await getCommunityBaseline(subreddit.id);
    for (const profile of DEMO_PROFILES) {
      await saveUserProfile(profile.username, profile);
      await registerUser(profile.username);

      const breakdown = computeRiskScore(profile, baseline);
      if (breakdown.hasEnoughData) {
        await updateUserScore(profile.username, breakdown.total);
        const fakeHistory = Array.from({ length: 7 }, () =>
          Math.max(0, breakdown.total + Math.floor(Math.random() * 20 - 10))
        );
        for (const s of fakeHistory) {
          await appendScoreHistory(profile.username, s);
        }
      }
    }

    // Seed demo watchlist/filter state
    await addToWatchlist('AutoShill_9000');
    await addToFilterList('CryptoMoonBot');

    // Seed a demo appeal for SleeperAgent_X
    await setAppealStatus('SleeperAgent_X', {
      status: 'pending',
      removalReason: 'Your content was removed due to detected automated behavior. If you believe this is an error, reply to this modmail.',
      createdAt: Date.now() - 4 * 86400000,
      expiresAt: Date.now() + 2 * 86400000,
    });

    // Seed the EvadeBot_Reborn as actioned (appears in Banned tab)
    await markUserActioned('EvadeBot_Reborn');

    // Seed demo audit log entries
    for (const entry of DEMO_AUDIT_ENTRIES) {
      await appendAuditEntry(entry);
    }

    // Seed demo metrics
    await incrementMetric('accounts_actioned', 4);
    await incrementMetric('items_filtered', 12);
    await incrementMetric('bans_issued', 2);
    await incrementMetric('rings_detected', 1);
    await incrementMetric('appeals_sent', 1);

    return c.json({ status: 'ok', loaded: DEMO_PROFILES.length });
  } catch (err) {
    console.error('BotPrints API: Error loading demo:', err);
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Unload Demo Data ───────────────────────────────────────────────────────
api.post('/unload-demo', async (c) => {
  try {
    const usernames = DEMO_PROFILES.map(p => p.username);
    for (const u of usernames) {
      await redis.del(`bp:user:${u}:profile`);
      await redis.del(`bp:user:${u}:scoreHistory`);
      await redis.del(`bp:dismissed:${u}`);
      await redis.del(`bp:appeal:${u}`);
    }
    await redis.zRem('bp:users:all', usernames);
    await redis.zRem('bp:scores:ranked', usernames);
    await redis.zRem('bp:scores:cleared', usernames);
    await redis.zRem('bp:scores:watchlist', usernames);
    await redis.zRem('bp:scores:actioned', usernames);
    await redis.zRem('bp:scores:filtered', usernames);
    await redis.zRem('bp:appeals:pending', usernames);
    
    return c.json({ status: 'ok', unloaded: usernames.length });
  } catch (err) {
    console.error('BotPrints API: Error unloading demo:', err);
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Dismiss User ───────────────────────────────────────────────────────────
api.post('/dismiss/:username', async (c) => {
  const username = c.req.param('username');
  try {
    await dismissUser(username);
    return c.json({ status: 'ok' });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Undismiss User ─────────────────────────────────────────────────────────
api.post('/undismiss/:username', async (c) => {
  const username = c.req.param('username');
  console.log(`BotPrints API: /undismiss/${username} called`);
  try {
    await undismissUser(username);
    
    // Immediately calculate risk score so they reappear
    const profile = await getUserProfile(username);
    const subreddit = await reddit.getCurrentSubreddit();
    const baseline = await getCommunityBaseline(subreddit.id);
    const breakdown = computeRiskScore(profile, baseline);
    if (breakdown.hasEnoughData) {
      await updateUserScore(username, breakdown.total);
    }
    
    return c.json({ status: 'ok' });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Watch User ─────────────────────────────────────────────────────────────
api.post('/watch/:username', async (c) => {
  const username = c.req.param('username');
  console.log(`BotPrints API: /watch/${username} called`);
  try {
    await addToWatchlist(username);
    console.log(`BotPrints API: Added u/${username} to watchlist in Redis`);
    return c.json({ status: 'ok' });
  } catch (err) {
    console.error(`BotPrints API: Failed to watch u/${username}:`, err);
    return c.json({ status: 'error', message: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3-TIER ENFORCEMENT ENGINE
// ═══════════════════════════════════════════════════════════════════════════

// ─── Tier 1: Filter → Modqueue (score 60-79) ───────────────────────────────
// Silently routes all future posts/comments to modqueue for human review.
// Zero user notification. Content is filtered, not removed.
api.post('/filter/:username', async (c) => {
  const username = c.req.param('username');
  console.log(`BotPrints API: /filter/${username} called`);
  try {
    const currentUser = await reddit.getCurrentUser();
    await addToFilterList(username);
    
    await incrementMetric('items_filtered', 1);
    await incrementMetric('accounts_actioned', 1);

    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'filter',
      username,
      performedBy: currentUser?.username || 'unknown',
      details: `Tier 1: All future content from u/${username} will be routed to modqueue for review.`,
    });

    console.log(`BotPrints API: Added u/${username} to filter list — future content goes to modqueue`);
    return c.json({ status: 'ok' });
  } catch (err) {
    console.error(`BotPrints API: Failed to filter u/${username}:`, err);
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Unfilter User ───────────────────────────────────────────────────────────
api.post('/unfilter/:username', async (c) => {
  const username = c.req.param('username');
  console.log(`BotPrints API: /unfilter/${username} called`);
  try {
    const currentUser = await reddit.getCurrentUser();
    await removeFromFilterList(username);
    
    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'filter',
      username,
      performedBy: currentUser?.username || 'unknown',
      details: `Removed u/${username} from filter list.`,
    });

    console.log(`BotPrints API: Removed u/${username} from filter list`);
    return c.json({ status: 'ok' });
  } catch (err) {
    console.error(`BotPrints API: Failed to unfilter u/${username}:`, err);
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Tier 2: Remove + Appeal (score 80-89) ─────────────────────────────────
// Auto-removes recent content. Sends modmail with appeal instructions.
// Stores pending appeal status in Redis per user.
api.post('/remove-appeal/:username', async (c) => {
  const username = c.req.param('username');
  console.log(`BotPrints API: /remove-appeal/${username} called`);
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const currentUser = await reddit.getCurrentUser();
    // Load configured appeal message
    const settings = await getAutoActionSettings();
    const rawReason = settings.appealMessage || `We've detected unusual activity patterns on your account. Please send a modmail to appeal.`;
    const removalReason = rawReason
      .replace(/\{username\}/g, username)
      .replace(/\{subreddit\}/g, subreddit.name);

    // Calculate expiry based on timeout
    let expiresAt: number | undefined;
    if (settings.appealTimeout !== 'never') {
      const hours = parseInt(settings.appealTimeout.replace('h', ''), 10);
      if (!isNaN(hours)) {
        expiresAt = Date.now() + hours * 60 * 60 * 1000;
      }
    }

    // Remove recent posts from this user
    let removedCount = 0;
    try {
      const posts = await reddit.getPostsByUser({ username, limit: 10 }).all();
      for (const post of posts) {
        if (post.subredditName === subreddit.name) {
          await post.remove();
          removedCount++;
        }
      }
    } catch (e) {
      console.warn(`BotPrints API: Could not fetch/remove posts for u/${username}:`, e);
    }

    // Remove recent comments from this user
    try {
      const comments = await reddit.getCommentsByUser({ username, limit: 25 }).all();
      for (const comment of comments) {
        if (comment.subredditName === subreddit.name) {
          await comment.remove();
          removedCount++;
        }
      }
    } catch (e) {
      console.warn(`BotPrints API: Could not fetch/remove comments for u/${username}:`, e);
    }

    // Also add to filter list so future content is caught
    await addToFilterList(username);

    // Mark user as actioned so they don't reappear on dashboard
    await markUserActioned(username);

    // Store appeal status
    const appealData: any = {
      status: 'pending',
      removalReason,
      createdAt: Date.now(),
    };
    if (expiresAt !== undefined) {
      appealData.expiresAt = expiresAt;
    }
    
    await setAppealStatus(username, appealData);

    // Send modmail TO THE USER with appeal instructions
    try {
      await reddit.modMail.createConversation({
        subredditName: subreddit.name,
        subject: `Content removed — appeal available`,
        body: removalReason,
        to: username,
        isAuthorHidden: true,
      });
      console.log(`BotPrints API: Sent appeal modmail to u/${username}`);
    } catch (e) {
      console.warn('BotPrints API: Could not send Tier 2 modmail to user:', e);
    }

    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'remove-appeal',
      username,
      performedBy: currentUser?.username || 'unknown',
      details: `Tier 2: Removed ${removedCount} item(s). Appeal status set to pending. Timeout: ${settings.appealTimeout}.`,
    });

    await incrementMetric('items_filtered', removedCount);
    await incrementMetric('appeals_sent', 1);
    await incrementMetric('accounts_actioned', 1);

    console.log(`BotPrints API: Tier 2 complete for u/${username} — ${removedCount} items removed, appeal pending`);
    return c.json({ status: 'ok', removedCount });
  } catch (err) {
    console.error(`BotPrints API: Tier 2 error for u/${username}:`, err);
    return c.json({ status: 'error', message: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// APPEAL WORKFLOW ENGINE (DASHBOARD ACTIONS)
// ═══════════════════════════════════════════════════════════════════════════

api.get('/appeals/pending', async (c) => {
  try {
    const appeals = await getAllPendingAppeals();
    return c.json({ status: 'ok', appeals });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

api.post('/appeals/:username/approve', async (c) => {
  const username = c.req.param('username');
  try {
    const currentUser = await reddit.getCurrentUser();
    
    // Set status to approved (which also removes from pending queue)
    await setAppealStatus(username, {
      status: 'approved',
      removalReason: 'Approved by moderator',
      createdAt: Date.now(),
    });
    
    // Dismiss the user so they move to the Safe tab and stop triggering alerts
    await dismissUser(username);
    
    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'dismiss',
      username,
      performedBy: currentUser?.username || 'unknown',
      details: `Appeal approved. Restored to normal monitoring.`,
    });
    
    // An approved appeal means they responded
    await incrementMetric('appeals_responded', 1);
    
    return c.json({ status: 'ok' });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

api.post('/appeals/:username/extend', async (c) => {
  const username = c.req.param('username');
  try {
    const currentUser = await reddit.getCurrentUser();
    const appeal = await getAppealStatus(username);
    if (!appeal || appeal.status !== 'pending') {
      return c.json({ status: 'error', message: 'No pending appeal found.' });
    }
    
    const newExpiresAt = (appeal.expiresAt || Date.now()) + 24 * 60 * 60 * 1000;
    await setAppealStatus(username, {
      ...appeal,
      expiresAt: newExpiresAt,
    });
    
    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'watch',
      username,
      performedBy: currentUser?.username || 'unknown',
      details: `Appeal timer extended by 24h.`,
    });
    
    return c.json({ status: 'ok', expiresAt: newExpiresAt });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

api.post('/appeals/:username/escalate', async (c) => {
  const username = c.req.param('username');
  try {
    const currentUser = await reddit.getCurrentUser();
    const subreddit = await reddit.getCurrentSubreddit();
    
    // Ban the user
    try {
      await reddit.banUser({
        subredditName: subreddit.name,
        username,
        duration: 0, // permanent
        reason: 'Failed appeal / Escalate from BotPrints',
        note: `BotPrints automated ban — appeal manually escalated. Actioned by ${currentUser?.username || 'mod'}.`,
        message: 'Your account has been permanently banned from this community following an unsuccessful appeal regarding detected automated or inauthentic behavior patterns.',
      });
    } catch (e) {
      console.warn(`BotPrints API: Failed to ban u/${username}:`, e);
    }
    
    await setAppealStatus(username, {
      status: 'denied',
      removalReason: 'Escalated to ban',
      createdAt: Date.now(),
    });

    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'ban-report',
      username,
      performedBy: currentUser?.username || 'unknown',
      details: `Appeal manually escalated. User banned.`,
    });

    await incrementMetric('bans_issued', 1);
    await incrementMetric('appeals_responded', 1); // An escalated appeal likely implies a response was evaluated

    // Store behavioral fingerprint for ban evasion detection
    try {
      const profile = await getUserProfile(username);
      const baseline = await getCommunityBaseline(subreddit.id);
      const breakdown = computeRiskScore(profile, baseline);
      if (breakdown.hasEnoughData) {
        await storeBanFingerprint(username, breakdown);
      }
    } catch (fpErr) {
      console.warn(`BotPrints: Could not store ban fingerprint for u/${username}:`, fpErr);
    }

    // Remove them from the active dashboard
    await removeUserScore(username);

    return c.json({ status: 'ok' });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }

});

// ─── Tier 3: Ban + Report (score 90+) ───────────────────────────────────────
// Permanently bans the user. Reports their recent content as spam to Reddit admins.
// Logs both actions to the mod audit trail.
api.post('/ban-report/:username', async (c) => {
  const username = c.req.param('username');
  console.log(`BotPrints API: /ban-report/${username} called`);
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const currentUser = await reddit.getCurrentUser();

    // Ban the user permanently
    let banSucceeded = false;
    try {
      await reddit.banUser({
        subredditName: subreddit.name,
        username,
        duration: 0, // permanent
        reason: 'BotPrints: Confirmed behavioral anomaly (score 90+)',
        note: `BotPrints automated ban — high risk score + confirmed behavioral anomaly. Actioned by ${currentUser?.username || 'mod'}.`,
        message: 'Your account has been permanently banned from this community due to detected automated or inauthentic behavior patterns.',
      });
      banSucceeded = true;
      console.log(`BotPrints API: Banned u/${username} from r/${subreddit.name}`);
    } catch (banErr) {
      const errStr = String(banErr);
      if (errStr.includes('CANT_RESTRICT_MODERATOR') || errStr.includes('MODERATOR')) {
        return c.json({ status: 'error', message: 'Cannot ban a subreddit moderator.' });
      }
      // If user is already banned or suspended, treat as success and skip content reporting
      if (errStr.includes('USER_DOESNT_EXIST') || errStr.includes('ALREADY_BANNED') || errStr.includes('404')) {
        banSucceeded = true;
        console.log(`BotPrints API: u/${username} is already banned/suspended — skipping content reporting.`);
      } else {
        console.warn(`BotPrints API: Failed to ban u/${username}:`, banErr);
      }
    }

    // Report recent content as spam to Reddit admins (skip if user is already gone)
    let reportedCount = 0;
    if (banSucceeded) {
      try {
        const posts = await reddit.getPostsByUser({ username, limit: 10 }).all();
        for (const post of posts) {
          if (post.subredditName === subreddit.name) {
            await reddit.report(post, { reason: 'BotPrints: Automated/inauthentic behavior — spam account' });
            await post.remove();
            reportedCount++;
          }
        }
      } catch (e) {
        // User may be suspended/shadow-banned — content is inaccessible. This is fine.
        console.log(`BotPrints API: Could not fetch posts for u/${username} (user may be suspended). Skipping.`);
      }

      try {
        const comments = await reddit.getCommentsByUser({ username, limit: 25 }).all();
        for (const comment of comments) {
          if (comment.subredditName === subreddit.name) {
            await reddit.report(comment, { reason: 'BotPrints: Automated/inauthentic behavior — spam account' });
            await comment.remove();
            reportedCount++;
          }
        }
      } catch (e) {
        console.log(`BotPrints API: Could not fetch comments for u/${username} (user may be suspended). Skipping.`);
      }
    }
    
    await incrementMetric('bans_issued', 1);
    await incrementMetric('items_filtered', reportedCount);
    await incrementMetric('accounts_actioned', 1);

    // Store behavioral fingerprint for ban evasion detection
    try {
      const profile = await getUserProfile(username);
      const baseline = await getCommunityBaseline(subreddit.id);
      const breakdown = computeRiskScore(profile, baseline);
      if (breakdown.hasEnoughData) {
        await storeBanFingerprint(username, breakdown);
      }
    } catch (fpErr) {
      console.warn(`BotPrints: Could not store ban fingerprint for u/${username}:`, fpErr);
    }

    // Remove them from the active dashboard and mark as actioned
    await markUserActioned(username);

    // Notify mod team via modmail
    try {
      await reddit.modMail.createModInboxConversation({
        subredditId: subreddit.id as any,
        subject: `BotPrints: u/${username} banned + content reported`,
        bodyMarkdown: `**Tier 3 Action — Ban + Report**\n\nu/${username} has been permanently banned from r/${subreddit.name}.\n\n**Actions taken:**\n- Permanent ban applied\n- ${reportedCount} item(s) reported to Reddit as spam and removed\n\n**Actioned by:** u/${currentUser?.username || 'unknown'}\n\n---\n\n*This action was taken based on a BotPrints risk score of 90+. If this was done in error, unban the user manually via mod tools.*`,
      });
    } catch (e) {
      console.warn('BotPrints API: Could not send Tier 3 modmail:', e);
    }

    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'ban-report',
      username,
      performedBy: currentUser?.username || 'unknown',
      details: `Tier 3: Permanently banned. ${reportedCount} item(s) reported as spam and removed.`,
    });

    console.log(`BotPrints API: Tier 3 complete for u/${username} — banned, ${reportedCount} items reported`);
    return c.json({ status: 'ok', reportedCount });
  } catch (err) {
    console.error(`BotPrints API: Tier 3 error for u/${username}:`, err);
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Single User Profile ────────────────────────────────────────────────────
api.get('/user/:username', async (c) => {
  const username = c.req.param('username');
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const profile = await getUserProfile(username);
    const baseline = await getCommunityBaseline(subreddit.id);
    const breakdown = computeRiskScore(profile, baseline);
    const history = await getScoreHistory(username);
    const shift = detectBehavioralShift(history);
    const isWatched = await isUserWatched(username);
    return c.json({ username, score: breakdown.total, breakdown, shift, profile, isWatched });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// RAID DETECTION API
// ═══════════════════════════════════════════════════════════════════════════

// ─── Raid Status (for dashboard banner) ─────────────────────────────────────
api.get('/raid-status', async (c) => {
  try {
    const state = await getRaidState();
    return c.json({ raid: state });
  } catch (err) {
    return c.json({ raid: null });
  }
});

// ─── AutoMod Rule Applier ───────────────────────────────────────────────────
api.post('/automod/apply', async (c) => {
  try {
    const { rule } = await c.req.json<{ rule: string }>();
    if (!rule) {
      return c.json({ status: 'error', message: 'No rule provided' });
    }

    const subreddit = await reddit.getCurrentSubreddit();
    const currentUser = await reddit.getCurrentUser();

    // Fetch the existing automod config
    let config = '';
    try {
      const page = await reddit.getWikiPage(subreddit.name, 'config/automoderator');
      config = page.content;
    } catch (e) {
      // Wiki page might not exist yet, that's fine, we create it
    }

    // Append the new rule
    const newConfig = config.trim() + '\n\n' + rule;
    
    // Update the wiki page
    await reddit.updateWikiPage({
      subredditName: subreddit.name,
      page: 'config/automoderator',
      content: newConfig,
      reason: 'BotPrints: Applied auto-generated ring defense rule',
    });

    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'watch',
      username: 'automod',
      performedBy: currentUser?.username || 'unknown',
      details: 'Applied BotPrints generated AutoMod rule',
    });

    return c.json({ status: 'ok' });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Metrics ────────────────────────────────────────────────────────────────
api.get('/metrics', async (c) => {
  try {
    const metrics = await getDashboardMetrics();
    return c.json({ status: 'ok', metrics });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Raid Settings ──────────────────────────────────────────────────────────
api.get('/raid-settings', async (c) => {
  try {
    const settings = await getRaidSettings();
    return c.json({ status: 'ok', settings });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

api.put('/raid-settings', async (c) => {
  try {
    const body = await c.req.json<Partial<RaidSettings>>();
    const current = await getRaidSettings();
    const updated: RaidSettings = {
      triggerThreshold: body.triggerThreshold ?? current.triggerThreshold,
      triggerWindowMinutes: body.triggerWindowMinutes ?? current.triggerWindowMinutes,
      minScoreForRaid: body.minScoreForRaid ?? current.minScoreForRaid,
    };
    await saveRaidSettings(updated);
    console.log('BotPrints API: Raid settings updated:', JSON.stringify(updated));
    return c.json({ status: 'ok', settings: updated });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Bulk Filter All Raid Participants ──────────────────────────────────────
api.post('/raid-filter-all', async (c) => {
  try {
    const state = await getRaidState();
    if (!state || !state.active) {
      return c.json({ status: 'error', message: 'No active raid to filter.' });
    }

    const currentUser = await reddit.getCurrentUser();
    let filteredCount = 0;

    for (const participant of state.participants) {
      try {
        await addToFilterList(participant.username);
        filteredCount++;
      } catch { /* skip individual failures */ }
    }

    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'filter',
      username: `raid:${state.participants.length}_users`,
      performedBy: currentUser?.username || 'unknown',
      details: `Bulk Raid Filter: ${filteredCount} participant(s) added to filter list.`,
    });
    
    await incrementMetric('rings_detected', 1);

    console.log(`BotPrints API: Bulk raid filter applied — ${filteredCount} users filtered`);
    return c.json({ status: 'ok', filteredCount });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

// ─── Clear Raid State ───────────────────────────────────────────────────────
api.post('/raid-clear', async (c) => {
  try {
    await clearRaidState();
    return c.json({ status: 'ok' });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-ACTION SETTINGS API
// ═══════════════════════════════════════════════════════════════════════════

api.get('/settings', async (c) => {
  try {
    const settings = await getAutoActionSettings();
    return c.json({ status: 'ok', settings });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

api.put('/settings', async (c) => {
  try {
    const body = await c.req.json<Partial<AutoActionSettings>>();
    const saved = await saveAutoActionSettings(body);
    console.log('BotPrints API: Settings updated');
    return c.json({ status: 'ok', settings: saved });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

api.post('/settings/reset', async (c) => {
  try {
    await redis.del('bp:settings:autoaction');
    const defaults = await getAutoActionSettings();
    console.log('BotPrints API: Settings reset to defaults');
    return c.json({ status: 'ok', settings: defaults });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG API
// ═══════════════════════════════════════════════════════════════════════════

api.get('/audit-log', async (c) => {
  try {
    const entries = await getAuditLog(100);
    return c.json({ status: 'ok', entries });
  } catch (err) {
    return c.json({ status: 'error', entries: [] });
  }
});

// ─── Actioned Users ─────────────────────────────────────────────────────────
api.get('/actioned', async (c) => {
  try {
    const actionedUsernames = await getActionedUsernames();
    const actionedUsers: any[] = [];
    for (const username of actionedUsernames) {
      try {
        const profile = await getUserProfile(username);
        const history = await getScoreHistory(username);
        const shift = detectBehavioralShift(history);
        actionedUsers.push({
          username,
          profile,
          shift,
          score: history[history.length - 1] || 0
        });
      } catch { /* skip */ }
    }
    return c.json({ users: actionedUsers });
  } catch (err) {
    return c.json({ error: 'failed' }, 500);
  }
});

api.post('/unaction/:username', async (c) => {
  const username = c.req.param('username');
  console.log(`BotPrints API: /unaction/${username} called`);
  try {
    const currentUser = await reddit.getCurrentUser();
    await unmarkUserActioned(username);
    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'unaction',
      username,
      performedBy: currentUser?.username || 'mod',
      details: `User removed from Actioned/Banned list for testing.`,
    });
    return c.json({ status: 'ok' });
  } catch (err) {
    return c.json({ error: 'failed' }, 500);
  }
});
