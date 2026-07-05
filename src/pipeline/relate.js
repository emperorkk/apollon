import { SIMILARITY_THRESHOLD, RELATION_WINDOW_DAYS } from '../lib/constants.js';

// Queries Vectorize for near neighbours within the relation window and
// writes qualifying pairs (similarity >= 0.85) to article_relations.
export async function computeRelations(env, article, embedding, topicIds) {
  const windowStart = new Date(Date.now() - RELATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const results = await env.VECTORIZE.query(embedding, {
    topK: 20,
    filter: { pub_date: { $gt: windowStart } },
    returnMetadata: true,
  });

  const related = (results.matches ?? []).filter(
    (m) => m.score >= SIMILARITY_THRESHOLD && m.id !== article.id
  );

  for (const match of related) {
    const [articleA, articleB] = [article.id, match.id].sort();
    const otherTopics = JSON.parse(match.metadata?.topics ?? '[]');
    const sharedTags = (topicIds ?? []).filter((t) => otherTopics.includes(t));

    await env.DB.prepare(
      'INSERT INTO article_relations (article_a, article_b, similarity, shared_tags) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(article_a, article_b) DO UPDATE SET similarity = excluded.similarity, shared_tags = excluded.shared_tags'
    )
      .bind(articleA, articleB, match.score, JSON.stringify(sharedTags))
      .run();
  }
}
