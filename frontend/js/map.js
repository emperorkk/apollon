import { state, subscribe } from './state.js';
import { apiGet } from './api.js';
import { openArticleCard } from './card.js';
import { escapeHtml } from './utils.js';

const AUTO_REFRESH_MS = 30 * 60 * 1000;

let map;
let clusterGroup;

export function initMap(containerId) {
  map = L.map(containerId, { worldCopyJump: true, minZoom: 2 }).setView([20, 10], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  clusterGroup = L.markerClusterGroup();
  map.addLayer(clusterGroup);

  loadMarkers();
  subscribe(() => loadMarkers());
  setInterval(loadMarkers, AUTO_REFRESH_MS);
}

// Markers that share (near-)identical coordinates — e.g. two different
// articles both geocoding to "Tehran" — render perfectly stacked, and the
// larger/brighter/pulsing subject marker fully hides a smaller secondary
// one sitting right underneath it. Nudge coincident markers apart in a
// small circle so every one of them stays visible and clickable. A fixed
// degree offset (rather than a pixel-projected one) is intentional: it
// naturally spreads wider in on-screen pixels as you zoom in and shrinks
// back down as you zoom out, matching what you'd want.
const JITTER_DEGREES = 0.08;

function jitterOverlapping(markers) {
  const groups = new Map();
  for (const m of markers) {
    const key = `${m.lat.toFixed(3)},${m.lng.toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  const result = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    group.forEach((m, i) => {
      const angle = (2 * Math.PI * i) / group.length;
      result.push({
        ...m,
        lat: m.lat + JITTER_DEGREES * Math.sin(angle),
        lng: m.lng + JITTER_DEGREES * Math.cos(angle),
      });
    });
  }
  return result;
}

function buildIcon(marker) {
  const size = marker.is_subject ? 22 : 11;
  const cls = `wid-marker ${marker.is_subject ? 'subject' : 'secondary'}`;
  return L.divIcon({
    className: '',
    html: `<div class="${cls}" style="--marker-color:${marker.color}; width:${size}px; height:${size}px;"></div>`,
    iconSize: [size, size],
  });
}

async function loadMarkers() {
  if (!map) return;

  let data;
  try {
    data = await apiGet('/map', { days: state.days, topic: state.activeTopic });
  } catch (err) {
    console.error('Failed to load map markers', err);
    return;
  }

  clusterGroup.clearLayers();

  for (const marker of jitterOverlapping(data.markers)) {
    const leafletMarker = L.marker([marker.lat, marker.lng], { icon: buildIcon(marker) });
    leafletMarker.bindPopup(
      `<div class="wid-popup-title" data-article="${marker.article_id}">${escapeHtml(marker.title ?? '')}</div>
       <div class="wid-popup-meta">${escapeHtml(marker.place_name)} &middot; IMPORTANCE ${marker.importance}</div>
       <a class="wid-popup-source" href="${marker.url}" target="_blank" rel="noopener noreferrer">Original source &rarr;</a>`
    );
    leafletMarker.on('popupopen', (e) => {
      const el = e.popup.getElement().querySelector('.wid-popup-title');
      el?.addEventListener('click', () => openArticleCard(marker.article_id));
    });
    clusterGroup.addLayer(leafletMarker);
  }
}
