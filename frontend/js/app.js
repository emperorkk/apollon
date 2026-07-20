import { state, subscribe, notify } from './state.js';
import { apiGet } from './api.js';
import { initMap } from './map.js';
import { initFeed } from './feed.js';
import { closeArticleCard } from './card.js';
import { initAuth } from './auth.js';
import { initPush } from './push.js';
import { closeGraph } from './graph.js';
import { initKeywords } from './keywords.js';
import { ADMIN_EMAIL, APP_VERSION } from './config.js';

const PRIVACY_ACK_KEY = 'apollon_privacy_ack_v1';

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

function wireLegalNotice() {
  const dialog = document.getElementById('legal-dialog');
  document.getElementById('legal-contact-email').textContent = ADMIN_EMAIL;
  document.getElementById('legal-notice-btn').addEventListener('click', () => dialog.showModal());
  document.getElementById('legal-dialog-close').addEventListener('click', () => dialog.close());
}

// First-visit notice (spec-independent, requested separately): Apollon sets
// no tracking cookies, but Cloudflare-level bot protection does log the
// requesting IP, so visitors are told that explicitly before using the
// site rather than it being buried only in the legal notice. Persisted in
// localStorage (not a cookie) so it only shows once per browser.
function wirePrivacyNotice() {
  const dialog = document.getElementById('privacy-dialog');

  document.getElementById('privacy-dialog-ack').addEventListener('click', () => {
    localStorage.setItem(PRIVACY_ACK_KEY, '1');
    dialog.close();
  });

  document.getElementById('privacy-dialog-details').addEventListener('click', () => {
    localStorage.setItem(PRIVACY_ACK_KEY, '1');
    dialog.close();
    document.getElementById('legal-dialog').showModal();
  });

  if (!localStorage.getItem(PRIVACY_ACK_KEY)) {
    dialog.showModal();
  }
}

function renderVersion() {
  document.getElementById('brand-version').textContent = APP_VERSION;
}

function wireOverlayDismiss() {
  document.getElementById('scrim').addEventListener('click', () => {
    closeArticleCard();
    closeGraph();
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
  renderVersion();
  await populateRegions();
  wireSearch();
  wireDaysSlider();
  wireOverlayDismiss();
  wireLegalNotice();
  wirePrivacyNotice();

  initMap('map');
  initFeed('feed-list');
  initAuth();
  initPush();
  initKeywords('keyword-list');

  subscribe(() => {});
}

document.addEventListener('DOMContentLoaded', bootstrap);
