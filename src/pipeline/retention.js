import { RETENTION_DAYS, RETENTION_DELETE_CHUNK, VECTORIZE_DELETE_CHUNK } from '../lib/constants.js';

// Daily retention (separate cron trigger, see wrangler.toml): drops
// everything older than RETENTION_DAYS so D1 stays well under its size
// cap. The database previously filled up (~1.3M relation rows), at which
// point every write — logins, cron bookkeeping, ingestion — started
// failing with "Exceeded maximum DB size".
//
// Articles go in chunks so a large backlog can't blow the per-query time
// limit; each chunk is one db.batch (a single transaction), so a chunk is
// either fully gone or untouched.
async function deleteOldArticles(db, cutoff) {
  const victims = `SELECT id FROM articles WHERE pub_date < ?1 ORDER BY pub_date LIMIT ${RETENTION_DELETE_CHUNK}`;
  let total = 0;

  for (;;) {
    const results = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO vector_deletions (article_id) ${victims}`).bind(cutoff),
      db.prepare(`DELETE FROM article_topics WHERE article_id IN (${victims})`).bind(cutoff),
      db.prepare(`DELETE FROM article_locations WHERE article_id IN (${victims})`).bind(cutoff),
      db.prepare(`DELETE FROM article_entities WHERE article_id IN (${victims})`).bind(cutoff),
      db
        .prepare(`DELETE FROM article_relations WHERE article_a IN (${victims}) OR article_b IN (${victims})`)
        .bind(cutoff),
      db.prepare(`DELETE FROM articles WHERE id IN (${victims})`).bind(cutoff),
    ]);
    const deleted = results.at(-1).meta.changes;
    total += deleted;
    if (deleted < RETENTION_DELETE_CHUNK) break;
  }

  // articles_fts is external-content: rather than per-row 'delete'
  // commands (which corrupt the index if the stored values ever drift from
  // articles — that's exactly what happened in production), rebuild it
  // from the surviving articles. Cheap at a 30-day window.
  if (total) {
    await db.prepare("INSERT INTO articles_fts(articles_fts) VALUES('rebuild')").run();
  }
  return total;
}

async function drainVectorDeletions(env) {
  const db = env.DB;
  let total = 0;

  for (;;) {
    const { results } = await db
      .prepare('SELECT article_id FROM vector_deletions LIMIT ?')
      .bind(VECTORIZE_DELETE_CHUNK)
      .all();
    if (!results.length) break;

    const ids = results.map((r) => r.article_id);
    await env.VECTORIZE.deleteByIds(ids);
    await db
      .prepare(`DELETE FROM vector_deletions WHERE article_id IN (SELECT article_id FROM vector_deletions LIMIT ?)`)
      .bind(ids.length)
      .run();
    total += ids.length;
    if (ids.length < VECTORIZE_DELETE_CHUNK) break;
  }
  return total;
}

export async function runRetention(env) {
  const db = env.DB;
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  // pub_date is stored as an ISO-8601 string; cron_runs/batch_jobs use
  // SQLite's datetime('now') format — compare each in its own format.
  const cutoffIso = cutoffDate.toISOString();
  const cutoffSql = cutoffIso.slice(0, 19).replace('T', ' ');

  const articles = await deleteOldArticles(db, cutoffIso);

  const [pending, cronRuns, batchJobs] = await db.batch([
    db.prepare("DELETE FROM pending_articles WHERE pub_date < ? AND status != 'batched'").bind(cutoffIso),
    db.prepare('DELETE FROM cron_runs WHERE started_at < ?').bind(cutoffSql),
    db
      .prepare(
        "DELETE FROM batch_jobs WHERE submitted_at < ? AND status IN ('completed','failed','expired','cancelled')"
      )
      .bind(cutoffSql),
  ]);

  let vectors = 0;
  let vectorError = null;
  try {
    vectors = await drainVectorDeletions(env);
  } catch (err) {
    // Left queued in vector_deletions; retried on the next run.
    vectorError = err.message;
    console.error(`[retention] Vectorize cleanup failed: ${err.message}`);
  }

  const summary = {
    articles,
    pending: pending.meta.changes,
    cronRuns: cronRuns.meta.changes,
    batchJobs: batchJobs.meta.changes,
    vectors,
    vectorError,
  };
  console.log(`[retention] ${JSON.stringify(summary)}`);

  // Last run's outcome, readable straight from D1 (app_state) without
  // needing access to Worker logs.
  await db
    .prepare(
      "INSERT INTO app_state (key, value, updated_at) VALUES ('retention:last', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    )
    .bind(JSON.stringify(summary))
    .run();
  return summary;
}
