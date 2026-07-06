import { apiGet } from './api.js';
import { openArticleCard, closeArticleCard } from './card.js';
import { state, notify } from './state.js';

let cy;
let currentArticleIds = [];
let currentLabel = '';
let listBtnWired = false;

// Graph and article card are mutually exclusive full-panel views — the
// graph modal's near-opaque backdrop was rendering on top of a still-open
// card (both are "open" simultaneously by z-index alone), turning into an
// unreadable dimmed mess. Closing whichever one isn't currently in focus
// keeps exactly one visible at a time.
function openModal() {
  closeArticleCard();
  const modal = document.getElementById('graph-modal');
  const scrim = document.getElementById('scrim');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  scrim.classList.add('visible');
  wireListButton();
}

async function openArticleFromGraph(articleId) {
  await openArticleCard(articleId);
  closeGraph();
}

function wireListButton() {
  if (listBtnWired) return;
  listBtnWired = true;
  document.getElementById('graph-view-list').addEventListener('click', () => {
    if (!currentArticleIds.length) return;
    state.articleIds = currentArticleIds;
    state.articleIdsLabel = currentLabel;
    notify();
    closeGraph();
    document.querySelector('.feed-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function setGraphResult(articleIds, label) {
  currentArticleIds = articleIds;
  currentLabel = label;
  document.getElementById('graph-view-list').hidden = articleIds.length === 0;
}

export async function openGraph(articleId) {
  openModal();
  await renderRelationGraph(articleId);
}

export async function openKeywordGraph(keyword) {
  openModal();
  await renderKeywordGraph(keyword);
}

export function closeGraph() {
  const modal = document.getElementById('graph-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');

  if (!document.getElementById('article-card').classList.contains('open')) {
    document.getElementById('scrim').classList.remove('visible');
  }
}

// Importance 1-10 -> node diameter 40px-120px (spec §7.4's 20-60px radius)
function importanceToDiameter(importance) {
  const clamped = Math.min(Math.max(importance, 1), 10);
  return (20 + ((clamped - 1) / 9) * 40) * 2;
}

function baseCytoscapeStyle() {
  return [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)',
        width: 'data(size)',
        height: 'data(size)',
        label: 'data(label)',
        color: '#dce4eb',
        'font-size': 9,
        'font-family': 'ui-monospace, monospace',
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'text-wrap': 'ellipsis',
        'text-max-width': '120px',
        'border-width': 2,
        'border-color': 'rgba(255,255,255,0.15)',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 'mapData(similarity, 0.85, 1, 1, 6)',
        'line-color': '#29333f',
        'target-arrow-shape': 'none',
        label: 'data(label)',
        'font-size': 8,
        color: '#8493a3',
        'text-background-color': '#0d1218',
        'text-background-opacity': 0.8,
        'curve-style': 'bezier',
      },
    },
  ];
}

// 2-hop article relation graph (embedding similarity + shared entities),
// opened via an article card's "View Graph" button.
async function renderRelationGraph(rootId) {
  let data;
  try {
    data = await apiGet(`/articles/${rootId}/graph`);
  } catch (err) {
    console.error('Failed to load relation graph', err);
    return;
  }

  setGraphResult(
    data.nodes.map((n) => n.id),
    'Relation graph'
  );

  const elements = [
    ...data.nodes.map((n) => ({
      data: { id: n.id, label: n.title ?? '', size: importanceToDiameter(n.importance), color: n.color },
    })),
    ...data.edges.map((e) => ({
      data: {
        id: `${e.source}__${e.target}`,
        source: e.source,
        target: e.target,
        similarity: e.similarity,
        label: e.label ?? '',
      },
    })),
  ];

  if (cy) cy.destroy();

  cy = cytoscape({
    container: document.getElementById('graph-container'),
    elements,
    style: [
      ...baseCytoscapeStyle(),
      {
        selector: `node[id = "${rootId}"]`,
        style: { 'border-width': 3, 'border-color': '#4fd8e8' },
      },
    ],
    layout: { name: 'cose', animate: false },
  });

  cy.on('tap', 'node', (evt) => openArticleFromGraph(evt.target.id()));
  cy.on('dbltap', 'node', (evt) => renderRelationGraph(evt.target.id()));
}

// Star graph for a keyword (named person/org entity): the keyword at the
// centre, every matching article (last 5 days) as a leaf node — opened from
// the keyword side panel.
async function renderKeywordGraph(keyword) {
  let data;
  try {
    data = await apiGet(`/keywords/${encodeURIComponent(keyword)}/graph`);
  } catch (err) {
    console.error('Failed to load keyword graph', err);
    return;
  }

  setGraphResult(
    data.articles.map((a) => a.id),
    keyword
  );

  const hubId = `__keyword__${keyword}`;
  const elements = [
    { data: { id: hubId, label: keyword, size: 56, color: '#4fd8e8' } },
    ...data.articles.map((a) => ({
      data: { id: a.id, label: a.title ?? '', size: importanceToDiameter(a.importance), color: a.color },
    })),
    ...data.articles.map((a) => ({
      data: { id: `${hubId}__${a.id}`, source: hubId, target: a.id, similarity: 1 },
    })),
  ];

  if (cy) cy.destroy();

  cy = cytoscape({
    container: document.getElementById('graph-container'),
    elements,
    style: [
      ...baseCytoscapeStyle(),
      {
        selector: `node[id = "${hubId}"]`,
        style: {
          shape: 'diamond',
          'background-color': '#4fd8e8',
          'border-width': 3,
          'border-color': '#8fecf7',
          'font-size': 11,
          'font-weight': 600,
        },
      },
    ],
    layout: { name: 'cose', animate: false },
  });

  cy.on('tap', 'node', (evt) => {
    if (evt.target.id() !== hubId) openArticleFromGraph(evt.target.id());
  });
}
