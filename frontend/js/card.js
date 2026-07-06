import { apiGet, apiDelete } from './api.js';
import { openGraph } from './graph.js';
import { escapeHtml, importanceBarHtml } from './utils.js';
import { state, notify } from './state.js';
import { ADMIN_EMAIL } from './config.js';

const cardEl = () => document.getElementById('article-card');
const scrimEl = () => document.getElementById('scrim');
const bodyEl = () => document.getElementById('card-body');

export async function openArticleCard(id) {
  let article;
  try {
    article = await apiGet(`/articles/${id}`);
  } catch (err) {
    console.error('Failed to load article', err);
    return;
  }

  render(article);
  cardEl().classList.add('open');
  cardEl().setAttribute('aria-hidden', 'false');
  scrimEl().classList.add('visible');
}

export function closeArticleCard() {
  cardEl().classList.remove('open');
  cardEl().setAttribute('aria-hidden', 'true');
  if (!document.getElementById('graph-modal').classList.contains('open')) {
    scrimEl().classList.remove('visible');
  }
}

// EN/GR toggle behaviour per spec §14. Driven by which field actually has
// content, not by the declared source language — a language flag doesn't
// guarantee which of summary_en/synopsis_gr GPT actually populated, so
// checking the language instead of the data itself could show a "not
// available yet" placeholder even when a real translation exists.
function render(article) {
  const hasEn = !!article.summary_en;
  const hasGr = !!article.synopsis_gr;
  const date = new Date(article.pub_date).toLocaleString();

  const enContent = hasEn
    ? `<p class="card-text">${escapeHtml(article.summary_en)}</p>`
    : `<p class="card-text">${escapeHtml(article.title_en ?? '')}</p>
       <p class="card-placeholder">Full English summary — Phase 2.</p>`;

  const grContent = hasGr
    ? `<p class="card-text">${escapeHtml(article.synopsis_gr)}</p>`
    : `<p class="card-placeholder">Η ελληνική σύνοψη θα είναι διαθέσιμη σύντομα.</p>`;

  // Default to whichever tab has real content — a translated (non-English
  // source) article should open straight to its Greek synopsis, not to an
  // EN tab that's just a title + "coming later" placeholder.
  const defaultLang = hasGr && !hasEn ? 'gr' : 'en';

  const topicsHtml = (article.topics ?? [])
    .map((t) => `<span class="topic-tag" style="--tag-color:${t.color_hex}">${escapeHtml(t.name)}</span>`)
    .join('');

  const relatedHtml =
    (article.related ?? [])
      .map(
        (r) =>
          `<div class="related-item" data-id="${r.id}">
             <span>${escapeHtml(r.title ?? '')}</span>
             <span class="similarity-badge">${Math.round(r.similarity * 100)}%</span>
           </div>`
      )
      .join('') || '<p class="card-placeholder">No related articles yet.</p>';

  const entityGroup = (label, names) =>
    names?.length
      ? `<div><div class="card-section-label">${label}</div><div class="pill-row">${names
          .map((n) => `<span class="topic-tag">${escapeHtml(n)}</span>`)
          .join('')}</div></div>`
      : '';
  const entitiesHtml =
    entityGroup('People', article.entities?.people) + entityGroup('Organisations', article.entities?.orgs);

  const isAdmin = state.user?.email === ADMIN_EMAIL;
  const deleteBtnHtml = isAdmin
    ? '<button class="btn-ghost" id="delete-article-btn" type="button" style="border-color:var(--danger);color:var(--danger);">Delete Article</button>'
    : '';

  bodyEl().innerHTML = `
    <div class="card-meta">
      <span>${escapeHtml(article.source_id)}</span>
      <span>&middot;</span>
      <span>${date}</span>
      ${article.greece_flag ? '<span>&middot; GR FLAG</span>' : ''}
    </div>
    <div class="card-title">${escapeHtml(article.title_orig)}</div>
    <div class="pill-row">${topicsHtml}</div>
    ${importanceBarHtml(article.importance)}

    <div class="lang-toggle" id="lang-toggle">
      <button type="button" class="${defaultLang === 'en' ? 'active' : ''}" data-lang="en">EN</button>
      <button type="button" class="${defaultLang === 'gr' ? 'active' : ''}" data-lang="gr">GR</button>
    </div>
    <div id="lang-panel-en" class="${defaultLang === 'en' ? '' : 'hidden'}">${enContent}</div>
    <div id="lang-panel-gr" class="${defaultLang === 'gr' ? '' : 'hidden'}">${grContent}</div>

    <a class="card-text" href="${article.url}" target="_blank" rel="noopener noreferrer">View original source &rarr;</a>

    ${entitiesHtml}

    <div class="card-section-label">Related Articles</div>
    <div class="related-list" id="related-list">${relatedHtml}</div>

    <button class="btn-primary" id="view-graph-btn" type="button">View Graph</button>
    ${deleteBtnHtml}
  `;

  wireLangToggle();
  wireRelated();
  document.getElementById('view-graph-btn').addEventListener('click', () => openGraph(article.id));

  if (isAdmin) {
    document.getElementById('delete-article-btn').addEventListener('click', () => deleteArticle(article.id));
  }
}

async function deleteArticle(id) {
  if (!confirm('Delete this article? This cannot be undone.')) return;
  try {
    await apiDelete(`/admin/articles/${id}`, {}, state.token);
    closeArticleCard();
    notify(); // refresh feed/map so the deleted article disappears
  } catch (err) {
    console.error('Failed to delete article', err);
    alert('Failed to delete article — see console.');
  }
}

function wireLangToggle() {
  const buttons = document.querySelectorAll('#lang-toggle button');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('lang-panel-en').classList.toggle('hidden', btn.dataset.lang !== 'en');
      document.getElementById('lang-panel-gr').classList.toggle('hidden', btn.dataset.lang !== 'gr');
    });
  });
}

function wireRelated() {
  document.querySelectorAll('.related-item').forEach((el) => {
    el.addEventListener('click', () => openArticleCard(el.dataset.id));
  });
}
