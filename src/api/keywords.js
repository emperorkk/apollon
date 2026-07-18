import { Hono } from 'hono';
import { DEFAULT_FEED_DAYS, MAX_FEED_DAYS, GRAPH_MAX_NODES } from '../lib/constants.js';
import { queryChunkedByIds } from '../lib/db.js';

const app = new Hono();
const MAX_LEVEL2_KEYWORDS = 30;

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

// GPT is now instructed to always give entity names in English (see
// process.js), but article_entities still holds names extracted before
// that fix — e.g. Japanese/Arabic source articles whose people/orgs came
// back untranslated. Filter those out here rather than waiting for old
// articles to age out of the window, so the keyword panel only ever shows
// names in the app's two display languages (English or Greek).
const DISPLAYABLE_NAME = /^[\p{Script=Latin}\p{Script=Greek}0-9\s\-'".,&()]+$/u;
function isDisplayableName(name) {
  return DISPLAYABLE_NAME.test(name);
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

  // Over-fetch past the 40 actually shown, since isDisplayableName may
  // drop some — keeps the visible list full instead of falling short.
  const { results } = await db
    .prepare(
      `SELECT ae.entity_name AS name, ae.entity_type AS type, COUNT(DISTINCT ae.article_id) AS count
       FROM article_entities ae
       JOIN articles a ON a.id = ae.article_id
       WHERE a.pub_date >= datetime('now', ?) AND ae.entity_type IN ('person', 'org')
       GROUP BY ae.entity_name, ae.entity_type
       ORDER BY count DESC
       LIMIT 120`
    )
    .bind(`-${days} days`)
    .all();

  const keywords = results.filter((r) => isDisplayableName(r.name)).slice(0, 40);
  return c.json({ keywords });
});

// GET /api/keywords/:name/graph — 2-hop bipartite network for the 3D graph:
// keyword -> articles mentioning it -> other people/orgs those articles
// mention -> other articles mentioning those. Nodes are tagged type:
// 'keyword' | 'article' so the frontend can render/color them distinctly.
app.get('/:name/graph', async (c) => {
  const db = c.env.DB;
  const rootKeyword = c.req.param('name');
  const days = clamp(
    parseInt(c.req.query('days') ?? String(DEFAULT_FEED_DAYS), 10) || DEFAULT_FEED_DAYS,
    1,
    MAX_FEED_DAYS
  );
  const windowClause = `-${days} days`;

  // Level 1: articles mentioning the root keyword
  const { results: level1Articles } = await db
    .prepare(
      `SELECT a.id, a.title_en, a.title_orig, a.importance
       FROM article_entities ae
       JOIN articles a ON a.id = ae.article_id
       WHERE ae.entity_name = ? AND a.pub_date >= datetime('now', ?)
       ORDER BY a.importance DESC
       LIMIT ?`
    )
    .bind(rootKeyword, windowClause, GRAPH_MAX_NODES)
    .all();

  if (!level1Articles.length) return c.json({ keyword: rootKeyword, nodes: [], edges: [] });

  const level1Ids = level1Articles.map((r) => r.id);
  const level1IdSet = new Set(level1Ids);

  // Level 2: other person/org entities mentioned across those same articles
  const entityRows = await queryChunkedByIds(
    db,
    level1Ids,
    (placeholders) =>
      `SELECT article_id, entity_name FROM article_entities
       WHERE entity_name != ? AND article_id IN (${placeholders}) AND entity_type IN ('person', 'org')`,
    [rootKeyword]
  );

  const countByKeyword = new Map();
  for (const row of entityRows) {
    if (!isDisplayableName(row.entity_name)) continue;
    countByKeyword.set(row.entity_name, (countByKeyword.get(row.entity_name) ?? 0) + 1);
  }
  const level2Keywords = [...countByKeyword.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_LEVEL2_KEYWORDS)
    .map(([name]) => name);

  // Level 3: articles mentioning those level-2 keywords (within the window)
  // — may include level-1 articles again (a real cross-link, kept as an
  // extra edge) as well as genuinely new ones.
  let level3Rows = [];
  if (level2Keywords.length) {
    const placeholders = level2Keywords.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT ae.entity_name, a.id, a.title_en, a.title_orig, a.importance
         FROM article_entities ae
         JOIN articles a ON a.id = ae.article_id
         WHERE ae.entity_name IN (${placeholders}) AND a.pub_date >= datetime('now', ?)
         ORDER BY a.importance DESC
         LIMIT ?`
      )
      .bind(...level2Keywords, windowClause, GRAPH_MAX_NODES * 3)
      .all();
    level3Rows = results;
  }

  const newArticlesById = new Map();
  for (const row of level3Rows) {
    if (!level1IdSet.has(row.id) && !newArticlesById.has(row.id)) {
      newArticlesById.set(row.id, { id: row.id, title_en: row.title_en, title_orig: row.title_orig, importance: row.importance });
    }
  }

  const allArticleRows = [...level1Articles, ...newArticlesById.values()];
  const allArticleIds = allArticleRows.map((r) => r.id);

  const topicRows = await queryChunkedByIds(
    db,
    allArticleIds,
    (placeholders) =>
      `SELECT at2.article_id, t.color_hex, at2.confidence
       FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id
       WHERE at2.article_id IN (${placeholders})
       ORDER BY at2.confidence DESC`
  );
  const colorByArticle = new Map();
  for (const row of topicRows) {
    if (!colorByArticle.has(row.article_id)) colorByArticle.set(row.article_id, row.color_hex);
  }

  const nodes = [
    { id: `kw:${rootKeyword}`, type: 'keyword', label: rootKeyword, root: true },
    ...level2Keywords.map((name) => ({ id: `kw:${name}`, type: 'keyword', label: name, root: false })),
    ...allArticleRows.map((r) => ({
      id: r.id,
      type: 'article',
      label: r.title_en || r.title_orig,
      importance: r.importance,
      color: colorByArticle.get(r.id) ?? '#8892a0',
    })),
  ];

  const edgeKeys = new Set();
  const edges = [];
  const addEdge = (source, target) => {
    const key = `${source}|${target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target });
  };

  for (const a of level1Articles) addEdge(`kw:${rootKeyword}`, a.id);
  for (const row of level3Rows) addEdge(`kw:${row.entity_name}`, row.id);

  return c.json({ keyword: rootKeyword, nodes, edges });
});

export default app;
