import Parser from 'rss-parser';
import { articleExists } from '../lib/db.js';
import { RSS_FETCH_TIMEOUT_MS, APP_USER_AGENT } from '../lib/constants.js';

const parser = new Parser();

// rss-parser's parseURL() fetches internally via Node's http/https module,
// which Cloudflare Workers' nodejs_compat layer doesn't implement
// ("[unenv] https.get is not implemented yet!"). Fetch the XML ourselves
// with the native fetch() and hand the text to parseString() instead.
async function fetchXml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': APP_USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fetches and parses one source's RSS feed, returning only articles not
// already present in D1 (deduplicated by SHA-256 of the RSS guid).
export async function fetchNewArticles(db, source) {
  let feed;
  try {
    const xml = await fetchXml(source.rss_url);
    feed = await parser.parseString(xml);
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
