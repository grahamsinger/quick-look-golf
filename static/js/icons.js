// Inline SVG icons (stroke = currentColor).
const ICONS = {
  refresh: '<path d="M13.4 8a5.4 5.4 0 1 1-1.7-3.9"/><path d="M13.6 3.1v3.4h-3.4"/>',
  link: '<path d="M6.6 9.4 9.4 6.6"/><path d="M7.3 4.7 8.3 3.7a2.6 2.6 0 0 1 3.7 3.7l-1 1"/><path d="M8.7 11.3l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1"/>',
  clock: '<circle cx="8" cy="8" r="5.3"/><path d="M8 5v3.2l2 1.3"/>',
  check: '<path d="M3.6 8.4 6.5 11.3 12.4 4.8"/>',
  sun: '<circle cx="8" cy="8" r="3.1"/><path d="M8 1.4v1.7M8 12.9v1.7M14.6 8h-1.7M3.1 8H1.4M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6 3.4 3.4"/>',
  moon: '<path d="M13.2 9.4A5.5 5.5 0 1 1 6.6 2.8 4.4 4.4 0 0 0 13.2 9.4z"/>',
};

export const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// small tee flag marking the hole the player started the round on
export const START_MARK = '<svg class="teeflag" viewBox="0 0 12 12" fill="none" aria-hidden="true">'
  + '<line x1="3" y1="1.6" x2="3" y2="10.4" stroke="var(--pine)" stroke-width="1.3" stroke-linecap="round"/>'
  + '<path d="M3 2 L8.6 3.6 L3 5.2 Z" fill="var(--flag)"/></svg>';
