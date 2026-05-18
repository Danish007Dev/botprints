// ─── BotPrints Trigger Handlers ─────────────────────────────────────────────
// Silent background data collection + real-time raid detection.
// RULES: Always try/catch. No unhandled exceptions.

import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnPostCreateRequest,
  OnPostUpdateRequest,
  OnCommentCreateRequest,
  OnCommentUpdateRequest,
  OnModMailRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import {
  getUserProfile,
  saveUserProfile,
  registerUser,
  isUserWatched,
  isUserFiltered,
  getCachedRiskScore,
  getCommunityBaseline,
  getScoreHistory,
  getAppealStatus,
  // Raid detection
  recordRaidActivity,
  checkRaidCondition,
  isRaidCooldownActive,
  setRaidCooldown,
  setRaidState,
  getRaidSettings,
} from '../storage/index.js';
import { computeRiskScore } from '../scoring/riskScore.js';
import { detectBehavioralShift } from '../scoring/shiftDetector.js';
import type { RaidParticipant } from '../types/index.js';

export const triggers = new Hono();

// ─── onAppInstall ───────────────────────────────────────────────────────────
triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('BotPrints installed to subreddit: r/' + input.subreddit?.name);
  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

// ─── onModMail ──────────────────────────────────────────────────────────────
triggers.post('/on-mod-mail', async (c) => {
  try {
    const input = await c.req.json<OnModMailRequest>();
    const username = input.messageAuthor?.name;
    if (!username) return c.json<TriggerResponse>({ status: 'success' }, 200);
    if (input.messageAuthorType !== 'participant_user') return c.json<TriggerResponse>({ status: 'success' }, 200);
    
    const appeal = await getAppealStatus(username);
    if (!appeal || appeal.status !== 'pending') return c.json<TriggerResponse>({ status: 'success' }, 200);
    
    const subredditName = input.conversationSubreddit?.name;
    if (!subredditName) return c.json<TriggerResponse>({ status: 'success' }, 200);

    const profile = await getUserProfile(username);
    const history = await getScoreHistory(username);
    const baseline = await getCommunityBaseline();
    const breakdown = computeRiskScore(profile, baseline);
    const shift = detectBehavioralShift(history);
    
    let annotation = `🚨 **BotPrints Appeal Annotation** 🚨\n\n`;
    annotation += `u/${username} is currently in **Pending Appeal** state.\n\n`;
    annotation += `**Risk Score**: ${breakdown.total}/100\n`;
    if (shift?.shifted) {
      annotation += `**Behavior Shift**: ⚠️ Magnitude ${shift.magnitude}x\n`;
    }
    annotation += `**Signals**: Time (${breakdown.temporal}), Day (${breakdown.circadian}), Act (${breakdown.engagement})\n\n`;
    annotation += `Review this user's appeal in the BotPrints Dashboard, or reply to them here.`;
    
    await reddit.modMail.reply({
      conversationId: input.conversationId,
      body: annotation,
      isInternal: true,
    });
    
    // Highlight the conversation for moderators to see clearly
    try {
      await reddit.modMail.highlightConversation(input.conversationId);
    } catch (e) {
      console.warn('BotPrints: Could not highlight modmail conversation:', e);
    }

    console.log(`BotPrints: Annotated modmail from pending appeal user u/${username}`);
  } catch (err) {
    console.error('BotPrints: /on-mod-mail error:', err);
  }
  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

// ─── Helper: Get highest signal name from a score breakdown ─────────────────
function getHighestSignal(breakdown: { temporal: number; circadian: number; engagement: number; editRate: number; burstSilence: number }): string {
  const signals = [
    { name: 'Timing regularity', value: breakdown.temporal, max: 25 },
    { name: 'Circadian pattern (24/7 activity)', value: breakdown.circadian, max: 20 },
    { name: 'Engagement ratio', value: breakdown.engagement, max: 20 },
    { name: 'Edit frequency', value: breakdown.editRate, max: 15 },
    { name: 'Burst-silence pattern', value: breakdown.burstSilence, max: 20 },
  ];
  // Sort by normalized value (value/max) descending
  signals.sort((a, b) => (b.value / b.max) - (a.value / a.max));
  return signals[0]!.name;
}

// ─── Helper: Build watchlist modmail for a specific piece of content ────────
async function sendWatchAlert(
  username: string,
  contentType: 'post' | 'comment',
  contentUrl: string | undefined,
  subredditId: string,
  subredditName: string
): Promise<void> {
  try {
    // Get current risk score for the alert
    const profile = await getUserProfile(username);
    const baseline = await getCommunityBaseline();
    const breakdown = computeRiskScore(profile, baseline);
    const highestSignal = getHighestSignal(breakdown);

    const directLink = contentUrl
      ? `[View the ${contentType}](${contentUrl})`
      : `[View u/${username}'s profile](https://www.reddit.com/user/${username})`;

    await reddit.modMail.createModInboxConversation({
      subredditId: subredditId as any,
      subject: `BotPrints Watch Alert — u/${username} just posted in r/${subredditName}`,
      bodyMarkdown:
        `🔬 **BotPrints Watch Alert**\n\n` +
        `**User:** u/${username}\n` +
        `**Activity:** New ${contentType} in r/${subredditName}\n` +
        `**Risk Score:** ${breakdown.total}/100\n` +
        `**Top Signal:** ${highestSignal}\n\n` +
        `${directLink}\n\n` +
        `---\n\n` +
        `**Quick actions:**\n` +
        `- ✅ Approve — content looks legitimate\n` +
        `- 🗑️ Remove — remove this ${contentType}\n` +
        `- 🚫 Ban — ban u/${username} from r/${subredditName}\n\n` +
        `*Use the moderation tools on the linked ${contentType} to take action.*`,
    });
    console.log(`BotPrints: Sent watch alert modmail for u/${username} (${contentType})`);
  } catch (e) {
    console.error('BotPrints: Failed to send watch alert:', e);
  }
}

// ─── Helper: Filter content to modqueue if user is on the filter list ───────
async function filterContentIfNeeded(
  username: string,
  contentType: 'post' | 'comment',
  contentId: string | undefined
): Promise<void> {
  try {
    const filtered = await isUserFiltered(username);
    if (!filtered || !contentId) return;

    // Use the filter/remove API to route content to modqueue
    if (contentType === 'post') {
      const post = await reddit.getPostById(contentId as `t3_${string}`);
      await post.remove(); // Remove from public feed → appears in modqueue
      console.log(`BotPrints: Filtered post ${contentId} by u/${username} to modqueue`);
    } else {
      const comment = await reddit.getCommentById(contentId as `t1_${string}`);
      await comment.remove(); // Remove from public feed → appears in modqueue
      console.log(`BotPrints: Filtered comment ${contentId} by u/${username} to modqueue`);
    }
  } catch (e) {
    console.warn(`BotPrints: Could not filter ${contentType} for u/${username}:`, e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RAID DETECTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O(1) raid check. Called after every post/comment from a scored user.
 * Steps:
 *   1. Lookup cached risk score (O(1) zScore)
 *   2. If score >= threshold, record activity in sliding window
 *   3. Check if window count >= raid trigger threshold
 *   4. If yes AND no cooldown → fire raid alert modmail
 */
async function checkForRaid(
  username: string,
  subredditId: string | undefined,
  subredditName: string | undefined
): Promise<void> {
  try {
    // 1. Fast cached score lookup — O(1)
    const cachedScore = await getCachedRiskScore(username);
    const settings = await getRaidSettings();

    if (cachedScore < settings.minScoreForRaid) {
      return; // Not suspicious enough to count toward raid
    }

    // 2. Record this user's activity in the sliding window
    await recordRaidActivity(username, cachedScore);

    // 3. Check if raid conditions are met
    const participants = await checkRaidCondition();
    if (!participants) {
      return; // Below threshold
    }

    // 4. Check cooldown — don't fire duplicate alerts
    if (await isRaidCooldownActive()) {
      return; // Already alerted recently
    }

    // 🚨 RAID DETECTED — Fire alert!
    console.log(`🚨 BotPrints: RAID DETECTED! ${participants.length} suspicious accounts active in last ${settings.triggerWindowMinutes} minutes`);

    // Set cooldown immediately to prevent duplicate alerts
    await setRaidCooldown();

    // Save raid state for dashboard banner
    const now = Date.now();
    await setRaidState({
      active: true,
      startedAt: now,
      participantCount: participants.length,
      participants: participants.slice(0, 20), // Cap at 20 for storage
      alertSentAt: now,
      cooldownEndsAt: now + 2 * 60 * 60 * 1000, // 2 hours
    });

    // Send raid alert modmail
    if (subredditId && subredditName) {
      await sendRaidAlert(participants, subredditId, subredditName);
    }
  } catch (e) {
    // Raid check must never crash the trigger
    console.warn('BotPrints: Raid check error (non-fatal):', e);
  }
}

/**
 * Send a raid alert modmail to the mod team.
 */
async function sendRaidAlert(
  participants: RaidParticipant[],
  subredditId: string,
  subredditName: string
): Promise<void> {
  try {
    const userList = participants
      .slice(0, 15) // Cap the list to keep modmail readable
      .map((p) => `- u/${p.username} — Risk Score: **${p.score}**/100`)
      .join('\n');

    const usernames = participants.map((p) => p.username);
    const usernameList = usernames.slice(0, 15).map((u) => `u/${u}`).join(', ');

    await reddit.modMail.createModInboxConversation({
      subredditId: subredditId as any,
      subject: `🚨 BotPrints RAID ALERT — ${participants.length} suspicious accounts active in r/${subredditName}`,
      bodyMarkdown:
        `# 🚨 Raid Alert\n\n` +
        `**${participants.length} accounts** with high behavioral anomaly scores have posted in r/${subredditName} within the last few minutes.\n\n` +
        `## Suspicious Accounts\n\n` +
        `${userList}\n\n` +
        `---\n\n` +
        `## Recommended Actions\n\n` +
        `1. **Check modqueue** — Content from these accounts may already be queued for review\n` +
        `2. **Open the BotPrints Dashboard** — Use the bulk action tools to Filter or Ban raid participants\n` +
        `3. **Filter All** — Automatically queue all future content from: ${usernameList}\n\n` +
        `---\n\n` +
        `*This alert has a 2-hour cooldown. You will not receive another raid alert for the same event.*\n` +
        `*Adjust raid detection thresholds in the BotPrints Dashboard settings.*`,
    });
    console.log(`BotPrints: Raid alert modmail sent — ${participants.length} participants`);
  } catch (e) {
    console.error('BotPrints: Failed to send raid alert modmail:', e);
  }
}

// ─── onPostCreate ───────────────────────────────────────────────────────────
// Updates: posts counter, postTimestamps (cap 50), hourBuckets, registers user
triggers.post('/on-post-create', async (c) => {
  try {
    const input = await c.req.json<OnPostCreateRequest>();
    const username = input.author?.name;
    if (!username || username === 'AutoModerator') {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }

    const profile = await getUserProfile(username);
    const createdAt = input.post?.createdAt;
    const hour = createdAt
      ? new Date(createdAt).getUTCHours()
      : new Date().getUTCHours();

    profile.posts += 1;
    profile.postTimestamps = [...profile.postTimestamps, Date.now()].slice(-50);
    profile.hourBuckets[hour] = (profile.hourBuckets[hour] ?? 0) + 1;

    console.log(`BotPrints: onPostCreate -> Registered post for u/${username}. Total posts: ${profile.posts}`);

    await saveUserProfile(username, profile);
    await registerUser(username);

    // Tier 1: Filter to modqueue if user is on the filter list
    const postId = input.post?.id;
    await filterContentIfNeeded(username, 'post', postId);

    // 🚨 Raid detection — check sliding window
    await checkForRaid(username, input.subreddit?.id, input.subreddit?.name);

    // Watchlist alert with direct link to the specific post
    if (await isUserWatched(username)) {
      if (input.subreddit?.id) {
        const postUrl = input.post?.permalink
          ? `https://www.reddit.com${input.post.permalink}`
          : undefined;
        await sendWatchAlert(
          username,
          'post',
          postUrl,
          input.subreddit.id,
          input.subreddit.name || 'unknown'
        );
      }
    }

    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onPostCreate trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});

// ─── onCommentCreate ────────────────────────────────────────────────────────
// Increments comment counter only
triggers.post('/on-comment-create', async (c) => {
  try {
    const input = await c.req.json<OnCommentCreateRequest>();
    const username = input.author?.name;
    if (!username || username === 'AutoModerator') {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }

    const profile = await getUserProfile(username);
    profile.comments += 1;

    console.log(`BotPrints: onCommentCreate -> Registered comment for u/${username}. Total comments: ${profile.comments}`);

    await saveUserProfile(username, profile);
    await registerUser(username);

    // Tier 1: Filter to modqueue if user is on the filter list
    const commentId = input.comment?.id;
    await filterContentIfNeeded(username, 'comment', commentId);

    // 🚨 Raid detection — check sliding window
    await checkForRaid(username, input.subreddit?.id, input.subreddit?.name);

    // Watchlist alert with direct link to the specific comment
    if (await isUserWatched(username)) {
      if (input.subreddit?.id) {
        const commentUrl = input.comment?.permalink
          ? `https://www.reddit.com${input.comment.permalink}`
          : undefined;
        await sendWatchAlert(
          username,
          'comment',
          commentUrl,
          input.subreddit.id,
          input.subreddit.name || 'unknown'
        );
      }
    }

    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onCommentCreate trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});

// ─── onPostUpdate ───────────────────────────────────────────────────────────
// Increments edit counter
triggers.post('/on-post-update', async (c) => {
  try {
    const input = await c.req.json<OnPostUpdateRequest>();
    const username = input.author?.name;
    if (!username) {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }

    const profile = await getUserProfile(username);
    profile.edits += 1;

    await saveUserProfile(username, profile);

    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onPostUpdate trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});

// ─── onCommentUpdate ────────────────────────────────────────────────────────
// Increments edit counter
triggers.post('/on-comment-update', async (c) => {
  try {
    const input = await c.req.json<OnCommentUpdateRequest>();
    const username = input.author?.name;
    if (!username) {
      return c.json<TriggerResponse>({ status: 'success' }, 200);
    }

    const profile = await getUserProfile(username);
    profile.edits += 1;

    await saveUserProfile(username, profile);

    return c.json<TriggerResponse>({ status: 'success' }, 200);
  } catch (err) {
    console.error('BotPrints: Error in onCommentUpdate trigger:', err);
    return c.json<TriggerResponse>({ status: 'success' }, 200);
  }
});
