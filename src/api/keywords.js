import { Hono } from 'hono';
import { DEFAULT_FEED_DAYS, MAX_FEED_DAYS, GRAPH_MAX_NODES } from '../lib/constants.js';

const app = new Hono();

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

// GET /api/keywords — top person/org entities mentioned in the last N days.
// Locations are excluded — too common/noisy to be a useful keyword on their
// own (e.g. "Israel"/"Gaza" appear across dozens of unrelated articles).
app.get('/', async (c) => {
  const db = c.env.DB;
  const days = clamp(
    parseInt(c.req.query('days') ?? String(DEFAULT_FEED_DAYS), 10) || DEFAULT_FEED_DAYS,
    1,
    MAX_FEED_DAYS
  );

  const { results } = await db
    .prepare(
      `SELECT ae.entity_name AS name, ae.entity_type AS type, COUNT(DISTINCT ae.article_id) AS count
       FROM article_entities ae
       JOIN articles a ON a.id = ae.article_id
       WHERE a.pub_date >= datetime('now', ?) AND ae.entity_type IN ('person', 'org')
       GROUP BY ae.entity_name, ae.entity_type
       ORDER BY count DESC
       LIMIT 40`
    )
    .bind(`-${days} days`)
    .all();

  return c.json({ keywords: results });
});

// GET /api/keywords/:name/graph — star graph for the Cytoscape modal: the
// keyword at the centre, every matching article (within the window) as a
// leaf node, per spec-adjacent request ("clicking a keyword opens the graph
// with the tag and articles").
app.get('/:name/graph', async (c) => {
  const db = c.env.DB;
  const name = c.req.param('name');
  const days = clamp(
    parseInt(c.req.query('days') ?? String(DEFAULT_FEED_DAYS), 10) || DEFAULT_FEED_DAYS,
    1,
    MAX_FEED_DAYS
  );

  const { results: rows } = await db
    .prepare(
      `SELECT a.id, a.title_en, a.title_orig, a.importance
       FROM article_entities ae
       JOIN articles a ON a.id = ae.article_id
       WHERE ae.entity_name = ? AND a.pub_date >= datetime('now', ?)
       ORDER BY a.importance DESC
       LIMIT ?`
    )
    .bind(name, `-${days} days`, GRAPH_MAX_NODES)
    .all();

  if (!rows.length) return c.json({ keyword: name, articles: [] });

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const { results: topicRows } = await db
    .prepare(
      `SELECT at2.article_id, t.color_hex, at2.confidence
       FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id
       WHERE at2.article_id IN (${placeholders})
       ORDER BY at2.confidence DESC`
    )
    .bind(...ids)
    .all();

  const colorByArticle = new Map();
  for (const row of topicRows) {
    if (!colorByArticle.has(row.article_id)) colorByArticle.set(row.article_id, row.color_hex);
  }

  const articles = rows.map((r) => ({
    id: r.id,
    title: r.title_en || r.title_orig,
    importance: r.importance,
    color: colorByArticle.get(r.id) ?? '#8892a0',
  }));

  return c.json({ keyword: name, articles });
});

export default app;
