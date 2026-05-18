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
  dismissUser,
  undismissUser,
  getClearedUsernames,
  addToWatchlist,
  isUserWatched,
  // 3-Tier Enforcement
  addToFilterList,
  setAppealStatus,
  appendAuditEntry,
  // Raid Detection
  getRaidState,
  clearRaidState,
  getRaidSettings,
  saveRaidSettings,
} from '../storage/index.js';
import { computeRiskScore } from '../scoring/riskScore.js';
import { detectBehavioralShift } from '../scoring/shiftDetector.js';
import { detectCoordinatedGroups } from '../scoring/coordinatedDetector.js';
import { DEMO_PROFILES } from '../data/demoData.js';
import { DEFAULT_BASELINE } from '../types/index.js';
import type { ScoredUser, SubredditSummary, RaidSettings } from '../types/index.js';

export const api = new Hono();

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
    const baseline = await getCommunityBaseline();
    const allUsernames = await getAllUsernames();
    const scoredUsers: ScoredUser[] = [];

    for (const { username } of topUsers) {
      try {
        const profile = await getUserProfile(username);
        const breakdown = computeRiskScore(profile, baseline);
        const history = await getScoreHistory(username);
        const shift = detectBehavioralShift(history);
        const isWatched = await isUserWatched(username);
        scoredUsers.push({ username, score: breakdown.total, breakdown, shift, profile, isWatched });
      } catch { /* skip */ }
    }

    const clearedUsernames = await getClearedUsernames();
    const clearedUsers: ScoredUser[] = [];
    for (const username of clearedUsernames) {
      try {
        const profile = await getUserProfile(username);
        const breakdown = computeRiskScore(profile, baseline);
        const history = await getScoreHistory(username);
        const shift = detectBehavioralShift(history);
        const isWatched = await isUserWatched(username);
        clearedUsers.push({ username, score: breakdown.total, breakdown, shift, profile, isWatched, isCleared: true });
      } catch { /* skip */ }
    }

    // Coordinated group detection
    const coordGroups = detectCoordinatedGroups(scoredUsers);
    // Tag users with their group ID
    for (const group of coordGroups) {
      for (const member of group.members) {
        const user = scoredUsers.find(u => u.username === member);
        if (user) user.coordGroup = group.id;
      }
    }

    // Subreddit summary
    const highRiskCount = scoredUsers.filter(u => u.score >= 70).length;
    const shiftedCount = scoredUsers.filter(u => u.shift?.shifted).length;
    const avgRisk = scoredUsers.length > 0
      ? scoredUsers.reduce((s, u) => s + u.score, 0) / scoredUsers.length
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

    return c.json({ users: scoredUsers, clearedUsers, coordGroups, summary, baseline, isDemoLoaded });
  } catch (err) {
    console.error('BotPrints API error:', err);
    return c.json({
      users: [], coordGroups: [], baseline: DEFAULT_BASELINE,
      summary: { totalTracked: 0, highRiskCount: 0, shiftedCount: 0, coordGroupCount: 0, healthScore: 100, lastScan: 0 },
    });
  }
});

// ─── Load Demo Data ─────────────────────────────────────────────────────────
api.post('/load-demo', async (c) => {
  try {
    const baseline = await getCommunityBaseline();
    for (const profile of DEMO_PROFILES) {
      await saveUserProfile(profile.username, profile);
      await registerUser(profile.username);
      const breakdown = computeRiskScore(profile, baseline);
      await updateUserScore(profile.username, breakdown.total);
      const fakeHistory = Array.from({ length: 7 }, () =>
        Math.max(0, breakdown.total + Math.floor(Math.random() * 20 - 10))
      );
      for (const s of fakeHistory) {
        await appendScoreHistory(profile.username, s);
      }
    }
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
    }
    await redis.zRem('bp:users:all', usernames);
    await redis.zRem('bp:scores:ranked', usernames);
    await redis.zRem('bp:scores:cleared', usernames);
    await redis.zRem('bp:scores:watchlist', usernames);
    
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
    const baseline = await getCommunityBaseline();
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

// ─── Tier 2: Remove + Appeal (score 80-89) ─────────────────────────────────
// Auto-removes recent content. Sends modmail with appeal instructions.
// Stores pending appeal status in Redis per user.
api.post('/remove-appeal/:username', async (c) => {
  const username = c.req.param('username');
  console.log(`BotPrints API: /remove-appeal/${username} called`);
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const currentUser = await reddit.getCurrentUser();
    const removalReason = `We've detected unusual activity patterns on your account. If you believe this is an error, please send a modmail to r/${subreddit.name} with a brief explanation of your recent activity to appeal this action.`;

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

    // Store appeal status
    await setAppealStatus(username, {
      status: 'pending',
      removalReason,
      createdAt: Date.now(),
    });

    // Send modmail to the user with appeal instructions
    try {
      await reddit.modMail.createModInboxConversation({
        subredditId: subreddit.id as any,
        subject: `BotPrints: Content removed for u/${username} — appeal available`,
        bodyMarkdown: `**Tier 2 Action — Remove + Appeal**\n\nu/${username} has been flagged with a high behavioral anomaly score.\n\n**Action taken:** ${removedCount} item(s) removed from r/${subreddit.name}. Future content is being filtered to modqueue.\n\n**Appeal reason sent to user:** ${removalReason}\n\n---\n\n*Review this user's appeal when they respond via modmail. Approve or deny within 1 hour if possible.*`,
      });
    } catch (e) {
      console.warn('BotPrints API: Could not send Tier 2 modmail:', e);
    }

    await appendAuditEntry({
      timestamp: Date.now(),
      action: 'remove-appeal',
      username,
      performedBy: currentUser?.username || 'unknown',
      details: `Tier 2: Removed ${removedCount} item(s). Appeal status set to pending. Future content filtered.`,
    });

    console.log(`BotPrints API: Tier 2 complete for u/${username} — ${removedCount} items removed, appeal pending`);
    return c.json({ status: 'ok', removedCount });
  } catch (err) {
    console.error(`BotPrints API: Tier 2 error for u/${username}:`, err);
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
    try {
      await reddit.banUser({
        subredditName: subreddit.name,
        username,
        duration: 0, // permanent
        reason: 'BotPrints: Confirmed behavioral anomaly (score 90+)',
        note: `BotPrints automated ban — high risk score + confirmed behavioral anomaly. Actioned by ${currentUser?.username || 'mod'}.`,
        message: 'Your account has been permanently banned from this community due to detected automated or inauthentic behavior patterns.',
      });
      console.log(`BotPrints API: Banned u/${username} from r/${subreddit.name}`);
    } catch (banErr) {
      const errStr = String(banErr);
      if (errStr.includes('CANT_RESTRICT_MODERATOR') || errStr.includes('MODERATOR')) {
        return c.json({ status: 'error', message: 'Cannot ban a subreddit moderator.' });
      }
      throw banErr;
    }

    // Report recent content as spam to Reddit admins
    let reportedCount = 0;
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
      console.warn(`BotPrints API: Could not report posts for u/${username}:`, e);
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
      console.warn(`BotPrints API: Could not report comments for u/${username}:`, e);
    }

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
    const profile = await getUserProfile(username);
    const baseline = await getCommunityBaseline();
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
