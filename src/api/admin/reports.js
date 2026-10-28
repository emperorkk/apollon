import { Hono } from 'hono';
import { requireAdmin } from '../../lib/auth.js';
import { generateDailyReport, translateReport } from '../../pipeline/daily-report.js';
import { previousAthensDay } from '../../lib/time.js';
import { purgeCacheTag } from '../../lib/cache-policy.js';

const app = new Hono();
app.use('/*', requireAdmin);

// POST /api/admin/reports/generate { date?: 'YYYY-MM-DD', force?: boolean }
// Runs the daily report for a given Athens calendar day on demand (defaults to
// yesterday). force regenerates an existing report in place.
app.post('/generate', async (c) => {
  const { date, force } = await c.req.json().catch(() => ({}));
  const day = date || previousAthensDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);

  try {
    const result = await generateDailyReport(c.env, day, { force: Boolean(force) });
    if (result.status === 'created') await purgeCacheTag(c.executionCtx, 'reports');
    return c.json(result);
  } catch (err) {
    console.error(`[admin] daily report ${day} failed: ${err.message}`);
    return c.json({ error: err.message }, 502);
  }
});

// POST /api/admin/reports/:date/translate — (re)create the Greek version.
app.post('/:date/translate', async (c) => {
  try {
    await translateReport(c.env, c.req.param('date'), 'el');
    await purgeCacheTag(c.executionCtx, 'reports');
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 502);
  }
});

// DELETE /api/admin/reports/:date
app.delete('/:date', async (c) => {
  const date = c.req.param('date');
  const [, { meta }] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM daily_report_translations WHERE report_date = ?').bind(date),
    c.env.DB.prepare('DELETE FROM daily_reports WHERE report_date = ?').bind(date),
  ]);
  if (!meta.changes) return c.json({ error: 'Not found' }, 404);
  await purgeCacheTag(c.executionCtx, 'reports');
  return c.json({ ok: true });
});

export default app;
