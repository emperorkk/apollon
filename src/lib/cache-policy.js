// Edge cache policy for Workers Caching (wrangler.toml [cache]). With it
// enabled, Cloudflare answers repeat GETs from cache without running the
// Worker at all — no CPU time, no D1 reads — for as long as a response's
// Cache-Control allows.
//
// Every response gets an explicit Cache-Control: Workers Caching applies
// heuristic freshness to responses *without* one (a 200 is cached for ~2
// hours), which would serve stale feeds and could cache admin/auth data.
// Anything not listed here is no-store. Requests carrying Authorization
// (admin, push) are bypassed by Cloudflare automatically on top of that.
//
// s-maxage is the edge TTL; max-age (browser) is kept short so a visitor's
// own reload still picks up the edge's newer copy. The Worker version is
// part of the cache key, so every deploy starts from a clean cache.

const MINUTE = 60;
const HOUR = 60 * MINUTE;

// [path regex, edge TTL seconds, Cache-Tag]. First match wins.
const POLICIES = [
  // Articles land every 5 minutes (cron), so feeds/map/search lag ≤ 2 min.
  [/^\/api\/(articles|map|search|keywords)(\/|$)/, 2 * MINUTE, 'api'],
  [/^\/api\/(topics|regions)$/, 10 * MINUTE, 'api'],
  [/^\/api\/reports$/, 10 * MINUTE, 'reports'],
  // Uptime monitors may poll often; a minute of staleness is fine (a 503
  // "down" response is never cached — only 200s are).
  [/^\/api\/health$/, MINUTE, 'health'],
  // Uptime monitors may poll often; a minute of staleness is fine.
  [/^\/api\/health$/, MINUTE, 'health'],
  // Server-rendered pages (src/web/). A single report never changes once
  // written except via admin regenerate, which purges the 'reports' tag.
  // Both languages: /reports/... and /el/reports/...
  [/^(\/el)?\/reports\/\d{4}-\d{2}-\d{2}\/og\.png$/, 7 * 24 * HOUR, 'reports'],
  [/^(\/el)?\/reports\/\d{4}-\d{2}-\d{2}\/[^/]+$/, 24 * HOUR, 'reports'],
  [/^(\/el)?\/reports(\/region\/[^/]+)?$/, HOUR, 'reports'],
  [/^(\/el)?\/reports\/rss\.xml$/, HOUR, 'reports'],
  [/^\/sitemap\.xml$/, HOUR, 'reports'],
  [/^\/robots\.txt$/, 24 * HOUR, 'static'],
];

// SPA shell served by the notFound fallback (e.g. /article/:id deep links).
const SPA_FALLBACK_TTL = 5 * MINUTE;

function policyFor(path) {
  return POLICIES.find(([re]) => re.test(path)) ?? null;
}

export function cacheControlMiddleware() {
  return async (c, next) => {
    await next();

    let res = c.res;
    const cacheable = c.req.method === 'GET' && res.status === 200;
    const policy = cacheable ? policyFor(c.req.path) : null;
    const isSpaFallback =
      cacheable &&
      !policy &&
      !c.req.path.startsWith('/api/') &&
      (res.headers.get('Content-Type') || '').includes('text/html');

    let value;
    let tag = null;
    if (policy) {
      const [, ttl, cacheTag] = policy;
      value = `public, max-age=${Math.min(ttl, MINUTE)}, s-maxage=${ttl}`;
      tag = cacheTag;
    } else if (isSpaFallback) {
      value = `public, max-age=0, s-maxage=${SPA_FALLBACK_TTL}`;
    } else {
      value = 'no-store';
    }

    // Re-wrapped: responses from bindings (ASSETS) have immutable headers.
    res = new Response(res.body, res);
    res.headers.set('Cache-Control', value);
    if (tag) res.headers.set('Cache-Tag', tag);
    // Hono's c.res setter copies the previous response's headers over the
    // new one, which would put the route's own Cache-Control back; clearing
    // it first makes this policy the single source of truth.
    c.res = undefined;
    c.res = res;
  };
}

// Drops cached pages/API responses carrying `tag` (e.g. after a report is
// (re)generated). Best effort: purge only exists where Workers Caching is
// available, and a failed purge just means waiting out the TTL.
export async function purgeCacheTag(ctx, tag) {
  try {
    await ctx?.cache?.purge?.({ tags: [tag] });
  } catch (err) {
    console.error(`[cache] purge of tag "${tag}" failed: ${err.message}`);
  }
}
