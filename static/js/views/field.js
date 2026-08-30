// Field view: the whole field's hole-by-hole running score for one round —
// the classic race chart. Each cell is the player's cumulative TOURNAMENT
// score to par through that hole; the cell's color is what they scored ON
// the hole (eagle+ / birdie / bogey / double+). Rows are ordered by where
// each player stood when the round ended.
import { $, esc } from '../dom.js';
import { state } from '../state.js';
import { api, loadShots } from '../api.js';
import { isOutPos, fmtTotal } from '../format.js';
import { selectPlayer } from '../pickers/player.js';

// "tid:round" -> {res, ts, live, pending}. A finished round's payload is kept
// for the session; a live one (partial scorecards, or nothing yet) re-fetches
// once it's 30 s old — matching the server's live TTL — while still showing
// the previous snapshot during the refresh.
const fieldCache = new Map();

function getField(tid, rnd) {
  const key = `${tid}:${rnd}`;
  const e = fieldCache.get(key);
  const stale = e && e.res && e.live && !e.pending && Date.now() - e.ts > 30000;
  if (e === undefined || stale) {
    fieldCache.set(key, { ...(e || {}), pending: true });
    api(`/api/holebyhole?tournamentId=${encodeURIComponent(tid)}&round=${rnd}`)
      .then(res => {
        const live = !res.available || (res.players || []).some(p => p.scores.length < 18);
        fieldCache.set(key, { res, ts: Date.now(), live });
        if (state.view === 'field') renderField();
      })
      .catch(() => {
        fieldCache.set(key, { res: { available: false }, ts: Date.now(), live: true });
        if (state.view === 'field') renderField();
      });
  }
  const cur = fieldCache.get(key);
  return cur && cur.res ? cur.res : null;
}

const fmtPar = n => n === 0 ? 'E' : n > 0 ? `+${n}` : `−${-n}`;
const cellCls = d => d <= -2 ? ' fc-eag' : d === -1 ? ' fc-bir' : d === 1 ? ' fc-bog' : d >= 2 ? ' fc-dbl' : '';

// "Yet to tee off" section (live rounds): field members the grid can't show
// yet, with tournament score + tee time. Collapsible; open by default, and
// the choice survives the 30 s live re-renders.
let teeOpen = true;

