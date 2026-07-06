import { state, subscribe, notify } from './state.js';
import { apiGet } from './api.js';
import { initMap } from './map.js';
import { initFeed } from './feed.js';
import { closeArticleCard } from './card.js';
import { initAuth } from './auth.js';
import { initPush } from './push.js';
import { closeGraph } from './graph.js';
import { initKeywords } from './keywords.js';

function renderTopicFilters() {
  const nav = document.getElementById('topic-filters');
  nav.innerHTML = '';

  for (const topic of state.topics) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'topic-pill';
    btn.textContent = topic.name;
    btn.style.setProperty('--pill-color', topic.color_hex);
    btn.classList.toggle('active', state.activeTopic === topic.name);

    btn.addEventListener('click', () => {
      state.activeTopic = state.activeTopic === topic.name ? null : topic.name;
      renderTopicFilters();
      notify();
    });

    nav.appendChild(btn);
  }
}

function renderMapLegend() {
  const legend = document.getElementById('map-legend');
  legend.innerHTML = state.topics
    .map(
      (t) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${t.color_hex}"></span>${t.name}</span>`
    )
    .join('');
}

async function populateRegions() {
  const select = document.getElementById('region-filter');
  try {
    const { regions } = await apiGet('/regions');
    for (const region of regions) {
      const opt = document.createElement('option');
      opt.value = region;
      opt.textContent = region;
      select.appendChild(opt);
    }
  } catch (err) {
    console.error('Failed to load regions', err);
  }

  select.addEventListener('change', () => {
    state.region = select.value;
    notify();
  });
}

function wireSearch() {
  const input = document.getElementById('search-input');
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.query = input.value.trim();
      notify();
    }, 400);
  });
}

function wireDaysSlider() {
  const slider = document.getElementById('days-slider');
  const label = document.getElementById('days-value');
  slider.addEventListener('input', () => {
    label.textContent = slider.value;
    state.days = parseInt(slider.value, 10);
    notify();
  });
}

function wireOverlayDismiss() {
  document.getElementById('scrim').addEventListener('click', () => {
    closeArticleCard();
  });
  document.getElementById('graph-close').addEventListener('click', () => closeGraph());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeArticleCard();
      closeGraph();
    }
  });
}

async function bootstrap() {
  try {
    const { topics } = await apiGet('/topics');
    state.topics = topics;
  } catch (err) {
    console.error('Failed to load topics', err);
    state.topics = [];
  }

  renderTopicFilters();
  renderMapLegend();
  await populateRegions();
  wireSearch();
  wireDaysSlider();
  wireOverlayDismiss();

  initMap('map');
  initFeed('feed-list');
  initAuth();
  initPush();
  initKeywords('keyword-list');

  subscribe(() => {});
}

document.addEventListener('DOMContentLoaded', bootstrap);
