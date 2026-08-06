// First putts, single round: Front | Back scorecard + shortest-missed panel.
import { $, esc } from '../dom.js';
import { state, playerName } from '../state.js';
import { ordPutt, pillClass, proxQual, proxSplit, proxSplitLabel } from '../format.js';
import { START_MARK } from '../icons.js';

// The shortest putts the player missed (daily: top 5 this round; all-rounds:
// top 5 across the tournament, with a round tag on each tile).
export function shortestMissedPanel(list, opts = {}) {
  if (!list || !list.length) return '';
  const missColor = (ft) => ft < 4 ? 'var(--flag)' : ft < 8 ? 'var(--sand)' : 'var(--ink-2)';
  const tiles = list.map(m => {
    const rtag = (opts.showRound && m.round) ? ` · R${m.round}` : '';
    // the pill shows what the putt was FOR (the score it would have closed),
    // not the score the hole ended at — that lives in the tooltip
    const pill = m.forScore
      ? `<span class="pill ${pillClass(m.forDiff)}" title="made ${esc(m.result)} after the miss">for ${esc(m.forScore)}</span>`
      : `<span class="pill ${pillClass(m.scoreToPar)}">${esc(m.result)}</span>`;
    return `
    <div class="misstile" title="Hole ${m.hole}${rtag}: missed a ${m.lengthFt} ft ${ordPutt(m.puttNumber)} putt${m.forScore ? ` for ${esc(m.forScore)}` : ''} · made ${esc(m.result)}">
      <div class="mt-len" style="color:${missColor(m.lengthFt)}">${m.lengthFt}<span class="mt-unit">ft</span></div>
      <div class="mt-meta">Hole ${m.hole}${rtag} · ${ordPutt(m.puttNumber)} putt</div>
      <div class="mt-res">${pill}</div>
    </div>`;
  }).join('');
  return `<div class="misspanel">
    <div class="misspanel-hd">${opts.title || 'Shortest putts missed'}<span class="misspanel-sub"> ${opts.sub || "— the shortest putts that didn't drop this round"}</span></div>
    <div class="misstiles">${tiles}</div>
  </div>`;
}

export function renderPutts() {
  const d = state.putts;
  if (!d) { $('out').innerHTML = ''; return; }
  const rows = d.holes.slice().sort((a, b) => a.hole - b.hole);
  const startHole = (d.holes[0] || {}).hole;  // holes arrive in play order → first = start
  const rowHtml = (r) => {
    const isStart = r.hole === startHole;
    const cls = r.putts === 1 ? 'made' : r.putts >= 3 ? 'threeputt' : '';
    const q = proxQual(r.approachHad, r.approachFrom, r.firstPuttFt);
    const had = r.approachHad
      ? `<span class="${q.kind === 'greenside' ? 'hgs' : ''}" title="${q.kind === 'greenside' ? 'greenside shot (chip/pitch) · ' : ''}hit it ${esc(r.approachDist || '?')} from ${esc(r.approachFrom || '?')}">${esc(r.approachHad)}</span>`
      : '<span class="made-na">—</span>';
    const prox = r.firstPuttFt != null
      ? `<span class="${q.cls}"${q.exp != null ? ` title="tour avg ≈ ${q.exp} ft from there"` : ''}>${r.firstPuttFt} ft${q.glyph ? `<span class="qg">${q.glyph}</span>` : ''}</span>`
      : '<span class="made-na" title="holed from off the green — no first putt to measure">holed out</span>';
    const puttsCell = r.holedOffGreen
      ? '<span class="made-na" title="holed from off the green — no putt on this hole">—</span>'
      : `<span class="${r.putts === 1 ? 'made-yes' : r.putts >= 3 ? 'made-no' : 'putts-cnt'}" title="${r.putts} putt${r.putts === 1 ? '' : 's'}">${r.putts}</span>`;
    return `<tr class="${cls}">
      <td class="hole">${r.hole}<span class="startslot"${isStart ? ' title="Teed off here — started the round on this hole"' : ''}>${isStart ? START_MARK : ''}</span></td>
      <td class="num">${had}</td>
      <td class="num dist">${prox}</td>
      <td class="num">${puttsCell}</td>
      <td><span class="pill ${pillClass(r.scoreToPar)}">${esc(r.result)}</span></td>
    </tr>`;
  };
  const nine = (label, rws) => rws.length ? `<div class="nine">
    <table class="putts">
      <thead>
        <tr><th class="mxhdr" colspan="5">${label}</th></tr>
        <tr><th>Hole</th><th>Had</th><th>Proximity</th><th>Putts</th><th>Result</th></tr>
      </thead>
      <tbody>${rws.map(rowHtml).join('')}</tbody>
    </table></div>` : '';
  const front = nine('Front', rows.filter(r => r.hole <= 9));
  const back = nine('Back', rows.filter(r => r.hole > 9));
  const sp = proxSplit(d.holes);
  const spTxt = proxSplitLabel(sp);
  $('out').innerHTML =
    `<div class="summary"><span class="who">${esc(playerName())}</span><span class="meta">Round <b>${d.round}</b>${startHole && startHole !== 1 ? ` · started hole ${startHole}` : ''} · first putts${d.madePuttFeet != null ? ` · <b>${d.madePuttFeet} ft</b> of putts made` : ''}${spTxt ? ` · avg 1st putt ${spTxt}` : ''}</span></div>
     ${shortestMissedPanel((d.shortestMissed || []).slice(0, 5))}
     <div class="caphint"><b>Had</b> = distance to the pin before the shot (<b class="hgs">sand</b> = greenside chip/pitch) · <b>Proximity</b> = how close it finished, judged against the tour average from that distance &amp; lie: <span class="q-hot">▴ beat it</span> / <span class="q-cold">▾ well outside</span> · <b>Putts</b> = putts taken · <b class="made">green</b> row = 1-putt · <b class="tp">red</b> = 3-putt+</div>
     <div class="card scorecard">${front}${back}</div>`;
}
