// Course view: the whole round drawn over the tournament's georeferenced
// aerial (TOURCAST assets), plus a per-hole zoom (click a hole) with a
// round-by-round or all-rounds trail overlay.
// Projection: tourcast feet → world meters (×0.3048 − offset) → image pixels
// via the course/hole world-file.
import { $, esc } from '../dom.js';
import { state, playerName, maxRound } from '../state.js';
import { api, fetchRound, loadShots, syncUrl } from '../api.js';
import { updateRoundOptions } from '../pickers/round.js';

const mapCache = new Map();   // tournamentId -> coursemap payload | null (in flight)
const holeMapCache = new Map();  // "tid:hole" -> holemap payload | null (in flight)

// world meters -> 2048px course-image space (course.tfw is axis-aligned)
function worldToPx(cm, wx, wy) {
  const t = cm.tfw;
  const fx = (wx - t.c) / t.a;
  const fy = (t.f - wy) / Math.abs(t.e);
  return [fx * 2048 / t.fullW, fy * 2048 / t.fullH];
}
// tourcast feet -> world meters. The config's `rotate` is deliberately NOT
// applied: the engine rotates the whole scene (terrain + shots together) by
// it, so relative to the aerial it cancels. Verified empirically — a Kabsch
// fit of shot pins vs courseData pins at TPC Twin Cities (config rotate
// -0.157 rad) gives rotation ≈ 0 and translation = -offset to within 30 cm.
const shotToWorld = (cm, tx, ty) => [0.3048 * tx - cm.offset.x, 0.3048 * ty - cm.offset.y];
function shotToPx(cm, tx, ty) {
  const [wx, wy] = shotToWorld(cm, tx, ty);
  return worldToPx(cm, wx, wy);
}

// world meters -> hole-image space, normalized to a 1000-wide viewBox. The
// per-hole world files are rotated (the hole runs down the frame), so this
// needs the full affine inverse, unlike the axis-aligned course.tfw.
function holeWorldToPx(hm, wx, wy) {
  const t = hm.tfw;
  const det = t.a * t.e - t.b * t.d;
  const px = (t.e * (wx - t.c) - t.b * (wy - t.f)) / det;
  const py = (-t.d * (wx - t.c) + t.a * (wy - t.f)) / det;
  const s = 1000 / t.fullW;
  return [px * s, py * s];
}

// --- data plumbing ---------------------------------------------------------

function getCourseMap(tid) {
  const cm = mapCache.get(tid);
  if (cm === undefined) {
    mapCache.set(tid, null);
    api(`/api/coursemap?tournamentId=${encodeURIComponent(tid)}`)
      .then(res => { mapCache.set(tid, res); if (state.view === 'course') renderCourse(); })
      .catch(() => { mapCache.set(tid, { available: false }); if (state.view === 'course') renderCourse(); });
  }
  return mapCache.get(tid);
}

function getHoleMap(tid, hole) {
  const key = `${tid}:${hole}`;
  const hm = holeMapCache.get(key);
  if (hm === undefined) {
    holeMapCache.set(key, null);
    api(`/api/holemap?tournamentId=${encodeURIComponent(tid)}&hole=${hole}`)
      .then(res => { holeMapCache.set(key, res); if (state.view === 'course') renderCourse(); })
      .catch(() => { holeMapCache.set(key, { available: false }); if (state.view === 'course') renderCourse(); });
  }
  return holeMapCache.get(key);
}

// All-rounds shot data for the hole overlay, fetched lazily (fetchRound's
// client cache makes repeat zooms free for completed rounds).
let allShots = null;  // { key: "tid:pid", rounds: {r: shotsData} } | {key, loading}
function getAllRoundShots(tid, pid) {
  const key = `${tid}:${pid}`;
  if (allShots && allShots.key === key) return allShots.rounds || null;
  allShots = { key, loading: true };
  const rounds = [1, 2, 3, 4].filter(r => r <= maxRound());
  Promise.all(rounds.map(r => fetchRound('shots', tid, pid, r).catch(() => null)))
    .then(entries => {
      if (allShots.key !== key) return;  // player/tournament changed mid-flight
      const out = {};
      rounds.forEach((r, i) => { if (entries[i]) out[r] = entries[i].data; });
      allShots = { key, rounds: out };
      if (state.view === 'course') renderCourse();
    });
  return null;
}

// --- shared trail building -------------------------------------------------

