import { VAPID_PUBLIC_KEY } from './config.js';
import { state } from './state.js';
import { apiPost, apiDelete } from './api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function initPush() {
  const btn = document.getElementById('push-toggle');
  btn.addEventListener('click', togglePush);
  refreshButtonState();
}

async function refreshButtonState() {
  const btn = document.getElementById('push-toggle');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    btn.hidden = true;
    return;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  btn.classList.toggle('active', !!sub);
  btn.textContent = sub ? 'NOTIFY: ON' : 'NOTIFY';
}

async function togglePush() {
  if (!state.token) {
    alert('Sign in to enable push notifications.');
    return;
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  const existing = await reg.pushManager.getSubscription();

  if (existing) {
    await apiDelete('/push/subscribe', { endpoint: existing.endpoint }, state.token);
    await existing.unsubscribe();
  } else {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const json = sub.toJSON();
    await apiPost('/push/subscribe', { endpoint: json.endpoint, keys: json.keys }, state.token);
  }

  await refreshButtonState();
}
