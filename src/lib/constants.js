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
// embed + relate) per cron tick, so a large batch finishing all at once
// can't blow the per-invocation subrequest limit. Leftovers finish on
// subsequent ticks.
export const MAX_FINALIZE_PER_RUN = 20;
