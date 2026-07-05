import Parser from 'rss-parser';
import { articleExists } from '../lib/db.js';
import { RSS_FETCH_TIMEOUT_MS } from '../lib/constants.js';

const parser = new Parser({ timeout: RSS_FETCH_TIMEOUT_MS });

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fetches and parses one source's RSS feed, returning only articles not
// already present in D1 (deduplicated by SHA-256 of the RSS guid).
export async function fetchNewArticles(db, source) {
  let feed;
  try {
    feed = await parser.parseURL(source.rss_url);
  } catch (err) {
    console.error(`[ingest] failed to fetch ${source.id}: ${err.message}`);
    return [];
  }

  const fresh = [];
  for (const item of feed.items ?? []) {
    const guid = item.guid || item.id || item.link;
    if (!guid) continue;

    const id = await sha256Hex(guid);
    if (await articleExists(db, guid)) continue;

    fresh.push({
      id,
      guid,
      source_id: source.id,
      url: item.link,
      title_orig: item.title ?? '',
      body: item['content:encoded'] || item.content || item.contentSnippet || item.summary || '',
      pub_date: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      language: source.language,
      greece_flag: source.region === 'GR' ? 1 : 0,
    });
  }
  return fresh;
}
