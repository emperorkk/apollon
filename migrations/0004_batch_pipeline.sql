-- Staging tables for the OpenAI Batch API pipeline. Ingested articles land
-- here first (status='queued'), get folded into a batch job (status=
-- 'batched'), then once the batch completes their GPT result is stored
-- (status='ready') for the finalize step to pick up in bounded chunks
-- (geocode/embed/relate/insert into articles, then delete the row).

CREATE TABLE pending_articles (
  id            TEXT PRIMARY KEY,        -- SHA-256(guid), same scheme as articles.id
  guid          TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  url           TEXT NOT NULL,
  title_orig    TEXT NOT NULL,
  body          TEXT,
  language      TEXT NOT NULL,
  pub_date      DATETIME NOT NULL,
  greece_flag   INTEGER DEFAULT 0,
  batch_id      TEXT,
  gpt_result    TEXT,                    -- JSON, populated once the batch completes
  status        TEXT NOT NULL DEFAULT 'queued', -- queued | batched | ready | failed
  error_message TEXT,
  created_at    DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX idx_pending_status ON pending_articles(status);
CREATE INDEX idx_pending_batch ON pending_articles(batch_id);

CREATE TABLE batch_jobs (
  id             TEXT PRIMARY KEY,       -- OpenAI batch id (batch_...)
  input_file_id  TEXT,
  status         TEXT NOT NULL DEFAULT 'validating',
  submitted_at   DATETIME DEFAULT (datetime('now')),
  completed_at   DATETIME,
  error_message  TEXT
);
