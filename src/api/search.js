import { Hono } from 'hono';
import { MAX_FEED_DAYS } from '../lib/constants.js';

const app = new Hono();

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

// GET /api/search — FTS5 keyword search across title_en, title_orig, summary_en
app.get('/', async (c) => {
  const db = c.env.DB;
  const q = c.req.query('q');
  if (!q) return c.json({ articles: [] });

  const days = clamp(parseInt(c.req.query('days') ?? String(MAX_FEED_DAYS), 10) || MAX_FEED_DAYS, 1, MAX_FEED_DAYS);
  const topic = c.req.query('topic');

  const conditions = [`articles_fts MATCH ?`, `a.pub_date >= datetime('now', ?)`];
  const binds = [q, `-${days} days`];

  if (topic) {
    conditions.push(
      'a.id IN (SELECT article_id FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id WHERE t.name = ?)'
    );
    binds.push(topic);
  }

  const sql = `
    SELECT a.id, a.title_en, a.title_orig, a.summary_en, a.synopsis_gr,
           a.importance, a.pub_date, a.source_id
    FROM articles_fts f JOIN articles a ON a.rowid = f.rowid
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.importance DESC, a.pub_date DESC
    LIMIT 50
  `;
  const { results } = await db.prepare(sql).bind(...binds).all();

  return c.json({ articles: results });
});

export default app;
