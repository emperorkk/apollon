import { GOOGLE_CLIENT_ID, ADMIN_EMAIL } from './config.js';
import { state, setSession, subscribe } from './state.js';
import { apiPost } from './api.js';

export function initAuth() {
  renderAuthArea();
  subscribe(renderAuthArea);

  if (window.google?.accounts?.id) {
    setupGsi();
  } else {
    window.addEventListener('load', setupGsi, { once: true });
  }
}

function setupGsi() {
  if (!window.google?.accounts?.id) return;
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential });
  renderAuthArea();
}

async function handleCredential(response) {
  try {
    const { token } = await apiPost('/auth/google', { id_token: response.credential });
    const payload = JSON.parse(atob(token.split('.')[1]));
    setSession(token, { email: payload.email });
  } catch (err) {
    console.error('Google sign-in failed', err);
  }
}

function renderAuthArea() {
  const area = document.getElementById('auth-area');
  const adminLink = document.getElementById('admin-link');
  const pushToggle = document.getElementById('push-toggle');

  adminLink.hidden = state.user?.email !== ADMIN_EMAIL;

  if (state.user) {
    pushToggle.hidden = false;
    area.innerHTML = `<button type="button" class="btn-ghost" id="sign-out-btn">${state.user.email.split('@')[0]} &middot; SIGN OUT</button>`;
    document.getElementById('sign-out-btn').addEventListener('click', () => setSession(null, null));
    return;
  }

  pushToggle.hidden = true;
  area.innerHTML = '<div id="gsi-button"></div>';
  if (window.google?.accounts?.id) {
    google.accounts.id.renderButton(document.getElementById('gsi-button'), {
      theme: 'filled_black',
      size: 'medium',
      text: 'signin',
    });
  }
}
