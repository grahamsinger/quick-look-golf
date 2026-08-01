# Next steps / open threads

Ideas discussed but not built, and things to verify. Nothing here is broken —
these are optional improvements.

## To do
- **Push to GitHub** — planned (do `gh repo create`, decide public/private).
  Note `pga/client.py` contains pgatour.com's *public* front-end API keys
  (scraped from their JS), not personal secrets — safe to publish.

## Design refresh (comprehensive)
The current UI is functional but visually generic — it reads as an
AI-generated/template dashboard and lacks polish. The data-first look was a
deliberate v1 tradeoff (get the numbers right and the interactions working
first); the UI was not a focus. A future pass should give it a real visual
identity, not just tweaks. Directions to consider:
- Intentional **typography** (a real typeface, type scale, weights) instead of
  system-font defaults.
- A considered **color system** beyond the default dark-slate + green accent —
  something that feels designed, with a proper neutral ramp and accent usage.
- Custom **wordmark / favicon**; drop the emoji-in-buttons (🔗, ↻) for real icons.
- More deliberate **spacing rhythm, density, and alignment** (the controls row,
  cards, and tables currently look like default flexbox scaffolding).
- Chart/table styling with a real data-viz sensibility (see the `dataviz` skill).
- Consider a light theme / theme toggle, and responsive/mobile layout.
This is UI-only — the data model, endpoints, and caching are solid and shouldn't
need to change.

## Possible improvements
- **Player typeahead** — the player dropdown is a plain `<select>` (144+ names);
  give it the same searchable combobox treatment as the tournament picker.
- **"Had" for scrambles** — when a player misses the green and chips on, *Had*
  shows the chip distance (in feet), because "the shot that set up the putt" is
  the chip. Optional: separately surface the *approach into the green* distance.
- **Back-button history** — URL state uses `history.replaceState` (no history
  entries). Switch to `pushState` if stepping back through selections is wanted
  (tends to feel noisy, so left off).
- **Server-Timing** — the load-time indicator is browser wall-clock; could add a
  `Server-Timing` header to split "server N ms / total M ms".
- **Hole diagrams** — overlay the real hole image (`holeDetails` "pickle" assets)
  behind the shot-trail SVGs instead of an auto-fit blank plot.
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
- Bump `CACHE_VERSION` in `pga/server.py` only if the *cached raw payload* shape
  changes — derived fields (e.g. `approachHad`) don't need it.
