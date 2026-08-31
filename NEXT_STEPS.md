# Next steps / open threads

Ideas discussed but not built, and things to verify. Shipped work is in
`CHANGELOG.md`.

## Known bugs
(none currently)

## Open (design)
- **Responsive / mobile layout.**
- **Player picker refinements** as they come up (density, maybe headshots?).
- **Strokes-gained-style tallies (tier 3)** — per-round "hit it X ft better
  than expected per approach · gained ~Y putts vs expected" using embeddable
  expected-putts baselines; do after living with the ▴/▾ coloring for a while.
- **Proximity baselines are approximations** — tune `APPR_BANDS` / lie
  multipliers / the 0.65×–1.8× thresholds in `static/js/format.js` if ▴/▾
  feel too generous or stingy over time.

## Possible improvements
- **Non-standard formats need support** (surfaced by the 2025 season
  download; today they just show "—" for field rounds): the **Ryder Cup**
  (match play — no stroke-play scorecards in `leaderboardHoleByHole`; the
  schema has separate match-play types worth exploring) and the **Zurich
  Classic** (two-man teams — the individual-keyed holebyhole comes back
  empty; team scorecards likely live under a team variant of the query).
  The **Grant Thornton Invitational** (mixed PGA/LPGA teams) already works
  as a 3-round event, and 54-hole weather weeks are handled (round 1's
  `currentRound` caps the walk). Presidents Cup years will hit the
  match-play gap too.
- **Course view ideas** (overview + per-hole zoom shipped — see CHANGELOG;
  projection recipes documented there and in `static/js/views/course.js` /
  `/api/coursemap` / `/api/holemap`):
  - **Full-field per-hole overlay** — round-by-round, every player on one
    hole, rendered into the existing hole zoom. **The data problem is
    already solved**: the schema's
    `scatterData(tournamentId, course, hole)` returns, in ONE query, every
    player's shot locations for ALL rounds of that hole — grouped by stroke
    number, with player name, hole result (BIRDIE/PAR/…), tourcast coords
    (same space as our projection; use
    `shotCoords.overview.landscapeCoords.tourcastX/Y`), and each round's
    pin position. Verified live (hole 15 R2026524: ~280 shots/round). So:
    no separate storage — just a `/api/scatter` proxy cached in Redis like
    everything else (permanent once the tournament completes, short TTL
    live). Render as **ending-location dots** (not trails) colored by
    result, with a stroke-number filter (stroke 1 = driving dispersion,
    stroke 2 on a par 4 = approach scatter); the per-round pin makes
    "vs that day's pin" readable. `scatterDataCompressed` exists too
    (base64-gzip `payload`, `pga.decode_payload` already handles it) if
    the raw query gets heavy.
  - Shot dots could encode result quality (colors from the shots matrix).
  - Multi-course events (e.g. AmEx) may need per-courseId `courseOffset`
    from the config (the app supports a `courseOffset` array), and
    `scatterData` takes a `course` arg — get courseId from `courseStats`.
  - `holeDetails.statsSummary` (birdie% + rank) could power a hole-difficulty
    strip on the aerial.
- **Live refresh for the per-player views** — the Field view now has a real
  ~30 s background cycle (see `scheduleLiveRefresh` in
  `static/js/views/field.js`) and `loadShots({background})` exists; wiring
  First putts / Shots / Course to the same pattern during a live round is
  the natural extension (offered, not yet requested).
- **Field view follow-ons** — "who made those?" (name the players behind a
  course-stats cell via `leaderboardHoleByHole`); color a player's scorecard
  by how the field played each hole that day; auto-load on tournament switch
  (today it's pick-then-Load, long-standing behavior).
- **Admin page actions** — the inventory is read-only (the season download
  is the one write path); purge-per-tournament buttons would be a small
  addition if wanted. A "download everything 2012–now" convenience loop is
  trivial on top of `/api/bulkload` too.
- **Bulk-download depth** — the season download deliberately skips
  shot-level detail; an opt-in "also fetch shot details for the top N
  finishers" tier is possible if browsing old events' Course view matters.
- **"Had" for scrambles** — when a player misses the green and chips on, *Had*
  shows the chip distance (in feet), because "the shot that set up the putt" is
  the chip. Optional: separately surface the *approach into the green* distance.
- **Back-button history** — URL state uses `history.replaceState` (no history
  entries). Switch to `pushState` if stepping back through selections is wanted
  (tends to feel noisy, so left off).
- **Server-Timing** — the load-time indicator is browser wall-clock; could add a
  `Server-Timing` header to split "server N ms / total M ms".
- **Live subscriptions** — the schema exposes `OnUpdate*` subscriptions over
  `orchestrator-ws.pgatour.com/graphql`; could stream live updates instead of
  manual refresh.
- **Cache the leaderboard** — still uncached (the schedule is cached now:
  durable for past seasons, 10 min for the current); a ~30–60s TTL on
  `/api/leaderboard` would offload the API further during live play.
- **Simplify client cache** — the in-browser `Map` is largely redundant with the
  loopback Redis layer; could drop it.
- **Tests** — none yet; `static/js/format.js` (pure: parseHad / expectedProx /
  proxQual) and the server's putt math (`_parse_feet`, miss/made derivation)
  are the natural first targets, with a captured fixture payload.

## To verify
- **Historical depth** — `shotDetailsV3` verified back to **2019** (full R4
  card for the 2019 TOUR Championship); the schedule API has seasons back to
  **2012** (empty before — the season dropdown starts there). How far back
  shot-level data actually resolves between 2012–2018 is untested.

## Reminders / gotchas
- Unofficial API, undocumented, governed by pgatour.com ToS — rate-limit, cache,
  don't hammer it. Keys rotate; the client now self-heals on 401/403
  (`PGATourClient.discover_keys()` re-scrapes), so a dead key no longer needs a
  restart.
- Coordinates are `tourcast`/`enhanced` space (raw ShotLink x/y are redacted).
- `CACHE_VERSION` is `v2` — the cache wraps the payload as `{fetchedAt, data}`
  (no expiry when final; 30s TTL while in progress). Bump it only if the stored
  shape changes; derived fields (`approachHad`, `shortestMissed`, `forScore`)
  are computed per request and don't need a bump.
- **No build step, on purpose** — front end is native ES modules; don't
  introduce Vite/React unless a real library (e.g. d3) becomes necessary.
- Server changes need `./stop.sh; ./start.sh` (uvicorn runs without --reload).
- Local dir is `golf_api`; the GitHub repo is
  [quick-look-golf](https://github.com/grahamsinger/quick-look-golf).
