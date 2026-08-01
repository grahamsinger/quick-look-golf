# golf_api

Client and schema tooling for the **unofficial PGA TOUR GraphQL API** — the
backend behind pgatour.com and its TOURCAST shot-tracker, and a free source of
genuine shot-by-shot (ShotLink-derived) data.

> ⚠️ Unofficial, undocumented, and governed by the pgatour.com Terms of Service.
> See [`STATUS.md`](STATUS.md) for the full picture, caveats, and alternatives.

## Browse it (web app)

```bash
./start.sh        # launches FastAPI + uvicorn on http://127.0.0.1:8600
./stop.sh         # shuts it down
```

Then open:

| URL | What |
|---|---|
| http://127.0.0.1:8600/ | **Shot Explorer** — two views (toggle top-left): *Shot trails* (each hole's shot path + play-by-play + radar) and *First putts* (first-putt length per hole grouped by the score made, + summary + table) |
| http://127.0.0.1:8600/graphiql | **GraphiQL** — full-API playground with autocomplete (introspection is on) |
| http://127.0.0.1:8600/docs | **Swagger UI** for the REST convenience endpoints |

The server proxies GraphQL through `POST /api/graphql` and injects the API key,
so the browser never handles the key and there are no CORS issues. Convenience
JSON endpoints: `/api/schedule`, `/api/leaderboard`, `/api/shots`, `/api/putts`
(first-putt length + score result per hole; a putt = any stroke from the green,
its length = distance-to-hole going into it).

## Layout

```
pga/client.py            PGATourClient: query(), introspect(), shot_details(), key discovery
pga/server.py            FastAPI app (Shot Explorer + GraphiQL + passthrough proxy)
static/                  index.html (explorer) + graphiql.html
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
