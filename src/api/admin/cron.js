import { Hono } from 'hono';
import { requireAdmin } from '../../lib/auth.js';
import { runCron } from '../../cron.js';

const app = new Hono();
app.use('/*', requireAdmin);

// POST /api/admin/cron/run — manually kick off an ingestion cycle, for
// verifying the pipeline without waiting for the */30 schedule. Awaited
// synchronously (NOT ctx.waitUntil) so the whole run completes within this
// request's lifetime: detached waitUntil() work only gets a short grace
// period after the response is sent, which was cutting ingestion off after
// only a handful of sources. GPT processing goes through the Batch API
// (see cron.js), so a full run here is normally quick — the exception is
// the bounded finalize step, which is capped per tick specifically to keep
// this fast.
// A run stuck at 'running' for longer than this is assumed dead (crashed,
// killed by a platform limit, etc.) rather than genuinely still in
// progress — a full run should normally finish in well under a minute — so
// it's auto-cleared instead of blocking every future run forever.
const STALE_RUN_MINUTES = 5;

app.post('/run', async (c) => {
  const db = c.env.DB;

  await db
    .prepare(
      `UPDATE cron_runs SET status = 'error', finished_at = datetime('now'),
         error_message = 'Stale run auto-cleared (exceeded ${STALE_RUN_MINUTES} min)'
       WHERE status = 'running' AND started_at < datetime('now', '-${STALE_RUN_MINUTES} minutes')`
    )
    .run();

  const alreadyRunning = await db.prepare("SELECT 1 FROM cron_runs WHERE status = 'running' LIMIT 1").first();
  if (alreadyRunning) {
    return c.json({ started: false, reason: 'A cron run is already in progress' }, 409);
  }

  const summary = await runCron(c.env);
  return c.json({ started: true, ...summary });
});

export default app;
