import { Hono } from 'hono';
import { GRAPH_MAX_NODES } from '../lib/constants.js';

const app = new Hono();

async function getRelated(db, articleId) {
  const { results } = await db
    .prepare(
      `SELECT article_a, article_b, similarity, shared_tags FROM article_relations
       WHERE article_a = ? OR article_b = ? ORDER BY similarity DESC`
    )
    .bind(articleId, articleId)
    .all();

  return results.map((r) => ({
    other: r.article_a === articleId ? r.article_b : r.article_a,
    similarity: r.similarity,
    shared_tags: r.shared_tags,
  }));
}

function sharedTagLabel(sharedTagsJson, topicNameById) {
  const ids = JSON.parse(sharedTagsJson ?? '[]');
  if (!ids.length) return null;
  return topicNameById.get(ids[0]) ?? null;
}

// GET /api/articles/:id/graph — 2-hop relation graph capped at 50 nodes,
// prioritised by similarity descending (spec §7.4, §14 "2-Hop Cap").
app.get('/:id/graph', async (c) => {
  const db = c.env.DB;
  const rootId = c.req.param('id');

  const root = await db.prepare('SELECT id FROM articles WHERE id = ?').bind(rootId).first();
  if (!root) return c.json({ error: 'Not found' }, 404);

  const rootEdges = await getRelated(db, rootId);
  const hop1Ids = rootEdges.map((e) => e.other);

  const edgeMap = new Map();
  const addEdges = (fromId, edges) => {
    for (const e of edges) {
      const [source, target] = [fromId, e.other].sort();
      const key = `${source}|${target}`;
      const existing = edgeMap.get(key);
      if (!existing || existing.similarity < e.similarity) {
        edgeMap.set(key, { source, target, similarity: e.similarity, shared_tags: e.shared_tags });
      }
    }
  };
  addEdges(rootId, rootEdges);

  for (const hop1Id of hop1Ids) {
    const hop2Edges = await getRelated(db, hop1Id);
    addEdges(hop1Id, hop2Edges);
  }

  const sortedEdges = [...edgeMap.values()].sort((a, b) => b.similarity - a.similarity);
  const cappedNodes = new Set([rootId]);
  const cappedEdges = [];
  for (const edge of sortedEdges) {
    if (cappedNodes.size >= GRAPH_MAX_NODES) break;
    cappedNodes.add(edge.source);
    cappedNodes.add(edge.target);
    cappedEdges.push(edge);
  }

  const nodeIds = [...cappedNodes];
  const placeholders = nodeIds.map(() => '?').join(',');

  const { results: articleRows } = await db
    .prepare(`SELECT id, title_en, title_orig, importance FROM articles WHERE id IN (${placeholders})`)
    .bind(...nodeIds)
    .all();

  const { results: topicRows } = await db
    .prepare(
      `SELECT at2.article_id, t.id AS topic_id, t.name, t.color_hex, at2.confidence
       FROM article_topics at2 JOIN topics t ON t.id = at2.topic_id
       WHERE at2.article_id IN (${placeholders})
       ORDER BY at2.confidence DESC`
    )
    .bind(...nodeIds)
    .all();

  const { results: allTopics } = await db.prepare('SELECT id, name FROM topics').all();
  const topicNameById = new Map(allTopics.map((t) => [t.id, t.name]));

  const primaryTopicByArticle = new Map();
  for (const row of topicRows) {
    if (!primaryTopicByArticle.has(row.article_id)) primaryTopicByArticle.set(row.article_id, row);
  }

  const nodes = articleRows.map((a) => {
    const topic = primaryTopicByArticle.get(a.id);
    return {
      id: a.id,
      title: a.title_en || a.title_orig,
      importance: a.importance,
      color: topic?.color_hex ?? '#8892a0',
    };
  });

  const edges = cappedEdges
    .filter((e) => cappedNodes.has(e.source) && cappedNodes.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
      label: sharedTagLabel(e.shared_tags, topicNameById),
    }));

  return c.json({ nodes, edges });
});

export default app;
