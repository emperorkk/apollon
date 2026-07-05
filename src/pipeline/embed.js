import { OPENAI_EMBEDDING_MODEL } from '../lib/constants.js';

export async function embedText(env, text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: text.slice(0, 2000),
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

// Embeds title+summary and upserts into Vectorize, marking the article
// vectorized in D1. Returns the embedding so relate.js can reuse it.
export async function embedArticle(env, article, topicIds) {
  const text = `${article.title_en ?? ''} ${article.summary_en ?? article.synopsis_gr ?? ''}`.trim();
  const embedding = await embedText(env, text);

  await env.VECTORIZE.upsert([
    {
      id: article.id,
      values: embedding,
      metadata: {
        article_id: article.id,
        pub_date: article.pub_date,
        topics: JSON.stringify(topicIds ?? []),
        importance: article.importance,
      },
    },
  ]);

  await env.DB.prepare('UPDATE articles SET vectorized = 1 WHERE id = ?').bind(article.id).run();

  return embedding;
}
