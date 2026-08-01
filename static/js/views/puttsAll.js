// First putts, all rounds: condensed Front/Back matrix + tournament stats.
import { $, esc } from '../dom.js';
import { state, playerName } from '../state.js';
import { approachShort, proxQual, proxSplit, proxSplitLabel } from '../format.js';
import { shortestMissedPanel } from './putts.js';

export function renderPuttsAll() {
  const byRound = state.puttsAll || {};
  const scored = h => h && h.score != null && h.score !== '' && h.score !== '-';
  const roundPlayed = r => byRound[r] && (byRound[r].holes || []).some(scored);
  const played = [1, 2, 3, 4].filter(roundPlayed);
  if (!played.length) { $('out').innerHTML = '<div class="summary"><span class="meta">No rounds available for this player.</span></div>'; return; }
  const map = {}; played.forEach(r => { map[r] = {}; byRound[r].holes.forEach(h => map[r][h.hole] = h); });
  const holes = [...new Set(played.flatMap(r => byRound[r].holes.filter(scored).map(h => h.hole)))].sort((a, b) => a - b);
  const frontHoles = holes.filter(h => h <= 9);
  const backHoles = holes.filter(h => h > 9);

  const cell = (row) => {
    if (!scored(row)) return '<td class="mx"></td>';           // not played yet
    if (row.firstPuttFt == null) return '<td class="mx"><span class="og" title="holed off green">–</span></td>';
    const cls = row.putts === 1 ? 'made' : row.putts >= 3 ? 'threeputt' : '';
    const q = proxQual(row.approachHad, row.approachFrom, row.firstPuttFt);
    const hadTip = row.approachHad ? `had ${row.approachHad} → ` : '';
    const expTip = q.exp != null ? ` · tour avg ≈ ${q.exp} ft from there` : '';
    const tip = `Hole ${row.hole} · ${hadTip}${row.firstPuttFt} ft${row.putts === 1 ? ' · made' : ` · ${row.putts}-putt`} · ${row.result}${expTip}`;
    return `<td class="mx ${cls}" title="${esc(tip)}">
      <span class="mput ${q.cls}">${row.firstPuttFt}${q.glyph ? `<span class="qg">${q.glyph}</span>` : ''}</span>
      <span class="mappr${q.kind === 'greenside' ? ' hgs' : ''}">${esc(approachShort(row.approachHad))}</span>
    </td>`;
  };
  // one nine's worth of cells for a given hole (empty if that hole is absent)
  const nineCells = (hole) => hole == null
    ? `<td class="num"></td>${played.map(() => '<td class="mx"></td>').join('')}`
    : `<td class="num hole">${hole}</td>${played.map(r => cell(map[r][hole])).join('')}`;

  const span = 1 + played.length;
  const roundHdr = `<th class="num">Hole</th>${played.map(r => `<th class="num">R${r}</th>`).join('')}`;
  const head = `
    <tr><th class="mxhdr" colspan="${span}">Front</th><th class="mxgap"></th><th class="mxhdr" colspan="${span}">Back</th></tr>
    <tr>${roundHdr}<th class="mxgap"></th>${roundHdr}</tr>`;
  const nRows = Math.max(frontHoles.length, backHoles.length);
  let body = '';
  for (let i = 0; i < nRows; i++) {
    body += `<tr>${nineCells(frontHoles[i])}<td class="mxgap"></td>${nineCells(backHoles[i])}</tr>`;
  }

  const key = `<div class="mxkey">
    <div class="kgrp"><span class="kt">Fill</span>
      <span class="ksw made">1</span> 1-putt
      <span class="ksw threeputt">3+</span> 3-putt or worse</div>
    <div class="kgrp"><span class="kt">Per cell</span>
      <span class="knum">12.2</span> proximity ft <span class="mappr" style="display:inline">/ 117y</span> had
      (<span class="hgs">51'</span> = greenside chip)</div>
    <div class="kgrp"><span class="kt">vs tour avg from there</span>
      <span class="q-hot">2.4<span class="qg">▴</span></span> beat it
      <span class="q-cold">44<span class="qg">▾</span></span> well outside</div>
    <div class="kgrp"><span class="og">–</span> holed off green</div>
  </div>`;
  // tournament putting stats: feet of putts made (per round + total), avg first
  // putt split, and the 5 shortest putts missed across all rounds
  const madeByRound = played.map(r => byRound[r].madePuttFeet);
  const madeTotal = Math.round(madeByRound.reduce((s, x) => s + (x || 0), 0) * 10) / 10;
  const madeStrip = `<div class="madestrip"><span class="ms-lbl">Feet of putts made</span>${played.map((r, i) => `<span class="ms-item">R${r} <b>${madeByRound[i] != null ? madeByRound[i] : '–'} ft</b></span>`).join('')}<span class="ms-item ms-total">Tournament <b>${madeTotal} ft</b></span></div>`;
  const allMissed = played.flatMap(r => (byRound[r].shortestMissed || []).map(m => ({ ...m, round: r })));
  allMissed.sort((a, b) => a.lengthFt - b.lengthFt || a.hole - b.hole);
  const missPanel = shortestMissedPanel(allMissed.slice(0, 5), { title: '5 shortest putts missed', sub: '— across the tournament', showRound: true });
  const sp = proxSplit(played.flatMap(r => byRound[r].holes.filter(scored)));
  const spTxt = proxSplitLabel(sp);
  const proxStrip = spTxt ? `<div class="madestrip"><span class="ms-lbl">Avg first putt</span><span class="ms-item">${spTxt}</span></div>` : '';
  $('out').innerHTML =
    `<div class="summary"><span class="who">${esc(playerName())}</span><span class="meta">All rounds · first-putt length (ft)</span></div>
     ${madeStrip}
     ${proxStrip}
     ${missPanel}
     ${key}
     <div class="card"><table class="putts"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
