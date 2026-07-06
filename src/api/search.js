import { Hono } from 'hono';
import { MAX_FEED_DAYS } from '../lib/constants.js';

const app = new Hono();

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

// GET /api/search — matches title/summary text (FTS5), named entity
// keywords (people/orgs/locations extracted per article), and source
// name/id — so searching "BBC" or "Khamenei" finds articles even when
// that text isn't itself in the title or summary.
app.get('/', async (c) => {
  const db = c.env.DB;
  const q = c.req.query('q');
  if (!q) return c.json({ articles: [] });

  const days = clamp(parseInt(c.req.query('days') ?? String(MAX_FEED_DAYS), 10) || MAX_FEED_DAYS, 1, MAX_FEED_DAYS);
  const topic = c.req.query('topic');
  const like = `%${q}%`;

  const conditions = [
    `a.id IN (
       SELECT a2.id FROM articles_fts f JOIN articles a2 ON a2.rowid = f.rowid WHERE articles_fts MATCH ?
       UNION
       SELECT ae.article_id FROM article_entities ae WHERE ae.entity_name LIKE ?
       UNION
       SELECT a3.id FROM articles a3 JOIN sources s ON s.id = a3.source_id WHERE s.name LIKE ? OR s.id LIKE ?
     )`,
    `a.pub_date >= datetime('now', ?)`,
  ];
  const binds = [q, like, like, like, `-${days} days`];

  if (topic) {
    conditions.push(
      'a.id IN (SELECT article_id FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id WHERE t.name = ?)'
    );
    binds.push(topic);
  }

  const sql = `
    SELECT a.id, a.title_en, a.title_orig, a.summary_en, a.synopsis_gr,
           a.importance, a.pub_date, a.source_id
    FROM articles a
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.importance DESC, a.pub_date DESC
    LIMIT 50
  `;
  const { results } = await db.prepare(sql).bind(...binds).all();

  return c.json({ articles: results });
});

export default app;
