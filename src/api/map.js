import { Hono } from 'hono';
import { DEFAULT_FEED_DAYS, MAX_FEED_DAYS } from '../lib/constants.js';
import { queryChunkedByIds } from '../lib/db.js';

const app = new Hono();

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

// GET /api/map — geotagged locations for the Leaflet layer (spec §6, §7.2)
app.get('/', async (c) => {
  const db = c.env.DB;
  const days = clamp(parseInt(c.req.query('days') ?? String(DEFAULT_FEED_DAYS), 10) || DEFAULT_FEED_DAYS, 1, MAX_FEED_DAYS);
  const topic = c.req.query('topic');

  const conditions = [`a.pub_date >= datetime('now', ?)`];
  const binds = [`-${days} days`];

  if (topic) {
    conditions.push(
      'a.id IN (SELECT article_id FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id WHERE t.name = ?)'
    );
    binds.push(topic);
  }

  const sql = `
    SELECT
      l.article_id, l.place_name, l.lat, l.lng, l.is_subject,
      a.title_en, a.title_orig, a.importance, a.url
    FROM article_locations l
    JOIN articles a ON a.id = l.article_id
    WHERE ${conditions.join(' AND ')}
  `;
  const { results } = await db.prepare(sql).bind(...binds).all();

  const articleIds = [...new Set(results.map((r) => r.article_id))];
  const topicRows = await queryChunkedByIds(
    db,
    articleIds,
    (placeholders) =>
      `SELECT at2.article_id, t.id, t.name, t.color_hex, at2.confidence
       FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id
       WHERE at2.article_id IN (${placeholders})
       ORDER BY at2.confidence DESC`
  );
  const topicsByArticle = new Map();
  for (const row of topicRows) {
    if (!topicsByArticle.has(row.article_id)) topicsByArticle.set(row.article_id, row);
  }

  const markers = results.map((r) => {
    const primaryTopic = topicsByArticle.get(r.article_id);
    return {
      article_id: r.article_id,
      title: r.title_en || r.title_orig,
      url: r.url,
      place_name: r.place_name,
      lat: r.lat,
      lng: r.lng,
      is_subject: !!r.is_subject,
      importance: r.importance,
      color: primaryTopic?.color_hex ?? '#8892a0',
    };
  });

  return c.json({ markers });
});

export default app;
