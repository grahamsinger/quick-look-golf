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
- **Spatial shot viz — SOLVED, ready to build (Aug 2026).** The exact
  shot-to-aerial projection is verified to ~1 m (pins land dead-center on
  greens for R2026524). A new "Course" tab is the plan. The full recipe:
  - **Assets (tourcast.pgatour.com, static, no auth), per tournament:**
    `models/{tid}/3D_Assets/terrain/course.jpg` (2048² whole-course aerial),
    `terrain/course.tfw` (world file), `terrain/extents.txt`, and — better for
    per-hole views — **per-hole** `terrain/terrain{NN}.jpg` + `terrain{NN}.tfw`
    + `terrain/cutouts/{hole}.png` (NN = zero-padded hole). Also
    `data/courseData.json`: `pinsTees` (per hole `[pinX, pinY, teeX, teeY]`,
    world meters) and `holeCenterLines` — enough to compute per-hole crop
    boxes and orientation.
  - **The transform** (extracted from the TOURCAST app + its config API):
    1. `world_m = 0.3048 × tourcast − (offset.x, offset.y)` (tourcast coords
       are in feet; rotate by `offset.rotate`, 0 for this course), where the
       offset comes from
       `https://orchestrator-config.pgatour.com/tourcast/pga-tour/{tid}` →
       `offsetConfig` (R2026524: x=3249.955441, y=3050.01224).
    2. `world → pixels` via the tfw (standard world-file affine):
       `px = (worldX − C)/A`, `py = (F − worldY)/|E|` with A=E=0.0185831 m/px,
       (C, F) = top-left; scale full-res (69956×91481) → the 2048² jpg.
    3. Strokes' `overview.leftToRightCoords.{from,to}Coords.tourcastX/Y` are
       already in our cached payloads. (`enhancedX/Y` is a normalized 0–1
       per-hole-pickle space — ignore; plain `x/y` are redacted −1.)
  - Serve config/tfw/courseData through our server (proxy + Redis cache,
    they're static per tournament); the jpg can hotlink in an `<img>` (SVG
    overlay on top — no canvas pixel access, so CORS is a non-issue).
  - Dead ends, verified: `holeDetails` Cloudinary "pickle" URLs **404**,
    `ImageAsset` imgix guesses **410**; `holeImage` (a *photo*) resolves.
    `holeDetails.statsSummary` (birdie% etc. + rank) could power a
    hole-difficulty strip.
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
