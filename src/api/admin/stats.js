import { Hono } from 'hono';
import { requireAdmin } from '../../lib/auth.js';

const app = new Hono();
app.use('/*', requireAdmin);

// Approximate per-article AI cost, derived from the spec's own §10 volume
// basis (~216,000 articles/month -> ~$27.50 GPT + embedding cost).
const AI_COST_PER_ARTICLE = 27.5 / 216_000;

app.get('/', async (c) => {
  const db = c.env.DB;

  const [today, week, month, subscribers, lastRun, failedGeocodes24h] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM articles WHERE date(ingested_at) = date('now')").first(),
    db.prepare("SELECT COUNT(*) AS n FROM articles WHERE ingested_at >= datetime('now', '-7 days')").first(),
    db.prepare("SELECT COUNT(*) AS n FROM articles WHERE ingested_at >= datetime('now', '-1 month')").first(),
    db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first(),
    db.prepare('SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT 1').first(),
    db
      .prepare(
        "SELECT COALESCE(SUM(failed_geocodes), 0) AS n FROM cron_runs WHERE started_at >= datetime('now', '-1 day')"
      )
      .first(),
  ]);

  return c.json({
    articles_today: today.n,
    articles_this_week: week.n,
    articles_this_month: month.n,
    estimated_api_cost_month_usd: Number((month.n * AI_COST_PER_ARTICLE).toFixed(2)),
    push_subscriber_count: subscribers.n,
    last_cron_run: lastRun
      ? {
          started_at: lastRun.started_at,
          finished_at: lastRun.finished_at,
          status: lastRun.status,
          articles_ingested: lastRun.articles_ingested,
        }
      : null,
    failed_geocoding_count_24h: failedGeocodes24h.n,
  });
});

export default app;
