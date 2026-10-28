import { Hono } from 'hono';
import { requireAdmin } from '../../lib/auth.js';
import { generateDailyReport, previousUtcDay } from '../../pipeline/daily-report.js';

const app = new Hono();
app.use('/*', requireAdmin);

// POST /api/admin/reports/generate { date?: 'YYYY-MM-DD', force?: boolean }
// Runs the daily report for a given UTC day on demand (defaults to
// yesterday). force regenerates an existing report in place.
app.post('/generate', async (c) => {
  const { date, force } = await c.req.json().catch(() => ({}));
  const day = date || previousUtcDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);

  try {
    const result = await generateDailyReport(c.env, day, { force: Boolean(force) });
    return c.json(result);
  } catch (err) {
    console.error(`[admin] daily report ${day} failed: ${err.message}`);
    return c.json({ error: err.message }, 502);
  }
});

// DELETE /api/admin/reports/:date
app.delete('/:date', async (c) => {
  const { meta } = await c.env.DB.prepare('DELETE FROM daily_reports WHERE report_date = ?').bind(c.req.param('date')).run();
  return meta.changes ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
});

export default app;
