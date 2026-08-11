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
const shotToWorld = (cm, off, tx, ty) => [0.3048 * tx - off.x, 0.3048 * ty - off.y];
function shotToPx(cm, off, tx, ty) {
  const [wx, wy] = shotToWorld(cm, off, tx, ty);
  return worldToPx(cm, wx, wy);
}

// Some tournaments ship a wrong offsetConfig (Sedgefield's was ~70 m off —
// trails started on houses). Every holed-out shot is a ground-truth anchor:
// it ended in the cup, beside that hole's marked pin in courseData. The
// median implied offset across a round's holes is robust to daily pin moves
// (~10 m scatter), so when it disagrees with the config by more than pin
// noise can explain (25 m), trust the shots instead of the config.
function calibratedOffset(cm, holesList) {
  if (cm._cal) return cm._cal;
  const xs = [], ys = [];
  (holesList || []).forEach(h => {
    const pt = cm.pinsTees && cm.pinsTees[h.holeNumber - 1];
    if (!pt || pt.length < 2) return;
    const fin = (h.strokes || []).filter(s => (s.strokeType || 'STROKE') === 'STROKE'
      && !((s.distanceRemaining || '') + '').trim());
    const c = fin.length && ((fin[fin.length - 1].overview || {}).leftToRightCoords || {}).toCoords;
    if (!c || c.tourcastX == null) return;
    xs.push(0.3048 * c.tourcastX - pt[0]);
    ys.push(0.3048 * c.tourcastY - pt[1]);
  });
  if (xs.length < 6) return cm.offset;  // too few anchors — don't memoize either
  const mx = med(xs), my = med(ys);
  cm._cal = Math.hypot(mx - cm.offset.x, my - cm.offset.y) > 25 ? { x: mx, y: my } : cm.offset;
  return cm._cal;
}

const med = a => a.sort((p, q) => p - q)[Math.floor(a.length / 2)];

