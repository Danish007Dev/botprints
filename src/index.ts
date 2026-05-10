// ─── BotPrints Server Entry Point ───────────────────────────────────────────
// Hono-based server for Devvit 0.12
// Registers trigger handlers, scheduler endpoints, menu actions, and API routes.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api.js';
import { triggers } from './routes/triggers.js';
import { scheduler } from './routes/scheduler.js';
import { menu } from './routes/menu.js';

const app = new Hono();
const internal = new Hono();

internal.route('/triggers', triggers);
internal.route('/scheduler', scheduler);
internal.route('/menu', menu);

app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
