import { Hono } from 'hono';
import { requireAdmin } from '../../lib/auth.js';

const app = new Hono();
app.use('/*', requireAdmin);

// GET /api/admin/pending-articles?status=failed — articles that dropped out
// of the batch pipeline (GPT/batch error, or an exception during finalize —
// see cron.js finalizeReadyArticles/syncBatchStatuses) and are stuck there
// until someone retries or discards them.
app.get('/', async (c) => {
  const status = c.req.query('status') || 'failed';
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.guid, p.url, p.title_orig, p.status, p.error_message, p.created_at,
            s.name AS source_name
     FROM pending_articles p
     LEFT JOIN sources s ON s.id = p.source_id
     WHERE p.status = ?
     ORDER BY p.created_at DESC
     LIMIT 200`
  )
    .bind(status)
    .all();

  return c.json({ pending_articles: results });
});

// A 'failed' row can have gotten there two different ways: a genuine
// OpenAI/batch failure (syncBatchStatuses caught an error, gpt_result was
// never populated) or an exception thrown by finalizeArticle *after* GPT
// already succeeded (gpt_result IS populated — see cron.js's finalize catch
// block, which only flips status, never clears it). Only the first kind
// needs to go back through the OpenAI batch queue; the second kind can — and
// should — go straight back to 'ready' so the very next cron tick re-runs
// (now-fixed) finalize immediately instead of waiting on a whole new batch
// submit/poll cycle (minutes to the full BATCH_COMPLETION_WINDOW).
const RETRY_SQL = `
  UPDATE pending_articles
  SET
    status = CASE WHEN gpt_result IS NOT NULL THEN 'ready' ELSE 'queued' END,
    error_message = NULL,
    batch_id = CASE WHEN gpt_result IS NOT NULL THEN batch_id ELSE NULL END
  WHERE status = 'failed'`;

// POST /api/admin/pending-articles/:id/retry — see RETRY_SQL above for how
// the target status is chosen. The original RSS body (and gpt_result, when
// present) is still stored on the row either way.
app.post('/:id/retry', async (c) => {
  const id = c.req.param('id');
  const { meta } = await c.env.DB.prepare(`${RETRY_SQL} AND id = ?`).bind(id).run();

  if (!meta.changes) return c.json({ error: 'Not found or not failed' }, 404);
  return c.json({ ok: true });
});

// POST /api/admin/pending-articles/retry-all — bulk version of the above.
app.post('/retry-all', async (c) => {
  const { meta } = await c.env.DB.prepare(RETRY_SQL).run();

  return c.json({ ok: true, retried: meta.changes });
});

// DELETE /api/admin/pending-articles/:id — permanently discard a failed
// article that isn't worth retrying (e.g. it keeps failing GPT validation).
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const { meta } = await c.env.DB.prepare("DELETE FROM pending_articles WHERE id = ? AND status = 'failed'")
    .bind(id)
    .run();

  if (!meta.changes) return c.json({ error: 'Not found or not failed' }, 404);
  return c.json({ ok: true });
});

export default app;
