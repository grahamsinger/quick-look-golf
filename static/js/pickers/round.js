// Round picker: ‹ › stepping + a custom styled dropdown over a hidden <select>.
import { $ } from '../dom.js';
import { state, maxRound } from '../state.js';
import { loadShots } from '../api.js';

// The arrows walk the picker's own option order — R1 → … → Rmax → All
// rounds (when the view offers it) — so "All rounds" is one more › past
// the last round, not an unreachable dead end.
const roundOrder = () => [...$('round').options].map(o => o.value);

export function updateRoundNav() {
  const order = roundOrder();
  const i = order.indexOf($('round').value);
  const prev = document.querySelector('.rnav[data-step="-1"]');
  const next = document.querySelector('.rnav[data-step="1"]');
  if (prev) prev.disabled = i <= 0;
  if (next) next.disabled = i < 0 || i >= order.length - 1;
}

export function stepRound(step) {
  const order = roundOrder();
  const target = order[order.indexOf($('round').value) + step];
  if (!target) return;
  $('round').value = target;
  syncRoundBtn();
  updateRoundNav();
  loadShots();
}

// Round options reflect data availability: only rounds 1..maxRound (played so
// far), plus "All rounds" — except in the Shots view, which is per-round only.
export function updateRoundOptions() {
  const sel = $('round');
  const cur = sel.value;
  const mx = maxRound();
  const allowAll = state.view !== 'shots';
  let html = '';
  for (let r = 1; r <= mx; r++) html += `<option value="${r}">Round ${r}</option>`;
  if (allowAll) html += '<option value="all">All rounds</option>';
  sel.innerHTML = html;
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : (allowAll ? 'all' : String(mx));
  syncRoundBtn();
  updateRoundNav();
}

// --- custom round dropdown (styled menu over the hidden <select>) ----------
const roundLabel = (v) => { const o = [...$('round').options].find(x => x.value === v); return o ? o.textContent : v; };

export function syncRoundBtn() { $('roundBtnLabel').textContent = roundLabel($('round').value); }

function renderRoundMenu() {
  const sel = $('round').value;
  $('roundMenu').innerHTML = [...$('round').options].map(o =>
    `<li role="option" data-val="${o.value}" class="${o.value === sel ? 'sel' : ''}" aria-selected="${o.value === sel}">${o.textContent}</li>`).join('');
}
function closeRoundMenu() { $('roundMenu').hidden = true; $('roundBtn').setAttribute('aria-expanded', 'false'); roundActive = -1; }
function openRoundMenu() {
  renderRoundMenu(); $('roundMenu').hidden = false; $('roundBtn').setAttribute('aria-expanded', 'true');
  roundActive = -1;
  const idx = [...$('round').options].findIndex(o => o.value === $('round').value);
  if (idx >= 0) setActiveRound(idx);
}
let roundActive = -1;
function setActiveRound(i) {
  const items = [...$('roundMenu').querySelectorAll('li[role=option]')];
  if (!items.length) return;
  roundActive = Math.max(0, Math.min(i, items.length - 1));
  items.forEach((el, idx) => el.classList.toggle('active', idx === roundActive));
  items[roundActive].scrollIntoView({ block: 'nearest' });
}
function selectRound(v) {
  closeRoundMenu();
  if (v === $('round').value) return;
  $('round').value = v;
  syncRoundBtn();
  updateRoundNav();
  loadShots();
}

export function setupRoundCombo() {
  $('roundBtn').addEventListener('click', () => { $('roundMenu').hidden ? openRoundMenu() : closeRoundMenu(); });
  $('roundMenu').addEventListener('click', (e) => { const li = e.target.closest('li[role=option]'); if (li) selectRound(li.dataset.val); });
  $('roundMenu').addEventListener('mousemove', (e) => {
    const li = e.target.closest('li[role=option]');
    if (li) setActiveRound([...$('roundMenu').querySelectorAll('li[role=option]')].indexOf(li));
  });
  $('roundBtn').addEventListener('keydown', (e) => {
    const open = !$('roundMenu').hidden;
    if (e.key === 'Escape') { closeRoundMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openRoundMenu();
      else setActiveRound(roundActive + (e.key === 'ArrowDown' ? 1 : -1));
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();  // keep the button's click-toggle from also firing
      const li = $('roundMenu').querySelectorAll('li[role=option]')[roundActive];
      if (li) selectRound(li.dataset.val);
    }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.round-combo')) closeRoundMenu(); });
}
