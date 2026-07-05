const BASE = '/api';

export async function apiGet(path, params = {}) {
  const url = new URL(BASE + path, location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res.json();
}

export const apiPost = (path, body, token) => apiWrite('POST', path, body, token);
export const apiPut = (path, body, token) => apiWrite('PUT', path, body, token);
export const apiDelete = (path, body, token) => apiWrite('DELETE', path, body, token);
