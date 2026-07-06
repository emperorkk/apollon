import { state, subscribe, notify } from './state.js';
import { apiGet } from './api.js';
import { openArticleCard } from './card.js';
import { escapeHtml, importanceBarHtml } from './utils.js';

let container;
let sentinel;
let countEl;
let clearFilterBtn;
let page = 1;
let loading = false;
let exhausted = false;

export function initFeed(containerId) {
  container = document.getElementById(containerId);
  sentinel = document.getElementById('feed-sentinel');
  countEl = document.getElementById('feed-count');
  clearFilterBtn = document.getElementById('clear-article-filter');

  // The sentinel must live inside the scrolling container, and the
  // observer's root must be that container (not the default viewport) —
  // .feed-list scrolls internally while the page itself doesn't, so a
  // viewport-rooted observer never sees it move and "load more" never
  // re-fires past the first page.
  container.appendChild(sentinel);

  clearFilterBtn.addEventListener('click', () => {
    state.articleIds = null;
    state.articleIdsLabel = '';
    notify();
  });

  resetAndLoad();
  subscribe(() => resetAndLoad());

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) loadMore();
    },
    { root: container, rootMargin: '200px' }
  );
  observer.observe(sentinel);
}

async function resetAndLoad() {
  page = 1;
  exhausted = false;
  clearFilterBtn.hidden = !state.articleIds;
  container.querySelectorAll('.feed-card').forEach((el) => el.remove());
  await loadMore();
}

async function loadMore() {
  if (loading || exhausted) return;
  loading = true;

  try {
    const data = state.articleIds
      ? await apiGet('/articles', { ids: state.articleIds.join(',') })
      : await apiGet('/articles', {
          topic: state.activeTopic,
          region: state.region,
          q: state.query,
          page,
          limit: 20,
        });

    if (state.articleIds) exhausted = true; // full result set arrives in one go, no pagination

    if (!data.articles.length) {
      exhausted = true;
      if (page === 1) countEl.textContent = 'NO RESULTS';
    } else {
      for (const article of data.articles) container.insertBefore(renderCard(article), sentinel);
      page += 1;
      const count = container.querySelectorAll('.feed-card').length;
      countEl.textContent = state.articleIdsLabel
        ? `${count} ARTICLES — ${state.articleIdsLabel}`
        : `${count} ARTICLES`;
    }
  } catch (err) {
    console.error('Failed to load feed', err);
  } finally {
    loading = false;
  }
}

function renderCard(article) {
  const el = document.createElement('article');
  el.className = 'feed-card';

  const primaryColor = article.topics?.[0]?.color_hex;
  if (primaryColor) el.style.setProperty('--card-color', primaryColor);

  const summary = article.summary_en || article.synopsis_gr || '';
  const date = new Date(article.pub_date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const topicTags = (article.topics ?? [])
    .map((t) => `<span class="topic-tag" style="--tag-color:${t.color_hex}">${escapeHtml(t.name)}</span>`)
    .join('');

  el.innerHTML = `
    <div class="feed-card-meta">
      <span>${escapeHtml(article.source_id)}</span>
      <span>&middot;</span>
      <span>${date}</span>
      ${article.greece_flag ? '<span>&middot; GR</span>' : ''}
    </div>
    <div class="feed-card-title">${escapeHtml(article.title_en || article.title_orig)}</div>
    <div class="feed-card-summary">${escapeHtml(summary)}</div>
    <div class="feed-card-footer">
      <div class="pill-row">${topicTags}</div>
      ${importanceBarHtml(article.importance)}
    </div>
  `;

  el.addEventListener('click', () => openArticleCard(article.id));
  return el;
}
