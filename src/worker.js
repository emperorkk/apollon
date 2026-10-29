import { Hono } from 'hono';
import { cors } from 'hono/cors';

import articles from './api/articles.js';
import graph from './api/graph.js';
import map from './api/map.js';
import search from './api/search.js';
import topics from './api/topics.js';
import regions from './api/regions.js';
import keywords from './api/keywords.js';
import auth from './api/auth.js';
import push from './api/push.js';
import adminTopics from './api/admin/topics.js';
import adminSources from './api/admin/sources.js';
import adminStats from './api/admin/stats.js';
import adminCron from './api/admin/cron.js';
import adminArticles from './api/admin/articles.js';
import adminPending from './api/admin/pending.js';
import adminReports from './api/admin/reports.js';
import reports from './api/reports.js';
import health from './api/health.js';
import web from './web/reports.js';
import { runCron } from './cron.js';
import { runRetention } from './pipeline/retention.js';
import { generateDailyReport, notifyDailyReport, ensureTranslations } from './pipeline/daily-report.js';
import { RETENTION_CRON, DAILY_REPORT_CRON } from './lib/constants.js';
import { cacheControlMiddleware, purgeCacheTag } from './lib/cache-policy.js';
import { securityHeadersMiddleware } from './lib/security-headers.js';

// strict: false — /api/health/ and /reports/ match the same routes as
// /api/health and /reports instead of falling through to a 404.
const app = new Hono({ strict: false });

app.use('*', securityHeadersMiddleware());
app.use('*', cacheControlMiddleware());
app.use('/api/*', cors());

app.route('/api/articles', articles);
app.route('/api/articles', graph); // /api/articles/:id/graph
app.route('/api/map', map);
app.route('/api/search', search);
app.route('/api/topics', topics);
app.route('/api/regions', regions);
app.route('/api/keywords', keywords);
app.route('/api/reports', reports);
app.route('/api/health', health);
app.route('/api/auth', auth);
app.route('/api/push', push);
app.route('/api/admin/topics', adminTopics);
app.route('/api/admin/sources', adminSources);
app.route('/api/admin/stats', adminStats);
app.route('/api/admin/cron', adminCron);
app.route('/api/admin/articles', adminArticles);
app.route('/api/admin/pending-articles', adminPending);
app.route('/api/admin/reports', adminReports);

// Server-rendered, indexable pages: /reports, /reports/:date/:slug,
// /reports/rss.xml, /sitemap.xml, /robots.txt.
app.route('/', web);

// Anything under /api/* that doesn't match a route above is a real 404.
// Anything else reaching the Worker is a path with no matching static file
// in frontend/ (e.g. /article/:id from a push notification) — fall back to
// the SPA shell so client-side code can handle it.
app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found', path: c.req.path }, 404);
  // The dashboard's only deep link (push notifications open /article/:id):
  // serve the SPA shell, which opens that article's card.
  if (/^\/article\/[^/]+$/.test(c.req.path)) return c.env.ASSETS.fetch(new URL('/', c.req.url));
  // Everything else is a real 404 — previously every unknown URL returned
  // the dashboard with status 200, which search engines treat as "soft 404"
  // duplicates of the home page.
  const page = await c.env.ASSETS.fetch(new URL('/404', c.req.url));
  return new Response(page.body, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    if (event.cron === RETENTION_CRON) {
      ctx.waitUntil(runRetention(env));
      return;
    }
    if (event.cron === DAILY_REPORT_CRON) {
      ctx.waitUntil(
        generateDailyReport(env).then(async (result) => {
          const backfilled = await ensureTranslations(env);
          if (result.status === 'created' || backfilled) await purgeCacheTag(ctx, 'reports');
          if (result.status === 'created') await notifyDailyReport(env, result);
        })
      );
      return;
    }
    ctx.waitUntil(runCron(env));
  },
};
