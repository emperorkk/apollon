-- One AI-written briefing per UTC day, summarising that day's articles
-- (src/pipeline/daily-report.js). Served as server-rendered, indexable
-- pages at /reports/:date/:slug.
--
-- Deliberately self-contained (sources are copied in as JSON rather than
-- referencing articles.id): articles are deleted after 30 days by the
-- retention job, but reports are kept indefinitely — they're the site's
-- long-lived, linkable content.

CREATE TABLE IF NOT EXISTS daily_reports (
  report_date   TEXT PRIMARY KEY,   -- YYYY-MM-DD, the UTC day covered
  slug          TEXT NOT NULL,      -- URL slug derived from the title
  title         TEXT NOT NULL,      -- <h1>/<title>, ~60 chars
  description   TEXT NOT NULL,      -- meta description, ~150 chars
  summary       TEXT NOT NULL,      -- lead paragraph
  key_points    TEXT NOT NULL,      -- JSON string[]
  sections      TEXT NOT NULL,      -- JSON [{ heading, paragraphs: string[], sources: number[] }]
  keywords      TEXT NOT NULL,      -- JSON string[]
  sources       TEXT NOT NULL,      -- JSON [{ title, url, source, topic }]
  regions       TEXT,               -- JSON string[] (places most covered)
  article_count INTEGER NOT NULL,
  created_at    DATETIME DEFAULT (datetime('now')),
  updated_at    DATETIME DEFAULT (datetime('now'))
);
