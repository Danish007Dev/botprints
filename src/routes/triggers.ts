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
import { getUserProfile, saveUserProfile, registerUser, isUserWatched } from '../storage/index.js';

export const triggers = new Hono();

// ─── onAppInstall ───────────────────────────────────────────────────────────
triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('BotPrints installed to subreddit: r/' + input.subreddit?.name);
  return c.json<TriggerResponse>({ status: 'success' }, 200);
});

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

    if (await isUserWatched(username)) {
      if (input.subreddit?.id) {
        try {
          await reddit.modMail.createModInboxConversation({
            subredditId: input.subreddit.id as any,
            subject: `BotPrints Watchlist Alert: u/${username}`,
            bodyMarkdown: `⚠️ **Watched User Activity Detected** ⚠️\n\nThe monitored user u/${username} has just made a new post in r/${input.subreddit.name}.\n\n[Review their activity](https://www.reddit.com/user/${username}) to ensure it follows community guidelines.`
          });
          console.log(`BotPrints: Successfully sent Watchlist Modmail for u/${username}`);
        } catch (e) {
          console.error('BotPrints: Failed to send watch alert:', e);
        }
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

    if (await isUserWatched(username)) {
      if (input.subreddit?.id) {
        try {
          await reddit.modMail.createModInboxConversation({
            subredditId: input.subreddit.id as any,
            subject: `BotPrints Watchlist Alert: u/${username}`,
            bodyMarkdown: `⚠️ **Watched User Activity Detected** ⚠️\n\nThe monitored user u/${username} has just made a new comment in r/${input.subreddit.name}.\n\n[Review their activity](https://www.reddit.com/user/${username}) to ensure it follows community guidelines.`
          });
          console.log(`BotPrints: Successfully sent Watchlist Modmail for u/${username}`);
        } catch (e) {
          console.error('BotPrints: Failed to send watch alert:', e);
        }
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
