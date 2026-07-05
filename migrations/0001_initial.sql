-- World Intelligence Dashboard — Initial D1 schema
-- Spec §4

CREATE TABLE articles (
  id            TEXT PRIMARY KEY,        -- SHA-256(guid)
  guid          TEXT UNIQUE NOT NULL,    -- original RSS guid
  source_id     TEXT NOT NULL,           -- FK -> sources.id
  url           TEXT NOT NULL,
  title_orig    TEXT NOT NULL,           -- original language headline
  title_en      TEXT,                    -- EN headline (EN sources); null for non-EN sources
  summary_en    TEXT,                    -- 100-150 word EN summary
  synopsis_gr   TEXT,                    -- Greek synopsis (nullable, Phase 2)
  language      TEXT NOT NULL,           -- ISO 639-1 source language
  importance    INTEGER NOT NULL,        -- 1-10 GPT-assigned score
  pub_date      DATETIME NOT NULL,
  ingested_at   DATETIME DEFAULT (datetime('now')),
  greece_flag   INTEGER DEFAULT 0,       -- 1 if Greece-origin or Greece-related
  vectorized    INTEGER DEFAULT 0        -- 1 once embedded in Vectorize
);

CREATE INDEX idx_articles_pub_date   ON articles(pub_date DESC);
CREATE INDEX idx_articles_importance ON articles(importance DESC);
CREATE INDEX idx_articles_source     ON articles(source_id);

CREATE VIRTUAL TABLE articles_fts USING fts5(
  title_en, title_orig, summary_en,
  content='articles', content_rowid='rowid'
);

CREATE TABLE sources (
  id            TEXT PRIMARY KEY,        -- slug e.g. 'reuters-world'
  name          TEXT NOT NULL,
  rss_url       TEXT NOT NULL UNIQUE,
  region        TEXT NOT NULL,           -- ISO 3166-1 alpha-2
  language      TEXT NOT NULL,           -- ISO 639-1
  category_bias TEXT,                    -- hint: 'energy', 'general', 'war'...
  active        INTEGER DEFAULT 1,
  created_at    DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE topics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,    -- e.g. 'Energy'
  name_gr       TEXT,                    -- Greek label (for Phase 2 UI)
  keywords      TEXT NOT NULL,           -- JSON array of strings
  color_hex     TEXT NOT NULL,           -- map marker color e.g. '#e94560'
  trigger_level INTEGER NOT NULL DEFAULT 3, -- 1-5; only 5 fires push
  active        INTEGER DEFAULT 1
);

CREATE TABLE article_topics (
  article_id    TEXT    NOT NULL REFERENCES articles(id),
  topic_id      INTEGER NOT NULL REFERENCES topics(id),
  confidence    REAL    NOT NULL DEFAULT 1.0,
  PRIMARY KEY (article_id, topic_id)
);

CREATE TABLE article_locations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id    TEXT NOT NULL REFERENCES articles(id),
  place_name    TEXT NOT NULL,           -- as extracted by GPT
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  is_subject    INTEGER DEFAULT 0,       -- 1 = article IS about this place
  geocode_src   TEXT DEFAULT 'nominatim' -- 'nominatim' | 'gpt-fallback'
);

CREATE INDEX idx_locations_article ON article_locations(article_id);

CREATE TABLE article_relations (
  article_a     TEXT NOT NULL REFERENCES articles(id),
  article_b     TEXT NOT NULL REFERENCES articles(id),
  similarity    REAL NOT NULL,           -- cosine similarity >= 0.85
  shared_tags   TEXT,                    -- JSON array of shared topic ids
  PRIMARY KEY (article_a, article_b),
  CHECK (article_a < article_b)          -- avoid duplicate pairs
);

CREATE TABLE users (
  email         TEXT PRIMARY KEY,
  google_sub    TEXT UNIQUE NOT NULL,    -- Google subject ID
  display_name  TEXT,
  created_at    DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE push_subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL REFERENCES users(email),
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  created_at    DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE geocode_cache (
  place_name    TEXT PRIMARY KEY,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  cached_at     DATETIME DEFAULT (datetime('now'))
);
