-- Cron run log — backs the admin stats view (spec §7.7): last run
-- timestamp/status and failed-geocode count, which the core schema in §4
-- has no table for.

CREATE TABLE cron_runs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at         DATETIME DEFAULT (datetime('now')),
  finished_at        DATETIME,
  status             TEXT DEFAULT 'running', -- running | success | error
  articles_ingested  INTEGER DEFAULT 0,
  failed_geocodes    INTEGER DEFAULT 0,
  error_message      TEXT
);

CREATE INDEX idx_cron_runs_started ON cron_runs(started_at DESC);
