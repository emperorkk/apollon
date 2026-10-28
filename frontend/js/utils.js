export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

export function importanceBarHtml(score) {
  const bars = Array.from({ length: 10 }, (_, i) => `<span class="${i < score ? 'filled' : ''}"></span>`).join('');
  return `<span class="importance-bar">${bars}<span class="importance-label">${score}/10</span></span>`;
}

// All displayed times are Athens time, regardless of the viewer's own
// time zone. Accepts ISO strings and SQLite's "YYYY-MM-DD HH:MM:SS" (UTC,
// but without a zone marker, which Date would otherwise read as local).
export const SITE_TIME_ZONE = 'Europe/Athens';

export function parseUtc(value) {
  if (value instanceof Date) return value;
  const s = String(value);
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
}

export function formatAthens(value, options = {}) {
  return parseUtc(value).toLocaleString('en-GB', {
    timeZone: SITE_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...options,
  });
}

// YYYY-MM-DD of yesterday in Athens.
export function athensYesterday() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: SITE_TIME_ZONE }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
