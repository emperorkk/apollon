import { ADMIN_EMAIL } from './config.js';
import { state } from './state.js';
import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { escapeHtml } from './utils.js';

const mainEl = () => document.getElementById('admin-main');

function render404() {
  document.body.innerHTML =
    '<div class="admin-404"><h1>404</h1><p>Not found.</p></div>';
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
    ['Last Cron Run', lastRun ? new Date(lastRun.started_at).toLocaleString() : '—'],
    ['Pending Articles', pendingSummary],
    ['Last Batch Job', lastBatch ? `${lastBatch.status}` : 'none yet'],
  ];

  return `<div class="stat-grid">${tiles
    .map(([label, value]) => `<div class="stat-tile"><span class="stat-tile-label">${label}</span><span class="stat-tile-value">${value}</span></div>`)
    .join('')}</div>`;
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
  const when = s.last_error_at ? new Date(s.last_error_at).toLocaleString() : '';
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

  const [statsHtml, topicsHtml, sourcesHtml] = await Promise.all([loadStats(), loadTopics(), loadSources()]);
  document.getElementById('stats-container').innerHTML = statsHtml;
  document.getElementById('topics-container').innerHTML = topicsHtml;
  document.getElementById('sources-container').innerHTML = sourcesHtml;

  wireTopicActions();
  wireSourceActions();
  wireCronButton();
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
  if (state.user?.email !== ADMIN_EMAIL || !state.token) {
    render404();
    return;
  }

  wireDialogs();
  renderAdmin();
  document.getElementById('admin-refresh').addEventListener('click', renderAdmin);
});
