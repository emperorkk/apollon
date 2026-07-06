export const state = {
  days: 5,
  topics: [],
  activeTopic: null, // topic name or null
  region: '',
  query: '',
  articleIds: null, // when set, feed shows exactly these ids (e.g. "view graph as list")
  articleIdsLabel: '',
  token: localStorage.getItem('wid_token'),
  user: JSON.parse(localStorage.getItem('wid_user') || 'null'),
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(state);
}

export function setSession(token, user) {
  state.token = token;
  state.user = user;
  if (token) {
    localStorage.setItem('wid_token', token);
    localStorage.setItem('wid_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('wid_token');
    localStorage.removeItem('wid_user');
  }
  notify();
}
