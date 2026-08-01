// Freshness bar: lives in the top-right (viewbar) slot, shared by all views.
import { $ } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { fmtWhen } from '../format.js';

function asOfBar(ts) {
  if (!ts) return '';
  let load = '';
  if (state.loadMs != null) {
    const src = state.loadCached ? 'cached' : 'live';
    const tip = state.loadCached ? 'served from cache (Redis / in-memory)' : 'fetched live from the PGA API';
    load = `<span class="sep"></span><span class="loadms" title="${tip}">loaded in ${state.loadMs} ms · ${src}</span>`;
  }
  return `<div class="asof">${icon('clock', 'clock')} data current as of <b>${fmtWhen(ts)}</b>${load}
    <button class="ibtn refresh-btn" type="button" title="Re-fetch from source">${icon('refresh')} refresh</button>
    <button class="ibtn copylink-btn" type="button" title="Copy a shareable link">${icon('link')} copy link</button></div>`;
}

// pick the capture timestamp for whatever's currently shown
function freshTs() {
  if (state.puttsAll) {
    const ts = Object.values(state.puttsAllTs || {}).filter(Boolean);
    return ts.length ? Math.min(...ts) : null;
  }
  return (state.view === 'shots' || state.view === 'course') ? state.shotsTs : state.puttsTs;
}

export function updateFreshBar() {
  const ts = freshTs();
  const el = $('status');
  el.className = '';
  el.innerHTML = ts ? asOfBar(ts) : '';
}
