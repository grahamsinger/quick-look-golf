// Round picker: a segmented control (R1…R4 · All) rendered from the hidden
// <select id="round">, which stays the single source of truth for the rest
// of the app. Buttons are rebuilt whenever the option list changes (per-view
// and per-player availability), so a missed cut simply shows fewer segments.
import { $ } from '../dom.js';
import { state, maxRound } from '../state.js';
import { loadShots, syncUrl } from '../api.js';
import { renderView } from '../views/render.js';

// Rounds the *selected player* actually has data for — their leaderboard
// strokes list ("-" until played), plus their in-progress round (mid-round
// the strokes cell is still "-" but shot data exists). A missed cut means
// fewer rounds than the tournament, and the seg must not offer a round the
// player never played.
function playerMaxRound(mx) {
  const p = (state.players || []).find(x => x.id === $('player').value);
  if (!p || !Array.isArray(p.rounds)) return mx;
  let last = 0;
  p.rounds.forEach((v, i) => { if (v && v !== '-') last = i + 1; });
  if (p.thru && p.thru !== '-' && p.currentRound) last = Math.max(last, p.currentRound);
  return Math.min(mx, Math.max(1, last));
}

// Round options reflect data availability: only rounds the selected player
// has played, plus "All rounds" — except in the per-round views: Shots,
// Field, and the Course overview (the Course *hole zoom* does offer All
// rounds — trails from every round overlay on one hole).
export function updateRoundOptions() {
  const sel = $('round');
  const cur = sel.value;
  const mx = state.view === 'field' ? maxRound() : playerMaxRound(maxRound());
  const allowAll = state.view !== 'shots' && state.view !== 'field'
    && !(state.view === 'course' && !state.courseHole);
  let html = '';
  for (let r = 1; r <= mx; r++) html += `<option value="${r}">Round ${r}</option>`;
  if (allowAll) html += '<option value="all">All rounds</option>';
  sel.innerHTML = html;
  // keep the selection when still valid; a numeric round past the player's
  // last one clamps down to it (not to "all"), anything else falls back
  sel.value = [...sel.options].some(o => o.value === cur) ? cur
    : /^\d+$/.test(cur) ? String(mx)
    : (allowAll ? 'all' : String(mx));
  renderRoundSeg();
}

function renderRoundSeg() {
  const seg = $('roundSeg');
  if (!seg) return;
  const sel = $('round');
  seg.querySelectorAll('.segbtn').forEach(b => b.remove());
  [...sel.options].forEach(o => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'segbtn' + (o.value === sel.value ? ' active' : '');
    b.dataset.rval = o.value;
    b.textContent = o.value === 'all' ? 'All' : `R${o.value}`;
    b.title = o.textContent;
    seg.appendChild(b);
  });
}

// kept under their historical names — several callers re-sync the control
// after changing the hidden <select> directly
export function syncRoundBtn() { renderRoundSeg(); }
export function updateRoundNav() { renderRoundSeg(); }

function selectRound(v) {
  if (v === $('round').value) return;
  $('round').value = v;
  renderRoundSeg();
  // Field: the grid renders from its own cache — repaint it immediately and
  // fetch the selected player's round in the background. Going through a
  // foreground loadShots blanked the grid while it fetched per-player data
  // the view doesn't even show (a visible flicker on every round flip).
  if (state.view === 'field') {
    renderView();
    syncUrl();
    loadShots({ background: true });
    return;
  }
  loadShots();
}

export function setupRoundCombo() {
  $('roundSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.segbtn[data-rval]');
    if (b) selectRound(b.dataset.rval);
  });
  renderRoundSeg();
}
