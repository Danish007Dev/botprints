// ─── BotPrints Menu Action Handlers ─────────────────────────────────────────
import { Hono } from 'hono';
import type { MenuItemRequest } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { redis } from '@devvit/redis';
import { runDailyAnalysis } from './scheduler.js';

export const menu = new Hono();

// ─── SECURITY: Global Menu Moderator Check ──────────────────────────────────
menu.use('*', async (c, next) => {
  try {
    const currentUser = await reddit.getCurrentUser();
    const subreddit = await reddit.getCurrentSubreddit();

    if (!currentUser) {
      return c.json({ showToast: { text: '❌ Unauthorized: Not logged in', appearance: 'neutral' } }, 403);
    }

    const mods = await reddit.getModerators({
      subredditName: subreddit.name,
      username: currentUser.username,
    }).all();

    if (mods.length === 0) {
      return c.json({ showToast: { text: '❌ Forbidden: Moderator access required', appearance: 'neutral' } }, 403);
    }
  } catch (err) {
    console.error('BotPrints Menu: Error verifying moderator status:', err);
    return c.json({ showToast: { text: '❌ Error verifying moderator status', appearance: 'neutral' } }, 500);
  }

  return await next();
});

const DASHBOARD_POST_KEY = 'bp:dashboard:postId';

// ─── Open Dashboard ─────────────────────────────────────────────────────────
// Reuses an existing dashboard post if one has already been created.
// Only creates a new post when no valid stored post can be found.

menu.post('/open-dashboard', async (c) => {
  await c.req.json<MenuItemRequest>();

  try {
    // ─── Try to reuse the existing dashboard post ───────────────────────
    const storedPostId = await redis.get(DASHBOARD_POST_KEY);

    if (storedPostId) {
      try {
        const existing = await reddit.getPostById(storedPostId as `t3_${string}`);
        const postUrl = existing.url.startsWith('http')
          ? existing.url
          : `https://www.reddit.com${existing.permalink}`;

        return c.json(
          {
            showToast: {
              text: '📊 Opening existing dashboard...',
              appearance: 'success',
            },
            navigateTo: postUrl,
          },
          200
        );
      } catch {
        // Stored post no longer exists (deleted, etc.) — fall through to create a new one
        console.warn('BotPrints: Stored dashboard post not found, creating a new one.');
      }
    }

    // ─── Create a new dashboard post ────────────────────────────────────
    const post = await reddit.submitCustomPost({
      title: '🔬 BotPrints — Behavioral Forensics Dashboard',
      entry: 'default',
    });

    // ─── SECURITY: Hide dashboard from public feed ────────────────────────
    // Custom posts are public by default. We immediately remove the post
    // so it's hidden from the subreddit feed and search. Moderators can
    // still access removed posts, keeping the dashboard mod-only.
    try {
      await post.remove();
      await post.distinguish();
    } catch (modErr) {
      console.warn('BotPrints: Could not remove/distinguish dashboard post:', modErr);
      // Continue anyway — the menu action is already mod-gated
    }

    // ─── Persist the post ID for future reuse ─────────────────────────────
    await redis.set(DASHBOARD_POST_KEY, post.id);

    const postUrl = post.url.startsWith('http')
      ? post.url
      : `https://www.reddit.com${post.permalink}`;

    return c.json(
      {
        showToast: {
          text: '📊 Dashboard post created! Opening...',
          appearance: 'success',
        },
        navigateTo: postUrl,
      },
      200
    );
  } catch (err) {
    console.error('BotPrints: Error creating dashboard post:', err);
    return c.json(
      {
        success: false,
        effects: [
          {
            showToast: {
              toast: {
                text: '❌ Failed to create dashboard post.',
                appearance: 'NEUTRAL',
              },
            },
          },
        ],
      },
      200
    );
  }
});

// ─── Trigger Analysis Now ───────────────────────────────────────────────────
menu.post('/trigger-analysis', async (c) => {
  await c.req.json<MenuItemRequest>();
  try {
    await runDailyAnalysis();
    return c.json(
      {
        showToast: {
          text: '✅ BotPrints analysis complete!',
          appearance: 'success',
        },
      },
      200
    );
  } catch (err) {
    console.error('BotPrints: Error running manual analysis:', err);
    return c.json(
      {
        showToast: {
          text: '❌ Analysis failed. Check logs.',
          appearance: 'neutral',
        },
      },
      200
    );
  }
});
