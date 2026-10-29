import { GOOGLE_CLIENT_ID, ADMIN_EMAIL } from './config.js';
import { state, setSession, subscribe } from './state.js';
import { apiPost } from './api.js';

// Google's SDK requires initialize() to complete before any renderButton()
// call, but the GSI script tag is async — it can finish loading before or
// after this module runs. Tracking readiness explicitly (rather than just
// checking window.google.accounts.id exists) avoids calling renderButton()
// before initialize() has actually run.
let gsiInitialized = false;

// Google's sign-in script (~100 KB, ~70% unused) is only loaded when a
// visitor actually clicks "Sign in" — most never do, and loading it on
// every page view cost mobile visitors blocking time and bandwidth.
let gsiRequested = false;
function loadGsi() {
  if (window.google?.accounts?.id) return setupGsi();
  if (gsiRequested) return;
  gsiRequested = true;
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = () => {
    setupGsi();
    // Offer the account chooser right away so one click is enough.
    google.accounts.id.prompt();
  };
  document.head.appendChild(script);
}

export function initAuth() {
  subscribe(renderAuthArea);
  renderAuthArea();
}

function setupGsi() {
  if (!window.google?.accounts?.id || gsiInitialized) return;
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential });
  gsiInitialized = true;
  renderAuthArea();
}

async function handleCredential(response) {
  try {
    const { token } = await apiPost('/auth/google', { id_token: response.credential });
    // JWT segments are base64url; atob needs standard base64 with padding.
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
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
  if (!gsiInitialized) {
    area.innerHTML = '<button type="button" class="btn-ghost" id="sign-in-btn">SIGN IN</button>';
    document.getElementById('sign-in-btn').addEventListener('click', (e) => {
      e.currentTarget.textContent = 'LOADING…';
      loadGsi();
    });
    return;
  }
  area.innerHTML = '<div id="gsi-button"></div>';
  if (gsiInitialized) {
    google.accounts.id.renderButton(document.getElementById('gsi-button'), {
      theme: 'filled_black',
      size: 'medium',
      text: 'signin',
    });
  }
}
