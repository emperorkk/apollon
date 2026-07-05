import { Hono } from 'hono';
import { cors } from 'hono/cors';

import articles from './api/articles.js';
import graph from './api/graph.js';
import map from './api/map.js';
import search from './api/search.js';
import topics from './api/topics.js';
import regions from './api/regions.js';
import auth from './api/auth.js';
import push from './api/push.js';
import adminTopics from './api/admin/topics.js';
import adminSources from './api/admin/sources.js';
import adminStats from './api/admin/stats.js';
import { runCron } from './cron.js';

const app = new Hono();

app.use('/api/*', cors());

app.route('/api/articles', articles);
app.route('/api/articles', graph); // /api/articles/:id/graph
app.route('/api/map', map);
app.route('/api/search', search);
app.route('/api/topics', topics);
app.route('/api/regions', regions);
app.route('/api/auth', auth);
app.route('/api/push', push);
app.route('/api/admin/topics', adminTopics);
app.route('/api/admin/sources', adminSources);
app.route('/api/admin/stats', adminStats);

// Anything under /api/* that doesn't match a route above is a real 404.
// Anything else reaching the Worker is a path with no matching static file
// in frontend/ (e.g. /article/:id from a push notification) — fall back to
// the SPA shell so client-side code can handle it.
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
  return c.env.ASSETS.fetch(new URL('/index.html', c.req.url));
});

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
};
