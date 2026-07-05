import { apiGet } from './api.js';
import { openArticleCard } from './card.js';

let cy;

export async function openGraph(articleId) {
  const modal = document.getElementById('graph-modal');
  const scrim = document.getElementById('scrim');

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  scrim.classList.add('visible');

  await renderGraph(articleId);
}

export function closeGraph() {
  const modal = document.getElementById('graph-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');

  if (!document.getElementById('article-card').classList.contains('open')) {
    document.getElementById('scrim').classList.remove('visible');
  }
}

// Importance 1-10 -> node radius 20px-60px (spec §7.4)
function importanceToDiameter(importance) {
  const clamped = Math.min(Math.max(importance, 1), 10);
  return (20 + ((clamped - 1) / 9) * 40) * 2;
}

async function renderGraph(rootId) {
  let data;
  try {
    data = await apiGet(`/articles/${rootId}/graph`);
  } catch (err) {
    console.error('Failed to load relation graph', err);
    return;
  }

  const elements = [
    ...data.nodes.map((n) => ({
      data: {
        id: n.id,
        label: n.title ?? '',
        size: importanceToDiameter(n.importance),
        color: n.color,
      },
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
        selector: `node[id = "${rootId}"]`,
        style: {
          'border-width': 3,
          'border-color': '#4fd8e8',
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
    ],
    layout: { name: 'cose', animate: false },
  });

  cy.on('tap', 'node', (evt) => openArticleCard(evt.target.id()));
  cy.on('dbltap', 'node', (evt) => renderGraph(evt.target.id()));
}
