import { Hono } from 'hono';

const app = new Hono();

// GET /api/regions — distinct source regions, for the feed's region filter
// dropdown (spec §7.5). Not in the spec's §6 route table, which has no
// backing endpoint for this explicitly-required frontend filter.
app.get('/', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT DISTINCT region FROM sources WHERE active = 1 ORDER BY region')
    .all();
  return c.json({ regions: results.map((r) => r.region) });
});

export default app;
