import { apiGet } from './api.js';
import { openArticleCard, closeArticleCard } from './card.js';
import { state, notify } from './state.js';
// Loaded as an ES module import (not a classic <script> global) because
// three-spritetext's UMD build expects a global `THREE` object to already
// exist — but 3d-force-graph bundles its own internal Three.js instance
// rather than exposing one on window, so the global build throws
// "can't access property CanvasTexture, t is undefined". Importing from
// esm.sh instead resolves its own 'three' dependency correctly; this is
// the same pattern used in 3d-force-graph's own official text-nodes example.
import SpriteText from 'https://esm.sh/three-spritetext';

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
  // Every node here is a story — a single click/tap always opens it. There
  // used to also be a dbltap handler that re-centered the graph on that
  // node instead, but double-clicking to "open" something is a strong
  // instinct; that shortcut meant a habitual double-click silently swapped
  // in a re-centered graph instead of the article the user actually
  // wanted. Re-centering is already available from the article card
  // itself (its own "View Graph" button), so nothing is lost by dropping
  // the ambiguous in-graph shortcut.
  cy.on('tap', 'node', (evt) => openArticleFromGraph(evt.target.id()));
}

// ---------------------------------------------------------------------------
// 3D keyword network (3d-force-graph / Three.js) — 2-hop bipartite mesh:
// keyword -> articles mentioning it -> other people/orgs those articles
// mention -> other articles mentioning those. Opened from the keyword side
// panel.
// ---------------------------------------------------------------------------

function truncateLabel(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// nodeLabel's hover tooltip meant only one node at a time was ever
// readable — for a sparse graph (a handful of nodes) that's basically
// useless, you had to hunt around hovering each ball to see what anything
// was. A floating SpriteText above every node makes the whole graph
// readable at a glance instead. nodeThreeObjectExtend keeps the default
// sphere (still used for color/size/click target) and adds this as an
// extra object at the same node position, offset upward so it doesn't
// overlap the sphere.
function makeNodeSprite(node) {
  const isRoot = node.type === 'keyword' && node.root;
  const text = node.type === 'article' ? truncateLabel(node.label, 34) : node.label;

  const sprite = new SpriteText(text);
  sprite.color = node.type === 'keyword' ? (isRoot ? '#4fd8e8' : '#f2c14e') : '#dce4eb';
  sprite.textHeight = isRoot ? 5 : node.type === 'keyword' ? 4 : 3;
  sprite.backgroundColor = 'rgba(4, 7, 10, 0.7)';
  sprite.padding = 2;
  sprite.borderRadius = 2;
  sprite.fontFace = 'ui-monospace, monospace';

  const sphereRadius = node.type === 'keyword' ? (isRoot ? 14 : 7) : Math.max(3, node.importance ?? 3);
  sprite.position.set(0, sphereRadius + 4, 0);

  // Labels float above their node and can visually/spatially overlap a
  // *different*, nearby node in a cramped layout — without this, clicking
  // what looks like one node's sphere can actually raycast-hit a
  // neighboring node's label instead (e.g. clicking a story only to land
  // on an adjacent keyword's graph). Only the sphere itself should ever
  // be a click target.
  sprite.raycast = () => {};
  return sprite;
}

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
    .nodeThreeObjectExtend(true)
    .nodeThreeObject(makeNodeSprite)
    .linkColor(() => 'rgba(220, 228, 235, 0.25)')
    .linkWidth(0.6)
    .onNodeClick((node) => {
      if (node.type === 'article') {
        openArticleFromGraph(node.id);
      } else {
        renderKeywordNetwork(node.label);
      }
    });

  // Slightly stronger repulsion + longer link distance than the library
  // default: with permanent labels above every node now, cramped default
  // spacing meant sprites overlapped each other on anything but the
  // sparsest graphs. d3Force(name) (single arg) returns the live d3-force
  // instance to tune directly, rather than needing d3-force as a separate
  // dependency just for forceManyBody().
  graph3D.d3Force('charge').strength(-160);
  graph3D.d3Force('link').distance(70);

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

  // Camera keeps whatever position/zoom it had from the previous graph
  // (or the library default on first open) otherwise — looks arbitrary
  // for a brand new node set, especially a small one like a single
  // keyword's immediate neighborhood. Let the force layout settle
  // briefly, then frame everything.
  setTimeout(() => graph.zoomToFit(400, 60), 350);
}
