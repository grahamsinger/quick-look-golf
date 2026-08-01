// Course view: the whole round drawn over the tournament's georeferenced
// aerial (TOURCAST assets). Projection: tourcast feet → world meters
// (×0.3048, rotate, − offset) → image pixels via the course world-file.
import { $, esc } from '../dom.js';
import { state, playerName } from '../state.js';
import { api } from '../api.js';
import { shotDist } from '../format.js';

const mapCache = new Map();  // tournamentId -> coursemap payload | null (in flight)

// world meters -> 2048px image space
function worldToPx(cm, wx, wy) {
  const t = cm.tfw;
  const fx = (wx - t.c) / t.a;
  const fy = (t.f - wy) / Math.abs(t.e);
  return [fx * 2048 / t.fullW, fy * 2048 / t.fullH];
}
// tourcast feet -> world meters (engine order: scale, rotate, translate)
function shotToPx(cm, tx, ty) {
  let wx = 0.3048 * tx, wy = 0.3048 * ty;
  const r = cm.offset.rotate || 0;
  if (r) { const c = Math.cos(r), s = Math.sin(r); [wx, wy] = [wx * c - wy * s, wx * s + wy * c]; }
  return worldToPx(cm, wx - cm.offset.x, wy - cm.offset.y);
}

export function renderCourse() {
  const d = state.shots;
  const tid = $('tourn').value;
  if (!d) { $('out').innerHTML = ''; return; }
  const cm = mapCache.get(tid);
  if (cm === undefined) {
    mapCache.set(tid, null);
    $('out').innerHTML = '<div class="summary"><span class="meta">Loading course map…</span></div>';
    api(`/api/coursemap?tournamentId=${encodeURIComponent(tid)}`)
      .then(res => { mapCache.set(tid, res); if (state.view === 'course') renderCourse(); })
      .catch(() => { mapCache.set(tid, { available: false }); if (state.view === 'course') renderCourse(); });
    return;
  }
  if (cm === null) return;  // fetch in flight — will re-render on arrival
  if (!cm.available) {
    $('out').innerHTML = '<div class="summary"><span class="meta">No course map for this tournament — TOURCAST doesn\'t publish aerial assets for it (typically only smaller/opposite-field events).</span></div>';
    return;
  }
  const holes = d.holes || [];
  if (!holes.length) { $('out').innerHTML = '<div class="summary"><span class="meta">No shot data for this round.</span></div>'; return; }

  const groups = holes.map(h => {
    const pts = [];
    (h.strokes || []).forEach((s, i) => {
      const ov = (s.overview || {}).leftToRightCoords || {};
      const add = (c, isFrom) => {
        if (!c || c.tourcastX == null) return;
        const [x, y] = shotToPx(cm, c.tourcastX, c.tourcastY);
        // first point = the tee; afterwards each stroke contributes where it finished
        if (isFrom && pts.length) return;
        const holed = !((s.distanceRemaining || '') + '').trim();
        pts.push({ x, y, n: s.strokeNumber, tip: isFrom ? `Hole ${h.holeNumber} tee` :
          `#${s.strokeNumber} · ${s.distance || ''}${holed ? ' · holed' : (s.toLocation ? ` · ${s.toLocation}` : '')}` });
      };
      add(ov.fromCoords, true);
      add(ov.toCoords, false);
    });
    return { h, pts };
  }).filter(g => g.pts.length > 1);

  const trail = (g) => {
    const ptsAttr = g.pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const dots = g.pts.map(p =>
      `<circle class="cpt" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6"><title>${esc(p.tip)}</title></circle>`).join('');
    // hole label chip: courseData pin if present, else the hole's last point
    const pt2 = cm.pinsTees && cm.pinsTees[g.h.holeNumber - 1];
    const [lx, ly] = pt2 && pt2.length >= 2 ? worldToPx(cm, pt2[0], pt2[1]) : [g.pts.at(-1).x, g.pts.at(-1).y];
    const diff = (g.h.score != null && g.h.par != null) ? g.h.score - g.h.par : null;
    const cls = diff == null ? '' : diff < 0 ? ' lb-good' : diff > 0 ? ' lb-over' : '';
    const label = `<g class="cpin${cls}"><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="15"/>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" dy="5.5">${g.h.holeNumber}</text>
      <title>Hole ${g.h.holeNumber} · par ${g.h.par}${g.h.score != null ? ` · ${g.h.score}` : ''}</title></g>`;
    return `<g class="chole"><polyline points="${ptsAttr}"/>${dots}${label}</g>`;
  };

  $('out').innerHTML =
    `<div class="summary"><span class="who">${esc(playerName())}</span><span class="meta">Round <b>${d.round}</b> · every shot on the course</span></div>
     <div class="caphint">Trails run tee → hole · hover a hole to isolate it, hover a dot for the shot · hole chip = score (<b class="rg-good">under</b> / par / <b class="rg-bad">over</b>) · aerial: PGA TOUR TOURCAST</div>
     <div class="card coursemap"><div class="cmwrap">
       <img src="${esc(cm.imageUrl)}" alt="Course aerial" draggable="false" />
       <svg viewBox="0 0 2048 2048" role="img" aria-label="Shot trails over the course aerial">${groups.map(trail).join('')}</svg>
     </div></div>`;
}
