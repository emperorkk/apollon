import { Hono } from 'hono';
import { requireAdmin } from '../../lib/auth.js';
import { runCron } from '../../cron.js';

const app = new Hono();
app.use('/*', requireAdmin);

// POST /api/admin/cron/run — manually kick off an ingestion cycle, for
// verifying the pipeline without waiting for the */30 schedule. Runs in the
// background (ctx.waitUntil) since a full cycle across all sources can take
// several minutes (Nominatim's 1 req/sec rate limit dominates); poll
// GET /api/admin/stats for last_cron_run to see progress/completion.
app.post('/run', async (c) => {
  const alreadyRunning = await c.env.DB.prepare(
    "SELECT 1 FROM cron_runs WHERE status = 'running' LIMIT 1"
  ).first();
  if (alreadyRunning) {
    return c.json({ started: false, reason: 'A cron run is already in progress' }, 409);
  }

  c.executionCtx.waitUntil(runCron(c.env));
  return c.json({ started: true });
});

export default app;
