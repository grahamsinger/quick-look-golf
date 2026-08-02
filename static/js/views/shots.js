// Shots view: rows = holes in play order, columns = shot number, so a column
// reads straight down for comparison (e.g. every tee-shot ball speed).
import { $, esc } from '../dom.js';
import { state, playerName } from '../state.js';
import { shotDist, pillClass } from '../format.js';
import { START_MARK } from '../icons.js';

// classify a shot's to-location into a short label + quality class
function shotResult(loc) {
  const s = (loc || '').toLowerCase();
  if (/green/.test(s)) return { label: 'green', cls: 'good' };
  if (/fairway/.test(s)) return { label: 'fairway', cls: 'good' };
  if (/fringe|collar|apron/.test(s)) return { label: 'fringe', cls: 'good' };
  if (/bunker|sand/.test(s)) return { label: 'bunker', cls: 'bad' };
  if (/water|hazard|penal|lateral|drop/.test(s)) return { label: 'penalty', cls: 'bad' };
  if (/tree|native|waste|fescue|desert|out of bounds/.test(s)) return { label: 'trouble', cls: 'bad' };
  if (/rough|intermediate|primary/.test(s)) return { label: 'rough', cls: 'warn' };
  if (/tee/.test(s)) return { label: 'tee', cls: '' };
  return { label: s || '—', cls: '' };
}

function shotCell(strokes, i, par) {
  const s = strokes[i];
  const isPutt = (s.fromLocation || '').toLowerCase() === 'green';
  const isHoled = !((s.distanceRemaining || '') + '').trim();
  const bs = s.radarData && s.radarData.ballSpeed;
  let primary, unit = '';
  if (bs) { primary = Math.round(bs); unit = 'mph'; }
  else if (isPutt) { primary = i > 0 ? shotDist(strokes[i - 1].distanceRemaining) : shotDist(s.distance); }
  else { primary = shotDist(s.distance); }
  let res, cls;
  if (isHoled) { res = isPutt ? 'made' : 'holed'; cls = 'good'; }
  else if (isPutt) { res = shotDist(s.distanceRemaining) + ' left'; cls = ''; }
  else { const r = shotResult(s.toLocation); res = r.label; cls = r.cls; }
  const p3 = (i === 0 && par === 3) ? '<sup class="p3" title="par-3 tee shot — an iron/hybrid, not a drive">P3</sup>' : '';
  const drop = s.dropNote ? `<sup class="p3" title="${esc(`played after a drop — ${s.dropNote}`)}">D</sup>` : '';
  const tip = [`#${s.strokeNumber}`, `${s.fromLocation || '?'} → ${isHoled ? 'holed' : (s.toLocation || '?')}`,
    s.distance ? `${s.distance} shot` : '', bs ? `ball ${s.radarData.ballSpeed} mph` : '',
    s.dropNote ? `after a drop (${s.dropNote})` : '', s.playByPlay || '']
    .filter(Boolean).join(' · ');
  return `<td class="scell" title="${esc(tip)}">
    <span class="sc-v">${esc(primary)}${unit ? `<span class="sc-u">${unit}</span>` : ''}${p3}${drop}</span>
    <span class="sc-r r-${cls}">${esc(res)}</span>
  </td>`;
}

// Only actual swings get a shot column. ShotLink interleaves non-stroke
// entries (strokeType DROP — a free-relief/penalty drop, sharing the prior
// shot's strokeNumber); folding one into a column made a 3 read as 4 shots.
// The drop's story is kept as a marker + tooltip on the shot played after it.
function realStrokes(h) {
  const out = [];
  let pendingDrop = null;
  (h.strokes || []).forEach(s => {
    if ((s.strokeType || 'STROKE') !== 'STROKE') { pendingDrop = s; return; }
    if (pendingDrop) { s = { ...s, dropNote: pendingDrop.playByPlay || 'drop' }; pendingDrop = null; }
    out.push(s);
  });
  return out;
}

export function renderShots() {
  const d = state.shots;
  if (!d) { $('out').innerHTML = ''; return; }
  const holes = d.holes || [];
  if (!holes.length) { $('out').innerHTML = '<div class="summary"><span class="meta">No shot data for this round.</span></div>'; return; }
  const startHole = holes[0].holeNumber;  // play order → first hole is the start
  const maxShots = Math.max(1, ...holes.map(h => realStrokes(h).length));
  const shotHdrs = Array.from({ length: maxShots }, (_, i) => `<th class="scol">Shot ${i + 1}</th>`).join('');
  const rows = holes.map(h => {
    const strokes = realStrokes(h);
    const cells = Array.from({ length: maxShots }, (_, i) =>
      i < strokes.length ? shotCell(strokes, i, h.par) : '<td class="scell"></td>').join('');
    const diff = (h.score != null && h.par != null) ? h.score - h.par : null;
    const isStart = h.holeNumber === startHole;
    return `<tr>
      <td class="hole">${h.holeNumber}<span class="startslot"${isStart ? ' title="Teed off here — started the round on this hole"' : ''}>${isStart ? START_MARK : ''}</span></td>
      <td class="spar">${h.par}</td>
      ${cells}
      <td class="sscore"><span class="pill ${pillClass(diff)}">${h.score != null ? h.score : ''}</span></td>
    </tr>`;
  }).join('');
  $('out').innerHTML =
    `<div class="summary"><span class="who">${esc(playerName())}</span><span class="meta">Round <b>${d.round}</b>${startHole !== 1 ? ` · started hole ${startHole}` : ''} · shot-by-shot</span></div>
     <div class="caphint">Big number = <b>ball speed</b> (mph) on full swings, otherwise the shot distance / putt length · below it = where it finished (<b class="rg-good">fairway · green</b> / <b class="rg-warn">rough</b> / <b class="rg-bad">sand · penalty</b>) · <sup class="p3">P3</sup> = par-3 tee shot · read a column down to compare (e.g. every tee-shot ball speed)</div>
     <div class="card shotmatrix"><table class="shots">
       <thead><tr><th>Hole</th><th class="spar-h">Par</th>${shotHdrs}<th>Score</th></tr></thead>
       <tbody>${rows}</tbody>
     </table></div>`;
}