// One hole's strokes -> ordered points (tee, then each shot's finish).
function holePoints(h, toPt, tipPrefix = '') {
  const pts = [];
  (h.strokes || []).forEach(s => {
    const ov = (s.overview || {}).leftToRightCoords || {};
    const add = (c, isFrom) => {
      if (!c || c.tourcastX == null) return;
      const [x, y] = toPt(c.tourcastX, c.tourcastY);
      if (isFrom && pts.length) return;
      const holed = !((s.distanceRemaining || '') + '').trim();
      pts.push({ x, y, n: s.strokeNumber, tip: isFrom ? `${tipPrefix}Hole ${h.holeNumber} tee` :
        `${tipPrefix}#${s.strokeNumber} · ${s.distance || ''}${holed ? ' · holed' : (s.toLocation ? ` · ${s.toLocation}` : '')}` });
    };
    add(ov.fromCoords, true);
    add(ov.toCoords, false);
  });
  return pts;
}

// polyline + shot dots for one trail (goes inside a .chole group)
function trailSvg(pts, dotR = 6) {
  const ptsAttr = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dots = pts.map(p =>
    `<circle class="cpt" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dotR}"><title>${esc(p.tip)}</title></circle>`).join('');
  return `<polyline points="${ptsAttr}"/>${dots}`;
}

// --- full-course view ------------------------------------------------------

function renderFullCourse(cm) {
  const d = state.shots;
  const holes = (d && d.holes) || [];
  if (!holes.length) { $('out').innerHTML = '<div class="summary"><span class="meta">No shot data for this round.</span></div>'; return; }

  const groups = holes
    .map(h => ({ h, pts: holePoints(h, (tx, ty) => shotToPx(cm, tx, ty)) }))
    .filter(g => g.pts.length > 1);

  const trail = (g) => {
    // hole label chip: courseData pin if present, else the hole's last point
    const pt2 = cm.pinsTees && cm.pinsTees[g.h.holeNumber - 1];
    const [lx, ly] = pt2 && pt2.length >= 2 ? worldToPx(cm, pt2[0], pt2[1]) : [g.pts.at(-1).x, g.pts.at(-1).y];
    const diff = (g.h.score != null && g.h.par != null) ? g.h.score - g.h.par : null;
    const cls = diff == null ? '' : diff < 0 ? ' lb-good' : diff > 0 ? ' lb-over' : '';
    const label = `<g class="cpin${cls}"><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="15"/>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" dy="5.5">${g.h.holeNumber}</text>
      <title>Hole ${g.h.holeNumber} · par ${g.h.par}${g.h.score != null ? ` · ${g.h.score}` : ''}</title></g>`;
    return `<g class="chole" data-hole="${g.h.holeNumber}">${trailSvg(g.pts)}${label}</g>`;
  };

  $('out').innerHTML =
    `<div class="summary"><span class="who">${esc(playerName())}</span><span class="meta">Round <b>${d.round}</b> · every shot on the course</span></div>
     <div class="caphint">Trails run tee → hole · click a hole to zoom in · hover a dot for the shot · hole chip = score (<b class="rg-good">under</b> / par / <b class="rg-bad">over</b>) · aerial: PGA TOUR TOURCAST</div>
     <div class="card coursemap"><div class="cmwrap">
       <img src="${esc(cm.imageUrl)}" alt="Course aerial" draggable="false" />
       <svg viewBox="0 0 2048 2048" role="img" aria-label="Shot trails over the course aerial">${groups.map(trail).join('')}</svg>
     </div></div>`;
  $('out').querySelector('.cmwrap svg').addEventListener('click', (e) => {
    const g = e.target.closest('.chole');
    if (g && g.dataset.hole) zoomToHole(Number(g.dataset.hole));
  });
}

// --- per-hole zoom ---------------------------------------------------------

const ROUND_CLS = { 1: 'r1', 2: 'r2', 3: 'r3', 4: 'r4' };

function zoomToHole(holeNum) {
  state.courseHole = holeNum;
  updateRoundOptions();  // the hole view offers "All rounds"
  renderCourse();
  syncUrl();
}

function zoomOut() {
  state.courseHole = null;
  const wasAll = $('round').value === 'all';
  updateRoundOptions();  // drops "All rounds", snaps to the latest round
  if (wasAll) { loadShots(); return; }  // syncs URL + re-renders on completion
  renderCourse();
  syncUrl();
}

function stepHole(step) {
  let h = (state.courseHole || 1) + step;
  if (h < 1) h = 18;
  if (h > 18) h = 1;
  zoomToHole(h);
}

