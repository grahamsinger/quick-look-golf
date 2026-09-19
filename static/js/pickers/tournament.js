// Tournament picker: a button + dropdown panel with its own search box
// (same pattern as the player picker — the trigger itself isn't typable).
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
function syncTournBtn() { $('tournBtnLabel').textContent = currentTournLabel() || 'pick a season'; }

function renderTournList(filter) {
  const q = (filter || '').trim().toLowerCase();
  tournFiltered = state.tournaments.filter(t => !q || tournLabel(t).toLowerCase().includes(q));
  const selId = $('tourn').value;
  $('tournList').innerHTML = tournFiltered.length
    ? tournFiltered.map(t => {
        const live = t.tournamentStatus === 'IN_PROGRESS';
        const cls = [t.id === selId ? 'sel' : '', live ? 'live' : ''].filter(Boolean).join(' ');
        const badge = live ? '<span class="live-badge">LIVE</span>' : '';
        return `<li role="option" data-id="${t.id}" class="${cls}"><span class="tlabel">${esc(tournLabel(t))}</span>${badge}</li>`;
      }).join('')
    : '<li class="combo-empty">No matches</li>';
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
function openTournPanel() {
  $('tournFilter').value = '';
  renderTournList('');
  $('tournPanel').hidden = false;
  $('tournBtn').setAttribute('aria-expanded', 'true');
  highlightSelectedTourn();
  $('tournFilter').focus();
}
function closeTournPanel() {
  $('tournPanel').hidden = true;
  $('tournBtn').setAttribute('aria-expanded', 'false');
  tournActive = -1;
}
export function selectTourn(id, opts = {}) {
  const t = state.tournaments.find(x => x.id === id);
  if (!t) return;
  // switching to a different course — leave the hole zoom (but not at boot,
  // when the select is still empty and a deep link may have set the hole)
  if ($('tourn').value && $('tourn').value !== id) state.courseHole = null;
  $('tourn').value = id;
  syncTournBtn();
  closeTournPanel();
  if (opts.load !== false) loadPlayers();
}
export function setupTournCombo() {
  $('tournBtn').addEventListener('click', () => { $('tournPanel').hidden ? openTournPanel() : closeTournPanel(); });
  const fin = $('tournFilter');
  fin.addEventListener('input', () => { renderTournList(fin.value); if (tournFiltered.length) setActiveTourn(0); });
  fin.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveTourn(tournActive + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveTourn(tournActive - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const t = tournFiltered[tournActive] || tournFiltered[0]; if (t) selectTourn(t.id); }
    else if (e.key === 'Escape') { closeTournPanel(); $('tournBtn').focus(); }
  });
  $('tournList').addEventListener('click', (e) => {
    const li = e.target.closest('li[role=option]');
    if (li) selectTourn(li.dataset.id);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.field.combo')) closeTournPanel(); });
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
