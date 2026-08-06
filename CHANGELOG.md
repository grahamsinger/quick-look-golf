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

## Aug 2026 — Course view (spatial shot viz)

The round drawn over the tournament's real aerial — the feature the removed
"shot trails" always wanted to be:

- Reverse-engineered the exact TOURCAST projection (verified ~1 m: pins land
  on greens): shot `tourcastX/Y` are **feet**; `world_m = 0.3048 × tourcast −
  offsetConfig` (from `orchestrator-config.pgatour.com/tourcast/pga-tour/{tid}`),
  then the `course.tfw` world-file affine maps meters → the 2048² aerial.
  The config's `rotate` is **not** applied to shots — it orients the whole 3D
  scene (terrain + shots together), so it cancels relative to the aerial;
  verified by Kabsch fit at TPC Twin Cities (rotate −0.157 rad in config,
  fitted rotation ≈ 0, translation = −offset within 30 cm).
- New `/api/coursemap` bundles tfw + offset + `courseData.json` pin/tee
  positions (Redis-cached, static per tournament); the aerial hotlinks in an
  `<img>` with an SVG overlay on top.
- New **Course** tab: 18 trails tee → hole, shot dots with tooltips,
  score-colored hole chips, hover-a-hole isolation. Per-round (like Shots).
  Events without TOURCAST assets (small opposite-field ones) fall back to a
  friendly message.

## Aug 2026 — Course hole zoom

Click a hole on the course overview to zoom into that hole's own aerial:

- Per-hole assets: `terrain{NN}.jpg` (4096², squashed) + `terrain{NN}.tfw`.
  Unlike `course.tfw`, the per-hole world files carry **rotation terms** (each
  hole's image is oriented tee-at-the-bottom, green-at-the-top), so the
  projection uses the full 6-term affine inverse. The squashed jpg un-squashes
  by rendering the wrap at the tfw's true full-raster aspect ratio with the
  SVG viewBox in the same space. New `/api/holemap` proxies the world file
  (Redis-cached, static per tournament).
- The hole view's round picker offers **"All rounds"** — the player's trails
  from every round overlaid, color-coded (R1 paper · R2 amber · R3 sky ·
  R4 rose; adjacent-pair CVD separation validated) with a legend carrying each
  round's score on the hole. Hovering a trail isolates that round. Identity is
  never color-alone: legend, tooltips (`R2 #3 · …`), and hover all name the
  round.
- ‹ › steps through holes, "‹ Full course" zooms back out (snapping "All
  rounds" back to the latest played round, which the overview requires), and
  `?h=` in the URL deep-links straight into a hole.
- **Hole zoom v1.1 (UI pass):** the hole renders **horizontal on desktop**
  (tee left → green right, like a hole diagram; vertical on narrow viewports,
  re-rendered on resize). The per-hole world files don't guarantee a
  direction, so the tee/pin projections decide the rotation — one SVG group
  transform rotates the aerial and all trails together (the `<img>` was
  replaced by an in-SVG `<image>` so everything shares one space). Round
  colors are now reserved for the all-rounds overlay (single round = the
  classic white trail), marks got zoom-scale weights, and the card hugs the
  aerial.

## Aug 2026 — non-stroke rows (DROP / PENALTY / PROVISIONAL)

ShotLink interleaves non-swing rows in `strokes[]` (`HoleStrokeType`), which
had two symptoms once found in the wild:

- **Shots matrix counted a drop as a shot** (an eagle 3 read as 4 shots).
  Non-STROKE rows now become markers on the next swing (ᴰ drop, ᴾ penalty,
  ᴾⱽ provisional) with the play-by-play in the tooltip; penalties count on
  the score, not as columns.
- **"Shortest missed" mislabeled what a putt was for** after a water ball —
  the array index over-counted past PENALTY/DROP rows, so a missed bogey
  putt said "for Double Bogey". The label now uses the feed's own
  `strokeNumber`.

## Aug 2026 — per-player round options

Fixed: the round ‹ › arrows walked the *tournament's* rounds, so for a player
whose last played round was behind the field (missed cut, or not yet teed off
in the current round) the › arrow stepped into a data-less round, the no-data
fallback snapped it straight back, and **"All rounds" was unreachable**. The
round picker now builds its options from the *selected player's* leaderboard
strokes list (plus their in-progress round), so the arrows only walk rounds
that exist for that player and "All rounds" is always one step past their
last one. Options rebuild on every player switch; a selected round past the
new player's last one clamps down to it.
