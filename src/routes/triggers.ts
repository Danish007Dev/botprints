// ─── BotPrints Trigger Handlers ─────────────────────────────────────────────
// Silent background data collection. No UI output.
// PERFORMANCE: Each trigger must complete in <100ms.
// RULES: Max 2 Redis ops per trigger (1 read + 1 write).
//        No Reddit API calls. No score computation. Always try/catch.

import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnPostCreateRequest,
  OnPostUpdateRequest,
  OnCommentCreateRequest,
  OnCommentUpdateRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import {
  getUserProfile,
  saveUserProfile,
  registerUser,
  isUserWatched,
  isUserFiltered,
  getScoreHistory,
} from '../storage/index.js';
import { computeRiskScore } from '../scoring/riskScore.js';
import { getCommunityBaseline } from '../storage/index.js';

export const triggers = new Hono();

// ─── onAppInstall ───────────────────────────────────────────────────────────
triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('BotPrints installed to subreddit: r/' + input.subreddit?.name);
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
  return signals[0].name;
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
      const post = await reddit.getPostById(contentId);
      await post.remove(); // Remove from public feed → appears in modqueue
      console.log(`BotPrints: Filtered post ${contentId} by u/${username} to modqueue`);
    } else {
      const comment = await reddit.getCommentById(contentId);
      await comment.remove(); // Remove from public feed → appears in modqueue
      console.log(`BotPrints: Filtered comment ${contentId} by u/${username} to modqueue`);
    }
  } catch (e) {
    console.warn(`BotPrints: Could not filter ${contentType} for u/${username}:`, e);
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
