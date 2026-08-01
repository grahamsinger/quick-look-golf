// Shared app state + derived selectors.
import { $ } from './dom.js';

export const state = { shots: null, putts: null, puttsAll: null, puttsTs: null, shotsTs: null, puttsAllTs: null, loadMs: null, loadCached: false, currentRound: null, tournaments: [], players: [], view: 'putts', courseHole: null };

export const playerLabel = () => $('player').selectedOptions[0]?.textContent.trim() || $('player').value;
// strip a leading "pos  " prefix off the option label for the editorial heading
export const playerName = () => playerLabel().replace(/^\S+\s+/, '').replace(/\s+\([^)]*\)\s*$/, '') || playerLabel();

export const scoredHole = h => h && h.score != null && h.score !== '' && h.score !== '-';

export const maxRound = () => Number(state.currentRound) || 4;

export function roundCompleted(tid, round) {
  const t = state.tournaments.find(x => x.id === tid);
  if (!t) return false;
  if (t.tournamentStatus === 'COMPLETED') return true;
  // in-progress event: rounds before the current one are final
  if (t.tournamentStatus === 'IN_PROGRESS') return state.currentRound != null && Number(round) < Number(state.currentRound);
  return false;
}
