import { Hono } from 'hono';
import { requireAdmin } from '../../lib/auth.js';

const app = new Hono();
app.use('/*', requireAdmin);

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM topics ORDER BY name').all();
  return c.json({ topics: results });
});

app.post('/', async (c) => {
  const { name, name_gr, keywords, color_hex, trigger_level } = await c.req.json();
  if (!name || !keywords || !color_hex) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO topics (name, name_gr, keywords, color_hex, trigger_level) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(name, name_gr ?? null, JSON.stringify(keywords), color_hex, trigger_level ?? 3)
    .run();

  return c.json({ ok: true }, 201);
});

app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const { name, name_gr, keywords, color_hex, trigger_level, active } = await c.req.json();

  await c.env.DB.prepare(
    `UPDATE topics SET
       name = COALESCE(?, name),
       name_gr = COALESCE(?, name_gr),
       keywords = COALESCE(?, keywords),
       color_hex = COALESCE(?, color_hex),
       trigger_level = COALESCE(?, trigger_level),
       active = COALESCE(?, active)
     WHERE id = ?`
  )
    .bind(
      name ?? null,
      name_gr ?? null,
      keywords ? JSON.stringify(keywords) : null,
      color_hex ?? null,
      trigger_level ?? null,
      active === undefined ? null : active ? 1 : 0,
      id
    )
    .run();

  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE topics SET active = 0 WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default app;
