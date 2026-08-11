// Tournament typeahead combobox + season schedule loading.
import { $, esc, status } from '../dom.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { loadPlayers } from './player.js';

let tournFiltered = [];
let tournActive = -1;

function tournLabel(t) {
  const d = t.startDate
    ? new Date(t.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  return d ? `${d} — ${t.name}` : t.name;
}
function currentTournLabel() {
  const t = state.tournaments.find(x => x.id === $('tourn').value);
  return t ? tournLabel(t) : '';
}
function renderTournList(filter) {
  const q = (filter || '').trim().toLowerCase();
  tournFiltered = state.tournaments.filter(t => !q || tournLabel(t).toLowerCase().includes(q));
  const selId = $('tourn').value;
  const list = $('tournList');
  list.innerHTML = tournFiltered.length
    ? tournFiltered.map(t => {
        const live = t.tournamentStatus === 'IN_PROGRESS';
        const cls = [t.id === selId ? 'sel' : '', live ? 'live' : ''].filter(Boolean).join(' ');
        const badge = live ? '<span class="live-badge">LIVE</span>' : '';
        return `<li role="option" data-id="${t.id}" class="${cls}"><span class="tlabel">${esc(tournLabel(t))}</span>${badge}</li>`;
      }).join('')
    : '<li class="combo-empty">No matches</li>';
  list.hidden = false;
  $('tournInput').setAttribute('aria-expanded', 'true');
  tournActive = -1;
}
function closeTournList() {
  $('tournList').hidden = true;
  $('tournInput').setAttribute('aria-expanded', 'false');
  tournActive = -1;
}
function setActiveTourn(i, block = 'nearest') {
  const items = [...$('tournList').querySelectorAll('li[role=option]')];
  if (!items.length) return;
  tournActive = Math.max(0, Math.min(i, items.length - 1));
  items.forEach((el, idx) => el.classList.toggle('active', idx === tournActive));
  items[tournActive].scrollIntoView({ block });
}
// On open (no filter), stick to the currently-shown tournament: highlight it
// and scroll it into view rather than starting at the top of the list.
function highlightSelectedTourn() {
  const idx = tournFiltered.findIndex(t => t.id === $('tourn').value);
  if (idx >= 0) setActiveTourn(idx, 'center');
}
export function selectTourn(id, opts = {}) {
  const t = state.tournaments.find(x => x.id === id);
  if (!t) return;
  // switching to a different course — leave the hole zoom (but not at boot,
  // when the select is still empty and a deep link may have set the hole)
  if ($('tourn').value && $('tourn').value !== id) state.courseHole = null;
  $('tourn').value = id;
  $('tournInput').value = tournLabel(t);
  closeTournList();
  if (opts.load !== false) loadPlayers();
}
export function setupTournCombo() {
  const tin = $('tournInput');
  tin.addEventListener('focus', () => { tin.select(); renderTournList(''); highlightSelectedTourn(); });
  tin.addEventListener('input', () => { renderTournList(tin.value); if (tournFiltered.length) setActiveTourn(0); });
  tin.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if ($('tournList').hidden) renderTournList(tin.value); setActiveTourn(tournActive + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveTourn(tournActive - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const t = tournFiltered[tournActive]; if (t) selectTourn(t.id); }
    else if (e.key === 'Escape') { closeTournList(); tin.value = currentTournLabel(); tin.blur(); }
  });
  tin.addEventListener('blur', () => { setTimeout(() => { closeTournList(); tin.value = currentTournLabel(); }, 150); });
  $('tournList').addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[role=option]');
    if (!li) return;
    e.preventDefault();  // keep focus, beat the blur
    selectTourn(li.dataset.id);
  });
}

export async function loadTournaments(preferredId) {
  const year = $('year').value.trim() || '2026';
  status('Loading schedule…');
  try {
    const { tournaments } = await api(`/api/schedule?year=${encodeURIComponent(year)}`);
    state.tournaments = tournaments.slice().reverse();  // most recent first
    // preferred (deep link) → live event → most recent *played* — the season
    // schedule includes future NOT_STARTED events, so "most recent" alone
    // would land on an upcoming tournament with no data
    const def = (preferredId && state.tournaments.find(t => t.id === preferredId))
      || state.tournaments.find(t => t.tournamentStatus === 'IN_PROGRESS')
      || state.tournaments.find(t => t.tournamentStatus === 'COMPLETED')
      || state.tournaments[0];
    if (def) selectTourn(def.id, { load: false });
    status(`${tournaments.length} tournaments in ${year}.`);
    await loadPlayers();
  } catch (e) { status('Schedule failed: ' + e.message, true); }
}
