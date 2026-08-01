# Changelog

Shipped work, oldest first. Open threads live in `NEXT_STEPS.md`.

## Jul 2026 — "Fairway" design refresh (v1)

Replaced the generic dark-slate + green look with the **Fairway** light
editorial identity:

- Warm paper palette + deep pine ink + sand / flag-red accents. Score & status
  colors validated for colorblind-safety (dataviz validator); **dark mode** is a
  warm "clubhouse at dusk" palette (its own CVD-validated steps, not a flip),
  with a sun/moon toggle, `localStorage` persistence, and a no-flash pre-paint
  script. Tint fills tokenized so both themes share one ruleset.
- Self-hosted **Fraunces** variable display serif (`static/fonts/`) for the
  wordmark, hole numbers, and headings; system sans for UI; tabular figures.
- Custom **flag wordmark + favicon** (`static/favicon.svg`); real inline-SVG
  icons replace the emoji.
- Daily first-putts view became a **Front | Back scorecard** (all 18 holes, no
  scrolling); "Made" column renamed **Putts** (count; green = 1-putt).
- **Shot trails removed** — abstract SVG plots were meaningless without the
  course underneath; reframed as **"Shots"** (play-by-play + TrackMan numbers).
- **Shots view → comparison matrix** — rows = holes in play order, columns =
  shot number, so a column reads straight down (e.g. every tee-shot ball
  speed); ball speed on full swings, color-coded result, par-3 tee flagged.
- **5 shortest missed putts** panel (server derives `shortestMissed` in
  `/api/putts`; a "miss" = any green stroke that wasn't the holed one, measured
  by the prior stroke's `distanceRemaining`, so short 2nd/3rd putts rank right).
- **"Data current as of" reflects true capture time** — server stamps
  `fetchedAt` (`X-Data-Fetched-At`); a cached round shows a stable capture
  time, not "now".
- Off-green hole-outs read **"holed out"**; the **starting hole** is marked
  with a tee flag and noted in the summary.
- **Round picker → styled dropdown** over a hidden `<select>`, options limited
  to rounds with data; ‹ › arrows step between rounds. **Freshness bar**
  consolidated into the view-toggle row. **All-rounds tournament putting
  stats**: feet of putts made per round + tournament total, and the 5 shortest
  missed putts across the tournament.

## Aug 2026 — robustness pass

- Per-key fetch lock + **30s TTL on in-progress rounds** — the parallel
  shots+putts load no longer double-hits PGA; live view-flipping reuses one
  capture.
- **Stale-response guard** in `loadShots` — rapid round-stepping can't paint
  old data over new.
- **API-key rotation self-healing** — on 401/403 the client re-scrapes keys
  from the site bundle and retries.
- `esc()` on all API strings hitting innerHTML; round-menu keyboard nav; dead
  `radar` param removed.
- Fixed: round-button label desync on the no-data fallback (fallback now calls
  `syncRoundBtn()`); round ‹ › arrows walk the picker's option order, so
  **All rounds is one step past the last round** instead of unreachable.

## Aug 2026 — leaderboard player picker

The dropdown IS a mini leaderboard: a right-aligned **position rail** (one
badge per tie group) beside wrapping player chips (name + colored score), a
search-the-field typeahead (arrows/Enter/Escape), a **"Missed cut · WD"**
divider with dimmed chips, sticky-scroll to the current pick, backed by the
hidden `<select>`. Each chip carries a **daily-progress slot**: tee time
before they're out, "thru N" mid-round, "F ‹strokes›" once done.

## Aug 2026 — proximity vs expectation

First-putts views judge each shot on its own curve instead of conflating
approach play with chipping:

- "Had" classifies as **approach** (full shot, >30y) vs **greenside** (feet);
  greenside hads render in sand.
- Proximity color/glyph = **vs tour-average proximity from that distance &
  lie** (static baselines in `static/js/format.js`: `APPR_BANDS` × lie
  multipliers): ▴ ≤0.65× the average, ▾ ≥1.8×; tooltips show the expected
  number. Replaced score-coloring (score stays in the Result pill/tooltips).
  Long bands corrected upward (250→46, 275→58, 275+→72 ft) so a 46-footer
  from 285y rates ▴.
- Split averages ("after approaches X ft · greenside Y ft") in the daily
  summary and an all-rounds strip.
- Quality ink got its own tokens (`--prox-hot/cold`) + glyphs — never
  color-alone, and fixes green-number-on-green-tint legibility.

## Aug 2026 — modularization + GitHub

- Front end split from a 1,300-line `index.html` into `static/css/fairway.css`
  + native ES modules under `static/js/` (dom, icons, theme, format, state,
  api, `pickers/`, `views/`, main). **Deliberately no bundler/framework** —
  browsers load `<script type="module">` natively; circular imports
  (api ↔ pickers) are safe because cross-calls happen at event time.
- Missed-putt tiles show **what the putt was for** ("for Par" / "for Birdie" =
  stroke index + 1 vs par) instead of the hole's final score, which moved to
  the tooltip.
- Published: https://github.com/grahamsinger/quick-look-golf
