import { Hono } from 'hono';
import { requireAdmin } from '../../lib/auth.js';

const app = new Hono();
app.use('/*', requireAdmin);

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM sources ORDER BY name').all();
  return c.json({ sources: results });
});

app.post('/', async (c) => {
  const { name, rss_url, region, language, category_bias } = await c.req.json();
  if (!name || !rss_url || !region || !language) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const id = slugify(name);
  await c.env.DB.prepare(
    `INSERT INTO sources (id, name, rss_url, region, language, category_bias) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, name, rss_url, region, language, category_bias ?? null)
    .run();

  return c.json({ ok: true, id }, 201);
});

app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const { name, rss_url, region, language, category_bias, active } = await c.req.json();

  await c.env.DB.prepare(
    `UPDATE sources SET
       name = COALESCE(?, name),
       rss_url = COALESCE(?, rss_url),
       region = COALESCE(?, region),
       language = COALESCE(?, language),
       category_bias = COALESCE(?, category_bias),
       active = COALESCE(?, active)
     WHERE id = ?`
  )
    .bind(
      name ?? null,
      rss_url ?? null,
      region ?? null,
      language ?? null,
      category_bias ?? null,
      active === undefined ? null : active ? 1 : 0,
      id
    )
    .run();

  return c.json({ ok: true });
});

export default app;
