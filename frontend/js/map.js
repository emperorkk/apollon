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

function buildIcon(marker) {
  const size = marker.is_subject ? 18 : 11;
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

  for (const marker of data.markers) {
    const leafletMarker = L.marker([marker.lat, marker.lng], { icon: buildIcon(marker) });
    leafletMarker.bindPopup(
      `<div class="wid-popup-title" data-article="${marker.article_id}">${escapeHtml(marker.title ?? '')}</div>
       <div class="wid-popup-meta">${escapeHtml(marker.place_name)} &middot; IMPORTANCE ${marker.importance}</div>`
    );
    leafletMarker.on('popupopen', (e) => {
      const el = e.popup.getElement().querySelector('.wid-popup-title');
      el?.addEventListener('click', () => openArticleCard(marker.article_id));
    });
    clusterGroup.addLayer(leafletMarker);
  }
}
