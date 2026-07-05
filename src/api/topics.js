import { Hono } from 'hono';

const app = new Hono();

// GET /api/topics — active topics for filter pills and map legend
app.get('/', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT id, name, name_gr, color_hex FROM topics WHERE active = 1')
    .all();
  return c.json({ topics: results });
});

export default app;
