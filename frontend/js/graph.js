import { apiGet } from './api.js';
import { openArticleCard, closeArticleCard } from './card.js';
import { state, notify } from './state.js';

let cy; // Cytoscape instance — 2D relation graph
let graph3D; // ForceGraph3D instance — 3D keyword network (created once, reused)
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

// The relation graph (2D/Cytoscape) and keyword network (3D) use separate
// containers stacked in the same modal, since two different rendering
// libraries can't safely share one DOM node — only one is shown at a time.
function showContainer(which) {
  document.getElementById('graph-container').classList.toggle('hidden', which !== '2d');
  document.getElementById('graph-container-3d').classList.toggle('hidden', which !== '3d');
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
  showContainer('2d');
  await renderRelationGraph(articleId);
}

export async function openKeywordGraph(keyword) {
  openModal();
  showContainer('3d');
  await renderKeywordNetwork(keyword);
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

// ---------------------------------------------------------------------------
// 2D relation graph (Cytoscape) — 2-hop article network (embedding
// similarity + shared entities), opened via an article card's "View Graph".
// ---------------------------------------------------------------------------

// Edge labels (shared topic/keyword) are deliberately NOT rendered directly
// on the graph — with many edges that turns into permanent visual noise.
// They're kept in edge data and surfaced via a lightweight hover tooltip
// instead (wireEdgeTooltips), so the graph stays clean by default but the
// "why are these connected" info is still one hover away.
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
        'text-wrap': 'wrap',
        'text-max-width': '150px',
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
        'curve-style': 'bezier',
      },
    },
  ];
}

function ensureTooltip() {
  const container = document.getElementById('graph-container');
  let tooltip = container.querySelector('.graph-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip hidden';
    container.appendChild(tooltip);
  }
  return tooltip;
}

// Shows an edge's shared-topic/keyword label on hover instead of always on.
function wireEdgeTooltips(cyInstance) {
  const tooltip = ensureTooltip();

  cyInstance.on('mouseover', 'edge', (evt) => {
    const label = evt.target.data('label');
    if (!label) return;
    tooltip.textContent = label;
    tooltip.classList.remove('hidden');
  });

  cyInstance.on('mouseout', 'edge', () => tooltip.classList.add('hidden'));

  cyInstance.on('mousemove', (evt) => {
    if (tooltip.classList.contains('hidden')) return;
    const pos = evt.renderedPosition ?? evt.position;
    tooltip.style.left = `${pos.x + 14}px`;
    tooltip.style.top = `${pos.y + 10}px`;
  });
}

// breadthfirst rooted at the selected article naturally arranges hop-1/
// hop-2 nodes in clear rings by distance from root, instead of cose's
// unstructured force-settle.
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
    layout: {
      name: 'breadthfirst',
      roots: [rootId],
      directed: false,
      spacingFactor: 1.5,
      avoidOverlap: true,
      animate: false,
    },
  });

  wireEdgeTooltips(cy);
  cy.on('tap', 'node', (evt) => openArticleFromGraph(evt.target.id()));
  cy.on('dbltap', 'node', (evt) => renderRelationGraph(evt.target.id()));
}

// ---------------------------------------------------------------------------
// 3D keyword network (3d-force-graph / Three.js) — 2-hop bipartite mesh:
// keyword -> articles mentioning it -> other people/orgs those articles
// mention -> other articles mentioning those. Opened from the keyword side
// panel.
// ---------------------------------------------------------------------------

function getGraph3D() {
  if (graph3D) return graph3D;

  graph3D = ForceGraph3D()(document.getElementById('graph-container-3d'))
    .backgroundColor('#04070a')
    .nodeLabel((node) => node.label)
    .nodeVal((node) => (node.type === 'keyword' ? (node.root ? 14 : 7) : Math.max(3, node.importance ?? 3)))
    .nodeColor((node) => {
      if (node.type === 'keyword') return node.root ? '#4fd8e8' : '#f2c14e';
      return node.color ?? '#8892a0';
    })
    .linkColor(() => 'rgba(220, 228, 235, 0.25)')
    .linkWidth(0.6)
    .onNodeClick((node) => {
      if (node.type === 'article') {
        openArticleFromGraph(node.id);
      } else {
        renderKeywordNetwork(node.label);
      }
    });

  return graph3D;
}

async function renderKeywordNetwork(keyword) {
  let data;
  try {
    data = await apiGet(`/keywords/${encodeURIComponent(keyword)}/graph`);
  } catch (err) {
    console.error('Failed to load keyword network', err);
    return;
  }

  setGraphResult(
    data.nodes.filter((n) => n.type === 'article').map((n) => n.id),
    keyword
  );

  const graph = getGraph3D();
  graph.graphData({
    nodes: data.nodes,
    links: data.edges.map((e) => ({ source: e.source, target: e.target })),
  });
}
