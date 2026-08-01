// Light / dark theme. The pre-paint snippet in index.html sets data-theme
// before first paint; this module owns the toggle button + persistence.
import { $ } from './dom.js';
import { icon } from './icons.js';

export function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('themeToggle');
  if (btn) {
    btn.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
    btn.title = t === 'dark' ? 'Switch to light' : 'Switch to dark';
  }
}

export function initTheme() {
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  $('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
  });
}
