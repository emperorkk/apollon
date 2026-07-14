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

// POST /api/admin/pending-articles/:id/retry — reset one failed article back
// to 'queued' so the next cron tick (or a manual "Run Ingestion Now") picks
// it up and resubmits it through the batch pipeline. The original RSS body
// is still stored on the row, so this doesn't need to refetch the source.
app.post('/:id/retry', async (c) => {
  const id = c.req.param('id');
  const { meta } = await c.env.DB.prepare(
    `UPDATE pending_articles
     SET status = 'queued', error_message = NULL, gpt_result = NULL, batch_id = NULL
     WHERE id = ? AND status = 'failed'`
  )
    .bind(id)
    .run();

  if (!meta.changes) return c.json({ error: 'Not found or not failed' }, 404);
  return c.json({ ok: true });
});

// POST /api/admin/pending-articles/retry-all — bulk version of the above.
app.post('/retry-all', async (c) => {
  const { meta } = await c.env.DB.prepare(
    `UPDATE pending_articles
     SET status = 'queued', error_message = NULL, gpt_result = NULL, batch_id = NULL
     WHERE status = 'failed'`
  ).run();

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
