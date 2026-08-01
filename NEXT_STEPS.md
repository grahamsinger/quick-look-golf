# Next steps / open threads

Ideas discussed but not built, and things to verify. Nothing here is broken —
these are optional improvements.

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
- **Freshness bar consolidated** into the top-right of the view-toggle row
  (replacing the redundant "Loaded round…" status); with the earlier compression,
  the daily scorecard now fits all 18 holes without scrolling.

Still open (design):
- **Player & round dropdowns → custom comboboxes** — both are still native
  `<select>`s that render the raw OS list, which looks jarring next to the styled
  tournament combobox. Give them the same treatment (share the combobox
  component/CSS): the **player** picker searchable/typeahead over the 144+ field
  (keep the position + score, open sticky to the current pick, LIVE-style
  affordances as fitting); the **round** picker a small styled menu matching the
  combo (no search needed for 5 items). This is a clear, high-impact polish win.
- Responsive / mobile layout.

## Possible improvements
- **"Had" for scrambles** — when a player misses the green and chips on, *Had*
  shows the chip distance (in feet), because "the shot that set up the putt" is
  the chip. Optional: separately surface the *approach into the green* distance.
- **Back-button history** — URL state uses `history.replaceState` (no history
  entries). Switch to `pushState` if stepping back through selections is wanted
  (tends to feel noisy, so left off).
- **Server-Timing** — the load-time indicator is browser wall-clock; could add a
  `Server-Timing` header to split "server N ms / total M ms".
- **Spatial shot viz (needs the hole image)** — the abstract shot-trail SVG plots
  were removed (meaningless without the course underneath). Any future spatial
  view must overlay the real hole image (`holeDetails` "pickle" assets) behind the
  shot paths; do not reintroduce bare plots without it.
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
