// Field view: the whole field's hole-by-hole running score for one round —
// the classic race chart. Each cell is the player's cumulative TOURNAMENT
// score to par through that hole; the cell's color is what they scored ON
// the hole (eagle+ / birdie / bogey / double+). Rows are ordered by current
// standing, so during live play this reads like a normal leaderboard —
// players yet to tee off sit at their position with an empty row showing
// their tee time.
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
// leaderboard total string ("-12" / "E" / "+3") -> number, unknowns sort last
const parseTot = t => t === 'E' ? 0 : Number.isFinite(Number(t)) && t !== '' ? Number(t) : Infinity;
const teeTimeStr = ms => {
  if (!ms) return '';
  const d = new Date(Number(ms));
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

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

  // field members with no scores in this round yet — mid-week that's the
  // yet-to-tee-off group (cut/WD excluded); they get leaderboard-style rows
  // at their current standing, empty cells, tee time across the middle. On
  // a completed tournament everyone eligible has played and this is empty.
  const tourn = state.tournaments.find(x => x.id === tid);
  const inProgress = tourn && tourn.tournamentStatus !== 'COMPLETED';
  const started = d.available ? d.players : [];
  const inGrid = new Set(started.map(p => p.id));
  const waiting = (d.available || inProgress)
    ? lb.filter(p => !inGrid.has(p.id) && !isOutPos(p.position))
    : [];

  if (!started.length && !waiting.length) {
    $('out').innerHTML = '<div class="summary"><span class="meta">No hole-by-hole scores for this round yet.</span></div>';
    return;
  }

  // one row per player, ordered by current standing (running total for
  // players on the course, leaderboard total for those yet to start)
  const rows = started.map(p => {
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
    const toParCls = p.diff < 0 ? 'rg-good' : p.diff > 0 ? 'rg-bad' : '';
    const strokes = p.total && p.total !== '-' ? p.total : '';  // "-" until the round is done
    const rd = `${esc(strokes)} <b class="${toParCls}">${fmtPar(p.diff)}</b>`;
    return { id: p.id, cells, end: run, rd };
  }).concat(waiting.map(p => {
    const tot = p.total || '';
    const cls = tot.startsWith('-') ? 'rg-good' : tot.startsWith('+') ? 'rg-bad' : '';
    const tt = teeTimeStr(p.teeTime);
    const cells = `<td class="fcell fteecell" colspan="18">${tt ? `tees off ${esc(tt)}` : ''}</td>`;
    return { id: p.id, cells, end: parseTot(tot), rd: `<b class="${cls}">${esc(fmtTotal(tot))}</b>`, wait: true };
  }));
  rows.sort((a, b) => a.end - b.end
    || (lbIdx.get(a.id) ?? 1e9) - (lbIdx.get(b.id) ?? 1e9));
  // shared positions for ties on the current total
  let pos = '';
  const posOf = rows.map((r, i) => {
    if (i && rows[i - 1].end === r.end) return pos;
    const tied = rows.some((o, j) => j !== i && o.end === r.end);
    pos = `${tied ? 'T' : ''}${i + 1}`;
    return pos;
  });

  const parRow = d.available && !d.multiCourse && Object.keys(d.pars).length === 18
    ? `<tr class="fparrow"><td class="fpos"></td><td class="fname">Par</td>
        ${Array.from({ length: 18 }, (_, i) => `<td class="fcell">${d.pars[i + 1]}</td>`).join('')}
        <td class="frd">${Object.values(d.pars).reduce((a, b) => a + b, 0)}</td></tr>`
    : '';

  const body = rows.map((r, i) =>
    `<tr class="frow${r.wait ? ' fwait' : ''}${r.id === selId ? ' fsel' : ''}" data-pid="${esc(r.id)}">
      <td class="fpos">${posOf[i]}</td><td class="fname">${esc(lbName.get(r.id) || r.id)}</td>${r.cells}
      <td class="frd">${r.rd}</td></tr>`).join('');

  const waitHint = waiting.length ? ' · yet-to-start rows show the tee time' : '';
  $('out').innerHTML =
    `<div class="summary"><span class="who">The field</span><span class="meta">Round <b>${rnd}</b> · hole-by-hole running score</span></div>
     <div class="caphint">Each cell = cumulative <b>tournament</b> score to par through that hole · color = the score on that hole
       (<span class="fkey fc-eag">eagle+</span> <span class="fkey fc-bir">birdie</span> <span class="fkey fc-bog">bogey</span> <span class="fkey fc-dbl">double+</span>)
       · click a row to select that player${waitHint}</div>
     <div class="card fieldcard"><div class="fieldwrap"><table class="fieldgrid">
       <thead><tr><th class="fpos"></th><th class="fname">Player</th>
         ${Array.from({ length: 18 }, (_, i) => `<th>${i + 1}</th>`).join('')}
         <th class="frd">${d.available ? 'Rd' : 'Tot'}</th></tr>${parRow}</thead>
       <tbody>${body}</tbody>
     </table></div></div>`;

  $('out').querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-pid]');
    if (tr && selectPlayer(tr.dataset.pid)) loadShots();  // re-renders + syncs URL
  });
}
