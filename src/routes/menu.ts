// ─── BotPrints Menu Action Handlers ─────────────────────────────────────────
import { Hono } from 'hono';
import type { MenuItemRequest } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { runDailyAnalysis } from './scheduler.js';

export const menu = new Hono();

// ─── Open Dashboard ─────────────────────────────────────────────────────────
// src/routes/menu.ts

menu.post('/open-dashboard', async (c) => {
  await c.req.json<MenuItemRequest>();

  try {
    const post = await reddit.submitCustomPost({
      title: '🔬 BotPrints — Behavioral Forensics Dashboard',
      entry: 'default',
    });

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
