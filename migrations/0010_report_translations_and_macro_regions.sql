-- Greek versions of the daily reports (src/pipeline/daily-report.js
-- translateReport), served at /el/reports/:date/:slug. One row per
-- report and language; the English original stays in daily_reports, and
-- language-neutral data (sources, article_count) is read from there.
CREATE TABLE IF NOT EXISTS daily_report_translations (
  report_date  TEXT NOT NULL REFERENCES daily_reports(report_date),
  lang         TEXT NOT NULL,      -- ISO 639-1, currently only 'el'
  slug         TEXT NOT NULL,      -- transliterated from the translated title
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  summary      TEXT NOT NULL,
  key_points   TEXT NOT NULL,      -- JSON string[]
  sections     TEXT NOT NULL,      -- JSON, same shape/order as the English sections
  keywords     TEXT NOT NULL,      -- JSON string[]
  regions      TEXT,               -- JSON string[]
  created_at   DATETIME DEFAULT (datetime('now')),
  updated_at   DATETIME DEFAULT (datetime('now')),
  PRIMARY KEY (report_date, lang)
);

-- Region hubs are four fixed macro-regions (src/lib/regions.js); GPT tags
-- each report with the ones it covers. JSON string[] of slugs.
ALTER TABLE daily_reports ADD COLUMN macro_regions TEXT;
