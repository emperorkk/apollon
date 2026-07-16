import { SIMILARITY_THRESHOLD, RELATION_WINDOW_DAYS } from '../lib/constants.js';
import { queryChunkedByIds } from '../lib/db.js';

// Shared named people/orgs are a strong "same story" signal on their own —
// locations are excluded here as too common/noisy ("Israel", "Gaza" appear
// across dozens of unrelated articles) to be a useful link signal by
// themselves. This lets two articles link even when embedding similarity
// falls short of SIMILARITY_THRESHOLD, which is what actually produces
// keyword-driven links rather than relying on semantic similarity alone.
async function findEntityMatches(db, articleId, entities) {
  const names = [...new Set([...(entities?.people ?? []), ...(entities?.orgs ?? [])])];
  if (!names.length) return new Map();

  // GROUP BY happens per name-chunk here, so merge share counts across
  // chunks below rather than trusting each chunk's count in isolation —
  // queryChunkedByIds just concatenates raw rows, it doesn't re-aggregate.
  const rows = await queryChunkedByIds(
    db,
    names,
    (placeholders) =>
      `SELECT ae2.article_id AS other_id, ae1.entity_name AS shared_name
       FROM article_entities ae1
       JOIN article_entities ae2 ON ae2.entity_name = ae1.entity_name AND ae2.article_id != ae1.article_id
       WHERE ae1.article_id = ? AND ae1.entity_name IN (${placeholders})`,
    [articleId]
  );

  const sharedByOther = new Map();
  for (const row of rows) {
    if (!sharedByOther.has(row.other_id)) sharedByOther.set(row.other_id, new Set());
    sharedByOther.get(row.other_id).add(row.shared_name);
  }

  const matches = new Map();
  for (const [otherId, shared] of sharedByOther) {
    matches.set(otherId, Math.min(0.99, 0.85 + 0.05 * (shared.size - 1)));
  }
  return matches;
}

// Combines Vectorize embedding similarity (>= 0.85 cosine) with shared
// people/org entity matches into one candidate set, then writes qualifying
// pairs to article_relations. entities must already be persisted to
// article_entities for `article` before this runs (see cron.js) so the
// self-join in findEntityMatches can see them.
export async function computeRelations(env, article, embedding, topicIds, entities) {
  const db = env.DB;
  const windowStart = new Date(Date.now() - RELATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const vectorResults = await env.VECTORIZE.query(embedding, {
    topK: 20,
    filter: { pub_date: { $gt: windowStart } },
    returnMetadata: true,
  });

  const candidates = new Map(); // other article id -> similarity score
  for (const m of vectorResults.matches ?? []) {
    if (m.id === article.id || m.score < SIMILARITY_THRESHOLD) continue;
    candidates.set(m.id, m.score);
  }

  const entityMatches = await findEntityMatches(db, article.id, entities);
  for (const [id, score] of entityMatches) {
    if (id === article.id) continue;
    const existing = candidates.get(id);
    if (!existing || score > existing) candidates.set(id, score);
  }

  if (!candidates.size) return;

  const otherIds = [...candidates.keys()];
  const topicRows = await queryChunkedByIds(
    db,
    otherIds,
    (placeholders) => `SELECT article_id, topic_id FROM article_topics WHERE article_id IN (${placeholders})`
  );

  const topicsByArticle = new Map();
  for (const row of topicRows) {
    if (!topicsByArticle.has(row.article_id)) topicsByArticle.set(row.article_id, []);
    topicsByArticle.get(row.article_id).push(row.topic_id);
  }

  const stmt = db.prepare(
    'INSERT INTO article_relations (article_a, article_b, similarity, shared_tags) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(article_a, article_b) DO UPDATE SET similarity = MAX(similarity, excluded.similarity), shared_tags = excluded.shared_tags'
  );

  const batch = [...candidates.entries()].map(([otherId, score]) => {
    const [articleA, articleB] = [article.id, otherId].sort();
    const otherTopics = topicsByArticle.get(otherId) ?? [];
    const sharedTags = (topicIds ?? []).filter((t) => otherTopics.includes(t));
    return stmt.bind(articleA, articleB, score, JSON.stringify(sharedTags));
  });

  await db.batch(batch);
}
