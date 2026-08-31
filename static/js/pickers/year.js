// Season picker: a styled dropdown over a hidden <select>, same pattern as
// the round combo. The PGA schedule API has data back to 2012; the list is
// generated from the current year, so the new season appears on its own.
import { $ } from '../dom.js';
import { loadTournaments } from './tournament.js';

const FIRST_SEASON = 2012;
let yearActive = -1;

export function syncYearBtn() { $('yearBtnLabel').textContent = $('year').value; }

function renderYearMenu() {
  const sel = $('year').value;
  $('yearMenu').innerHTML = [...$('year').options].map(o =>
    `<li role="option" data-val="${o.value}" class="${o.value === sel ? 'sel' : ''}" aria-selected="${o.value === sel}">${o.textContent}</li>`).join('');
}
function closeYearMenu() { $('yearMenu').hidden = true; $('yearBtn').setAttribute('aria-expanded', 'false'); yearActive = -1; }
function openYearMenu() {
  renderYearMenu(); $('yearMenu').hidden = false; $('yearBtn').setAttribute('aria-expanded', 'true');
  yearActive = -1;
  const idx = [...$('year').options].findIndex(o => o.value === $('year').value);
  if (idx >= 0) setActiveYear(idx);
}
function setActiveYear(i) {
  const items = [...$('yearMenu').querySelectorAll('li[role=option]')];
  if (!items.length) return;
  yearActive = Math.max(0, Math.min(i, items.length - 1));
  items.forEach((el, idx) => el.classList.toggle('active', idx === yearActive));
  items[yearActive].scrollIntoView({ block: 'nearest' });
}
function selectYear(v) {
  closeYearMenu();
  if (v === $('year').value) return;
  $('year').value = v;
  syncYearBtn();
  loadTournaments();  // picks that season's default event + loads its field
}

export function setupYearCombo() {
  const sel = $('year');
  const now = new Date().getFullYear();
  let html = '';
  for (let y = now; y >= FIRST_SEASON; y--) html += `<option value="${y}">${y}</option>`;
  sel.innerHTML = html;
  sel.value = String(now);
  syncYearBtn();
  $('yearBtn').addEventListener('click', () => { $('yearMenu').hidden ? openYearMenu() : closeYearMenu(); });
  $('yearMenu').addEventListener('click', (e) => { const li = e.target.closest('li[role=option]'); if (li) selectYear(li.dataset.val); });
  $('yearMenu').addEventListener('mousemove', (e) => {
    const li = e.target.closest('li[role=option]');
    if (li) setActiveYear([...$('yearMenu').querySelectorAll('li[role=option]')].indexOf(li));
  });
  $('yearBtn').addEventListener('keydown', (e) => {
    const open = !$('yearMenu').hidden;
    if (e.key === 'Escape') { closeYearMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openYearMenu();
      else setActiveYear(yearActive + (e.key === 'ArrowDown' ? 1 : -1));
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();  // keep the button's click-toggle from also firing
      const li = $('yearMenu').querySelectorAll('li[role=option]')[yearActive];
      if (li) selectYear(li.dataset.val);
    }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.year-combo')) closeYearMenu(); });
}
