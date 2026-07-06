# World Intelligence Dashboard

Global news aggregation & geopolitical intelligence platform, deployed as a
single Cloudflare Worker (Workers, D1, Vectorize, static assets).

See [`WID_Technical_Specification_v1.0.md`](./WID_Technical_Specification_v1.0.md) for the full technical spec.

## Architecture

- **Worker** (`src/`) — cron-driven RSS ingestion, GPT-5.4-mini processing via
  the OpenAI Batch API, Nominatim geocoding, OpenAI embeddings + Vectorize,
  and the public/admin JSON API.
- **Static assets** (`frontend/`) — a vanilla JS/HTML/CSS single-page app (Leaflet
  map, feed, Cytoscape relation graph, admin console). No build step. Served
  directly by the same Worker via the `[assets]` binding in `wrangler.toml`.
- **D1** — structured data (`migrations/`). **Vectorize** — article embeddings for
  semantic relations.

Everything deploys as one Cloudflare Worker connected to this GitHub repo —
`/api/*` requests run the Hono app in `src/worker.js`; every other request is
served as a static file from `frontend/` (falling back to `index.html` for
unmatched paths).

> Earlier versions of this README described a two-project setup (separate
> Worker + Pages project bridged by a `WORKER_URL` proxy). That's no longer
> needed — Cloudflare now supports binding static assets straight to a
> Worker, which is simpler and is what this repo is wired for.

## One-time setup

### 1. Cloudflare resources

Create the D1 database and Vectorize index once, from a machine with `wrangler`
authenticated against your Cloudflare account:

```bash
npm install
npx wrangler d1 create wid-db          # copy the returned database_id into wrangler.toml
npm run vectorize:create
```

Paste the `database_id` into `wrangler.toml` (`[[d1_databases]]`), commit, and push.

### 2. Connect the Worker (Cloudflare dashboard → Workers & Pages → Import a repository)

- Root directory: `/` (repo root, where `wrangler.toml` lives)
- Build command: none — `wrangler.toml` handles both the Worker code
  (`src/worker.js`) and the static assets (`frontend/`)
- After the first deploy, set secrets (never commit these):

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put JWT_SECRET        # any 256-bit random string
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

Generate a VAPID key pair with `npx web-push generate-vapid-keys`.

### 3. Run migrations against the remote D1 database

```bash
npx wrangler d1 execute wid-db --remote --file=./migrations/0001_initial.sql
npx wrangler d1 execute wid-db --remote --file=./migrations/0002_seed.sql
npx wrangler d1 execute wid-db --remote --file=./migrations/0003_cron_runs.sql
npx wrangler d1 execute wid-db --remote --file=./migrations/0004_batch_pipeline.sql
npx wrangler d1 execute wid-db --remote --file=./migrations/0005_source_errors.sql
npx wrangler d1 execute wid-db --remote --file=./migrations/0006_article_entities.sql
```

### 4. Google OAuth

Create an OAuth 2.0 Client ID (Web application) in Google Cloud Console.
Add your Worker's domain(s) (`*.workers.dev` and any custom domain) as
Authorized JavaScript origins. The client ID is not secret — put it in
`frontend/js/config.js` (`GOOGLE_CLIENT_ID`) alongside your VAPID public key
(`VAPID_PUBLIC_KEY`), then commit.

### 5. Verify

- Visit the Worker's domain: map + feed should populate once the first cron
  run (`*/30 * * * *`) has ingested articles.
- Sign in with `kkourentzes@gmail.com` and confirm the **ADMIN** link appears
  in the header, linking to `/admin.html`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in the same secrets as above, if testing locally
npm run dev                       # wrangler dev, serves both the Worker and frontend/
npm run db:migrate:local
npm run db:seed:local
```

## Status

Full v1 build complete per the spec's implementation order (§16): schema,
ingestion pipeline, public/auth/admin API, and the frontend (map, feed,
article card, relation graph, OAuth, push, admin console). Phase 2 backlog is
tracked in spec §15.
