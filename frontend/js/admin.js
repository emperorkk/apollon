import { ADMIN_EMAIL, GOOGLE_CLIENT_ID } from './config.js';
import { state, setSession } from './state.js';
import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { escapeHtml, formatAthens, athensYesterday } from './utils.js';

const mainEl = () => document.getElementById('admin-main');

// Shown when there's no admin session — first visit, an expired token, or
// after api.js's auth-failure recovery clears a stale session and reloads.
// It used to be a dead-end "404 Not found" with no way to sign in from
// here, which read as the admin page being broken.
function renderSignIn(message) {
  document.body.innerHTML = `<div class="admin-404">
    <h1>ADMIN CONSOLE</h1>
    <p>${escapeHtml(message)}</p>
    <div id="admin-gsi"></div>
    <a class="legal-footer-link" href="/">&larr; Back to Apollon</a>
  </div>`;

  // The GSI script loads async; wait for it (up to ~10s).
  let tries = 0;
  const timer = setInterval(() => {
    if (!window.google?.accounts?.id && ++tries < 100) return;
    clearInterval(timer);
    if (!window.google?.accounts?.id) return;
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleAdminCredential });
    google.accounts.id.renderButton(document.getElementById('admin-gsi'), {
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
    });
  }, 100);
}

function decodeJwtPayload(token) {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
}

async function handleAdminCredential(response) {
  try {
    const { token } = await apiPost('/auth/google', { id_token: response.credential });
    setSession(token, { email: decodeJwtPayload(token).email });
    window.location.reload();
  } catch (err) {
    console.error('Admin sign-in failed', err);
    renderSignIn('Sign-in failed — please try again.');
  }
}

async function loadStats() {
  const stats = await apiGet('/admin/stats', {}, state.token).catch(() => null);
  if (!stats) return '<p class="card-placeholder">Failed to load stats.</p>';

  const lastRun = stats.last_cron_run;
  const lastBatch = stats.last_batch_job;
  const pending = stats.pending_articles_by_status ?? {};
  const pendingSummary =
    Object.entries(pending)
      .map(([status, n]) => `${n} ${status}`)
      .join(', ') || 'none';

  const tiles = [
    ['Articles Today', stats.articles_today],
    ['Articles This Week', stats.articles_this_week],
    ['Articles This Month', stats.articles_this_month],
    ['Est. API Cost / mo', `$${stats.estimated_api_cost_month_usd}`],
    ['Push Subscribers', stats.push_subscriber_count],
    ['Failed Geocodes (24h)', stats.failed_geocoding_count_24h],
    ['Last Cron Status', lastRun?.status ?? 'never run'],
    ['Last Cron Run', lastRun ? formatAthens(lastRun.started_at) : '—'],
    ['Pending Articles', pendingSummary],
    ['Last Batch Job', lastBatch ? `${lastBatch.status}` : 'none yet'],
  ];

  // Plain fetch: /api/health answers 503 when the pipeline is down, which
  // apiGet would turn into an exception instead of showing the problems.
  const health = await fetch('/api/health')
    .then((res) => res.json())
    .catch(() => null);
  const healthHtml = health
    ? `<div class="health-banner health-${health.status}">
        <strong>Pipeline ${escapeHtml(health.status.toUpperCase())}</strong>
        ${
          health.problems?.length
            ? `<ul>${health.problems.map((p) => `<li>${escapeHtml(p.message)}</li>`).join('')}</ul>`
            : '<span>All checks passing. Enable NOTIFY on the dashboard to get push alerts if this changes.</span>'
        }
      </div>`
    : '';

  return `${healthHtml}<div class="stat-grid">${tiles
    .map(([label, value]) => `<div class="stat-tile"><span class="stat-tile-label">${label}</span><span class="stat-tile-value">${value}</span></div>`)
    .join('')}</div>`;
}

function formatPendingError(p) {
  if (!p.error_message) return '<span class="card-placeholder">—</span>';
  return `<span title="${escapeHtml(p.error_message)}">${escapeHtml(p.error_message.slice(0, 80))}${p.error_message.length > 80 ? '…' : ''}</span>`;
}

