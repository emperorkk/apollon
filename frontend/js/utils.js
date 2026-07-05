export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

export function importanceBarHtml(score) {
  const bars = Array.from({ length: 10 }, (_, i) => `<span class="${i < score ? 'filled' : ''}"></span>`).join('');
  return `<span class="importance-bar">${bars}<span class="importance-label">${score}/10</span></span>`;
}
