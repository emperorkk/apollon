-- Supports the daily retention job (src/pipeline/retention.js).
--
-- vector_deletions queues ids of articles removed from D1 whose Vectorize
-- embeddings still need deleting — kept as a table rather than deleted
-- inline so a Vectorize hiccup can't leave orphaned vectors behind; the
-- job drains it on every run.
--
-- idx_relations_b: deleting/counting relations by article_b otherwise
-- scans the whole table (the primary key only covers article_a first).

CREATE TABLE IF NOT EXISTS vector_deletions (
  article_id TEXT PRIMARY KEY
);

CREATE INDEX IF NOT EXISTS idx_relations_b ON article_relations(article_b);
