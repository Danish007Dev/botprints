// ─── BotPrints API Routes ───────────────────────────────────────────────────
// Internal API endpoints for client ↔ server communication.
// Will be expanded in Phase 5 (Dashboard UI) to serve scored user data.

import { Hono } from 'hono';

export const api = new Hono();

// Placeholder — API endpoints will be added in Phase 5
api.get('/health', (c) => {
  return c.json({ status: 'ok', app: 'botprints', version: '0.0.1' });
});
