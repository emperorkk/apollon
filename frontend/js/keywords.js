import { apiGet } from './api.js';
import { openKeywordGraph } from './graph.js';
import { escapeHtml } from './utils.js';

const AUTO_REFRESH_MS = 30 * 60 * 1000;
const WINDOW_DAYS = 5;

function weightClass(count, maxCount) {
  const ratio = count / maxCount;
  if (ratio > 0.66) return 'weight-high';
  if (ratio > 0.33) return 'weight-med';
  return '';
}

async function loadKeywords(containerId) {
  const container = document.getElementById(containerId);
  let data;
  try {
    data = await apiGet('/keywords', { days: WINDOW_DAYS });
  } catch (err) {
    console.error('Failed to load keywords', err);
    container.innerHTML = '<p class="card-placeholder">Failed to load.</p>';
    return;
  }

  if (!data.keywords.length) {
    container.innerHTML = '<p class="card-placeholder">No keywords yet.</p>';
    return;
  }

  const maxCount = Math.max(...data.keywords.map((k) => k.count));
  container.innerHTML = data.keywords
    .map(
      (k) =>
        `<button type="button" class="keyword-chip ${weightClass(k.count, maxCount)}" data-keyword="${escapeHtml(
          k.name
        )}">${escapeHtml(k.name)} <span class="stat-tile-label">${k.count}</span></button>`
    )
    .join('');

  container.querySelectorAll('[data-keyword]').forEach((btn) => {
    btn.addEventListener('click', () => openKeywordGraph(btn.dataset.keyword));
  });
}

export function initKeywords(containerId) {
  loadKeywords(containerId);
  setInterval(() => loadKeywords(containerId), AUTO_REFRESH_MS);
}
