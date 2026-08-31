# quick-look-golf

Client and schema tooling for the **unofficial PGA TOUR GraphQL API** — the
backend behind pgatour.com and its TOURCAST shot-tracker, and a free source of
genuine shot-by-shot (ShotLink-derived) data — plus **Fairway**, a local
putting-focused web app for browsing it (light + dark).

> ⚠️ Unofficial, undocumented, and governed by the pgatour.com Terms of Service.
> See [`STATUS.md`](STATUS.md) for the full picture, caveats, and alternatives.

## Browse it (web app)

```bash
./start.sh        # launches FastAPI + uvicorn on http://127.0.0.1:8600
./stop.sh         # shuts it down       (PORT=9000 ./start.sh to override)
```

Runs on **:8600** (deliberately clear of the marathon_training app on :8000).
Uses a local **Redis** at `127.0.0.1:6379` for caching if present; degrades
gracefully to live fetches if Redis is down (`REDIS_HOST`/`PORT`/`DB` override).

Then open:

| URL | What |
|---|---|
| http://127.0.0.1:8600/ | **Shot Explorer** (see below) |
| http://127.0.0.1:8600/graphiql | **GraphiQL** — full-API playground with autocomplete (introspection is on) |
| http://127.0.0.1:8600/docs | **Swagger UI** for the REST convenience endpoints |

### Shot Explorer — "Fairway"

A dependency-free vanilla-JS app — **native ES modules, no bundler or build
step** — with a light **editorial "Fairway" theme** and a **dark mode** —
sun/moon toggle (top right) that remembers your choice and follows the system
default. Self-hosted Fraunces display serif.

- **Controls:** season, a **searchable tournament combobox** (dates + a "LIVE"
  badge on the in-progress event; opens *sticky to the current selection*), a
  **leaderboard player picker** (the dropdown is a mini leaderboard: a position
  rail with one badge per tie group, player chips with colored scores, a
  search-the-field typeahead, and a dimmed missed-cut section; defaults to the
  leader), and round — **‹ ›** arrows step through a tournament's days, or pick
  **All rounds** (the default). Rounds a player didn't play fall back to their
  latest round with data.
- **First putts** (default view):
  - *Single round* — a **Front | Back scorecard** (both nines side by side, all
    18 holes at once): **Hole · Had · Proximity · Putts · Result**, where *Had* =
    distance to the pin before the approach, *Proximity* = how close the first
    putt finished, *Putts* = putts taken (green = 1-putt, red row = 3-putt+). A
    hole finished from off the green shows **"holed out."**
  - A **Shortest putts missed** panel — the five shortest putts the player didn't
    convert that round (a "miss" is any putt that wasn't the holed stroke, so a
    short comeback 2nd/3rd putt ranks correctly).
  - *All rounds* — a **front/back matrix** (nines side by side): each cell shows
    proximity (big) over the had-distance (small), colored by score.
- **Shots** view: a per-hole comparison matrix — rows = holes in play order,
  columns = shot number (ball speed on full swings, color-coded results).
