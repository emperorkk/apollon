import { getActiveSources, getActiveTopics, deleteArticleCascade, queryChunkedByIds, chunkArray } from './lib/db.js';
import { fetchNewArticles } from './pipeline/ingest.js';
import { submitBatch, getBatchStatus, downloadBatchResults } from './pipeline/batch.js';
import { geocodeArticle } from './pipeline/geocode.js';
import { embedArticle } from './pipeline/embed.js';
import { computeRelations } from './pipeline/relate.js';
import { maybeNotify } from './pipeline/notify.js';
import { checkAndAlert } from './pipeline/health.js';
import { MAX_FINALIZE_PER_RUN, MAX_BATCH_SIZE } from './lib/constants.js';

const RESULT_UPDATE_CHUNK = 100;

// --- ingest: RSS -> pending_articles (status='queued') ----------------------
// INSERT OR IGNORE on the deterministic sha256(guid) id naturally dedupes
// against articles already queued/batched/ready from an earlier tick.

// One batched round-trip for all of a source's new articles instead of one
// D1 call per article — see getExistingGuids in lib/db.js for why this
// matters (Cloudflare's per-invocation cap on binding/"API" calls, distinct
// from and much easier to hit than the outbound fetch() subrequest cap).
async function insertPendingArticles(db, articles) {
  if (!articles.length) return;

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO pending_articles
      (id, guid, source_id, url, title_orig, body, language, pub_date, greece_flag, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`
  );

  await db.batch(
    articles.map((a) =>
      stmt.bind(a.id, a.guid, a.source_id, a.url, a.title_orig, a.body, a.language, a.pub_date, a.greece_flag)
    )
  );
}

async function ingestNewArticles(db) {
  const sources = await getActiveSources(db);
  let count = 0;
  for (const source of sources) {
    const newArticles = await fetchNewArticles(db, source);
    await insertPendingArticles(db, newArticles);
    count += newArticles.length;
  }
  return count;
}

// --- batch submit: queued pending_articles -> one OpenAI batch job ---------
// At most one batch in flight at a time, keeping this simple. Submission is
// ~2 subrequests total no matter how many articles are queued.

async function submitQueuedBatch(env, db) {
  const openBatch = await db
    .prepare("SELECT 1 FROM batch_jobs WHERE status NOT IN ('completed','failed','expired','cancelled') LIMIT 1")
    .first();
  if (openBatch) return null;

  // Capped and newest-first: an uncapped select let a backlog grow into
  // one huge batch, and the per-id UPDATE below blew D1's bound-parameter
  // limit (~100) for anything over that.
  const { results: queued } = await db
    .prepare("SELECT * FROM pending_articles WHERE status = 'queued' ORDER BY pub_date DESC LIMIT ?")
    .bind(MAX_BATCH_SIZE)
    .all();
  if (!queued.length) return null;

  const topics = await getActiveTopics(db);
  const { batchId, status } = await submitBatch(env, queued, topics.map((t) => t.name));

  await db.prepare('INSERT INTO batch_jobs (id, status) VALUES (?, ?)').bind(batchId, status).run();

  await queryChunkedByIds(
    db,
    queued.map((a) => a.id),
    (placeholders) => `UPDATE pending_articles SET batch_id = ?, status = 'batched' WHERE id IN (${placeholders})`,
    [batchId]
  );

  return { batchId, count: queued.length };
}

// --- batch sync: poll open batch jobs, pull results down once completed ----

async function failBatch(db, batchId, status, errorMessage) {
  await db.batch([
    db
      .prepare("UPDATE batch_jobs SET status = ?, completed_at = datetime('now'), error_message = ? WHERE id = ?")
      .bind(status, errorMessage, batchId),
    db
      .prepare(
        "UPDATE pending_articles SET status = 'failed', error_message = 'Batch job did not complete' WHERE batch_id = ? AND status = 'batched'"
      )
      .bind(batchId),
  ]);
}

async function syncBatchStatuses(env, db) {
  const { results: openBatches } = await db
    .prepare("SELECT * FROM batch_jobs WHERE status NOT IN ('completed','failed','expired','cancelled')")
    .all();

  for (const job of openBatches) {
    let remote;
    try {
      remote = await getBatchStatus(env, job.id);
    } catch (err) {
      console.error(`[cron] failed to check batch ${job.id}: ${err.message}`);
      continue;
    }

    if (remote.status === 'completed') {
      let resultsMap;
      try {
        resultsMap = await downloadBatchResults(env, remote);
      } catch (err) {
        // OpenAI deletes batch output files after a while; once they're
        // gone this throws on every tick forever, and since only one batch
        // may be open at a time the whole pipeline stalls behind it (it
        // sat like that from Sept 10). Give up on it and move on.
        console.error(`[cron] abandoning batch ${job.id}: ${err.message}`);
        await failBatch(db, job.id, 'failed', err.message);
        continue;
      }
      // Batched rather than one query per article: Cloudflare caps D1
      // calls per invocation, and a batch can hold MAX_BATCH_SIZE results.
      const failStmt = db.prepare("UPDATE pending_articles SET status = 'failed', error_message = ? WHERE id = ?");
      const readyStmt = db.prepare("UPDATE pending_articles SET status = 'ready', gpt_result = ? WHERE id = ?");
      const updates = [...resultsMap].map(([customId, { result, error }]) =>
        error ? failStmt.bind(JSON.stringify(error), customId) : readyStmt.bind(JSON.stringify(result), customId)
      );
      for (const chunk of chunkArray(updates, RESULT_UPDATE_CHUNK)) {
        await db.batch(chunk);
      }
      await db
        .prepare("UPDATE batch_jobs SET status = 'completed', completed_at = datetime('now') WHERE id = ?")
        .bind(job.id)
        .run();
    } else if (['failed', 'expired', 'cancelled'].includes(remote.status)) {
      await failBatch(db, job.id, remote.status, JSON.stringify(remote.errors ?? null));
    } else if (remote.status !== job.status) {
      await db.prepare('UPDATE batch_jobs SET status = ? WHERE id = ?').bind(remote.status, job.id).run();
    }
  }
}

// --- finalize: ready pending_articles -> full pipeline -> articles ---------
// Bounded per tick (MAX_FINALIZE_PER_RUN) so a big batch completing all at
// once can't blow the subrequest limit; leftovers finish on later ticks.

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
  if (matched.length) {
    const stmt = db.prepare('INSERT OR IGNORE INTO article_topics (article_id, topic_id) VALUES (?, ?)');
    await db.batch(matched.map((t) => stmt.bind(articleId, t.id)));
  }
  return matched;
}

// Persists GPT's extracted people/orgs/locations so relate.js can link
// articles that mention the same entity (see relate.js findEntityMatches) —
// previously only entities.locations was used (geocoding) and people/orgs
// were discarded entirely, so there was no keyword-based linking at all.
async function insertEntities(db, articleId, entities) {
  const rows = [
    ...(entities?.people ?? []).map((name) => ['person', name]),
    ...(entities?.orgs ?? []).map((name) => ['org', name]),
    ...(entities?.locations ?? []).map((name) => ['location', name]),
  ].filter(([, name]) => name);

  if (!rows.length) return;

  const stmt = db.prepare('INSERT INTO article_entities (article_id, entity_type, entity_name) VALUES (?, ?, ?)');
  await db.batch(rows.map(([type, name]) => stmt.bind(articleId, type, name)));
}

async function finalizeArticle(env, db, pending, gptResult, allTopics) {
  // A previous attempt for this same pending row can have thrown partway
  // through (e.g. computeRelations hitting D1's bound-parameter cap) after
  // insertArticle already succeeded — pending_articles ends up 'failed'
  // while the articles row (and its FTS entry) is already there. Clear any
  // such leftover before redoing the insert so a retry doesn't hit
  // `UNIQUE constraint failed: articles.guid`.
  await deleteArticleCascade(db, pending.id);

  const greeceFlag = pending.greece_flag || gptResult.greece_related ? 1 : 0;

  const article = {
    id: pending.id,
    guid: pending.guid,
    source_id: pending.source_id,
    url: pending.url,
    title_orig: pending.title_orig,
    title_en: gptResult.title_en ?? null,
    summary_en: gptResult.summary_en ?? null,
    synopsis_gr: gptResult.synopsis_gr ?? null,
    language: pending.language,
    importance: gptResult.importance ?? 1,
    pub_date: pending.pub_date,
    greece_flag: greeceFlag,
  };

  await insertArticle(db, article);
  const matchedTopics = await linkTopics(db, article.id, gptResult.topics ?? [], allTopics);
  await insertEntities(db, article.id, gptResult.entities);

  const failedGeocodes = await geocodeArticle(db, article.id, {
    subjectLocation: gptResult.subject_location ?? null,
    otherLocations: gptResult.entities?.locations ?? [],
  });

  const topicIds = matchedTopics.map((t) => t.id);
  const embedding = await embedArticle(env, article, topicIds);
  await computeRelations(env, article, embedding, topicIds, gptResult.entities);
  await maybeNotify(env, article, matchedTopics);

  return { failedGeocodes };
}

async function finalizeReadyArticles(env, db) {
  const topics = await getActiveTopics(db);
  // Newest first: with more 'ready' articles than MAX_FINALIZE_PER_RUN can
  // drain in one tick, an unordered (effectively FIFO-by-rowid) select left
  // today's news stuck behind a growing backlog of old queued articles —
  // the feed's day-window filter (pub_date-based) never saw anything recent
  // even though articles were finalizing every tick. Draining newest-first
  // means the site stays current while the backlog empties in the
  // background.
  const { results: ready } = await db
    .prepare('SELECT * FROM pending_articles WHERE status = \'ready\' ORDER BY pub_date DESC LIMIT ?')
    .bind(MAX_FINALIZE_PER_RUN)
    .all();

  let finalized = 0;
  let failedGeocodes = 0;

  for (const pending of ready) {
    try {
      const gptResult = JSON.parse(pending.gpt_result);
      const result = await finalizeArticle(env, db, pending, gptResult, topics);
      failedGeocodes += result.failedGeocodes;
      finalized += 1;
      await db.prepare('DELETE FROM pending_articles WHERE id = ?').bind(pending.id).run();
    } catch (err) {
      console.error(`[cron] failed to finalize article ${pending.id}: ${err.message}`);
      await db
        .prepare("UPDATE pending_articles SET status = 'failed', error_message = ? WHERE id = ?")
        .bind(err.message, pending.id)
        .run();
    }
  }

  return { finalized, failedGeocodes };
}

// Entry point for the Cron Trigger (spec §5.1). Runs every 30 minutes.
// GPT processing goes through the OpenAI Batch API rather than live calls
// per article — ingestion isn't time-critical, and a live call per article
// blows through Cloudflare's per-invocation subrequest limit whenever a
// backlog of articles lands in one tick. Each stage below is cheap and
// roughly constant-cost regardless of article volume, except the bounded
// finalize step. Logs each run to cron_runs for the admin stats view
// (spec §7.7).
export async function runCron(env) {
  const db = env.DB;

  await checkAndAlert(env);

  const { meta } = await db.prepare("INSERT INTO cron_runs (status) VALUES ('running')").run();
  const runId = meta.last_row_id;

  try {
    const ingested = await ingestNewArticles(db);
    const submitted = await submitQueuedBatch(env, db);
    await syncBatchStatuses(env, db);
    const { finalized, failedGeocodes } = await finalizeReadyArticles(env, db);

    await db
      .prepare(
        `UPDATE cron_runs SET finished_at = datetime('now'), status = 'success',
           articles_ingested = ?, failed_geocodes = ? WHERE id = ?`
      )
      .bind(finalized, failedGeocodes, runId)
      .run();

    const summary = { ingested, submittedBatch: submitted ? submitted.count : 0, finalized, failedGeocodes };
    console.log(
      `[cron] ingested=${ingested} submitted_batch=${summary.submittedBatch} finalized=${finalized}`
    );
    return summary;
  } catch (err) {
    await db
      .prepare(
        `UPDATE cron_runs SET finished_at = datetime('now'), status = 'error',
           error_message = ? WHERE id = ?`
      )
      .bind(err.message, runId)
      .run();
    throw err;
  }
}
