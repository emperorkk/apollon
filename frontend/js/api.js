import { setSession } from './state.js';

const BASE = '/api';

// An authenticated request rejected as 401/403 means the session token is
// stale (expired, or otherwise invalid) — the UI would otherwise keep
// showing the user as "signed in" (stale localStorage) while every
// authenticated call silently fails, which looks like the app is just
// broken. Clear the session and reload so the page re-evaluates into a
// clean signed-out state instead.
function handleAuthFailure(status, hadToken) {
  if (hadToken && (status === 401 || status === 403)) {
    setSession(null, null);
    window.location.reload();
  }
}

export async function apiGet(path, params = {}, token) {
  const url = new URL(BASE + path, location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    handleAuthFailure(res.status, !!token);
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function apiWrite(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    handleAuthFailure(res.status, !!token);
    throw new Error(`${method} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export const apiPost = (path, body, token) => apiWrite('POST', path, body, token);
export const apiPut = (path, body, token) => apiWrite('PUT', path, body, token);
export const apiDelete = (path, body, token) => apiWrite('DELETE', path, body, token);
