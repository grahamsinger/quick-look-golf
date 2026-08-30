// Field view: the whole field's hole-by-hole running score for one round —
// the classic race chart. Each cell is the player's cumulative TOURNAMENT
// score to par through that hole; the cell's color is what they scored ON
// the hole (eagle+ / birdie / bogey / double+). Rows are ordered by where
// each player stood when the round ended.
import { $, esc } from '../dom.js';
import { state } from '../state.js';
import { api, loadShots } from '../api.js';
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

export function renderField() {
  const tid = $('tourn').value;
  const rnd = Number($('round').value);
  if (!tid || !rnd) { $('out').innerHTML = ''; return; }
  const d = getField(tid, rnd);
  if (d === null) { $('out').innerHTML = '<div class="summary"><span class="meta">Loading the field…</span></div>'; return; }
  if (!d.available) {
    $('out').innerHTML = '<div class="summary"><span class="meta">No hole-by-hole scores for this round yet.</span></div>';
    return;
  }

  const lb = state.players || [];
  const lbIdx = new Map(lb.map((p, i) => [p.id, i]));
  const lbName = new Map(lb.map(p => [p.id, p.name]));
  const selId = $('player').value;

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
    return `<tr class="frow${r.p.id === selId ? ' fsel' : ''}" data-pid="${esc(r.p.id)}">
      <td class="fpos">${posOf[i]}</td><td class="fname">${esc(name)}</td>${r.cells}
      <td class="frd">${esc(r.p.total || '')} <b class="${toParCls}">${fmtPar(r.p.diff)}</b></td></tr>`;
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
     </table></div></div>`;

  $('out').querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-pid]');
    if (tr && selectPlayer(tr.dataset.pid)) loadShots();  // re-renders + syncs URL
  });
}
