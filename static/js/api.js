// Data layer: fetch helpers, the client round-cache, URL sync, and the
// loadShots orchestrator that drives every view refresh.
import { $, status } from './dom.js';
import { icon } from './icons.js';
import { state, scoredHole, maxRound, roundCompleted } from './state.js';
import { syncRoundBtn, updateRoundNav } from './pickers/round.js';
import { renderView } from './views/render.js';

export const api = async (path) => { const r = await fetch(path); if (!r.ok) throw new Error(`${r.status} ${await r.text()}`); return r.json(); };

// --- session cache: completed rounds only; live round always re-fetched ---
const dataCache = new Map();  // "kind:tid:pid:round" -> { data, ts }

export async function fetchRound(kind, tid, pid, round, force) {
  const cacheable = roundCompleted(tid, round);
  const key = `${kind}:${tid}:${pid}:${round}`;
  if (!force && cacheable && dataCache.has(key)) return { ...dataCache.get(key), source: 'client' };
  const refreshQ = force ? '&refresh=true' : '';  // also bust the server (Redis) entry
  const url = kind === 'shots'
    ? `/api/shots?tournamentId=${tid}&playerId=${pid}&round=${round}${refreshQ}`
    : `/api/putts?tournamentId=${tid}&playerId=${pid}&round=${round}${refreshQ}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  // "data current as of" = when the server actually captured the data from
  // PGA (header), not the browser's fetch time. Falls back to now.
  const fetchedAt = Number(r.headers.get('X-Data-Fetched-At')) || Date.now();
  const entry = { data: await r.json(), ts: fetchedAt };
  const source = r.headers.get('X-Cache') === 'HIT' ? 'redis' : 'live';
  if (cacheable) dataCache.set(key, entry); else dataCache.delete(key);
  return { ...entry, source };
}

// Reflect the current selection in the URL so reloads restore it and links are shareable.
export function syncUrl() {
  const q = new URLSearchParams();
  const t = $('tourn').value, p = $('player').value, r = $('round').value;
  if (t) q.set('t', t);
  if (p) q.set('p', p);
  if (r) q.set('r', r);
  q.set('v', state.view);
  if (state.view === 'course' && state.courseHole) q.set('h', state.courseHole);
  history.replaceState(null, '', location.pathname + '?' + q.toString());
}

export async function copyLink(btn) {
  syncUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    const orig = btn.innerHTML;
    btn.innerHTML = `${icon('check')} copied`;
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  } catch (e) {
    status('Copy failed — copy the URL from the address bar instead.', true);
  }
}

// Monotonic load counter: round-stepping / picker clicks can overlap, and a
// slower older response must never paint over a newer one. Each load takes a
// ticket; anything that returns to a stale ticket bails before touching state.
let loadSeq = 0;

export async function loadShots(opts = {}) {
  const force = !!opts.force;
  // background: fetch the player's round data without tearing down the view
  // (the Field grid renders from its own cache — clicking a row there must
  // not blank the leaderboard while the player's shots load)
  const background = !!opts.background;
  const tid = $('tourn').value, pid = $('player').value, rnd = $('round').value;
  if (!tid || !pid) { status('Pick a tournament and player first.', true); return; }
  const seq = ++loadSeq;
  $('go').disabled = true;
  if (!background) { status(force ? 'Refreshing…' : 'Loading…'); $('out').innerHTML = ''; }
  const t0 = performance.now();
  const setLoadMeta = (sources) => {
    state.loadMs = Math.round(performance.now() - t0);
    state.loadCached = sources.length > 0 && sources.every(s => s !== 'live');
  };
  try {
    if (rnd === 'all') {
      // only fetch rounds that have started (<= the tournament's current round)
      const rounds = [1, 2, 3, 4].filter(r => r <= maxRound());
      const entries = await Promise.all(rounds.map(r =>
        fetchRound('putts', tid, pid, r, force).catch(() => null)));
      if (seq !== loadSeq) return;
      state.puttsAll = {}; state.puttsAllTs = {};
      rounds.forEach((r, i) => {
        state.puttsAll[r] = entries[i] ? entries[i].data : null;
        state.puttsAllTs[r] = entries[i] ? entries[i].ts : null;
      });
      state.shots = state.putts = null;
      setLoadMeta(entries.filter(Boolean).map(e => e.source));
      renderView();
    } else {
      let useRound = rnd;
      let [sE, pE] = await Promise.all([
        fetchRound('shots', tid, pid, useRound, force),
        fetchRound('putts', tid, pid, useRound, force),
      ]);
      if (seq !== loadSeq) return;
      // (not in the Field view: the grid shows the whole tournament, and a
      // missed-cut selected player must not yank the round picker around)
      if (state.view !== 'field' && !(pE.data.holes || []).some(scoredHole)) {
        // no data for this player in the chosen round — drop to their last round with data
        const probe = [1, 2, 3, 4].filter(r => r <= maxRound());
        const all = await Promise.all(probe.map(r =>
          fetchRound('putts', tid, pid, r, force).catch(() => null)));
        if (seq !== loadSeq) return;
        const latest = [...probe].reverse().find(r => all[probe.indexOf(r)] && (all[probe.indexOf(r)].data.holes || []).some(scoredHole));
        if (latest && String(latest) !== String(useRound)) {
          useRound = String(latest);
          $('round').value = useRound;
          syncRoundBtn();  // keep the styled button label in step with the fallback
          [sE, pE] = await Promise.all([
            fetchRound('shots', tid, pid, useRound, force),
            fetchRound('putts', tid, pid, useRound, force),
          ]);
          if (seq !== loadSeq) return;
        }
      }
      state.shots = sE.data; state.putts = pE.data;
      state.shotsTs = sE.ts; state.puttsTs = pE.ts;
      state.puttsAll = null; state.puttsAllTs = null;
      setLoadMeta([sE.source, pE.source]);
      renderView();
    }
    syncUrl();
  } catch (e) {
    if (seq !== loadSeq) return;
    state.shots = state.putts = state.puttsAll = null;
    status('Load failed: ' + e.message + '  (player may not have played this round)', true);
  } finally {
    if (seq === loadSeq) { $('go').disabled = false; updateRoundNav(); }
  }
}