function teeWaitHtml(waiting, selId) {
  if (!waiting.length) return '';
  const chips = waiting.map(p => {
    const tot = p.total || '';
    const cls = tot.startsWith('-') ? 'rg-good' : tot.startsWith('+') ? 'rg-bad' : '';
    const tt = p.teeTime ? new Date(p.teeTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    return `<button type="button" class="teechip${p.id === selId ? ' sel' : ''}" data-pid="${esc(p.id)}">
      <span class="tpos">${esc(p.position || '')}</span>${esc(p.name)}
      <b class="${cls}">${esc(fmtTotal(tot))}</b>${tt ? `<span class="ttime">${esc(tt)}</span>` : ''}</button>`;
  }).join('');
  return `<div class="teewait">
    <button type="button" class="teewait-hdr" aria-expanded="${teeOpen}">
      <svg class="ic twcaret" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5 8 10.5 12 6.5"/></svg>
      Yet to tee off · <b>${waiting.length}</b>
    </button>
    ${teeOpen ? `<div class="teewait-list">${chips}</div>` : ''}
  </div>`;
}

function wireTeeWait() {
  const tw = $('out').querySelector('.teewait');
  if (!tw) return;
  tw.querySelector('.teewait-hdr').addEventListener('click', () => { teeOpen = !teeOpen; renderField(); });
  tw.querySelectorAll('.teechip').forEach(b =>
    b.addEventListener('click', () => { if (selectPlayer(b.dataset.pid)) loadShots(); }));
}

export function renderField() {
  const tid = $('tourn').value;
  const rnd = Number($('round').value);
  if (!tid || !rnd) { $('out').innerHTML = ''; return; }
  const d = getField(tid, rnd);
  if (d === null) { $('out').innerHTML = '<div class="summary"><span class="meta">Loading the field…</span></div>'; return; }

  const lb = state.players || [];
  const lbIdx = new Map(lb.map((p, i) => [p.id, i]));
  const lbName = new Map(lb.map(p => [p.id, p.name]));
  const selId = $('player').value;

  // field members with no scores in this round: mid-week that's the
  // yet-to-tee-off group (cut/WD players are excluded); on a completed
  // tournament everyone eligible has played and this is empty
  const tourn = state.tournaments.find(x => x.id === tid);
  const inProgress = tourn && tourn.tournamentStatus !== 'COMPLETED';
  const inGrid = new Set(d.available ? d.players.map(p => p.id) : []);
  const waiting = (d.available || inProgress)
    ? lb.filter(p => !inGrid.has(p.id) && !isOutPos(p.position))
        .sort((a, b) => (a.teeTime || Infinity) - (b.teeTime || Infinity))
    : [];

  if (!d.available) {
    $('out').innerHTML =
      `<div class="summary"><span class="who">The field</span><span class="meta">Round <b>${rnd}</b> · hole-by-hole running score</span></div>
       <div class="summary"><span class="meta">No hole-by-hole scores for this round yet${waiting.length ? ' — tee times below' : ''}.</span></div>
       ${teeWaitHtml(waiting, selId)}`;
    wireTeeWait();
    return;
  }

  // running totals per row, ordered by standing at the end of the round
  const rows = d.players.map(p => {
    const by = new Map(p.scores.map(s => [s.h, s]));
    let run = p.start;
    let cells = '';
    for (let h = 1; h <= 18; h++) {
      const s = by.get(h);
      if (!s) { cells += '<td class="fcell"></td>'; continue; }
      const diff = s.s - s.par;
      run += diff;
      cells += `<td class="fcell${cellCls(diff)}">${fmtPar(run)}</td>`;
    }
    return { p, cells, end: run };
  });
  rows.sort((a, b) => a.end - b.end
    || (lbIdx.get(a.p.id) ?? 1e9) - (lbIdx.get(b.p.id) ?? 1e9));
  // shared positions for ties on the running total
  let pos = '';
  const posOf = rows.map((r, i) => {
    if (i && rows[i - 1].end === r.end) return pos;
    const tied = rows.some((o, j) => j !== i && o.end === r.end);
    pos = `${tied ? 'T' : ''}${i + 1}`;
    return pos;
  });

  const parRow = !d.multiCourse && Object.keys(d.pars).length === 18
    ? `<tr class="fparrow"><td class="fpos"></td><td class="fname">Par</td>
        ${Array.from({ length: 18 }, (_, i) => `<td class="fcell">${d.pars[i + 1]}</td>`).join('')}
        <td class="frd">${Object.values(d.pars).reduce((a, b) => a + b, 0)}</td></tr>`
    : '';

  const body = rows.map((r, i) => {
    const name = lbName.get(r.p.id) || r.p.id;
    const toParCls = r.p.diff < 0 ? 'rg-good' : r.p.diff > 0 ? 'rg-bad' : '';
    const strokes = r.p.total && r.p.total !== '-' ? r.p.total : '';  // "-" until the round is done
    return `<tr class="frow${r.p.id === selId ? ' fsel' : ''}" data-pid="${esc(r.p.id)}">
      <td class="fpos">${posOf[i]}</td><td class="fname">${esc(name)}</td>${r.cells}
      <td class="frd">${esc(strokes)} <b class="${toParCls}">${fmtPar(r.p.diff)}</b></td></tr>`;
  }).join('');

  $('out').innerHTML =
    `<div class="summary"><span class="who">The field</span><span class="meta">Round <b>${rnd}</b> · hole-by-hole running score</span></div>
     <div class="caphint">Each cell = cumulative <b>tournament</b> score to par through that hole · color = the score on that hole
       (<span class="fkey fc-eag">eagle+</span> <span class="fkey fc-bir">birdie</span> <span class="fkey fc-bog">bogey</span> <span class="fkey fc-dbl">double+</span>)
       · click a row to select that player</div>
     <div class="card fieldcard"><div class="fieldwrap"><table class="fieldgrid">
       <thead><tr><th class="fpos"></th><th class="fname">Player</th>
         ${Array.from({ length: 18 }, (_, i) => `<th>${i + 1}</th>`).join('')}
         <th class="frd">Rd</th></tr>${parRow}</thead>
       <tbody>${body}</tbody>
     </table></div></div>
     ${teeWaitHtml(waiting, selId)}`;

  $('out').querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-pid]');
    if (tr && selectPlayer(tr.dataset.pid)) loadShots();  // re-renders + syncs URL
  });
  wireTeeWait();
}
