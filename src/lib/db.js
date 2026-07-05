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

// Bulk existence check: one D1 round-trip for a whole list of guids instead
// of one per guid. Cloudflare caps total binding calls ("API requests") per
// invocation, and checking each RSS item individually across ~20 sources
// was blowing through it well before subrequests (fetch calls) were even
// close to their own limit.
export async function getExistingGuids(db, guids) {
  if (!guids.length) return new Set();
  const placeholders = guids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT guid FROM articles WHERE guid IN (${placeholders})`)
    .bind(...guids)
    .all();
  return new Set(results.map((r) => r.guid));
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
