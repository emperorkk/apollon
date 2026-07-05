import { getActiveSources, getActiveTopics } from './lib/db.js';
import { fetchNewArticles } from './pipeline/ingest.js';
import { processArticle } from './pipeline/process.js';
import { geocodeArticle } from './pipeline/geocode.js';
import { embedArticle } from './pipeline/embed.js';
import { computeRelations } from './pipeline/relate.js';
import { maybeNotify } from './pipeline/notify.js';

async function insertArticle(db, article) {
  await db
    .prepare(
      `INSERT INTO articles
        (id, guid, source_id, url, title_orig, title_en, summary_en, synopsis_gr,
         language, importance, pub_date, greece_flag, vectorized)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .bind(
      article.id,
      article.guid,
      article.source_id,
      article.url,
      article.title_orig,
      article.title_en,
      article.summary_en,
      article.synopsis_gr,
      article.language,
      article.importance,
      article.pub_date,
      article.greece_flag
    )
    .run();

  await db
    .prepare(
      `INSERT INTO articles_fts (rowid, title_en, title_orig, summary_en)
       SELECT rowid, title_en, title_orig, summary_en FROM articles WHERE id = ?`
    )
    .bind(article.id)
    .run();
}

async function linkTopics(db, articleId, topicNames, allTopics) {
  const matched = allTopics.filter((t) => topicNames.includes(t.name));
  for (const topic of matched) {
    await db
      .prepare('INSERT OR IGNORE INTO article_topics (article_id, topic_id) VALUES (?, ?)')
      .bind(articleId, topic.id)
      .run();
  }
  return matched;
}

async function processOneArticle(env, db, raw, allTopics) {
  const gpt = await processArticle(env, raw, allTopics.map((t) => t.name));

  const greeceFlag = raw.greece_flag || gpt.greece_related ? 1 : 0;

  const article = {
    id: raw.id,
    guid: raw.guid,
    source_id: raw.source_id,
    url: raw.url,
    title_orig: raw.title_orig,
    title_en: gpt.title_en ?? null,
    summary_en: gpt.summary_en ?? null,
    synopsis_gr: gpt.synopsis_gr ?? null,
    language: raw.language,
    importance: gpt.importance ?? 1,
    pub_date: raw.pub_date,
    greece_flag: greeceFlag,
  };

  await insertArticle(db, article);
  const matchedTopics = await linkTopics(db, article.id, gpt.topics ?? [], allTopics);

  const failedGeocodes = await geocodeArticle(db, article.id, {
    subjectLocation: gpt.subject_location ?? null,
    otherLocations: gpt.entities?.locations ?? [],
  });

  const topicIds = matchedTopics.map((t) => t.id);
  const embedding = await embedArticle(env, article, topicIds);
  await computeRelations(env, article, embedding, topicIds);

  await maybeNotify(env, article, matchedTopics);

  return { failedGeocodes };
}

// Entry point for the Cron Trigger (spec §5.1). Runs every 30 minutes,
// processing all active sources sequentially so the Nominatim rate limit
// (1 req/sec) is respected across the whole batch. Logs each run to
// cron_runs for the admin stats view (spec §7.7).
export async function runCron(env) {
  const db = env.DB;

  const { meta } = await db
    .prepare("INSERT INTO cron_runs (status) VALUES ('running')")
    .run();
  const runId = meta.last_row_id;

  let articlesIngested = 0;
  let failedGeocodes = 0;

  try {
    const [sources, topics] = await Promise.all([getActiveSources(db), getActiveTopics(db)]);

    for (const source of sources) {
      const newArticles = await fetchNewArticles(db, source);

      for (const raw of newArticles) {
        try {
          const result = await processOneArticle(env, db, raw, topics);
          articlesIngested += 1;
          failedGeocodes += result.failedGeocodes;
        } catch (err) {
          console.error(`[cron] failed processing article from ${source.id}: ${err.message}`);
        }
      }
    }

    await db
      .prepare(
        `UPDATE cron_runs SET finished_at = datetime('now'), status = 'success',
           articles_ingested = ?, failed_geocodes = ? WHERE id = ?`
      )
      .bind(articlesIngested, failedGeocodes, runId)
      .run();
  } catch (err) {
    await db
      .prepare(
        `UPDATE cron_runs SET finished_at = datetime('now'), status = 'error',
           articles_ingested = ?, failed_geocodes = ?, error_message = ? WHERE id = ?`
      )
      .bind(articlesIngested, failedGeocodes, err.message, runId)
      .run();
    throw err;
  }
}
