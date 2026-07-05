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
