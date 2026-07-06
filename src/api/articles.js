import { Hono } from 'hono';
import { DEFAULT_FEED_DAYS, MAX_FEED_DAYS } from '../lib/constants.js';

const app = new Hono();

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

async function attachTopics(db, articleIds) {
  if (!articleIds.length) return new Map();
  const placeholders = articleIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT at2.article_id, t.id, t.name, t.color_hex
       FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id
       WHERE at2.article_id IN (${placeholders})`
    )
    .bind(...articleIds)
    .all();

  const map = new Map();
  for (const row of results) {
    if (!map.has(row.article_id)) map.set(row.article_id, []);
    map.get(row.article_id).push({ id: row.id, name: row.name, color_hex: row.color_hex });
  }
  return map;
}

// GET /api/articles — feed list with optional filters
app.get('/', async (c) => {
  const db = c.env.DB;
  const days = clamp(parseInt(c.req.query('days') ?? String(DEFAULT_FEED_DAYS), 10) || DEFAULT_FEED_DAYS, 1, MAX_FEED_DAYS);
  const topic = c.req.query('topic');
  const region = c.req.query('region');
  const q = c.req.query('q');
  const page = Math.max(parseInt(c.req.query('page') ?? '1', 10) || 1, 1);
  const limit = clamp(parseInt(c.req.query('limit') ?? '20', 10) || 20, 1, 50);
  const offset = (page - 1) * limit;

  const conditions = [`a.pub_date >= datetime('now', ?)`];
  const binds = [`-${days} days`];
  let from = 'articles a';

  if (q) {
    from = 'articles_fts f JOIN articles a ON a.rowid = f.rowid';
    conditions.push('articles_fts MATCH ?');
    binds.push(q);
  }
  if (topic) {
    conditions.push(
      'a.id IN (SELECT article_id FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id WHERE t.name = ?)'
    );
    binds.push(topic);
  }
  if (region) {
    conditions.push('a.source_id IN (SELECT id FROM sources WHERE region = ?)');
    binds.push(region);
  }

  const sql = `SELECT a.* FROM ${from} WHERE ${conditions.join(' AND ')} ORDER BY a.pub_date DESC, a.importance DESC LIMIT ? OFFSET ?`;
  const { results } = await db.prepare(sql).bind(...binds, limit, offset).all();

  const topicsByArticle = await attachTopics(db, results.map((r) => r.id));
  const articles = results.map((a) => ({ ...a, topics: topicsByArticle.get(a.id) ?? [] }));

  return c.json({ articles, page, limit });
});

// GET /api/articles/:id — single article with locations, topics, 1-hop related
app.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const article = await db.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
  if (!article) return c.json({ error: 'Not found' }, 404);

  const { results: locations } = await db
    .prepare('SELECT place_name, lat, lng, is_subject FROM article_locations WHERE article_id = ?')
    .bind(id)
    .all();

  const { results: topics } = await db
    .prepare(
      `SELECT t.id, t.name, t.color_hex, at2.confidence
       FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id
       WHERE at2.article_id = ?`
    )
    .bind(id)
    .all();

  const { results: relatedRows } = await db
    .prepare(
      `SELECT article_a, article_b, similarity FROM article_relations
       WHERE article_a = ? OR article_b = ?
       ORDER BY similarity DESC LIMIT 5`
    )
    .bind(id, id)
    .all();

  const relatedIds = relatedRows.map((r) => (r.article_a === id ? r.article_b : r.article_a));
  let related = [];
  if (relatedIds.length) {
    const placeholders = relatedIds.map(() => '?').join(',');
    const { results: relatedArticles } = await db
      .prepare(`SELECT id, title_en, title_orig FROM articles WHERE id IN (${placeholders})`)
      .bind(...relatedIds)
      .all();
    const titleById = new Map(relatedArticles.map((a) => [a.id, a.title_en || a.title_orig]));
    related = relatedRows.map((r) => {
      const otherId = r.article_a === id ? r.article_b : r.article_a;
      return { id: otherId, title: titleById.get(otherId), similarity: r.similarity };
    });
  }

  const { results: entityRows } = await db
    .prepare('SELECT entity_type, entity_name FROM article_entities WHERE article_id = ?')
    .bind(id)
    .all();
  const entities = { people: [], orgs: [], locations: [] };
  for (const row of entityRows) {
    if (row.entity_type === 'person') entities.people.push(row.entity_name);
    else if (row.entity_type === 'org') entities.orgs.push(row.entity_name);
    else if (row.entity_type === 'location') entities.locations.push(row.entity_name);
  }

  return c.json({ ...article, locations, topics, related, entities });
});

export default app;