function renderHole(cm) {
  const tid = $('tourn').value, pid = $('player').value;
  const holeNum = state.courseHole;
  const hm = getHoleMap(tid, holeNum);
  if (hm === null) { $('out').innerHTML = '<div class="summary"><span class="meta">Loading hole map…</span></div>'; return; }
  if (hm && !hm.available) {
    $('out').innerHTML = '<div class="summary"><span class="meta">No aerial for this hole.</span></div>';
    return;
  }
  const allMode = $('round').value === 'all';
  let roundsData;  // {roundNumber: shotsData}
  if (allMode) {
    const all = getAllRoundShots(tid, pid);
    if (!all) { $('out').innerHTML = '<div class="summary"><span class="meta">Loading all rounds…</span></div>'; return; }
    roundsData = all;
  } else if (state.shots) {
    roundsData = { [state.shots.round]: state.shots };
  } else {
    $('out').innerHTML = '';
    return;
  }

  const t = hm.tfw;
  const vbH = Math.round(1000 * t.fullH / t.fullW);
  const toPt = (tx, ty) => { const [wx, wy] = shotToWorld(cm, tx, ty); return holeWorldToPx(hm, wx, wy); };

  // one trail per round that has data on this hole
  const rounds = Object.keys(roundsData).map(Number).sort((a, b) => a - b);
  const trails = [];
  let par = null;
  rounds.forEach(r => {
    const h = ((roundsData[r] || {}).holes || []).find(x => x.holeNumber === holeNum);
    if (!h) return;
    if (h.par != null) par = h.par;
    const pts = holePoints(h, toPt, allMode ? `R${r} ` : '');
    if (pts.length < 2) return;
    trails.push({ r, h, pts });
  });

  const svgTrails = trails.map(tr =>
    `<g class="chole hr ${ROUND_CLS[tr.r] || 'r1'}">${trailSvg(tr.pts, 8)}</g>`).join('');

  // pin (courseData's marked position) + tee, oriented by the hole world-file
  const pt2 = cm.pinsTees && cm.pinsTees[holeNum - 1];
  let marks = '';
  if (pt2 && pt2.length >= 4) {
    const [px, py] = holeWorldToPx(hm, pt2[0], pt2[1]);
    marks = `<g class="hpin"><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7"/><title>Pin (marked position)</title></g>`;
  }

  const scoreBit = (h) => {
    if (h.score == null || h.par == null) return '';
    const diff = h.score - h.par;
    const cls = diff < 0 ? 'rg-good' : diff > 0 ? 'rg-bad' : '';
    return ` · <b class="${cls}">${h.score}</b>`;
  };
  const legend = allMode
    ? `<div class="rleg">${trails.map(tr =>
        `<span class="rlegchip"><i class="sw ${ROUND_CLS[tr.r] || 'r1'}"></i>R${tr.r}${scoreBit(tr.h)}</span>`).join('')}</div>`
    : '';
  const roundMeta = allMode
    ? `all rounds`
    : `Round <b>${rounds[0] || ''}</b>${trails[0] ? scoreBit(trails[0].h) : ''}`;
  const noData = trails.length ? '' :
    '<div class="summary"><span class="meta">No shot trail for this hole in the selected round.</span></div>';

  $('out').innerHTML =
    `<div class="summary"><span class="who">${esc(playerName())}</span><span class="meta">Hole <b>${holeNum}</b>${par != null ? ` · par ${par}` : ''} · ${roundMeta}</span></div>
     <div class="caphint">Tee at the bottom, green at the top · hover a dot for the shot${allMode ? ' · hover a trail to isolate that round' : ''} · aerial: PGA TOUR TOURCAST</div>
     <div class="card coursemap holemap">
       <div class="holebar">
         <button type="button" class="hback">‹ Full course</button>
         <div class="holenav">
           <button type="button" class="hstep" data-hstep="-1" aria-label="Previous hole">‹</button>
           <span class="holetitle">Hole ${holeNum}</span>
           <button type="button" class="hstep" data-hstep="1" aria-label="Next hole">›</button>
         </div>
         ${legend}
       </div>
       ${noData}
       <div class="cmwrap cmwrap-hole" style="aspect-ratio:${t.fullW}/${t.fullH};width:min(100%, calc(74vh * ${(t.fullW / t.fullH).toFixed(4)}))">
         <img src="${esc(hm.imageUrl)}" alt="Hole ${holeNum} aerial" draggable="false" />
         <svg viewBox="0 0 1000 ${vbH}" preserveAspectRatio="none" role="img" aria-label="Shot trails over the hole aerial">${marks}${svgTrails}</svg>
       </div>
     </div>`;
  $('out').querySelector('.hback').addEventListener('click', zoomOut);
  $('out').querySelectorAll('.hstep').forEach(b => b.addEventListener('click', () => stepHole(Number(b.dataset.hstep))));
}

// --- entry -----------------------------------------------------------------

export function renderCourse() {
  const tid = $('tourn').value;
  const cm = getCourseMap(tid);
  if (cm === null || cm === undefined) {
    $('out').innerHTML = '<div class="summary"><span class="meta">Loading course map…</span></div>';
    return;
  }
  if (!cm.available) {
    $('out').innerHTML = '<div class="summary"><span class="meta">No course map for this tournament — TOURCAST doesn\'t publish aerial assets for it (typically only smaller/opposite-field events).</span></div>';
    return;
  }
  if (state.courseHole) { renderHole(cm); return; }
  if (!state.shots) { $('out').innerHTML = ''; return; }
  renderFullCourse(cm);
}
