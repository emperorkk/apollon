-- Small key/value store for operational state that has to survive between
-- cron invocations — currently just when each kind of health alert was
-- last sent, so a stalled pipeline pages the admin once every few hours
-- rather than every 5 minutes (src/pipeline/health.js).

CREATE TABLE IF NOT EXISTS app_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at DATETIME DEFAULT (datetime('now'))
);
