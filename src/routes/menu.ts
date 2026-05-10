// ─── BotPrints Menu Action Handlers ─────────────────────────────────────────
import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { runDailyAnalysis } from './scheduler.js';

export const menu = new Hono();

// ─── Open Dashboard ─────────────────────────────────────────────────────────
menu.post('/open-dashboard', async (c) => {
  await c.req.json<MenuItemRequest>();

  try {
    await reddit.submitCustomPost({
      title: '🔬 BotPrints — Behavioral Forensics Dashboard',
      entry: 'default',
    });
    return c.json<UiResponse>(
      { showToast: { text: '📊 Dashboard post created! Open it to view results.', appearance: 'success' } },
      200
    );
  } catch (err) {
    console.error('BotPrints: Error creating dashboard post:', err);
    return c.json<UiResponse>(
      { showToast: { text: '❌ Failed to create dashboard post. Check logs.', appearance: 'neutral' } },
      200
    );
  }
});

// ─── Trigger Analysis Now ───────────────────────────────────────────────────
menu.post('/trigger-analysis', async (c) => {
  await c.req.json<MenuItemRequest>();
  try {
    await runDailyAnalysis();
    return c.json<UiResponse>(
      { showToast: { text: '✅ BotPrints analysis complete!', appearance: 'success' } },
      200
    );
  } catch (err) {
    console.error('BotPrints: Error running manual analysis:', err);
    return c.json<UiResponse>(
      { showToast: { text: '❌ Analysis failed. Check logs.', appearance: 'neutral' } },
      200
    );
  }
});