- **Course** view: **every shot of the round drawn over the tournament's real
  aerial** (TOURCAST's georeferenced imagery; shots projected to ~1 m). Trails
  run tee → hole, hover a hole to isolate it, hole chips are score-colored.
  **Click a hole to zoom** into its own high-res aerial — per-round, or
  **"All rounds"** with the player's trails from every round overlaid and
  color-coded (tee-shot dispersion at a glance). Available for
  ShotLink-enhanced events (most of the schedule); smaller opposite-field
  events don't publish the imagery and fall back gracefully.
  - **Course stats for the week** lead the view (the aerial sits below them,
    collapsible, the choice remembered): per hole — par, yards,
    scoring average, to-par diff, difficulty rank, and
    eagle/birdie/par/bogey/double counts plus a derived **T+ "others"** column
    (triples or worse), with OUT/IN/TOTAL rows and pills for
    **All Rounds** or any single round (per-round yardage shows moved-up
    tees). Click a row to zoom the hole; the hole zoom shows the same numbers
    for the open hole in a **field strip** that follows the round selection.
- **Field** view: the whole field's round as the classic **race chart** —
  rows = players (ordered by where they stood when the round ended), columns =
  holes; each cell is the player's cumulative tournament score to par through
  that hole, colored by what they scored on it (eagle+/birdie/bogey/double+),
  with a par row, Rd/Tot columns, and tie-aware positions. Click a row to
  select that player everywhere; the ★ on a row (hover) **pins a favorite
  to the top**, remembered across tournaments. During live play, players
  yet to tee off hold their leaderboard spot with their tee time.
- **Cache admin** (`/admin`, the "Cache" link in the topbar): an inventory of
  everything cached, **grouped by season into collapsible year sections**
  (newest open; your toggles are remembered) — per tournament: player rounds,
  field rounds, hole-map coverage, course map/stats, size, last capture.
  **Download a season** (top bar, or per year) walks that year's completed
  events in one paced background pass (four at a time) and grabs each one's
  field scorecards, course stats, and aerial assets — player shot rounds stay
  on-demand — with live progress and a stop button. **Seasons queue**: click
  as many years as you like and they run one after another, each season's
  header row showing its own state (download / queued ✕ / spinner + progress
  / ✓ done + flagged count); Stop clears everything, the ✕ dequeues one.
  Each finished year keeps its report — select that season in the dropdown
  to review its flags. Every run is **audited to `data/bulkload.log`**: one line per
  event (rounds fetched vs expected, per-round player counts, a
  scorecard-vs-API `toPar` cross-check, coverage, timing), `!!` flags on
  anything anomalous, and a per-job summary; flagged events also surface on
  the admin page after the run.
- **Shareable deep links:** the URL carries the selection (`?t=&p=&r=&v=&h=`), so a
  reload restores the view and a **copy-link** button shares it. A freshness bar
  shows **"data current as of … · loaded in N ms · cached/live"** — the timestamp
  is when the data was actually captured from PGA (server-stamped), and
  **refresh** force-re-fetches (busting the cache for the rare ShotLink
  correction).

The server proxies GraphQL through `POST /api/graphql` and injects the API key,
so the browser never handles the key and there are no CORS issues.

### Caching model

Completed rounds are immutable, so the server caches the **raw radar-on
`shotDetailsV3` payload once per (tournament, player, round)** in Redis with no
expiry, wrapped as `{fetchedAt, data}`; both `/api/shots` and `/api/putts` derive
from that single entry (verified lossless — `includeRadar:true` is a strict
superset of `false`). A round is cached with no expiry only once *final* (every
hole scored); an **in-progress round gets a 30-second TTL** instead, so live
view-flipping reuses one capture without going stale. A **per-key fetch lock**
coalesces concurrent identical requests (the UI loads shots+putts in parallel —
only one upstream fetch happens). `refresh=true` on either endpoint busts the
key. If the scraped API key rotates, the client **re-scrapes and retries
automatically** on an auth failure. Derived stats (`/api/putts`'s per-hole rows and `shortestMissed`) are
computed per request from that payload.

Immutable entries (final rounds, course/hole maps) are additionally written to
a local **SQLite** file (`data/cache.sqlite`, git-ignored) as a durable tier —
Redis is a shared service whose lifetime the app doesn't control (a reboot can
empty it), so on a Redis miss the server reads through to SQLite, backfills
Redis, and only then falls back to the PGA API. Live (TTL'd) entries stay
Redis-only. Both tiers degrade gracefully if unavailable.

Convenience JSON endpoints: `/api/schedule`, `/api/leaderboard`, `/api/shots`,
`/api/putts`. Responses carry `X-Cache: HIT|MISS` and `X-Data-Fetched-At` (ms,
when the payload was captured from PGA — drives the UI's "data current as of").

## Layout

```
pga/client.py            PGATourClient: query(), introspect(), shot_details(), key discovery
pga/server.py            FastAPI app (Shot Explorer + GraphiQL + passthrough proxy)
static/index.html        the explorer shell (markup only)
static/css/fairway.css   the whole stylesheet (light + dark themes)
static/js/               native ES modules, no build step:
  main.js                  entry point — wiring + boot
  dom.js · icons.js · theme.js · format.js · state.js · api.js
  pickers/               tournament.js · round.js · player.js
  views/                 render.js · putts.js · puttsAll.js · shots.js · freshness.js
static/                  also: graphiql.html, favicon.svg, fonts/
start.sh / stop.sh       run/stop the web app
scripts/dump_schema.py   dump the live schema -> schema/schema.{json,graphql}
scripts/example_shots.py pull + print shot-by-shot data for a player/round
schema/schema.graphql    checked-in SDL snapshot (~8.7k lines, 925 types)
schema/schema.json        checked-in raw introspection snapshot
STATUS.md                what's available right now (verified)
```

## Quickstart (CLI)

```bash
uv run scripts/example_shots.py            # Scheffler, 3M Open 2026, round 1
uv run scripts/dump_schema.py --discover   # refresh the schema dump
```

## Use the client

```python
from pga import PGATourClient, decode_payload

with PGATourClient() as c:                 # add discover=True to scrape a fresh key
    shots = c.shot_details("R2026525", "46046", round_num=1)
    for hole in shots["holes"]:
        for s in hole["strokes"]:
            print(s["strokeNumber"], s["playByPlay"])
```

Endpoint: `https://orchestrator.pgatour.com/graphql` · auth: `x-api-key` header
(keys rotate — `discover_keys()` re-scrapes them from the live site).
