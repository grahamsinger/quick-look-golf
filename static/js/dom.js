// Tiny shared DOM helpers.
export const $ = (id) => document.getElementById(id);

// escape API-sourced strings before they hit innerHTML / attributes
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const status = (msg, err = false) => { const s = $('status'); s.textContent = msg || ''; s.className = err ? 'err' : ''; };
