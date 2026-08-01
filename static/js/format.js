// Pure formatting + the proximity-expectation model. No DOM, no state.

export function fmtWhen(ts) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// compact a ShotLink distance string ("322 yds", "46 ft 2 in.") for a cell
export function shotDist(str) {
  if (!str) return '';
  let m = str.match(/([\d.]+)\s*yds/); if (m) return m[1] + 'y';
  m = str.match(/(\d+)\s*ft/); if (m) return m[1] + '′';
  m = str.match(/(\d+)\s*in/); if (m) return m[1] + '″';
  return str;
}

// Compact approach distance for the matrix: "93 yds"->"93y", "46 ft 2 in."->"46'".
export function approachShort(s) {
  if (!s) return '';
  let m = s.match(/(\d+)\s*yds/);
  if (m) return m[1] + 'y';
  m = s.match(/(\d+)\s*ft/);
  if (m) return m[1] + "'";
  m = s.match(/(\d+)\s*in/);
  if (m) return m[1] + '"';
  return s;
}

export const ordPutt = (n) => (['', '1st', '2nd', '3rd', '4th', '5th', '6th'][n] || `${n}th`);

export function pillClass(diff) {
  if (diff == null) return 'par';
  if (diff < 0) return 'birdie';
  if (diff === 0) return 'par';
  if (diff === 1) return 'bogey';
  return 'double';
}

export const fmtTotal = (t) => (t || '').replace('-', '−');  // proper minus sign
export const isOutPos = (pos) => /cut|wd|dq/i.test(pos || '');

// ---- proximity vs expectation: judge each shot on its own curve -----------
// "2.4 ft from 107y" is elite; "2.3 ft from a 45′ chip" is merely good. A
// shot's proximity is scored against the tour-average from that distance
// and lie, not against the hole score.
// Parse a "had" string → feet + kind (approach = full shot; greenside =
// chip/pitch — ShotLink reports those in feet; ≤30y follows the SG line).
export function parseHad(str) {
  if (!str) return null;
  let m = str.match(/([\d.]+)\s*yds/);
  if (m) { const y = parseFloat(m[1]); return { ft: y * 3, yds: y, kind: y > 30 ? 'approach' : 'greenside' }; }
  m = str.match(/(\d+)\s*ft/);
  const inch = str.match(/(\d+)\s*in/);
  if (m || inch) { const f = (m ? +m[1] : 0) + (inch ? +inch[1] / 12 : 0); return { ft: f, yds: f / 3, kind: 'greenside' }; }
  return null;
}

// static tour-average first-putt proximity (ft) by start distance + lie.
// Long bands keep climbing — tour avg from 275+ is ~72 ft (and that's among
// shots where pros *chose* to go for it), so a 46-footer from 285 rates ▴.
export const APPR_BANDS = [[75, 16.5], [100, 18], [125, 20.5], [150, 23.5], [175, 27], [200, 32], [225, 38], [250, 46], [275, 58], [Infinity, 72]];

export function expectedProx(had, fromLoc) {
  if (!had) return null;
  const lie = (fromLoc || '').toLowerCase();
  if (had.kind === 'approach') {
    const base = APPR_BANDS.find(([max]) => had.yds <= max)[1];
    const mult = /rough|intermediate/.test(lie) ? 1.35 : /bunker|sand/.test(lie) ? 1.45 : 1;
    return Math.round(base * mult * 10) / 10;
  }
  const base = had.ft <= 30 ? 5 : had.ft <= 60 ? 7.5 : had.ft <= 90 ? 10 : 12.5;
  return base + (/bunker|sand/.test(lie) ? 2.5 : /rough|intermediate/.test(lie) ? 1.5 : 0);
}

export function proxQual(hadStr, fromLoc, actualFt) {
  const had = parseHad(hadStr);
  const exp = expectedProx(had, fromLoc);
  const kind = had ? had.kind : null;
  if (exp == null || actualFt == null) return { cls: '', glyph: '', exp: null, kind };
  const r = actualFt / exp;
  if (r <= 0.65) return { cls: 'q-hot', glyph: '▴', exp, kind };
  if (r >= 1.8) return { cls: 'q-cold', glyph: '▾', exp, kind };
  return { cls: '', glyph: '', exp, kind };
}

// split average first-putt length by what set it up (approach vs greenside)
export function proxSplit(rows) {
  const acc = { approach: [], greenside: [] };
  rows.forEach(r => {
    if (r.firstPuttFt == null) return;
    const had = parseHad(r.approachHad);
    if (had) acc[had.kind].push(r.firstPuttFt);
  });
  const avg = (x) => x.length ? Math.round(x.reduce((s, v) => s + v, 0) / x.length * 10) / 10 : null;
  return { appr: avg(acc.approach), apprN: acc.approach.length, gs: avg(acc.greenside), gsN: acc.greenside.length };
}

export const proxSplitLabel = (sp) =>
  [sp.appr != null ? `after approaches <b>${sp.appr} ft</b>` : '',
   sp.gs != null ? `greenside <b>${sp.gs} ft</b>` : ''].filter(Boolean).join(' · ');
