import { Hono } from 'hono';

const app = new Hono();

// GET /api/reports?limit=N — latest daily reports (metadata only), used by
// the dashboard to surface the newest report. Full content lives on the
// server-rendered /reports/:date/:slug pages.
app.get('/', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '7', 10) || 7, 1), 30);
  const { results } = await c.env.DB.prepare(
    `SELECT r.report_date, r.slug, r.title, r.description, r.article_count, t.slug AS el_slug, t.title AS el_title
     FROM daily_reports r
     LEFT JOIN daily_report_translations t ON t.report_date = r.report_date AND t.lang = 'el'
     ORDER BY r.report_date DESC LIMIT ?`
  )
    .bind(limit)
    .all();
  return c.json({
    reports: results.map(({ el_slug: elSlug, el_title: elTitle, ...r }) => ({
      ...r,
      url: `/reports/${r.report_date}/${r.slug}`,
      el: elSlug ? { title: elTitle, url: `/el/reports/${r.report_date}/${elSlug}` } : null,
    })),
  });
});

export default app;
