-- Tracks the last ingestion error per source so the admin panel can surface
-- it without needing `wrangler tail` — makes it obvious which sources are
-- dead/broken and worth disabling.

ALTER TABLE sources ADD COLUMN last_error TEXT;
ALTER TABLE sources ADD COLUMN last_error_at DATETIME;
ALTER TABLE sources ADD COLUMN last_success_at DATETIME;
