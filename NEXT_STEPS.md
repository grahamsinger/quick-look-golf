# Next steps / open threads

Ideas discussed but not built, and things to verify.

## Known bugs
(none currently — the round-label desync on the no-data fallback was fixed
Aug 2026: the fallback now calls `syncRoundBtn()` after writing
`$('round').value`, verified against the live-event repro.)

## To do
- **Push to GitHub** — planned (do `gh repo create`, decide public/private).
  Note `pga/client.py` contains pgatour.com's *public* front-end API keys
  (scraped from their JS), not personal secrets — safe to publish.

## Design refresh — v1 shipped (Fairway theme, Jul 2026)
Implemented the **"Fairway"** light editorial identity (replaces the generic
dark-slate + green look):
- Warm paper palette + deep pine ink + sand / flag-red accents. Score & status
  colors validated for colorblind-safety (`dataviz` skill's validator).
- Self-hosted **Fraunces** variable display serif (`static/fonts/`) for the
  wordmark, hole numbers, and headings; system sans for UI; tabular figures for
  data.
- Custom **flag wordmark + favicon** (`static/favicon.svg`); tab title leads with
  "Fairway". Real inline-SVG icons replace the emoji (🔗 / ↻ / ↗).
- Daily first-putts view is now a **front/back scorecard** (Out | In side by
  side) — all 18 holes visible without scrolling.
- "Made" column renamed **Putts** (shows the putt count; green = 1-putt).
- **Shot trails removed** — the abstract SVG plots were meaningless without the
  course underneath. The view was reframed as **"Shots"** (shot-by-shot
  play-by-play + TrackMan/ball-speed numbers, no plot).
- **Dark mode** — a warm "clubhouse at dusk" palette (its own CVD-validated
  steps, not a flip), a header sun/moon toggle, persisted to `localStorage`,
  initialized from the system preference with a no-flash inline script. All tint
  fills are tokenized (`--tint-good` etc.) so both themes share one ruleset.
- **Round prev/next arrows** flanking the Round picker — step through a
  tournament's days; disabled at the bounds (round 1 / the latest played round).
- **5 shortest missed putts** — a daily-view panel of the shortest putts the
  player *didn't* convert (server derives it in `/api/putts` as `shortestMissed`;
  a "miss" = any green stroke that wasn't the holed one, length = the prior
  stroke's `distanceRemaining`, so short 2nd/3rd putts rank correctly).
- **"Data current as of" now reflects true capture time** — the server stamps
  `fetchedAt` when it pulls from PGA and returns it (`X-Data-Fetched-At` header);
  the browser shows that instead of its own fetch time, so a cached completed
  round shows a stable capture time, not "now" on every load.
- Off-green hole-outs read **"holed out"** (single line, keeps the nines
  symmetric); the **starting hole** is marked with a tee flag + noted in the summary.
- **Shots view → comparison matrix** — rows = holes (play order), columns = shot
  number, so a column reads straight down for comparison (e.g. every tee-shot
  ball speed). Each cell = ball speed (full swings) or distance (putts/chips)
  over the color-coded result location; par-3 tee shots flagged.
- **Round picker → styled dropdown** — a custom menu (matches the tournament
  combobox) over a hidden `<select>`; shows only rounds with data (1..current) and
  omits "All rounds" in the Shots view (per-round only). Selecting a round or using
  the ‹ › arrows loads immediately.
- **Freshness bar consolidated** into the top-right of the view-toggle row
  (replacing the redundant "Loaded round…" status); with the earlier compression,
  the daily scorecard now fits all 18 holes without scrolling.
- **All-rounds tournament putting stats** — "feet of putts made" per round + a
  tournament total (ShotLink stat: the length of every putt holed; a 2-putt
  contributes the tap-in, not the lag), and the **5 shortest missed putts across
  the tournament** (round-tagged). Server returns each round's top-10 misses +
  `madePuttFeet`; the client aggregates.

- **Player picker → leaderboard panel (v1, Aug 2026)** — the user's design: the
  dropdown IS a mini leaderboard. A two-column grid: a right-aligned **position
  rail** (one badge per tie group — who's tied reads instantly) | that group's
  player chips (name + colored score) wrapping to the right. Search-the-field
  typeahead on top (arrows/Enter/Escape work), a **"Missed cut · WD" divider**
  with dimmed chips below, opens sticky-scrolled to the current pick, backed by
  the hidden `<select>` so deep links/labels flow unchanged. Each chip carries a
  **daily-progress slot** right of the score: tee time before they're out,
  "thru N" mid-round, "F ‹strokes›" once done (from `scoringData`'s
  thru/teeTime/rounds via `/api/leaderboard`).
- **Robustness pass (Aug 2026)** — per-key fetch lock + 30s TTL on in-progress
  rounds (the parallel shots+putts load no longer double-hits PGA; live
  view-flipping reuses one capture); a stale-response guard in `loadShots`
  (rapid round-stepping can't paint old data over new); API-key rotation
  self-healing in the client (on 401/403 it re-scrapes keys and retries);
  `esc()` on all API strings hitting innerHTML; round menu keyboard nav;
  dead `radar` param removed.

- **Proximity vs expectation (Aug 2026)** — the first-putts views now judge each
  shot on its own curve instead of conflating approach play with chipping:
  - "Had" classifies as **approach** (full shot, >30y) vs **greenside**
    (chip/pitch — ShotLink reports those in feet); greenside hads render in
    sand so the two are tellable at a glance.
  - The proximity number's color/glyph = **vs tour-average proximity from that
    distance & lie** (static baseline table in the client: distance bands ×
    fairway/rough/sand multipliers): ▴ = well inside the average (≤0.6×),
    ▾ = well outside (≥1.8×). Tooltips show the expected number. This replaced
    score-coloring the number (score lives in the Result pill / cell tooltip) —
    a 46-footer after a 285y approach no longer glows green just because the
    eagle putt dropped, and a 2.4-from-107y lights up even on a par.
  - Split averages: "avg 1st putt after approaches X ft · greenside Y ft" in
    the daily summary line and as a strip on the all-rounds view.
  - Contrast fix: quality ink uses its own tokens (`--prox-hot/cold`, deeper
    than `--good` in light, brighter in dark) + a ▴/▾ glyph so the signal is
    never color-alone — resolves green-number-on-green-tint illegibility.
  - Baselines are approximations; tune `APPR_BANDS`/lie multipliers in
    `static/index.html` if they feel off. Tier 3 (per-round "strokes gained
    vs expected" tallies from expected-putts tables) is a possible follow-on.
- **Round arrows walk the picker order (Aug 2026)** — ‹ › now step
  R1 → … → Rmax → All rounds (when the view offers it), so All rounds is
  reachable by arrow; ends disable at the sequence bounds.

Still open (design):
- Responsive / mobile layout.
- Player picker refinements as they come up (density, maybe headshots?).
- **Strokes-gained-style tallies (tier 3)** — per-round "hit it X ft better
  than expected per approach · gained ~Y putts vs expected" using embeddable
  expected-putts baselines; do after living with the ▴/▾ coloring for a while.

## Possible improvements
- **"Had" for scrambles** — when a player misses the green and chips on, *Had*
  shows the chip distance (in feet), because "the shot that set up the putt" is
  the chip. Optional: separately surface the *approach into the green* distance.
- **Back-button history** — URL state uses `history.replaceState` (no history
  entries). Switch to `pushState` if stepping back through selections is wanted
  (tends to feel noisy, so left off).
- **Server-Timing** — the load-time indicator is browser wall-clock; could add a
  `Server-Timing` header to split "server N ms / total M ms".
- **Spatial shot viz — now feasible (hole imagery located, Aug 2026).** The
  abstract shot-trail SVG plots were removed (meaningless without the course
  underneath); any spatial view must overlay real imagery. Findings:
  - **The winner: TOURCAST's static asset host, no auth.**
    `https://tourcast.pgatour.com/models/{tournamentId}/3D_Assets/terrain/course.jpg`
    is a 2048×2048 aerial of the whole course (verified for R2026524), with
    `course.tfw` (a world file — the affine pixel→world transform; its pixel
    size appears scaled to a ~70k×91k full-res source) and `extents.txt`
    alongside. Our cached `shotDetailsV3` strokes already carry
    `overview.leftToRightCoords` `tourcastX/Y` — same coordinate space. So:
    crop the aerial per hole and plot strokes over it. (Same dir has greens
    textures, tree sprites, 3D models if ever wanted.)
  - Dead ends, verified: `holeDetails(tournamentId, courseId, hole)` (courseId
    from `courseStats`) returns Cloudinary "pickle" URLs
    (`pga-tour-res.cloudinary.com/.../holes_2026_r_524_947_overhead_full_15.jpg`)
    that **404** (deprecated in-schema), and `ImageAsset {imageOrg, imagePath}`
    whose imgix guesses **410**. `holeImage` (a course *photo*, not overhead)
    does resolve on `res.cloudinary.com/pgatour-prod`.
  - `holeDetails` also returns per-hole scoring stats (`statsSummary`: birdie% etc.
    + `rank`) — could power a "hole difficulty" strip even without the viz.
- **Live subscriptions** — the schema exposes `OnUpdate*` subscriptions over
  `orchestrator-ws.pgatour.com/graphql`; could stream live updates instead of
  manual refresh.
- **Cache leaderboard/schedule** — currently uncached; a short TTL (leaderboard
  ~30–60s, schedule ~hours) would offload the API further.
- **Simplify client cache** — the in-browser `Map` is largely redundant with the
  loopback Redis layer; could drop it.

## To verify
- **Historical depth** — how far back `shotDetailsV3` resolves for old seasons is
  unverified (recent/current events confirmed working).

## Reminders / gotchas
- Unofficial API, undocumented, governed by pgatour.com ToS — rate-limit, cache,
  don't hammer it. Keys rotate; `PGATourClient.discover_keys()` re-scrapes them.
- Coordinates are `tourcast`/`enhanced` space (raw ShotLink x/y are redacted).
- `CACHE_VERSION` is now `v2` — the cache wraps the payload as `{fetchedAt, data}`.
  Bump it only if that stored shape changes; derived fields (`approachHad`,
  `shortestMissed`) are computed per request and don't need a bump.