async function loadFailedIngestions() {
  const { pending_articles: rows } = await apiGet('/admin/pending-articles', { status: 'failed' }, state.token);

  if (!rows.length) {
    return '<p class="card-placeholder">No failed ingestions.</p>';
  }

  const tableRows = rows
    .map(
      (p) => `
    <tr>
      <td><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.title_orig || p.guid)}</a></td>
      <td>${escapeHtml(p.source_name ?? p.source_id ?? '')}</td>
      <td>${formatPendingError(p)}</td>
      <td>${formatAthens(p.created_at)}</td>
      <td>
        <button type="button" class="btn-ghost" data-retry-pending="${p.id}">Retry</button>
        <button type="button" class="btn-ghost" data-discard-pending="${p.id}">Discard</button>
      </td>
    </tr>`
    )
    .join('');

  return `
    <table class="data-table">
      <thead><tr><th>Article</th><th>Source</th><th>Error</th><th>Failed At</th><th></th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
}

async function loadTopics() {
  const { topics } = await apiGet('/admin/topics', {}, state.token);
  const rows = topics
    .map(
      (t) => `
    <tr>
      <td><span class="color-swatch" style="background:${t.color_hex}"></span>${escapeHtml(t.name)}</td>
      <td>${escapeHtml(t.name_gr ?? '')}</td>
      <td>${t.trigger_level}</td>
      <td><span class="status-dot ${t.active ? 'active' : ''}"></span></td>
      <td>
        <button type="button" class="btn-ghost" data-edit-topic="${t.id}">Edit</button>
        <button type="button" class="btn-ghost" data-delete-topic="${t.id}">Delete</button>
      </td>
    </tr>`
    )
    .join('');

  return `
    <table class="data-table">
      <thead><tr><th>Name</th><th>GR Label</th><th>Trigger</th><th>Active</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function formatSourceError(s) {
  if (!s.last_error) return '<span class="card-placeholder">—</span>';
  const when = s.last_error_at ? formatAthens(s.last_error_at) : '';
  return `<span title="${escapeHtml(s.last_error)}">${escapeHtml(s.last_error.slice(0, 60))}${s.last_error.length > 60 ? '…' : ''}</span><br /><span class="stat-tile-label">${when}</span>`;
}

async function loadSources() {
  const { sources } = await apiGet('/admin/sources', {}, state.token);
  const rows = sources
    .map(
      (s) => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.region)}</td>
      <td>${escapeHtml(s.language)}</td>
      <td>${escapeHtml(s.category_bias ?? '')}</td>
      <td><span class="status-dot ${s.active ? (s.last_error ? 'error' : 'active') : ''}"></span></td>
      <td>${formatSourceError(s)}</td>
      <td>
        <button type="button" class="btn-ghost" data-edit-source="${s.id}">Edit</button>
        <button type="button" class="btn-ghost" data-toggle-source="${s.id}" data-active="${s.active}">${s.active ? 'Disable' : 'Enable'}</button>
      </td>
    </tr>`
    )
    .join('');

  return `
    <table class="data-table">
      <thead><tr><th>Name</th><th>Region</th><th>Lang</th><th>Category</th><th>Active</th><th>Last Error</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function loadReports() {
  const { reports } = await apiGet('/reports', { limit: 10 });
  const rows = reports
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.report_date)}</td>
      <td><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a></td>
      <td>${
        r.el
          ? `<a href="${escapeHtml(r.el.url)}" target="_blank" rel="noopener">ΕΛ</a>`
          : `<button type="button" class="btn-ghost" data-translate-report="${escapeHtml(r.report_date)}">Translate</button>`
      }</td>
      <td>${r.article_count}</td>
      <td>
        <button type="button" class="btn-ghost" data-regen-report="${escapeHtml(r.report_date)}">Regenerate</button>
        <button type="button" class="btn-ghost" data-delete-report="${escapeHtml(r.report_date)}">Delete</button>
      </td>
    </tr>`
    )
    .join('');

  return `
    <div class="report-generate">
      <label class="form-field" style="margin:0;"><span>Day (Athens)</span><input type="date" id="report-date" /></label>
      <button type="button" class="btn-primary" id="generate-report-btn">Generate Report</button>
      <span class="report-generate-status" id="report-generate-status"></span>
    </div>
    ${
      reports.length
        ? `<table class="data-table">
      <thead><tr><th>Day</th><th>Title</th><th>Greek</th><th>Articles</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
        : '<p class="admin-empty">No reports yet — one is generated automatically every morning (~06:23–07:23 Athens time) for the previous Athens day.</p>'
    }`;
}

async function generateReport(date, force) {
  const status = document.getElementById('report-generate-status');
  status.textContent = `Generating ${date || 'yesterday'}… (this takes ~30s)`;
  try {
    const result = await apiPost('/admin/reports/generate', { date: date || undefined, force }, state.token);
    if (result.status === 'skipped') {
      status.textContent = `Skipped ${result.date}: only ${result.articleCount} articles that day.`;
      return;
    }
    if (result.status === 'exists') {
      status.textContent = `${result.date} already has a report — use Regenerate to replace it.`;
      return;
    }
    await renderAdmin();
  } catch (err) {
    console.error('Failed to generate report', err);
    status.textContent = 'Failed — see console';
  }
}

