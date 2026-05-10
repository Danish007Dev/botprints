// ─── BotPrints Menu Action Handlers ─────────────────────────────────────────
// Mod-only menu actions for opening dashboard and triggering analysis.

import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { runDailyAnalysis } from './scheduler.js';

export const menu = new Hono();

// ─── Open Dashboard ─────────────────────────────────────────────────────────
// Creates a custom post with the BotPrints dashboard
menu.post('/open-dashboard', async (c) => {
  await c.req.json<MenuItemRequest>();

  // TODO Phase 5: Create a custom post with the dashboard UI
  // For now, show a toast confirming the action
  return c.json<UiResponse>(
    {
      showToast: {
        text: '📊 BotPrints Dashboard — coming in Phase 5! Analysis triggers are active.',
        appearance: 'success',
      },
    },
    200
  );
});

// ─── Trigger Analysis Now ───────────────────────────────────────────────────
// Manually runs the daily analysis without waiting for the cron schedule
menu.post('/trigger-analysis', async (c) => {
  await c.req.json<MenuItemRequest>();

  try {
    await runDailyAnalysis();
    return c.json<UiResponse>(
      {
        showToast: {
          text: '✅ BotPrints analysis complete! Check logs for results.',
          appearance: 'success',
        },
      },
      200
    );
  } catch (err) {
    console.error('BotPrints: Error running manual analysis:', err);
    return c.json<UiResponse>(
      {
        showToast: {
          text: '❌ Analysis failed. Check logs for details.',
          appearance: 'neutral',
        },
      },
      200
    );
  }
});