// Hole-zoom refinement, only for courses whose config already proved wrong
// (the global calibration fired): even after the global fix, Sedgefield
// keeps residual error that varies not just per hole but ALONG a hole —
// one translation that fixed a green pushed that hole's tee off its box.
// Both ends have ground truth (stroke 1 starts at the marked tee, the
// holed-out shot ends beside the marked pin), so the correction blends the
// two median deltas linearly along the tee→pin axis. Round-to-round cup
// differences survive, and a rogue row can't warp a hole more than 40 m.
// Returns a (wx, wy) → [dx, dy] correction, or null for none.
function holeCorrection(cm, off, holeNum, roundsData, rounds) {
  const pt = cm.pinsTees && cm.pinsTees[holeNum - 1];
  if (!pt || pt.length < 4) return null;
  const dPin = { x: [], y: [] }, dTee = { x: [], y: [] };
  rounds.forEach(r => {
    const h = ((roundsData[r] || {}).holes || []).find(x => x.holeNumber === holeNum);
    if (!h) return;
    const strokes = (h.strokes || []).filter(s => (s.strokeType || 'STROKE') === 'STROKE');
    const fc = strokes.length && ((strokes[0].overview || {}).leftToRightCoords || {}).fromCoords;
    if (fc && fc.tourcastX != null) {
      dTee.x.push(0.3048 * fc.tourcastX - off.x - pt[2]);
      dTee.y.push(0.3048 * fc.tourcastY - off.y - pt[3]);
    }
    const fin = strokes.filter(s => !((s.distanceRemaining || '') + '').trim());
    const c = fin.length && ((fin[fin.length - 1].overview || {}).leftToRightCoords || {}).toCoords;
    if (c && c.tourcastX != null) {
      dPin.x.push(0.3048 * c.tourcastX - off.x - pt[0]);
      dPin.y.push(0.3048 * c.tourcastY - off.y - pt[1]);
    }
  });
  const mk = d => d.x.length ? { x: med(d.x), y: med(d.y) } : null;
  const ok = v => v && Math.hypot(v.x, v.y) <= 40 ? v : null;
  let p = ok(mk(dPin)), te = ok(mk(dTee));
  if (!p && !te) return null;
  p = p || te; te = te || p;  // one anchor end missing → uniform correction
  const ax = pt[2], ay = pt[3], vx = pt[0] - ax, vy = pt[1] - ay;
  const len2 = vx * vx + vy * vy || 1;
  return (wx, wy) => {
    const t = Math.max(0, Math.min(1, ((wx - ax) * vx + (wy - ay) * vy) / len2));
    return [te.x + (p.x - te.x) * t, te.y + (p.y - te.y) * t];
  };
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
    // a DROP row is where the ball was placed, not a swing — keep the point
    // (the trail really moved) but say so instead of faking a shot number
    const isDrop = (s.strokeType || 'STROKE') !== 'STROKE';
    const add = (c, isFrom) => {
      if (!c || c.tourcastX == null) return;
      const [x, y] = toPt(c.tourcastX, c.tourcastY);
      if (isFrom && pts.length) return;
      const holed = !((s.distanceRemaining || '') + '').trim();
      pts.push({ x, y, n: s.strokeNumber, tip: isFrom ? `${tipPrefix}Hole ${h.holeNumber} tee` :
        isDrop ? `${tipPrefix}${s.playByPlay || (s.strokeType || 'drop').toLowerCase()}` :
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

  const off = calibratedOffset(cm, holes);
  const groups = holes
    .map(h => ({ h, pts: holePoints(h, (tx, ty) => shotToPx(cm, off, tx, ty)) }))
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

// Manual per-hole nudge — the last-resort polish. Auto-calibration can only
// be as accurate as the course model's marked tee/pin points, and those are
// themselves off by ±10–15 m on some holes (in different directions), so the
// user can drag a hole's trails into place; the world-space delta persists
// per (tournament, hole) in localStorage and applies on top of everything.
const ADJ_LS = 'fairway-hole-adjust';
let adjustMode = false;
function loadAdj() { try { return JSON.parse(localStorage.getItem(ADJ_LS)) || {}; } catch (e) { return {}; } }
function saveAdj(map) { try { localStorage.setItem(ADJ_LS, JSON.stringify(map)); } catch (e) { /* private mode etc. */ } }

function zoomToHole(holeNum) {
  state.courseHole = holeNum;
  adjustMode = false;
  updateRoundOptions();  // the hole view offers "All rounds"
  renderCourse();
  syncUrl();
}

function zoomOut() {
  state.courseHole = null;
  adjustMode = false;
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
  // one trail per round that has data on this hole
  const rounds = Object.keys(roundsData).map(Number).sort((a, b) => a - b);
  // calibrate from every loaded round's holed-out anchors (more = steadier);
  // when the config was wrong enough to override, also refine along this hole
  const off = calibratedOffset(cm, rounds.flatMap(r => (roundsData[r] || {}).holes || []));
  const corr = off !== cm.offset ? holeCorrection(cm, off, holeNum, roundsData, rounds) : null;
  const adjMap = loadAdj();
  const adjKey = `${tid}:${holeNum}`;
  const manual = adjMap[adjKey];  // user's saved world-space nudge for this hole
  const toPt = (tx, ty) => {
    let [wx, wy] = shotToWorld(cm, off, tx, ty);
    if (corr) { const [dx, dy] = corr(wx, wy); wx -= dx; wy -= dy; }
    if (manual) { wx -= manual.x; wy -= manual.y; }
    return holeWorldToPx(hm, wx, wy);
  };
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

  // round colors only mean something in the all-rounds overlay (they have a
  // legend there); a single round wears the app's classic white trail
  const svgTrails = trails.map(tr =>
    `<g class="chole${allMode ? ` hr ${ROUND_CLS[tr.r] || 'r1'}` : ''}">${trailSvg(tr.pts, 8)}</g>`).join('');

  // pin (courseData's marked position) + tee, oriented by the hole world-file.
  // The world files run the hole along the frame but not in a guaranteed
  // direction — when the tee projects above the pin, rotate the whole aerial
  // 180° so "tee at the bottom, green at the top" is true at every course.
  const pt2 = cm.pinsTees && cm.pinsTees[holeNum - 1];
  let marks = '', flip = false;
  if (pt2 && pt2.length >= 4) {
    const [px, py] = holeWorldToPx(hm, pt2[0], pt2[1]);
    const [, ty] = holeWorldToPx(hm, pt2[2], pt2[3]);
    flip = ty < py;
    marks = `<g class="hpin"><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="9"/><title>Pin (marked position)</title></g>`;
  }

  // Desktop gets the hole horizontal (tee left → green right, like a hole
  // diagram — wide screens are wide); narrow viewports keep it vertical
  // (tee bottom → green top). One SVG group transform rotates the aerial and
  // every trail together, and also absorbs the tee-at-the-top flip cases.
  const landscape = window.innerWidth > 860;
  let boxW = 1000, boxH = vbH, gT = '';
  if (landscape) {
    boxW = vbH; boxH = 1000;
    gT = flip ? `rotate(-90) translate(-1000 0)` : `rotate(90) translate(0 -${vbH})`;
  } else if (flip) {
    gT = `rotate(180 500 ${(vbH / 2).toFixed(1)})`;
  }
  const wrapStyle = landscape
    ? `aspect-ratio:${t.fullH}/${t.fullW};width:980px`
    : `aspect-ratio:${t.fullW}/${t.fullH};width:calc(74vh * ${(t.fullW / t.fullH).toFixed(4)})`;
  const orient = landscape ? 'Tee on the left, green on the right' : 'Tee at the bottom, green at the top';

  // --- our own "green view": the hole aerial windowed tightly on the green.
  // The site's green view plots the same tourcast points (verified: green.*
  // coords equal overview.*) over a long-dead crop asset — so window ours
  // instead: same image, same projection/corrections/rotation, putt scale.
  // Each round shows from the shot that found the green through every putt.
  let greenCard = '';
  if (pt2 && pt2.length >= 2 && trails.length) {
    const [gpx, gpy] = holeWorldToPx(hm, pt2[0], pt2[1]);
    const upm = 1000 / (t.fullW * Math.hypot(t.a, t.d));  // viewBox units per meter
    const half = 24 * upm;  // 48 m window around the marked pin
    // the window is a square in the *displayed* space — map the pin's
    // portrait position through the same rotation the big aerial uses
    const gc = !landscape ? (flip ? [1000 - gpx, vbH - gpy] : [gpx, gpy])
      : (flip ? [gpy, 1000 - gpx] : [vbH - gpy, gpx]);
    const gTrails = trails.map(tr => {
      const nGreen = (tr.h.strokes || []).filter(s =>
        (s.fromLocation || '').toLowerCase() === 'green'
        && ((((s.overview || {}).leftToRightCoords || {}).toCoords) || {}).tourcastX != null).length;
      const pts = tr.pts.slice(-(nGreen + 1));  // setup shot's finish + every putt
      return pts.length ? `<g class="chole${allMode ? ` hr ${ROUND_CLS[tr.r] || 'r1'}` : ''}">${trailSvg(pts, 5)}</g>` : '';
    }).join('');
    greenCard = `<div class="greencard">
      <div class="gvhdr">On the green</div>
      <svg class="greenview" viewBox="${(gc[0] - half).toFixed(1)} ${(gc[1] - half).toFixed(1)} ${(2 * half).toFixed(1)} ${(2 * half).toFixed(1)}" role="img" aria-label="Green detail">
        <g${gT ? ` transform="${gT}"` : ''}>
          <image href="${esc(hm.imageUrl)}" x="0" y="0" width="1000" height="${vbH}" preserveAspectRatio="none"/>
          ${marks}${gTrails}
        </g>
      </svg>
    </div>`;
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

  // shot-by-shot verbiage under the aerial (the feed's own play-by-play);
  // drops/penalties appear as unnumbered muted lines, like the Tour's panel
  const pbp = trails.length ? `<div class="pbp">${rounds.map(r => {
    const h = ((roundsData[r] || {}).holes || []).find(x => x.holeNumber === holeNum);
    if (!h || !(h.strokes || []).length) return '';
    const items = h.strokes.map(s => {
      const real = (s.strokeType || 'STROKE') === 'STROKE';
      const txt = s.playByPlay || [s.distance, s.toLocation].filter(Boolean).join(' to ')
        || (s.strokeType || '').toLowerCase();
      return real
        ? `<li><b>${s.strokeNumber}</b>${esc(txt)}</li>`
        : `<li class="pbpx">${esc(txt)}</li>`;
    }).join('');
    const hdr = allMode
      ? `<span class="pbphdr"><i class="sw ${ROUND_CLS[r] || 'r1'}"></i>Round ${r}${scoreBit(h)}</span>`
      : `<span class="pbphdr">Round ${r}${scoreBit(h)}</span>`;
    return `<div class="pbpr">${hdr}<ol>${items}</ol></div>`;
  }).join('')}</div>` : '';

  $('out').innerHTML =
    `<div class="summary"><span class="who">${esc(playerName())}</span><span class="meta">Hole <b>${holeNum}</b>${par != null ? ` · par ${par}` : ''} · ${roundMeta}</span></div>
     <div class="caphint">${adjustMode
       ? '<b>Adjust:</b> drag the aerial to slide this hole’s trails into place · saved for this hole on this device · <b>done</b> finishes'
       : `${orient} · hover a dot for the shot${allMode ? ' · hover a trail to isolate that round' : ''}${manual ? ' · manually adjusted' : ''} · aerial: PGA TOUR TOURCAST`}</div>
     <div class="card coursemap holemap">
       <div class="holebar">
         <button type="button" class="hback">‹ Full course</button>
         <div class="holenav">
           <button type="button" class="hstep" data-hstep="-1" aria-label="Previous hole">‹</button>
           <span class="holetitle">Hole ${holeNum}</span>
           <button type="button" class="hstep" data-hstep="1" aria-label="Next hole">›</button>
         </div>
         ${legend}
         <span class="hadjwrap">
           <button type="button" class="hadj${adjustMode ? ' on' : ''}" title="Nudge this hole's trails if they sit off the aerial">${adjustMode ? 'done' : 'adjust'}</button>
           ${manual && !adjustMode ? '<button type="button" class="hadjreset" title="Remove the saved adjustment">reset</button>' : ''}
         </span>
       </div>
       ${noData}
       <div class="cmwrap cmwrap-hole" style="${wrapStyle}">
         <svg viewBox="0 0 ${boxW} ${boxH}" preserveAspectRatio="none" role="img" aria-label="Shot trails over the hole aerial">
           <g${gT ? ` transform="${gT}"` : ''}>
             <image href="${esc(hm.imageUrl)}" x="0" y="0" width="1000" height="${vbH}" preserveAspectRatio="none"/>
             ${marks}<g class="adjlayer">${svgTrails}</g>
           </g>
         </svg>
       </div>
       <div class="holeside">${greenCard}${pbp}</div>
     </div>`;
  $('out').querySelector('.hback').addEventListener('click', zoomOut);
  $('out').querySelectorAll('.hstep').forEach(b => b.addEventListener('click', () => stepHole(Number(b.dataset.hstep))));
  $('out').querySelector('.hadj').addEventListener('click', () => { adjustMode = !adjustMode; renderCourse(); });
  const resetBtn = $('out').querySelector('.hadjreset');
  if (resetBtn) resetBtn.addEventListener('click', () => { delete adjMap[adjKey]; saveAdj(adjMap); renderCourse(); });

  if (adjustMode) {
    // Drag anywhere on the aerial to slide the trails; the screen delta is
    // unwound through the display rotation and the hole world-file back to
    // world meters, then saved so it re-applies on every future visit.
    const svgEl = $('out').querySelector('.cmwrap-hole svg');
    const layer = svgEl.querySelector('.adjlayer');
    const screenToPortrait = (ux, uy) =>
      !landscape ? (flip ? [-ux, -uy] : [ux, uy])
      : (flip ? [-uy, ux] : [uy, -ux]);
    let drag = null;
    svgEl.style.cursor = 'grab';
    const delta = (e) => {
      const rect = svgEl.getBoundingClientRect();
      return [(e.clientX - drag.x) * boxW / rect.width, (e.clientY - drag.y) * boxH / rect.height];
    };
    svgEl.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      svgEl.setPointerCapture(e.pointerId);
      svgEl.style.cursor = 'grabbing';
      e.preventDefault();
    });
    svgEl.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const [px, py] = screenToPortrait(...delta(e));
      layer.setAttribute('transform', `translate(${px} ${py})`);
    });
    const finish = (e) => {
      if (!drag) return;
      const [px, py] = screenToPortrait(...delta(e));
      drag = null;
      // portrait viewBox units → full-raster px → world meters (tfw linear part)
      const rx = px * t.fullW / 1000, ry = py * t.fullW / 1000;
      const dwx = t.a * rx + t.b * ry, dwy = t.d * rx + t.e * ry;
      if (!dwx && !dwy) return;
      const cur = adjMap[adjKey] || { x: 0, y: 0 };
      adjMap[adjKey] = { x: cur.x - dwx, y: cur.y - dwy };
      saveAdj(adjMap);
      renderCourse();
    };
    svgEl.addEventListener('pointerup', finish);
    svgEl.addEventListener('pointercancel', () => { drag = null; renderCourse(); });
  }
}

// the hole zoom picks landscape/portrait from the viewport — re-render when
// a resize crosses the breakpoint (cheap: all data is cached by then)
let rzT;
window.addEventListener('resize', () => {
  clearTimeout(rzT);
  rzT = setTimeout(() => { if (state.view === 'course' && state.courseHole) renderCourse(); }, 150);
});

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
