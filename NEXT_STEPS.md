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
- **Cache leaderboard/schedule** — currently uncached; a short TTL (leaderboard
  ~30–60s, schedule ~hours) would offload the API further.
- **Simplify client cache** — the in-browser `Map` is largely redundant with the
  loopback Redis layer; could drop it.
- **Tests** — none yet; `static/js/format.js` (pure: parseHad / expectedProx /
  proxQual) and the server's putt math (`_parse_feet`, miss/made derivation)
  are the natural first targets, with a captured fixture payload.

## To verify
- **Historical depth** — how far back `shotDetailsV3` resolves for old seasons is
  unverified (recent/current events confirmed working).

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
