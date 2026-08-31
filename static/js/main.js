// Entry point: global event wiring + boot (restore deep link, auto-load).
import { $ } from './dom.js';
import { state, maxRound } from './state.js';
import { initTheme } from './theme.js';
import { loadShots, copyLink, syncUrl } from './api.js';
import { setupTournCombo, loadTournaments } from './pickers/tournament.js';
import { setupYearCombo, syncYearBtn } from './pickers/year.js';
import { setupRoundCombo, stepRound, updateRoundNav, updateRoundOptions, syncRoundBtn } from './pickers/round.js';
import { setupPlayerCombo, selectPlayer } from './pickers/player.js';
import { renderView } from './views/render.js';

function setActiveView(view) {
  document.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  state.view = view;
}

document.querySelectorAll('.segbtn').forEach(btn => btn.addEventListener('click', () => {
  const view = btn.dataset.view;
  const wasAll = $('round').value === 'all';
  setActiveView(view);
  updateRoundOptions();  // Shots + Course overview drop the "All rounds" option
  // Shots, Field, and the Course overview are per-round; the Course hole zoom
  // keeps "All rounds". If "All rounds" was selected and the target view can't
  // show it, switch to the latest played round and load it.
  if ((view === 'shots' || view === 'field' || (view === 'course' && !state.courseHole)) && wasAll) {
    const scored = h => h && h.score != null && h.score !== '' && h.score !== '-';
    const latest = state.puttsAll
      ? [4, 3, 2, 1].find(r => state.puttsAll[r] && (state.puttsAll[r].holes || []).some(scored))
      : null;
    $('round').value = String(latest || maxRound());
    syncRoundBtn();
    loadShots();  // syncs URL on completion
    return;
  }
  renderView();
  syncUrl();
}));

$('go').addEventListener('click', () => loadShots());
document.querySelectorAll('.rnav').forEach(b => b.addEventListener('click', () => stepRound(Number(b.dataset.step))));
$('round').addEventListener('change', updateRoundNav);
document.addEventListener('click', (e) => {
  const copyBtn = e.target.closest('.copylink-btn');
  if (copyBtn) { copyLink(copyBtn); return; }
  if (e.target.closest('.refresh-btn')) loadShots({ force: true });
});

// Restore selection from the URL (shared link / reload), then auto-load.
async function init() {
  initTheme();
  setupYearCombo();
  setupTournCombo();
  setupRoundCombo();
  setupPlayerCombo();
  const q = new URLSearchParams(location.search);
  const wantT = q.get('t'), wantP = q.get('p'), wantR = q.get('r'), wantV = q.get('v'), wantH = q.get('h');
  if (wantV === 'shots' || wantV === 'trails') setActiveView('shots');
  else if (wantV === 'field') setActiveView('field');
  else if (wantV === 'course') {
    setActiveView('course');
    const h = Number(wantH);
    if (h >= 1 && h <= 18) state.courseHole = h;  // deep link straight into a hole zoom
  }
  if (wantT && /^R\d{7}$/.test(wantT)) { $('year').value = wantT.slice(1, 5); syncYearBtn(); }
  await loadTournaments(wantT);
  if (wantP) selectPlayer(wantP);
  if (wantR && [...$('round').options].some(o => o.value === wantR)) $('round').value = wantR;
  syncRoundBtn();
  loadShots();
}
init();
