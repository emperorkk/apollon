# World Intelligence Dashboard

Global news aggregation & geopolitical intelligence platform on Cloudflare (Workers, D1, Vectorize, Pages).

See [`WID_Technical_Specification_v1.0.md`](./WID_Technical_Specification_v1.0.md) for the full technical spec.

## Architecture

- **Worker** (`src/`) — cron-driven RSS ingestion, GPT-4.4-mini processing, Nominatim
  geocoding, OpenAI embeddings + Vectorize, and the public/admin JSON API.
- **Pages** (`frontend/`) — a vanilla JS/HTML/CSS single-page app (Leaflet map,
  feed, Cytoscape relation graph, admin console). No build step.
- **D1** — structured data (`migrations/`). **Vectorize** — article embeddings for
  semantic relations.

The two halves deploy as separate Cloudflare resources connected to this same
GitHub repo, so pushes to the tracked branch auto-deploy both.

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
- Build command: none — it deploys `src/worker.js` directly via `wrangler.toml`
- After the first deploy, set secrets (never commit these):

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put JWT_SECRET        # any 256-bit random string
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

Generate a VAPID key pair with `npx web-push generate-vapid-keys`.

### 3. Connect Pages (Cloudflare dashboard → Workers & Pages → Import a repository)

- Root directory: `frontend`
- Build command: none (static assets + Pages Functions)
- Environment variable: `WORKER_URL` = the Worker's `*.workers.dev` URL (or custom
  domain) — used by `frontend/functions/api/[[path]].js` to proxy `/api/*`

### 4. Run migrations against the remote D1 database

```bash
npm run db:migrate:remote
npm run db:seed:remote
```

### 5. Google OAuth

Create an OAuth 2.0 Client ID (Web application) in Google Cloud Console.
Add both the Pages URL and any custom domain as Authorized JavaScript origins.
The client ID is not secret — put it in `frontend/js/config.js` (`GOOGLE_CLIENT_ID`)
alongside your VAPID public key (`VAPID_PUBLIC_KEY`), then commit.

### 6. Verify

- Visit the Pages URL: map + feed should populate once the first cron run
  (`*/30 * * * *`) has ingested articles. Trigger one early with
  `npx wrangler triggers` or by waiting for the schedule.
- Sign in with `kkourentzes@gmail.com` and confirm the **ADMIN** link appears
  in the header, linking to `/admin.html`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in the same secrets as above, if testing locally
npm run dev                       # wrangler dev, serves the Worker
npm run db:migrate:local
npm run db:seed:local
```

Serve `frontend/` with any static file server for local UI work; point
`frontend/js/api.js`'s `BASE` at `http://localhost:8787/api` during local testing.

## Status

Full v1 build complete per the spec's implementation order (§16): schema,
ingestion pipeline, public/auth/admin API, and the Pages frontend (map, feed,
article card, relation graph, OAuth, push, admin console). Phase 2 backlog is
tracked in spec §15.
