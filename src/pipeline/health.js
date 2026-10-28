import {
  HEALTH_CRON_STALE_MINUTES,
  HEALTH_BATCH_STALE_HOURS,
  HEALTH_REPORT_STALE_HOURS,
  HEALTH_ALERT_COOLDOWN_HOURS,
} from '../lib/constants.js';
import { notifyAdmin } from './notify.js';

// Pipeline health. The ingest pipeline once sat stalled for weeks (a batch
// whose results OpenAI had already deleted blocked every later batch, and
// later the database filled up) with nothing telling anyone. Two layers:
//
//  - GET /api/health returns these checks, with 503 when the pipeline is
//    down, for an external uptime monitor — the only thing that can notice
//    when the Worker's cron isn't running at all.
//  - checkAndAlert() runs at the start of every cron tick and pushes a
//    notification to the admin's subscribed devices when something is
//    wrong, at most once per HEALTH_ALERT_COOLDOWN_HOURS per problem.
//
// Every query here reads a handful of rows (indexed / LIMIT 1) so a monitor
// polling every few minutes costs next to nothing against D1's daily reads.

function ageMinutes(sqliteDatetime, now) {
  if (!sqliteDatetime) return null;
  return Math.round((now - Date.parse(`${sqliteDatetime.replace(' ', 'T')}Z`)) / 60000);
}

export async function getHealth(db, now = Date.now()) {
  const [lastSuccess, lastRun, oldestOpenBatch, lastReport] = await db.batch([
    db.prepare("SELECT started_at, finished_at FROM cron_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1"),
    db.prepare('SELECT started_at, status, error_message FROM cron_runs ORDER BY id DESC LIMIT 1'),
    db.prepare(
      "SELECT id, submitted_at FROM batch_jobs WHERE status NOT IN ('completed','failed','expired','cancelled') ORDER BY submitted_at LIMIT 1",
    ),
    db.prepare('SELECT report_date, created_at FROM daily_reports ORDER BY report_date DESC LIMIT 1'),
  ]);

  const success = lastSuccess.results[0];
  const run = lastRun.results[0];
  const batch = oldestOpenBatch.results[0];
  const report = lastReport.results[0];

  const cronAge = ageMinutes(success?.finished_at || success?.started_at, now);
  const batchAgeHours = batch ? Math.round(ageMinutes(batch.submitted_at, now) / 60) : null;
  const reportAgeHours = report ? Math.round(ageMinutes(report.created_at, now) / 60) : null;

  const problems = [];
  if (cronAge === null || cronAge > HEALTH_CRON_STALE_MINUTES) {
    problems.push({
      key: 'cron',
      severity: 'down',
      message:
        cronAge === null
          ? 'Ingestion has never completed successfully.'
          : `No successful ingestion run for ${cronAge} minutes${run?.error_message ? ` (last error: ${run.error_message.slice(0, 160)})` : ''}.`,
    });
  }
  if (batchAgeHours !== null && batchAgeHours > HEALTH_BATCH_STALE_HOURS) {
    problems.push({
      key: 'batch',
      severity: 'degraded',
      message: `OpenAI batch ${batch.id} has been open for ${batchAgeHours} hours; new articles are not being processed.`,
    });
  }
  if (reportAgeHours !== null && reportAgeHours > HEALTH_REPORT_STALE_HOURS) {
    problems.push({
      key: 'report',
      severity: 'degraded',
      message: `No daily report has been published for ${reportAgeHours} hours.`,
    });
  }

  const status = problems.some((p) => p.severity === 'down') ? 'down' : problems.length ? 'degraded' : 'ok';

  return {
    status,
    checked_at: new Date(now).toISOString(),
    last_successful_ingest_minutes_ago: cronAge,
    last_run_status: run?.status ?? null,
    open_batch_age_hours: batchAgeHours,
    latest_report_date: report?.report_date ?? null,
    problems,
  };
}

// Called at the start of each cron tick — before the tick's own work, so a
// tick that later dies (e.g. on a D1 limit) has still raised the alarm.
export async function checkAndAlert(env) {
  const db = env.DB;
  let health;
  try {
    health = await getHealth(db);
  } catch (err) {
    console.error(`[health] check failed: ${err.message}`);
    return;
  }
  if (!health.problems.length) return;

  const keys = health.problems.map((p) => `alert:${p.key}`);
  const { results } = await db
    .prepare(`SELECT key, updated_at FROM app_state WHERE key IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys)
    .all();
  const lastSent = new Map(results.map((r) => [r.key, r.updated_at]));

  const due = health.problems.filter((p) => {
    const age = ageMinutes(lastSent.get(`alert:${p.key}`), Date.now());
    return age === null || age > HEALTH_ALERT_COOLDOWN_HOURS * 60;
  });
  if (!due.length) return;

  console.warn(`[health] ${health.status}: ${due.map((p) => p.message).join(' | ')}`);
  try {
    await notifyAdmin(env, {
      title: `Apollon pipeline ${health.status.toUpperCase()}`,
      body: due.map((p) => p.message).join(' '),
      url: '/admin.html',
    });
  } catch (err) {
    console.error(`[health] alert push failed: ${err.message}`);
  }

  const stmt = db.prepare(
    "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  await db.batch(due.map((p) => stmt.bind(`alert:${p.key}`, p.message)));
}
