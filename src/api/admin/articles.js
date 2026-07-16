import { Hono } from 'hono';
import { requireAdmin } from '../../lib/auth.js';
import { deleteArticleCascade } from '../../lib/db.js';

const app = new Hono();
app.use('/*', requireAdmin);

// DELETE /api/admin/articles/:id — remove an article and everything
// referencing it (topics, locations, entities, relations, FTS index entry,
// Vectorize embedding).
app.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const deleted = await deleteArticleCascade(c.env.DB, id);
  if (!deleted) return c.json({ error: 'Not found' }, 404);

  try {
    await c.env.VECTORIZE.deleteByIds([id]);
  } catch (err) {
    console.error(`[admin] failed to remove vector for deleted article ${id}: ${err.message}`);
  }

  return c.json({ ok: true });
});

export default app;
