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

## Aug 2026 — self-calibrating course offset

Sedgefield (Wyndham) shipped an `offsetConfig` that was **~72 m wrong** —
trails started on houses and putts ended a green short (first course where
the config didn't match reality; Detroit was right to ~2 m, 3M to ~16 m).
The Course view now **self-calibrates**: every holed-out shot is a
ground-truth anchor (it ended in the cup, beside that hole's marked pin in
courseData), so the median implied offset across a round's holes gives the
true translation, robust to daily pin moves. The config is overridden only
when it disagrees by more than pin noise can explain (25 m). Verified: a
Kabsch fit over 72 anchors confirms rotation still cancels (≈1°) — the
error is pure translation — and 3M/Detroit keep their configs.

On such courses a **per-hole refinement** kicks in for the hole zoom: no
global transform (even a full affine over 144 anchors — rms stays ~9 m)
explains Sedgefield's remaining error, which varies per hole (2–18 m,
enough to put a holed putt off the green) **and along a hole** (a uniform
per-hole shift that fixed a green pushed that hole's tee off its box).
Both ends have ground truth — stroke 1 starts at the marked tee, the
holed-out shot ends beside the marked pin — so the correction blends the
two median deltas linearly along the tee→pin axis. Round-to-round cup
differences survive, corrections are capped at 40 m, and courses whose
config checked out are left untouched — their data is ground truth.

## Aug 2026 — play-by-play under the hole aerial

The hole zoom shows the feed's own shot-by-shot verbiage beneath the
aerial — per-round columns (swatch-labeled in all-rounds mode) with
numbered strokes ("174 yds to right green, 49 ft 8 in. to hole"), and
drops/penalties as unnumbered muted lines, like the Tour's own panel.

## Aug 2026 — green view (hole zoom)

"On the green" panel beside the play-by-play: the hole aerial windowed
~48 m around the marked pin, showing each round from the shot that found
the green through every putt, at putt scale. No new data or imagery —
investigation showed the main site's green view plots the same tourcast
points (`green.*` coords equal `overview.*`; its `enhancedX/Y` normalize
to a long-dead crop asset, and no green imagery/polygons exist on the
asset host anymore), so we window our own aerial through the same
projection, corrections, and rotation as the big view.

## Aug 2026 — manual per-hole nudge (hole zoom)

Auto-calibration can only be as accurate as the course model's marked
tee/pin points, and those are themselves off by ±10–15 m on the odd hole
(Sedgefield 16's marked tee sits a box left of where they played). An
**adjust** button in the hole bar lets you drag the aerial to slide that
hole's trails into place; the drag is unwound through the display rotation
and the hole world-file back to world meters and saved per (tournament,
hole) in localStorage — it re-applies on every visit, on top of the
automatic corrections, with a **reset** to clear. Also: JS/CSS now ship
`Cache-Control: no-cache`, so deploys can't leave the browser running
half-old modules (stale trails after an update were exactly that).

## Aug 2026 — durable cache tier (SQLite under Redis)

A machine reboot emptied the shared local Redis (its snapshot policy and
lifetime aren't the app's to control), silently discarding every cached
tournament. Immutable cache entries — final rounds, course/hole maps — now
also write to `data/cache.sqlite`; a Redis miss reads through to SQLite,
backfills Redis, and preserves the original `fetchedAt` (so "data current as
of" stays the true capture time across reboots). Live 30-second entries stay
Redis-only, and both tiers degrade gracefully.

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

## Aug 2026 — course stats for the week (Course view)

How the field played each hole, from the `courseStats(tournamentId)` GraphQL
query (the site's Course Stats tab — new `/api/coursestats` proxy):

- **Overview table** under the full-course aerial: par, yards, scoring
  average, to-par diff (colored over/under), difficulty rank, and
  eagle→double-bogey counts per hole, with OUT/IN/TOTAL rows. Pills switch
  between **All Rounds** and each round's block (per-round yardages show
  moved-up tees); clicking a row zooms that hole. Events with stats but no
  aerial still get the table.
- **Hole zoom strip** under the nav bar: the same numbers for the open hole,
  following the trail selection (all-rounds overlay → All Rounds block,
  single round → that round's block).
- Caching matches the rest: durable (Redis + SQLite) once rounds 1–4 all
  have a non-live block, 30 s TTL while the week is still moving.
- **T+ ("others") column derived**: the API's buckets stop at double bogey,
  but every finished hole lands in exactly one bucket — so a completed
  round's field size = the max bucket-sum across its holes, and each hole's
  shortfall is triples+. Derived per round (cuts handled — each round
  carries its own field size), All Rounds sums the rounds; blank ("–") for
  a live round, where unreached holes would masquerade as others.

## Aug 2026 — Field view (hole-by-hole running score)

A fourth view: the whole field's round as the classic race chart (rows =
players, columns = holes 1–18). Each cell is the player's **cumulative
tournament score to par through that hole**, colored by what they scored ON
the hole (eagle+ / birdie / bogey / double+), so the round's story — charges,
collapses, lead changes — reads left to right.

- Data: new `/api/holebyhole` over `leaderboardHoleByHole(tournamentId,
  round)` — every player's numeric per-hole score in one query (found while
  verifying the course stats). The server adds each player's cumulative
  to-par *entering* the round, summed per-hole from the earlier rounds'
  cached scorecards (multi-course weeks use each card's own pars).
- Rows ordered by standing at the end of that round, tie-aware positions,
  par row + sticky header/name columns, round strokes + to-par at the right;
  the selected player's row is highlighted and clicking a row selects that
  player app-wide. Field members who didn't play the round are dropped.
- Caching: a round is durable once every scorecard is complete (or the
  tournament has moved past it); partial cards — live play or an overnight
  suspension — keep the 30 s TTL, and the client re-fetches a live payload
  every 30 s while showing the previous snapshot.
- The Field view is per-round ("All rounds" leaves the picker, like Shots);
  its round options cover the tournament, not the selected player, and the
  no-data player fallback no longer yanks the round picker while in it.
- **Live rounds read like a real leaderboard**: field members who haven't
  teed off get normal rows *in* the grid at their current standing — empty
  cells with "tees off ‹time›" across the middle and their tournament total
  in the last column — interleaved with the players on the course (everyone
  sorts by current total). Cut/WD players are excluded; before a round
  starts the view is the whole tee sheet in standings order. Mid-round rows
  show just their running to-par in the Rd column (strokes are "-" until
  the card is signed).

## Aug 2026 — Course overview: stats lead, the aerial collapses

The overview now opens with the course-stats table; the big aerial sits
below it behind a "Course map" toggle (open by default, the choice kept in
localStorage). Hole-click zoom and the stats-row zoom both still work.
- **Favorites**: a ★ on every Field row (visible on hover) pins that player
  to the top of the grid, above a divider, keeping their real position.
  Stored once per browser in localStorage (player ids are stable), so
  favorites follow you from tournament to tournament. Toggling never
  changes the selected player.
- **Rd / Tot columns**: the right edge was one column meaning "round score"
  for players on the course but "tournament total" for those yet to start.
  Now two honest columns — Rd (strokes + round score once playing) and Tot
  (cumulative tournament score for everyone, matching the last filled cell).
- **Click a row → inline scorecards**: expanding a player shows one sub-row
  per round under their row — raw score on every hole, colored by result,
  with Rd (that round) and Tot (cumulative through it) in the end columns.
  Clicking again collapses; the click still selects the player app-wide.
  Rounds come from the same cached per-round payloads, so it's free.
- **No more page-blank on row click**: selecting a player from the grid
  used to tear the view down while their shot data loaded (and the page
  collapse threw the scroll back to the top). The expansion now opens
  instantly from the field's own cache — spinner sub-rows cover rounds
  still fetching — while the player's shots load in the background
  (`loadShots({background})` keeps the view up), and re-renders restore
  the grid's scroll position (live refreshes stop jumping too).
- **Expansion polish**: sub-rows run newest round first and skip the round
  being viewed (the main row already shows it — cell colors are its
  scores, Rd its total), and an expansion no longer follows the player
  into a different tournament's grid.
- **Complete rounds join the stack**: once the expanded player's card for
  the viewed round is signed (18 holes), it appears as a full raw-score
  sub-row like the others — the skip only applies mid-round, when it
  would duplicate the live main row.
- **One scroller**: the grid no longer scrolls inside a scrolling page —
  on wide screens it runs full length, the page is the only scrollbar,
  and the header + par rows stick just under the topbar (offsets overlap
  2px: fractional-pixel seams between stacked sticky rows bleed).
  Narrow screens keep the contained scroll for its horizontal axis.
- **Live data actually stays live**: the leaderboard snapshot behind the
  player picker was fetched once per tournament, so its "thru N" aged all
  day; and the grid's 30 s staleness check only ran when something else
  triggered a render — an idle page never updated. Now a live Field view
  runs a real ~30 s cycle (holebyhole + a quiet leaderboard refresh that
  keeps the selection and repaints an open picker), and opening the player
  picker on a live event refreshes the board too (30 s debounce,
  in-progress tournaments only).

## Aug 2026 — season dropdown

The free-text season box became a styled dropdown (same pattern as the
round combo: hidden select, button, keyboard-navigable menu). Seasons run
from the current year back to 2012 — the earliest the schedule API has
data — and the newest season appears automatically each January.

## Aug 2026 — cache admin page

`/admin` (also linked from the topbar as "Cache"): an inventory of both
cache tiers grouped by tournament — player rounds (shot-detail captures),
field rounds, hole-map coverage, course map/stats flags, payload size, and
last capture time, with totals up top (Redis health, SQLite file size,
entry count). Tournament names resolve through the schedule; a "live"
chip marks short-TTL Redis-only payloads from in-progress play. Backed by
the new `/api/cachestats`, which rolls the inventory up from the
structured cache keys without reading any payloads.

## Aug 2026 — season downloads + admin year grouping

- The admin table is **grouped by season into collapsible year sections**
  (newest open by default; toggles remembered in localStorage). Rows within
  a season sort in calendar order via the schedule; the per-row Season
  column is gone.
- **Download a season**: `POST /api/bulkload?year=` walks every completed
  event in the year and warms the field-facing caches — hole-by-hole
  scorecards for each played round (round 1's `currentRound` says how many),
  the course-stats table, and the aerial assets (course map + 18 hole world
  files). Shot-level detail stays on-demand (~600 queries/event is the
  reason). Four tournaments run concurrently, each pacing its own upstream
  calls; cache hits skip the pause, so re-running a season is a cheap
  fill-in-the-gaps pass. One job at a time (409 otherwise), `GET` polls
  progress, `DELETE` cancels after the fetches in flight. The admin page
  drives it: a season picker + per-year buttons, a live progress line
  (n/total + the events in flight), stop, and a per-event report; it also
  picks up a job already running from another tab.
- Fixed a durability blind spot the season walk exposed: a **mid-round WD
  in the final round** leaves a permanently partial scorecard with
  `currentRound == round`, so that round could never pass the
  holebyhole cache-finality heuristic — it sat on the 30 s TTL forever
  (the 2025 Sentry's R4 showed up as an eternal "live" chip). The bulk
  loader only walks completed tournaments, so it now passes
  `final_hint=True` and pins those rounds durable.
- **The schedule is cached now** — durable for past seasons (immutable in
  practice; `refresh=true` busts), 10 min TTL for the current one. Keyed
  `schedule:{year}:{tour}` so the admin rollup (which groups on R-ids)
  skips it. This is what makes the admin page's name lookups and the
  season walk cheap.
- **Every bulk run is audited** to `data/bulkload.log` (its own file, out
  of uvicorn's noise): per event — rounds fetched vs expected (round 1's
  `currentRound`), per-round player counts (cut patterns readable at a
  glance), a data-integrity cross-check (each full scorecard's summed
  per-hole diff vs the API's own round `toPar` — 0 disagreements across
  ~19k 2025 cards), stats/aerial coverage, and duration; anomalies get
  `!!` WARN flags (missing rounds, tiny fields, toPar disagreements,
  partial aerials, team/match-play events with no individual scorecards)
  and a per-job summary + flagged recap. The same flags surface on the
  admin page after each run. Expected absences (no aerials on an old
  season) aren't flagged — a flag means "look at this one".
- Audit follow-ups: flagged rows carry their **season + a link to the
  event** (log recap lines carry the full R-id), and the report shows
  only while its season is selected in the dropdown — switching back to
  that year brings it back. `coursestats` gained the same `finalHint`
  as holebyhole: its rounds-1-4 finality rule could never fire for
  54-hole weeks or match-play events, so their stats sat on the 30 s
  TTL and the admin inventory flapped by ten rows after every 2013 run.
- With whole seasons loading, the admin page went **full-bleed with
  sticky headers**: the layout uses the full window (the app shell's
  1200px `main` cap is lifted for this page), the page is the only
  scroller, and on wide screens the column header pins under the topbar
  with the current season's header pinned just below it — deep in a
  long inventory you always know the year and the columns. Names get a
  wider ellipsis cap on big screens; narrow screens keep the contained
  horizontal scroll.
