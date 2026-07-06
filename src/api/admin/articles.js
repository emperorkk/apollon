import { Hono } from 'hono';
import { requireAdmin } from '../../lib/auth.js';

const app = new Hono();
app.use('/*', requireAdmin);

// DELETE /api/admin/articles/:id — remove an article and everything
// referencing it (topics, locations, entities, relations, FTS index entry,
// Vectorize embedding).
app.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const article = await db
    .prepare('SELECT rowid, title_en, title_orig, summary_en FROM articles WHERE id = ?')
    .bind(id)
    .first();
  if (!article) return c.json({ error: 'Not found' }, 404);

  // articles_fts is an external-content FTS5 table; rows can't just be
  // DELETEd from it directly — the documented way is the special 'delete'
  // command, which needs the old column values to correctly unindex them.
  await db.batch([
    db
      .prepare(
        `INSERT INTO articles_fts(articles_fts, rowid, title_en, title_orig, summary_en) VALUES ('delete', ?, ?, ?, ?)`
      )
      .bind(article.rowid, article.title_en, article.title_orig, article.summary_en),
    db.prepare('DELETE FROM article_topics WHERE article_id = ?').bind(id),
    db.prepare('DELETE FROM article_locations WHERE article_id = ?').bind(id),
    db.prepare('DELETE FROM article_entities WHERE article_id = ?').bind(id),
    db.prepare('DELETE FROM article_relations WHERE article_a = ? OR article_b = ?').bind(id, id),
    db.prepare('DELETE FROM articles WHERE id = ?').bind(id),
  ]);

  try {
    await c.env.VECTORIZE.deleteByIds([id]);
  } catch (err) {
    console.error(`[admin] failed to remove vector for deleted article ${id}: ${err.message}`);
  }

  return c.json({ ok: true });
});

export default app;
