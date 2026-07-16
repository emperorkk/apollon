export async function getActiveSources(db) {
  const { results } = await db
    .prepare('SELECT * FROM sources WHERE active = 1')
    .all();
  return results;
}

export async function getActiveTopics(db) {
  const { results } = await db
    .prepare('SELECT * FROM topics WHERE active = 1')
    .all();
  return results;
}

export async function articleExists(db, guid) {
  const row = await db
    .prepare('SELECT 1 FROM articles WHERE guid = ?')
    .bind(guid)
    .first();
  return !!row;
}

// D1 caps bound parameters per statement at 100. Any query building a
// dynamic `IN (${placeholders})` from an unbounded id list needs to chunk —
// this was hit for real once article volume grew (map.js's per-article
// topic lookup started throwing 500s once the window held >100 distinct
// articles). Splits into multiple statements sent as one db.batch() call
// (still a single round-trip) and merges the results.
const D1_MAX_BOUND_PARAMS = 100;

export function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// buildSql(placeholders) must return SQL containing exactly one
// `IN (${placeholders})` built from that chunk's ids. extraBinds (if any)
// are bound before the id list on every chunk.
export async function queryChunkedByIds(db, ids, buildSql, extraBinds = []) {
  if (!ids.length) return [];
  const chunks = chunkArray(ids, D1_MAX_BOUND_PARAMS);
  const statements = chunks.map((chunk) => {
    const placeholders = chunk.map(() => '?').join(',');
    return db.prepare(buildSql(placeholders)).bind(...extraBinds, ...chunk);
  });
  const results = await db.batch(statements);
  return results.flatMap((r) => r.results ?? []);
}

// Bulk existence check: one D1 round-trip for a whole list of guids instead
// of one per guid. Cloudflare caps total binding calls ("API requests") per
// invocation, and checking each RSS item individually across ~20 sources
// was blowing through it well before subrequests (fetch calls) were even
// close to their own limit.
export async function getExistingGuids(db, guids) {
  if (!guids.length) return new Set();
  const rows = await queryChunkedByIds(db, guids, (placeholders) => `SELECT guid FROM articles WHERE guid IN (${placeholders})`);
  return new Set(rows.map((r) => r.guid));
}

export async function recordSourceError(db, sourceId, message) {
  await db
    .prepare("UPDATE sources SET last_error = ?, last_error_at = datetime('now') WHERE id = ?")
    .bind(message.slice(0, 500), sourceId)
    .run();
}

export async function recordSourceSuccess(db, sourceId) {
  await db
    .prepare(
      "UPDATE sources SET last_error = NULL, last_error_at = NULL, last_success_at = datetime('now') WHERE id = ?"
    )
    .bind(sourceId)
    .run();
}

export async function getCachedGeocode(db, placeName) {
  return db
    .prepare('SELECT lat, lng FROM geocode_cache WHERE place_name = ?')
    .bind(placeName)
    .first();
}

export async function cacheGeocode(db, placeName, lat, lng) {
  await db
    .prepare(
      'INSERT INTO geocode_cache (place_name, lat, lng) VALUES (?, ?, ?) ' +
        'ON CONFLICT(place_name) DO UPDATE SET lat = excluded.lat, lng = excluded.lng'
    )
    .bind(placeName, lat, lng)
    .run();
}

// Removes an article and everything referencing it (topics, locations,
// entities, relations, FTS index entry). Returns false if the article
// didn't exist. Shared by the admin delete-article endpoint and by
// finalizeArticle's retry-safety cleanup (see cron.js) — a finalize that
// throws partway through (e.g. in computeRelations) can leave the articles
// row already inserted while pending_articles is still marked 'failed';
// without this, retrying hits `UNIQUE constraint failed: articles.guid`.
// Does NOT touch Vectorize — callers that also need to remove the
// embedding should do so separately (finalizeArticle's retry path doesn't
// need to: embedArticle's upsert overwrites the same id).
export async function deleteArticleCascade(db, id) {
  const article = await db
    .prepare('SELECT rowid, title_en, title_orig, summary_en FROM articles WHERE id = ?')
    .bind(id)
    .first();
  if (!article) return false;

  // articles_fts is an external-content FTS5 table; rows can't just be
  // DELETEd from it directly — the documented way is the special 'delete'
  // command, which needs the old column values to correctly unindex them.
  await db.batch([
    db
      .prepare(
        `INSERT INTO articles_fts(articles_fts, rowid, title_en, title_orig, summary_en) VALUES ('delete', ?, ?, ?, ?)`
      )
      .bind(article.rowid, article.title_en, article.title_orig, article.summary_en),
    db.prepare('DELETE FROM article_topics WHERE article_id = ?').bind(id),
    db.prepare('DELETE FROM article_locations WHERE article_id = ?').bind(id),
    db.prepare('DELETE FROM article_entities WHERE article_id = ?').bind(id),
    db.prepare('DELETE FROM article_relations WHERE article_a = ? OR article_b = ?').bind(id, id),
    db.prepare('DELETE FROM articles WHERE id = ?').bind(id),
  ]);
  return true;
}

export async function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

export async function upsertUser(db, { email, googleSub, displayName }) {
  await db
    .prepare(
      'INSERT INTO users (email, google_sub, display_name) VALUES (?, ?, ?) ' +
        'ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name'
    )
    .bind(email, googleSub, displayName ?? null)
    .run();
}
