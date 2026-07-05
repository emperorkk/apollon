import { getCachedGeocode, cacheGeocode } from '../lib/db.js';
import { APP_USER_AGENT, NOMINATIM_DELAY_MS } from '../lib/constants.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeOne(db, placeName) {
  const cached = await getCachedGeocode(db, placeName);
  if (cached) return { lat: cached.lat, lng: cached.lng };

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(placeName)}`;
  const res = await fetch(url, { headers: { 'User-Agent': APP_USER_AGENT } });
  if (!res.ok) return null;

  const results = await res.json();
  if (!results.length) return null;

  const { lat, lon } = results[0];
  const point = { lat: parseFloat(lat), lng: parseFloat(lon) };
  await cacheGeocode(db, placeName, point.lat, point.lng);
  return point;
}

// Geocodes an article's subject location (primary marker) and any other
// extracted locations (secondary markers), respecting Nominatim's 1 req/sec
// rate limit via a sequential queue with a fixed delay between calls.
export async function geocodeArticle(db, articleId, { subjectLocation, otherLocations }) {
  const placesToGeocode = [];
  if (subjectLocation) placesToGeocode.push({ name: subjectLocation, isSubject: true });
  for (const name of otherLocations ?? []) {
    if (name && name !== subjectLocation) placesToGeocode.push({ name, isSubject: false });
  }

  let failedCount = 0;

  for (const place of placesToGeocode) {
    let point;
    try {
      point = await geocodeOne(db, place.name);
    } catch (err) {
      console.error(`[geocode] failed for "${place.name}": ${err.message}`);
      point = null;
    }

    if (point) {
      await db
        .prepare(
          'INSERT INTO article_locations (article_id, place_name, lat, lng, is_subject, geocode_src) ' +
            'VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(articleId, place.name, point.lat, point.lng, place.isSubject ? 1 : 0, 'nominatim')
        .run();
    } else {
      failedCount += 1;
    }

    await sleep(NOMINATIM_DELAY_MS);
  }

  return failedCount;
}
