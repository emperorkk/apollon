export const SIMILARITY_THRESHOLD = 0.85;
export const RELATION_WINDOW_DAYS = 30;
export const DEFAULT_FEED_DAYS = 5;
export const MAX_FEED_DAYS = 30;
export const GRAPH_MAX_NODES = 50;
export const GRAPH_MAX_HOPS = 2;
export const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const APP_USER_AGENT = 'WorldIntelligenceDashboard/1.0 (contact@yourdomain.com)';
export const NOMINATIM_DELAY_MS = 1100;
export const OPENAI_CHAT_MODEL = 'gpt-5.4-mini';
export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const RSS_FETCH_TIMEOUT_MS = 10_000;
export const BATCH_COMPLETION_WINDOW = '24h';
// Cap on how many completed-batch articles get fully processed (geocode +
// embed + relate) per cron tick. Each article can need several sequential
// geocode lookups, each forced to wait ~1.1s (Nominatim's rate limit) — at
// 20/tick that's 60-100+ seconds, risking the request getting cut off
// before it reaches the final "mark as success" update (leaving cron_runs
// stuck at 'running'). Kept small so a tick reliably finishes; leftovers
// just finish on later ticks, which is fine since ingestion isn't
// time-critical. 50 on Workers Paid (D1 allows 1000 queries per
// invocation); it was 5 on Free. Geocoding makes this wall-clock bound, so
// a tick also stops after FINALIZE_TIME_BUDGET_MS to finish inside the
// 5-minute cron interval, and skips finalizing while a previous tick is
// still running (see cron.js).
export const MAX_FINALIZE_PER_RUN = 50;
export const FINALIZE_TIME_BUDGET_MS = 4 * 60 * 1000;
// Daily retention job (pipeline/retention.js): everything older than this
// is deleted — articles plus their relations/topics/locations/entities,
// stale pending articles, and old cron/batch bookkeeping rows.
export const RETENTION_DAYS = 30;
export const RETENTION_DELETE_CHUNK = 500;
export const VECTORIZE_DELETE_CHUNK = 500;
export const RETENTION_CRON = '17 3 * * *';
// Hard cap on relations per article, counting both sides of the pair —
// uncapped shared-entity matching ("United States", etc.) linked each new
// article to thousands of old ones and is what filled D1 up.
export const MAX_RELATIONS_PER_ARTICLE = 20;
// Max queued articles per OpenAI batch submission; the rest go in the next
// batch once this one finishes.
export const MAX_BATCH_SIZE = 500;
// Daily report (pipeline/daily-report.js): runs once a day for the
// previous Athens calendar day. Cron is UTC: 04:23 UTC is 06:23 (winter) /
// 07:23 (summer) in Athens, a few hours after the Athens day ended, which
// gives the batch pipeline time to finish processing late articles.
export const DAILY_REPORT_CRON = '23 4 * * *';
export const DAILY_REPORT_MAX_ARTICLES = 120;
export const DAILY_REPORT_MIN_ARTICLES = 5;
export const SITE_NAME = 'Apollon';
export const SITE_TAGLINE = 'World Intelligence Dashboard';
// Pipeline health (pipeline/health.js, GET /api/health). The ingest cron
// runs every 5 minutes, so no successful run for 30 minutes means it is
// failing or not running; OpenAI batches normally finish within hours.
export const HEALTH_CRON_STALE_MINUTES = 30;
export const HEALTH_BATCH_STALE_HOURS = 26;
export const HEALTH_REPORT_STALE_HOURS = 52;
export const HEALTH_ALERT_COOLDOWN_HOURS = 6;
