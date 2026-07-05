# World Intelligence Dashboard — Technical Specification v1.0

**Platform:** Global News Aggregation & Intelligence Dashboard  
**Version:** 1.0 · July 2026  
**Target:** Claude Code  
**Stack:** Cloudflare Workers · D1 · Vectorize · Pages · OpenAI · Google OAuth

---

## Table of Contents

1. [Overview](#1-overview)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Data Model](#4-data-model-cloudflare-d1--sqlite)
5. [Ingestion Pipeline](#5-ingestion-pipeline)
6. [Worker API Routes](#6-worker-api-routes)
7. [Frontend](#7-frontend-cloudflare-pages)
8. [Initial RSS Source List](#8-initial-rss-source-list-25-sources)
9. [External Services & Credentials](#9-external-services--credentials)
10. [Cost Estimate](#10-cost-estimate-monthly-at-steady-state)
11. [Worker File Structure](#11-worker-file-structure)
12. [wrangler.toml Skeleton](#12-wranglertoml-skeleton)
13. [Vectorize Index Setup](#13-vectorize-index-setup)
14. [Key Behavioural Rules](#14-key-behavioural-rules)
15. [Phase 2 Backlog](#15-phase-2-backlog)
16. [Implementation Order](#16-recommended-implementation-order)

---

## 1. Overview

The World Intelligence Dashboard is a **public, real-time global news aggregation platform** built on Cloudflare infrastructure. It ingests 25–30 international RSS feeds every 30 minutes, processes each article through **GPT-4.4-mini** for English summarisation, topic tagging, entity extraction, and importance scoring. Summaries are embedded for semantic similarity search. Locations are geocoded and rendered on an interactive world map.

Authenticated users (Google OAuth) may subscribe to browser push notifications. A hidden admin interface — restricted to `kkourentzes@gmail.com` — controls topic taxonomy, trigger levels, and source management.

### Key LLM cost decision

- **Model:** `gpt-4.4-mini` for all processing (EN summary + tags + entities + score)
- **English articles (majority):** summarise in English only — no Greek output
- **Non-English articles:** since translation is already happening, output a Greek summary directly — zero extra cost
- **Greek synopsis for EN articles:** moved to Phase 2 (would increase costs by >10% at scale)
- The `synopsis_gr` column is present in the schema (nullable) so Phase 2 is a non-breaking addition

---

## 2. Goals & Non-Goals

### Goals

- Aggregate global news across energy, war, natural disasters, diplomacy, and logistics
- Provide English summaries for EN-source articles
- Provide Greek summaries for non-EN-source articles (translation + Greek output in one pass)
- Surface topic associations through semantic embeddings (cosine similarity ≥ 0.85)
- Render an interactive world map with geotagged article markers
- Enable full-text keyword search across the last 5–30 days of articles
- Deliver browser push notifications for highest-priority (level 5) events
- Guarantee Greece-origin articles are always ingested regardless of importance score

### Non-Goals (v1)

- Greek-language synopses (Phase 2)
- Mobile native apps
- User-specific personalisation beyond notification subscription
- Paid tier or paywalled content
- Translation of full article bodies (summary only)
- Social sharing or comments

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    RSS SOURCES  (25–30)                      │
│     Wire services · Regional outlets · Topic-specific        │
└───────────────────────────┬─────────────────────────────────┘
                            │ every 30 min (Cron Trigger)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│           CLOUDFLARE WORKER — INGESTION CRON                │
│  Fetch RSS → Parse → Deduplicate (D1 guid check)            │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│           CLOUDFLARE WORKER — PROCESSING PIPELINE           │
│  GPT-4.4-mini → EN summary + topic tags + named entities    │
│               + locations + importance score 1–10           │
│               + non-EN articles → Greek summary directly    │
│  Nominatim    → geocode (article subject location priority)  │
│  Embeddings   → text-embedding-3-small → Vectorize index    │
│  D1 write     → articles, tags, locations, relations        │
│  Push fan-out → if score triggers level-5 topic             │
└──────────┬──────────────────────────┬────────────────────── ┘
           │                          │
           ▼                          ▼
    Cloudflare D1              Cloudflare Vectorize
    (structured data)          (semantic embeddings)
           │                          │
           └──────────┬───────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              CLOUDFLARE PAGES — FRONTEND                    │
│  Leaflet map · 5-day feed · Cytoscape graph · Search        │
│  Google OAuth · Push subscription · Admin panel             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Data Model (Cloudflare D1 — SQLite)

### 4.1 articles

```sql
CREATE TABLE articles (
  id            TEXT PRIMARY KEY,        -- SHA-256(guid)
  guid          TEXT UNIQUE NOT NULL,    -- original RSS guid
  source_id     TEXT NOT NULL,           -- FK → sources.id
  url           TEXT NOT NULL,
  title_orig    TEXT NOT NULL,           -- original language headline
  title_en      TEXT,                    -- EN headline (EN sources); null for non-EN sources
  summary_en    TEXT,                    -- 100-150 word EN summary
  synopsis_gr   TEXT,                    -- Greek synopsis (nullable, Phase 2)
  language      TEXT NOT NULL,           -- ISO 639-1 source language
  importance    INTEGER NOT NULL,        -- 1–10 GPT-assigned score
  pub_date      DATETIME NOT NULL,
  ingested_at   DATETIME DEFAULT (datetime('now')),
  greece_flag   INTEGER DEFAULT 0,       -- 1 if Greece-origin or Greece-related
  vectorized    INTEGER DEFAULT 0        -- 1 once embedded in Vectorize
);

CREATE INDEX idx_articles_pub_date   ON articles(pub_date DESC);
CREATE INDEX idx_articles_importance ON articles(importance DESC);

CREATE VIRTUAL TABLE articles_fts USING fts5(
  title_en, title_orig, summary_en,
  content='articles', content_rowid='rowid'
);
```

### 4.2 sources

```sql
CREATE TABLE sources (
  id            TEXT PRIMARY KEY,        -- slug e.g. 'reuters-world'
  name          TEXT NOT NULL,
  rss_url       TEXT NOT NULL UNIQUE,
  region        TEXT NOT NULL,           -- ISO 3166-1 alpha-2
  language      TEXT NOT NULL,           -- ISO 639-1
  category_bias TEXT,                    -- hint: 'energy', 'general', 'war'…
  active        INTEGER DEFAULT 1,
  created_at    DATETIME DEFAULT (datetime('now'))
);
```

### 4.3 topics

```sql
CREATE TABLE topics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,    -- e.g. 'Energy'
  name_gr       TEXT,                    -- Greek label (for Phase 2 UI)
  keywords      TEXT NOT NULL,           -- JSON array of strings
  color_hex     TEXT NOT NULL,           -- map marker color e.g. '#e94560'
  trigger_level INTEGER NOT NULL DEFAULT 3, -- 1–5; only 5 fires push
  active        INTEGER DEFAULT 1
);
```

### 4.4 article_topics (M:M)

```sql
CREATE TABLE article_topics (
  article_id    TEXT    NOT NULL REFERENCES articles(id),
  topic_id      INTEGER NOT NULL REFERENCES topics(id),
  confidence    REAL    NOT NULL DEFAULT 1.0,
  PRIMARY KEY (article_id, topic_id)
);
```

### 4.5 article_locations

```sql
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
```

### 4.6 article_relations

```sql
CREATE TABLE article_relations (
  article_a     TEXT NOT NULL REFERENCES articles(id),
  article_b     TEXT NOT NULL REFERENCES articles(id),
  similarity    REAL NOT NULL,           -- cosine similarity ≥ 0.85
  shared_tags   TEXT,                    -- JSON array of shared topic ids
  PRIMARY KEY (article_a, article_b),
  CHECK (article_a < article_b)          -- avoid duplicate pairs
);
```

### 4.7 users & push_subscriptions

```sql
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
```

### 4.8 geocode_cache

```sql
CREATE TABLE geocode_cache (
  place_name    TEXT PRIMARY KEY,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  cached_at     DATETIME DEFAULT (datetime('now'))
);
```

---

## 5. Ingestion Pipeline

### 5.1 Cron Trigger

A Cloudflare Worker Cron Trigger fires every **30 minutes** (`*/30 * * * *`). The trigger calls the ingestion handler which processes all active sources sequentially.

### 5.2 RSS Fetch & Parse

- **Fetch:** Each active source RSS URL fetched with a 10-second timeout
- **Parse:** Use `rss-parser` npm package to extract: `guid`, `title`, `link`, `pubDate`, `content:encoded` or `description`, `dc:creator`
- **Deduplicate:** SHA-256 the guid. Check D1 for existence. Skip if found
- **Language detection:** Use the source's declared `language` field. No automatic detection needed
- **Greece flag:** Set `greece_flag = 1` if source `region = 'GR'` OR if GPT later returns `greece_related = true`. These articles bypass any importance-based filtering and are always stored

### 5.3 GPT-4.4-mini Processing (single API call per article)

The prompt branches on source language. Both branches are single API calls.

**Branch A — English-source articles (`language = 'en'`):**

```
SYSTEM:
You are a geopolitical intelligence analyst. Respond ONLY with valid JSON.
No markdown, no explanation, no code fences.

USER:
Analyse the following English news article and return a JSON object with exactly these fields:
{
  "title_en":         string,   // English headline
  "summary_en":       string,   // 100-150 word English summary
  "synopsis_gr":      null,     // always null for English-source articles
  "topics":           string[], // from allowed list injected below
  "entities": {
    "people":         string[],
    "orgs":           string[],
    "locations":      string[]
  },
  "subject_location": string | null,
  "importance":       number,   // 1–10 (see scale below)
  "greece_related":   boolean
}

Importance scale:
1-2: Local/minor interest
3-4: National significance
5-6: Regional significance
7-8: Multi-regional impact
9-10: Global geopolitical event

Allowed topics: [DYNAMICALLY INJECTED FROM D1 topics TABLE]
Article title: {title_orig}
Article body: {body_snippet_500_chars}
```

**Branch B — Non-English-source articles (`language != 'en'`):**

```
SYSTEM:
You are a geopolitical intelligence analyst. Respond ONLY with valid JSON.
No markdown, no explanation, no code fences.

USER:
Analyse the following news article (written in {language}) and return a JSON object
with exactly these fields:
{
  "title_en":         string,   // English headline (translated)
  "summary_en":       null,     // always null for non-English-source articles
  "synopsis_gr":      string,   // 80-100 word Greek summary (translate + summarise in one step)
  "topics":           string[], // from allowed list injected below
  "entities": {
    "people":         string[],
    "orgs":           string[],
    "locations":      string[]
  },
  "subject_location": string | null,
  "importance":       number,   // 1–10 (see scale below)
  "greece_related":   boolean
}

Importance scale:
1-2: Local/minor interest
3-4: National significance
5-6: Regional significance
7-8: Multi-regional impact
9-10: Global geopolitical event

Allowed topics: [DYNAMICALLY INJECTED FROM D1 topics TABLE]
Article language: {language}
Article title: {title_orig}
Article body: {body_snippet_500_chars}
```

> **Note:** For non-EN articles, `synopsis_gr` is populated immediately. For EN articles, `synopsis_gr` remains null until Phase 2 activates Greek output for EN sources.

> **Note:** The topics list is fetched from D1 at the start of each cron run and injected into every prompt. New topics created in the admin panel take effect on the next cron cycle — no code deployment needed.

### 5.4 Geocoding (OSM Nominatim)

- **Primary:** If GPT returns a non-null `subject_location`, geocode that string first via Nominatim. Set `is_subject = 1`
- **Secondary:** Geocode remaining strings in `entities.locations` via Nominatim. Set `is_subject = 0`
- **Cache:** Check `geocode_cache` before calling Nominatim. Write result to cache on success
- **Rate limiting:** Nominatim requires max 1 req/sec. Use sequential queue with 1100ms delay between calls
- **User-Agent:** Must send `User-Agent: WorldIntelligenceDashboard/1.0 (contact@yourdomain.com)` — required by Nominatim ToS
- **Fallback:** If Nominatim returns no result, log and skip that location. Never fabricate coordinates

### 5.5 Embeddings & Vectorize

- **Input text:** `title_en + ' ' + summary_en` (max 512 tokens)
- **Model:** OpenAI `text-embedding-3-small` (1536 dimensions, $0.02/1M tokens)
- **Storage:** Upsert to Vectorize index `wid-articles` with metadata: `{ article_id, pub_date, topics[], importance }`
- **Relation computation:** After inserting, query Vectorize for top-20 nearest neighbours with similarity ≥ 0.85. Write results to `article_relations`. Only run for articles published within the last 30 days
- **Similarity threshold:** Hardcoded at 0.85 (v1). Configurable in Phase 2

### 5.6 Push Notification Fan-out

Trigger condition: `article.importance >= topic.trigger_level AND topic.trigger_level = 5`

When triggered, fetch all rows from `push_subscriptions` and send Web Push to each endpoint.

**Push payload (≤ 4KB):**

```json
{
  "title": "[{topic_name}] {title_en}",
  "body":  "{title_en truncated to 100 chars}",
  "icon":  "/icons/icon-192.png",
  "url":   "/article/{article_id}"
}
```

> VAPID public and private keys stored as Worker secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`). Use the `web-push` npm library for signing.

---

## 6. Worker API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/articles` | Public | List articles. Query params: `days` (1–30), `topic`, `region`, `q` (FTS), `page`, `limit` |
| GET | `/api/articles/:id` | Public | Single article with locations, topics, related list (1-hop) |
| GET | `/api/articles/:id/graph` | Public | 2-hop relation graph for Cytoscape: `{ nodes[], edges[] }` |
| GET | `/api/map` | Public | Locations for map. Params: `days` (1–30, default 5), `topic` |
| GET | `/api/topics` | Public | All active topics: `id, name, name_gr, color_hex` |
| GET | `/api/search` | Public | FTS5 search. Params: `q`, `days`, `topic` |
| POST | `/api/auth/google` | Public | Verify Google ID token → return signed session JWT |
| POST | `/api/push/subscribe` | JWT | Save push subscription for authenticated user |
| DELETE | `/api/push/subscribe` | JWT | Remove push subscription |
| GET | `/api/admin/topics` | Admin | List all topics including inactive |
| POST | `/api/admin/topics` | Admin | Create topic |
| PUT | `/api/admin/topics/:id` | Admin | Update topic (keywords, level, color, active) |
| DELETE | `/api/admin/topics/:id` | Admin | Soft-delete (sets `active = 0`) |
| GET | `/api/admin/sources` | Admin | List all sources |
| POST | `/api/admin/sources` | Admin | Add RSS source |
| PUT | `/api/admin/sources/:id` | Admin | Update source (toggle active, edit fields) |
| GET | `/api/admin/stats` | Admin | System stats: articles/day, API cost estimate, push subscriber count |

### Authentication Middleware

- **Public routes:** No token required
- **JWT routes:** Verify `Bearer` JWT signed with `JWT_SECRET` Worker secret. Payload: `{ email, sub, iat, exp }`
- **Admin routes:** JWT check PLUS `email === 'kkourentzes@gmail.com'` enforced **server-side**. Return 403 for any other authenticated user. Admin page returns 404 to unauthenticated requests

---

## 7. Frontend (Cloudflare Pages)

Single-page application built with **vanilla JS + HTML + CSS** (no framework). Assets served from Cloudflare Pages. API calls proxied through Pages Functions at `/api/*`.

### 7.1 Page Layout

```
┌────────────────────────────────────────────────────────────┐
│  HEADER: Logo · Topic filters · Search bar · Login btn    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  MAP PANEL (Leaflet.js, 60% viewport height)              │
│  Interactive world map · MarkerCluster · Topic colours    │
│  Time slider: 1–30 days (default 5)                       │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  FEED PANEL (scrollable, 40% viewport height)             │
│  Article cards sorted by importance · FTS search          │
│  Filters: topic pill · region · date range                │
└────────────────────────────────────────────────────────────┘
```

### 7.2 Map (Leaflet.js + Leaflet.MarkerCluster)

- **Tiles:** OpenStreetMap (no API key required)
- **Marker colour:** derived from `topic.color_hex`
- **Subject location marker:** larger icon with CSS pulse animation
- **Secondary location markers:** smaller, 70% opacity
- **Clustering:** `Leaflet.MarkerCluster` groups nearby markers; cluster bubble shows count
- **Click marker:** opens article card panel (slides in from right)
- **Time control:** range slider (1–30 days). Default = 5 days. On change, re-fetch `/api/map?days=N` and redraw markers without page reload
- **Auto-refresh:** every 30 minutes, aligned with cron cadence

### 7.3 Article Card

Slide-in panel (right side on desktop, bottom sheet on mobile):

- Source name + region flag + publication date
- Original language headline (`title_orig`)
- **EN sources:** English summary (`summary_en`) shown by default. GR tab shows placeholder: *"Η ελληνική σύνοψη θα είναι διαθέσιμη σύντομα."*
- **Non-EN sources:** Greek summary (`synopsis_gr`) shown by default. EN tab shows the translated `title_en` + a note that full EN summary is Phase 2
- Topic pills (colour-coded)
- Importance bar (1–10 visual indicator)
- External link to original article
- Related Articles: list of up to 5 related article titles with similarity score badge
- **"View Graph"** button → opens Cytoscape panel

### 7.4 Cytoscape.js Relation Graph

- **Trigger:** user clicks "View Graph" in the article card
- **Depth:** 2 hops from the selected article
- **Node size:** scaled from importance score (1–10 → 20px–60px radius)
- **Node colour:** primary topic colour
- **Edge thickness:** proportional to similarity score
- **Edge label:** shared topic name
- **Layout:** `cose` (force-directed)
- **Interaction:**
  - Click node → loads that article's card
  - Double-click node → re-centres graph on that node and expands its 2-hop neighbourhood
- **Cap:** max 50 nodes; if exceeded, prioritise by similarity score descending
- **Container:** full-screen modal overlay, `<canvas>` managed by Cytoscape

### 7.5 Feed & Keyword Search

- **Default:** last 5 days, sorted by importance descending
- **Keyword search:** input triggers `/api/search?q=...` (FTS5). Results replace the feed. Debounced 400ms
- **Filters:** topic pills (multi-select), region dropdown, date range picker (up to 30 days)
- **Pagination:** infinite scroll, 20 articles per page
- **Card:** compact — source · flag · date · importance dot · summary preview (2 lines) · topic pills

### 7.6 Authentication (Google OAuth — GSI)

- **Library:** Google Identity Services `accounts.google.com/gsi/client` loaded async
- **Flow:** One-tap or button → Google returns ID token → `POST /api/auth/google` → Worker verifies with Google public keys → returns signed JWT → stored in `localStorage`
- **Session:** JWT expiry 7 days. Silent re-auth via GSI on expiry
- **Push toggle:** shown only to authenticated users (in header)
- **Admin link:** shown in header only if JWT `email === 'kkourentzes@gmail.com'`

### 7.7 Admin Panel (/admin)

**Access:** `kkourentzes@gmail.com` only. Any other request receives a generic 404.

**Topic Management:**
- Table: name, Greek label, keywords, trigger level (1–5), colour, active toggle
- Add/edit via modal; delete = soft delete (`active = 0`)

**Source Management:**
- Table: name, URL, region flag, language, category bias, active toggle
- Add: enter URL → auto-fetch feed title as default name → confirm fields

**System Stats:**
- Articles ingested today / this week / this month
- Estimated API costs (tokens used × model price)
- Push subscriber count
- Last cron run timestamp and status
- Failed geocoding count (last 24h)

---

## 8. Initial RSS Source List (25 sources)

| # | Name | Region | Lang | Category | RSS URL |
|---|------|--------|------|----------|---------|
| 1 | Reuters World | INT | EN | General | `feeds.reuters.com/reuters/worldNews` |
| 2 | AP Top News | INT | EN | General | `feeds.apnews.com/apnews/topnews` |
| 3 | BBC World | INT | EN | General | `feeds.bbci.co.uk/news/world/rss.xml` |
| 4 | Al Jazeera EN | INT | EN | General | `aljazeera.com/xml/rss/all.xml` |
| 5 | France 24 EN | FR | EN | General | `france24.com/en/rss` |
| 6 | DW World | DE | EN | General | `rss.dw.com/xml/rss-en-world` |
| 7 | NHK World | JP | EN | General | `nhk.or.jp/rss/news/cat0.xml` |
| 8 | Channel NewsAsia | SG | EN | General | `channelnewsasia.com/rss` |
| 9 | Ekathimerini | GR | EN | General | `ekathimerini.com/rss` |
| 10 | Jerusalem Post | IL | EN | General | `jpost.com/rss/rssfeedsheadlines.aspx` |
| 11 | Haaretz EN | IL | EN | Diplomacy | `haaretz.com/srv/rss` |
| 12 | Egypt Independent | EG | EN | General | `egyptindependent.com/feed` |
| 13 | Notes from Poland | PL | EN | General | `notesfrompoland.com/feed` |
| 14 | Nikkei Asia | JP | EN | Energy/Logistics | `asia.nikkei.com/rss/feed/nar` |
| 15 | South China Morning Post | CN | EN | General | `scmp.com/rss/91/feed` |
| 16 | CGTN World | CN | EN | General | `cgtn.com/subscribe/feeds/en/NewsUpdate.xml` |
| 17 | IEA News | INT | EN | Energy | `iea.org/feed` |
| 18 | OilPrice.com | INT | EN | Energy | `oilprice.com/rss/main` |
| 19 | ReliefWeb | INT | EN | Disasters | `reliefweb.int/updates/rss.xml` |
| 20 | GDACS Alerts | INT | EN | Disasters | `gdacs.org/gdacsapi/api/rss` |
| 21 | Institute for Study of War | INT | EN | War | `understandingwar.org/rss.xml` |
| 22 | Bellingcat | INT | EN | War | `bellingcat.com/feed` |
| 23 | FreightWaves | INT | EN | Logistics | `freightwaves.com/fw-content/uploads/rss.xml` |
| 24 | Lloyd's List | INT | EN | Logistics | `lloydslist.maritimeintelligence.informa.com/rss` |
| 25 | CFR | INT | EN | Diplomacy | `cfr.org/rss/region_rss/all` |

> Admin can add regional-language sources at any time. GPT-4.4-mini handles translation from any language to English during processing.

---

## 9. External Services & Credentials

| Service | Purpose | Secret Name | Storage |
|---------|---------|-------------|---------|
| OpenAI GPT-4.4-mini | EN articles: summarise + tag + score; non-EN: Greek summary + tag + score in one pass | `OPENAI_API_KEY` | Worker Secret |
| OpenAI Embeddings | `text-embedding-3-small` | `OPENAI_API_KEY` | Worker Secret (same) |
| Google OAuth GSI | User authentication | `GOOGLE_CLIENT_ID` | Worker Secret + Pages env |
| Web Push (VAPID) | Push notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Worker Secrets |
| JWT signing | Session tokens | `JWT_SECRET` (256-bit random) | Worker Secret |
| OSM Nominatim | Geocoding | None — send User-Agent header | — |
| Cloudflare D1 | Primary database | Bound in `wrangler.toml` | — |
| Cloudflare Vectorize | Embedding storage & search | Bound in `wrangler.toml` | — |
| Cloudflare Pages | Frontend hosting | CF account | — |

---

## 10. Cost Estimate (monthly at steady state)

**Volume basis:** 25 sources × 48 fetches/day × avg 5 new articles = ~7,200 articles/day → ~216,000/month

| Item | Volume | Unit Cost | Monthly Est. |
|------|--------|-----------|-------------|
| GPT-4.4-mini input | ~75M tokens | $0.15/1M | ~$11 |
| GPT-4.4-mini output (EN sources → EN summary) | ~20M tokens | $0.60/1M | ~$12 |
| GPT-4.4-mini output (non-EN sources → GR summary, one pass) | ~5M tokens | $0.60/1M | ~$3 |
| text-embedding-3-small | ~75M tokens | $0.02/1M | ~$1.50 |
| Cloudflare Workers | ~500K invocations | $5/month plan | $5 |
| Cloudflare D1 | ~500MB + queries | Free tier | ~$0 |
| Cloudflare Vectorize | ~7M vectors | $0.01/1M stored | ~$1 |
| Cloudflare Pages | Frontend | Free | $0 |
| OSM Nominatim | Geocoding | Free | $0 |
| **Total** | | | **~$34/month** |

> **Phase 2 cost impact of adding Greek synopses:** Adding Greek output (~80 tokens per article) across all articles would add ~17M output tokens/month → ~$10/month additional. Acceptable at Phase 2 since the platform is already running.

---

## 11. Worker File Structure

```
world-intelligence-dashboard/
├── wrangler.toml
├── package.json
├── src/
│   ├── worker.js                    # Main router (hono recommended)
│   ├── cron.js                      # Cron trigger handler
│   ├── pipeline/
│   │   ├── ingest.js                # RSS fetch + parse + deduplicate
│   │   ├── process.js               # GPT-4.4-mini call + response parsing
│   │   ├── geocode.js               # Nominatim + cache logic
│   │   ├── embed.js                 # Embedding + Vectorize upsert
│   │   ├── relate.js                # Similarity query + relation write
│   │   └── notify.js                # Web Push fan-out
│   ├── api/
│   │   ├── articles.js              # GET /api/articles, /api/articles/:id
│   │   ├── graph.js                 # GET /api/articles/:id/graph
│   │   ├── map.js                   # GET /api/map
│   │   ├── search.js                # GET /api/search
│   │   ├── auth.js                  # POST /api/auth/google
│   │   ├── push.js                  # POST/DELETE /api/push/subscribe
│   │   └── admin/
│   │       ├── topics.js
│   │       ├── sources.js
│   │       └── stats.js
│   └── lib/
│       ├── auth.js                  # JWT verify + admin guard middleware
│       ├── db.js                    # D1 query helpers
│       └── constants.js
├── frontend/                        # Cloudflare Pages source
│   ├── index.html
│   ├── admin.html
│   ├── css/
│   │   ├── main.css
│   │   └── map.css
│   └── js/
│       ├── app.js                   # Bootstrap + routing
│       ├── map.js                   # Leaflet init + marker management
│       ├── feed.js                  # Feed render + infinite scroll
│       ├── graph.js                 # Cytoscape init + data loading
│       ├── card.js                  # Article card component
│       ├── auth.js                  # GSI init + JWT management
│       ├── push.js                  # Push subscription UI
│       └── admin.js                 # Admin panel logic
└── migrations/
    └── 0001_initial.sql             # Full D1 schema
```

---

## 12. wrangler.toml Skeleton

```toml
name = "world-intelligence-dashboard"
main = "src/worker.js"
compatibility_date = "2025-01-01"

[triggers]
crons = ["*/30 * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "wid-db"
database_id = "<your-d1-database-id>"

[[vectorize]]
binding = "VECTORIZE"
index_name = "wid-articles"

[vars]
ENVIRONMENT = "production"

# Secrets — set via: wrangler secret put SECRET_NAME
# OPENAI_API_KEY
# GOOGLE_CLIENT_ID
# JWT_SECRET
# VAPID_PUBLIC_KEY
# VAPID_PRIVATE_KEY
```

---

## 13. Vectorize Index Setup

```bash
# Run once to create the index
wrangler vectorize create wid-articles \
  --dimensions=1536 \
  --metric=cosine

# Metadata fields available for filtering:
# article_id  (string)
# pub_date    (string, ISO 8601) — use for 30-day window filter
# importance  (number)
# topics      (string, JSON array)
```

When querying for related articles, filter to the last 30 days to keep performance bounded:

```js
const results = await env.VECTORIZE.query(embedding, {
  topK: 20,
  filter: { pub_date: { $gt: thirtyDaysAgoISO } },
  returnMetadata: true,
});
// Then filter results to similarity >= 0.85
const related = results.matches.filter(m => m.score >= 0.85);
```

---

## 14. Key Behavioural Rules

### Greece Rule

Any article where `source.region = 'GR'` OR where GPT returns `greece_related = true` **must** be ingested and stored. The importance score is stored as-is — it is not inflated. The Greece flag overrides any importance-based filtering that might otherwise skip low-scoring articles.

### Importance Scoring Scale

| Score | Meaning | Example |
|-------|---------|---------|
| 1–2 | Local/minor interest | City council decision, local event |
| 3–4 | National significance | Domestic policy change, regional election |
| 5–6 | Regional significance | Bilateral trade deal, regional conflict escalation |
| 7–8 | Multi-regional impact | Major sanctions, large-scale natural disaster |
| 9–10 | Global geopolitical event | Superpower military action, global financial shock |

### Topic Trigger Levels

| Level | Meaning | Push Notification |
|-------|---------|-------------------|
| 1 | Monitor only | No |
| 2 | Low priority | No |
| 3 | Medium priority | No |
| 4 | High priority | No |
| 5 | Critical | **YES — push to all subscribers** |

A push fires when: `article.importance >= topic.trigger_level AND topic.trigger_level = 5`. Admin sets level 5 only for topics where any event warrants immediate attention regardless of fine-grained score.

### Location Priority Rule

If GPT identifies a `subject_location` (the place the article is fundamentally **about**), that is geocoded first and shown as the primary map marker. Incidental locations mentioned in the body are secondary markers. If no subject location is found, the source's region is used as fallback.

### Relation Graph — 2-Hop Cap

When loading a graph for article A: fetch all articles directly related to A (similarity ≥ 0.85 in `article_relations`) — hop-1 nodes. Then fetch all articles related to each hop-1 node — hop-2 nodes. Cap total nodes at **50**, prioritised by similarity score descending. Render with Cytoscape `cose` layout.

### EN/GR Toggle (v1 behaviour)

The article card shows an EN/GR toggle in all cases. Behaviour varies by source language:

| Source language | EN tab | GR tab |
|----------------|--------|--------|
| English | `summary_en` (default) | Placeholder: *"Η ελληνική σύνοψη θα είναι διαθέσιμη σύντομα."* |
| Non-English | `title_en` + Phase 2 note | `synopsis_gr` (default) |

The toggle UI is fully built in v1. Phase 2 only requires adding `summary_en` output to the non-EN branch and `synopsis_gr` output to the EN branch of the GPT prompt — no frontend changes needed.

---

## 15. Phase 2 Backlog

- **Greek synopses** — add `synopsis_gr` output to GPT-4.4-mini prompt; populate the nullable column already in the schema; activate the EN/GR toggle. Estimated +$10/month
- Configurable similarity threshold (admin panel)
- Telegram bot notifications
- Email digest (daily summary via Resend or Mailgun)
- Topic trend charts (articles-per-topic over time)
- Named entity timeline (person/org appears across N articles)
- User watchlist (saved keywords, personal push on match)
- Export processed feed as RSS
- Regional language feed toggle (show articles in original language)

---

## 16. Recommended Implementation Order

| Phase | Deliverable | Dependencies |
|-------|-------------|--------------|
| 1 | D1 schema + migrations | None |
| 2 | Vectorize index creation | None |
| 3 | Ingestion Worker (RSS fetch + dedup) | D1 |
| 4 | GPT-4.4-mini processing pipeline | D1 + OpenAI key |
| 5 | Geocoding pipeline (Nominatim + cache) | D1 |
| 6 | Embedding + Vectorize pipeline | Vectorize + OpenAI key |
| 7 | Relation computation (similarity ≥ 0.85) | Vectorize + D1 |
| 8 | Cron trigger wiring (30min) | Phases 3–7 |
| 9 | Public API routes | D1 |
| 10 | Frontend — Feed + Search | API routes |
| 11 | Frontend — Leaflet Map + MarkerCluster | API map route |
| 12 | Frontend — Cytoscape Graph (2-hop) | API graph route |
| 13 | Google OAuth + JWT auth | `GOOGLE_CLIENT_ID` |
| 14 | Web Push + VAPID | JWT auth + D1 |
| 15 | Admin Panel (topics + sources + stats) | All routes + auth |
| 16 | System stats endpoint | All prior phases |

---

*World Intelligence Dashboard · Technical Specification v1.0 · July 2026*
