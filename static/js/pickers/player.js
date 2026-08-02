// Player picker: a leaderboard panel over the hidden <select>.
// Chips flow left→right in leaderboard order, one position badge per tie
// group (who's tied reads at a glance); the cut line splits off CUT/WD.
import { $, esc, status } from '../dom.js';
import { state, playerLabel } from '../state.js';
import { api, loadShots } from '../api.js';
import { isOutPos, fmtTotal } from '../format.js';
import { updateRoundOptions } from './round.js';

let playerActive = -1;

export function syncPlayerBtn() { $('playerBtnLabel').textContent = playerLabel() || 'pick a tournament'; }

export function selectPlayer(id) {
  const sel = $('player');
  if (id && [...sel.options].some(o => o.value === id)) {
    sel.value = id;
    syncPlayerBtn();
    updateRoundOptions();  // round list is per-player (missed cut = fewer rounds)
    return true;
  }
  return false;
}

export async function loadPlayers() {
  const tid = $('tourn').value;
  if (!tid) return;
  status('Loading field…');
  const sel = $('player'); sel.innerHTML = '<option>loading…</option>';
  try {
    const data = await api(`/api/leaderboard?tournamentId=${encodeURIComponent(tid)}`);
    state.players = data.players;
    sel.innerHTML = '';
    data.players.forEach(p => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `${p.position ? p.position + '  ' : ''}${p.name}${p.total ? '  (' + p.total + ')' : ''}`;
      sel.appendChild(o);
    });
    // remember the tournament's latest round with data (drives the round
    // picker's options; First putts stays on "All rounds").
    state.currentRound = data.currentRound || null;
    updateRoundOptions();
    syncPlayerBtn();
    status(`${data.players.length} players in the field.`);
  } catch (e) { state.players = []; sel.innerHTML = '<option value="">—</option>'; syncPlayerBtn(); status('Field failed: ' + e.message, true); }
}

function renderPlayerBoard(filter) {
  const q = (filter || '').trim().toLowerCase();
  const selId = $('player').value;
  const ps = (state.players || []).filter(p => !q || p.name.toLowerCase().includes(q));
  const board = $('playerBoard');
  playerActive = -1;
  if (!ps.length) { board.innerHTML = '<div class="pempty">No matches</div>'; return; }
  // daily progress: finished → "F 61" (today's strokes), mid-round →
  // "thru 12", not out yet → the tee time, otherwise nothing
  const prog = (p) => {
    if (isOutPos(p.position)) return '';
    if (p.thru === 'F') return 'F ' + (p.todayStrokes || fmtTotal(p.today) || '');
    if (p.thru && p.thru !== '-') return `thru ${p.thru}`;
    if (p.teeTime) return new Date(p.teeTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return '';
  };
  const chip = (p) => {
    const t = p.total || '';
    const scls = t.startsWith('-') ? 'under' : (t.startsWith('+') ? 'over' : '');
    const pr = prog(p);
    return `<button type="button" class="pchip${p.id === selId ? ' sel' : ''}" data-id="${p.id}" role="option" aria-selected="${p.id === selId}">
      <span class="pname">${esc(p.name)}</span><span class="pscore ${scls}">${esc(fmtTotal(t))}</span>${pr ? `<span class="pprog">${esc(pr)}</span>` : ''}</button>`;
  };
  let html = '', cutDone = false, g = null;
  const flush = () => { if (g && g.chips.length) html += `<span class="pgpos${g.out ? ' out' : ''}">${esc(g.pos || '—')}</span><span class="pgchips${g.out ? ' out' : ''}">${g.chips.join('')}</span>`; };
  for (const p of ps) {
    const out = isOutPos(p.position);
    if (out && !cutDone) { flush(); g = null; html += '<div class="pcut">Missed cut · WD</div>'; cutDone = true; }
    if (!g || p.position !== g.pos) { flush(); g = { pos: p.position, out, chips: [] }; }
    g.chips.push(chip(p));
  }
  flush();
  board.innerHTML = html;
}

const visibleChips = () => [...$('playerBoard').querySelectorAll('.pchip')];

function setActivePlayer(i) {
  const items = visibleChips();
  if (!items.length) return;
  playerActive = Math.max(0, Math.min(i, items.length - 1));
  items.forEach((el, idx) => el.classList.toggle('active', idx === playerActive));
  items[playerActive].scrollIntoView({ block: 'nearest' });
}
function openPlayerPanel() {
  $('playerFilter').value = '';
  renderPlayerBoard('');
  $('playerPanel').hidden = false;
  $('playerBtn').setAttribute('aria-expanded', 'true');
  const sel = $('playerBoard').querySelector('.pchip.sel');
  if (sel) sel.scrollIntoView({ block: 'center' });  // sticky to the current pick
  $('playerFilter').focus();
}
function closePlayerPanel() { $('playerPanel').hidden = true; $('playerBtn').setAttribute('aria-expanded', 'false'); }
function choosePlayer(id) {
  closePlayerPanel();
  if (!id || id === $('player').value) return;
  $('player').value = id;
  syncPlayerBtn();
  updateRoundOptions();  // round list is per-player (missed cut = fewer rounds)
  loadShots();
}

export function setupPlayerCombo() {
  $('playerBtn').addEventListener('click', () => { $('playerPanel').hidden ? openPlayerPanel() : closePlayerPanel(); });
  $('playerBoard').addEventListener('click', (e) => { const c = e.target.closest('.pchip'); if (c) choosePlayer(c.dataset.id); });
  $('playerFilter').addEventListener('input', () => { renderPlayerBoard($('playerFilter').value); if (visibleChips().length) setActivePlayer(0); });
  $('playerFilter').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivePlayer(playerActive + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivePlayer(playerActive - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const items = visibleChips(); const c = items[playerActive] || items[0]; if (c) choosePlayer(c.dataset.id); }
    else if (e.key === 'Escape') { closePlayerPanel(); $('playerBtn').focus(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.field-player')) closePlayerPanel(); });
}
