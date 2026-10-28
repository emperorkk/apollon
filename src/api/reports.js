import { Hono } from 'hono';

const app = new Hono();

// GET /api/reports?limit=N — latest daily reports (metadata only), used by
// the dashboard to surface the newest report. Full content lives on the
// server-rendered /reports/:date/:slug pages.
app.get('/', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '7', 10) || 7, 1), 30);
  const { results } = await c.env.DB.prepare(
    'SELECT report_date, slug, title, description, article_count FROM daily_reports ORDER BY report_date DESC LIMIT ?'
  )
    .bind(limit)
    .all();
  return c.json({
    reports: results.map((r) => ({ ...r, url: `/reports/${r.report_date}/${r.slug}` })),
  });
});

export default app;