function wireReportActions() {
  const dateInput = document.getElementById('report-date');
  const yesterday = athensYesterday();
  dateInput.value = yesterday;
  dateInput.max = yesterday;

  const generateBtn = document.getElementById('generate-report-btn');
  generateBtn.addEventListener('click', () => {
    generateBtn.disabled = true;
    generateReport(dateInput.value, false).finally(() => {
      generateBtn.disabled = false;
    });
  });

  document.querySelectorAll('[data-regen-report]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      generateReport(btn.dataset.regenReport, true).finally(() => {
        btn.disabled = false;
      });
    });
  });

  document.querySelectorAll('[data-translate-report]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Translating…';
      try {
        await apiPost(`/admin/reports/${btn.dataset.translateReport}/translate`, {}, state.token);
        renderAdmin();
      } catch (err) {
        console.error('Failed to translate report', err);
        btn.textContent = 'Failed';
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-delete-report]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete the report for ${btn.dataset.deleteReport}?`)) return;
      btn.disabled = true;
      try {
        await apiDelete(`/admin/reports/${btn.dataset.deleteReport}`, {}, state.token);
        renderAdmin();
      } catch (err) {
        console.error('Failed to delete report', err);
        btn.disabled = false;
      }
    });
  });
}

async function renderAdmin() {
  mainEl().innerHTML = `
    <section class="admin-section">
      <div class="admin-section-header">
        <span class="admin-section-title">System Stats</span>
        <button type="button" class="btn-primary" id="run-cron-btn">Run Ingestion Now</button>
      </div>
      <div id="stats-container">Loading&hellip;</div>
    </section>

    <section class="admin-section">
      <div class="admin-section-header">
        <span class="admin-section-title">Failed Ingestions</span>
        <button type="button" class="btn-primary" id="retry-all-btn">Retry All</button>
      </div>
      <div id="failed-container">Loading&hellip;</div>
    </section>

    <section class="admin-section">
      <div class="admin-section-header">
        <span class="admin-section-title">Daily Reports</span>
        <a class="btn-ghost" href="/reports" target="_blank" rel="noopener">View public page</a>
      </div>
      <div id="reports-container">Loading&hellip;</div>
    </section>

    <section class="admin-section">
      <div class="admin-section-header">
        <span class="admin-section-title">Topics</span>
        <button type="button" class="btn-primary" id="add-topic-btn">+ Add Topic</button>
      </div>
      <div id="topics-container">Loading&hellip;</div>
    </section>

    <section class="admin-section">
      <div class="admin-section-header">
        <span class="admin-section-title">Sources</span>
        <button type="button" class="btn-primary" id="add-source-btn">+ Add Source</button>
      </div>
      <div id="sources-container">Loading&hellip;</div>
    </section>
  `;

  const [statsHtml, failedHtml, reportsHtml, topicsHtml, sourcesHtml] = await Promise.all([
    loadStats(),
    loadFailedIngestions(),
    loadReports(),
    loadTopics(),
    loadSources(),
  ]);
  document.getElementById('stats-container').innerHTML = statsHtml;
  document.getElementById('failed-container').innerHTML = failedHtml;
  document.getElementById('reports-container').innerHTML = reportsHtml;
  document.getElementById('topics-container').innerHTML = topicsHtml;
  document.getElementById('sources-container').innerHTML = sourcesHtml;

  wireTopicActions();
  wireSourceActions();
  wireReportActions();
  wireCronButton();
  wireFailedIngestionActions();
}

function wireFailedIngestionActions() {
  document.getElementById('retry-all-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { retried } = await apiPost('/admin/pending-articles/retry-all', {}, state.token);
      btn.textContent = `Retried ${retried}`;
      await renderAdmin();
    } catch (err) {
      console.error('Failed to retry all', err);
      btn.disabled = false;
    }
  });

  document.querySelectorAll('[data-retry-pending]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await apiPost(`/admin/pending-articles/${btn.dataset.retryPending}/retry`, {}, state.token);
        renderAdmin();
      } catch (err) {
        console.error('Failed to retry article', err);
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-discard-pending]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Permanently discard this failed article?')) return;
      btn.disabled = true;
      try {
        await apiDelete(`/admin/pending-articles/${btn.dataset.discardPending}`, {}, state.token);
        renderAdmin();
      } catch (err) {
        console.error('Failed to discard article', err);
        btn.disabled = false;
      }
    });
  });
}

function wireCronButton() {
  const btn = document.getElementById('run-cron-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Running…';
    try {
      const result = await apiPost('/admin/cron/run', {}, state.token);
      if (result.started) {
        btn.textContent = `Done — ingested ${result.ingested}, batched ${result.submittedBatch}, finalized ${result.finalized}`;
        await renderAdmin();
        return;
      }
      btn.textContent = result.reason ?? 'Already running';
    } catch (err) {
      console.error('Failed to run cron', err);
      btn.textContent = 'Failed — see console';
    } finally {
      btn.disabled = false;
    }
  });
}

function openTopicDialog(topic) {
  const dialog = document.getElementById('topic-dialog');
  const form = document.getElementById('topic-form');
  form.reset();
  form.id.value = topic?.id ?? '';
  form.name.value = topic?.name ?? '';
  form.name_gr.value = topic?.name_gr ?? '';
  form.keywords.value = topic ? JSON.parse(topic.keywords).join(', ') : '';
  form.color_hex.value = topic?.color_hex ?? '#4fd8e8';
  form.trigger_level.value = topic?.trigger_level ?? 3;
  form.active.value = topic ? String(topic.active) : '1';
  dialog.showModal();
}

function wireTopicActions() {
  document.getElementById('add-topic-btn').addEventListener('click', () => openTopicDialog(null));

  document.querySelectorAll('[data-edit-topic]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { topics } = await apiGet('/admin/topics', {}, state.token);
      const topic = topics.find((t) => String(t.id) === btn.dataset.editTopic);
      openTopicDialog(topic);
    });
  });

  document.querySelectorAll('[data-delete-topic]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Deactivate this topic?')) return;
      await apiDelete(`/admin/topics/${btn.dataset.deleteTopic}`, {}, state.token);
      renderAdmin();
    });
  });
}

function openSourceDialog(source) {
  const dialog = document.getElementById('source-dialog');
  const form = document.getElementById('source-form');
  form.reset();
  form.id.value = source?.id ?? '';
  form.name.value = source?.name ?? '';
  form.rss_url.value = source?.rss_url ?? '';
  form.region.value = source?.region ?? '';
  form.language.value = source?.language ?? '';
  form.category_bias.value = source?.category_bias ?? '';
  form.active.value = source ? String(source.active) : '1';
  dialog.showModal();
}

function wireSourceActions() {
  document.getElementById('add-source-btn').addEventListener('click', () => openSourceDialog(null));

  document.querySelectorAll('[data-edit-source]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { sources } = await apiGet('/admin/sources', {}, state.token);
      const source = sources.find((s) => s.id === btn.dataset.editSource);
      openSourceDialog(source);
    });
  });

  document.querySelectorAll('[data-toggle-source]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isActive = btn.dataset.active === '1' || btn.dataset.active === 'true';
      await apiPut(`/admin/sources/${btn.dataset.toggleSource}`, { active: !isActive }, state.token);
      renderAdmin();
    });
  });
}

function wireDialogs() {
  const topicDialog = document.getElementById('topic-dialog');
  const topicForm = document.getElementById('topic-form');
  document.getElementById('topic-cancel').addEventListener('click', () => topicDialog.close());
  topicForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(topicForm);
    const payload = {
      name: fd.get('name'),
      name_gr: fd.get('name_gr') || null,
      keywords: fd
        .get('keywords')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      color_hex: fd.get('color_hex'),
      trigger_level: Number(fd.get('trigger_level')),
      active: fd.get('active') === '1',
    };
    const id = fd.get('id');
    if (id) {
      await apiPut(`/admin/topics/${id}`, payload, state.token);
    } else {
      await apiPost('/admin/topics', payload, state.token);
    }
    topicDialog.close();
    renderAdmin();
  });

  const sourceDialog = document.getElementById('source-dialog');
  const sourceForm = document.getElementById('source-form');
  document.getElementById('source-cancel').addEventListener('click', () => sourceDialog.close());
  sourceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(sourceForm);
    const payload = {
      name: fd.get('name'),
      rss_url: fd.get('rss_url'),
      region: fd.get('region'),
      language: fd.get('language'),
      category_bias: fd.get('category_bias') || null,
      active: fd.get('active') === '1',
    };
    const id = fd.get('id');
    if (id) {
      await apiPut(`/admin/sources/${id}`, payload, state.token);
    } else {
      await apiPost('/admin/sources', payload, state.token);
    }
    sourceDialog.close();
    renderAdmin();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!state.token || !state.user) {
    renderSignIn('Sign in with the admin Google account to continue.');
    return;
  }
  if (state.user.email !== ADMIN_EMAIL) {
    renderSignIn(`${state.user.email} doesn't have admin access. Sign in with the admin account.`);
    return;
  }

  wireDialogs();
  renderAdmin();
  document.getElementById('admin-refresh').addEventListener('click', renderAdmin);
});
