"""Local web app for browsing the unofficial PGA TOUR GraphQL API.

Run it with ./start.sh (or: uv run python -m uvicorn pga.server:app --port 8600).

Routes
------
GET  /            Shot Explorer  — pick tournament/player/round, see shot trails
GET  /graphiql    GraphiQL IDE   — full-API playground with autocomplete
GET  /docs         Swagger UI     — the REST convenience endpoints
POST /api/graphql  passthrough proxy (injects x-api-key; browser never sees it)
GET  /api/schedule?year=2026&tour=R
GET  /api/leaderboard?tournamentId=R2026525
GET  /api/shots?tournamentId=R2026525&playerId=46046&round=1&radar=true
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

import redis
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .client import PGATourClient

# Cache-key namespace. Bump CACHE_VERSION to invalidate everything after a
# change to the derived data shape (completed rounds are stored with no expiry).
CACHE_VERSION = "v2"  # v2: cache wraps the payload as {fetchedAt, data}

_SCORE_NAMES = {
    -4: "Condor", -3: "Albatross", -2: "Eagle", -1: "Birdie",
    0: "Par", 1: "Bogey", 2: "Double Bogey", 3: "Triple Bogey",
}


def _parse_feet(dist: str | None) -> float | None:
    """Parse a ShotLink distance ('16 ft 11 in.', '8 in.', '2 yds') to feet."""
    if not dist:
        return None
    s = dist.lower()
    if "yd" in s:  # shouldn't happen for putts, but be safe
        m = re.search(r"([\d.]+)", s)
        return round(float(m.group(1)) * 3, 1) if m else None
    ft = re.search(r"(\d+)\s*ft", s)
    inch = re.search(r"(\d+)\s*in", s)
    if not ft and not inch:
        return None
    total = (int(ft.group(1)) if ft else 0) + (int(inch.group(1)) / 12 if inch else 0)
    return round(total, 1)


def _diff_label(diff: int) -> str:
    if diff in _SCORE_NAMES:
        return _SCORE_NAMES[diff]
    return f"+{diff}" if diff > 0 else str(diff)


def _score_result(score: str | None, par: int) -> tuple[int | None, str]:
    try:
        diff = int(score) - par
    except (TypeError, ValueError):
        return None, score or ""
    return diff, _diff_label(diff)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(
    title="golf_api — PGA TOUR GraphQL explorer",
    description="Local browser for the unofficial pgatour.com GraphQL API.",
    version="0.1.0",
)

# One shared client. httpx.Client is thread-safe for requests; FastAPI runs
# these sync handlers in a threadpool.
client = PGATourClient()

# --- Redis cache (loopback; optional) --------------------------------------
# We cache the RAW radar-on shotDetailsV3 payload once per (tournament, player,
# round). Both /api/shots and /api/putts derive from it — verified lossless:
# includeRadar:true is a strict superset of includeRadar:false. Only *final*
# rounds (every hole scored) are stored, with no expiry; in-progress rounds are
# never cached, so live data is always fetched fresh. If Redis is unreachable,
# every helper degrades to a no-op and we just fetch live.
_redis = redis.Redis(
    host=os.environ.get("REDIS_HOST", "127.0.0.1"),
    port=int(os.environ.get("REDIS_PORT", "6379")),
    db=int(os.environ.get("REDIS_DB", "0")),
    socket_connect_timeout=0.3,
    socket_timeout=0.3,
    decode_responses=True,
)


def _cache_get(key: str) -> str | None:
    try:
        return _redis.get(key)
    except Exception:
        return None


def _cache_set(key: str, value: str, ttl: int | None = None) -> None:
    try:
        if ttl:
            _redis.setex(key, ttl, value)  # short-lived (in-progress round)
        else:
            _redis.set(key, value)  # no expiry: final rounds are immutable
    except Exception:
        pass


def _cache_del(key: str) -> None:
    try:
        _redis.delete(key)
    except Exception:
        pass


def _round_final(data: dict) -> bool:
    """A round is final (safe to cache forever) once every hole has a real score."""
    holes = data.get("holes") or []
    return bool(holes) and all(
        (h.get("score") not in (None, "", "-")) for h in holes
    )


# The UI loads /api/shots and /api/putts in parallel and both derive from the
# same shotDetailsV3 payload — without coordination a cold cache means two
# identical upstream fetches. A per-key lock makes the second request wait and
# hit the cache instead; a short TTL on in-progress rounds means view-flipping
# during live play reuses one capture instead of hammering PGA on every click.
LIVE_TTL_S = 30
_fetch_locks: dict[str, threading.Lock] = {}
_fetch_locks_guard = threading.Lock()


def _fetch_lock(key: str) -> threading.Lock:
    with _fetch_locks_guard:
        return _fetch_locks.setdefault(key, threading.Lock())


def shot_details_cached(
    tournament_id: str, player_id: str, round_num: int, refresh: bool = False
) -> tuple[dict, bool, int]:
    """Radar-on shotDetailsV3 for one player/round, cached in Redis when final.

    Returns (data, cache_hit, fetched_at_ms), where fetched_at_ms is when the
    payload was actually captured from PGA — stored alongside a cached final
    round, or "now" for a fresh/live fetch. This is what the UI's "data current
    as of" should reflect, not the browser's fetch time. refresh=True busts the
    cached entry and re-fetches (for the rare ShotLink correction to a round).
    """
    key = f"golf:{CACHE_VERSION}:shotdetails:{tournament_id}:{player_id}:{round_num}"
    if refresh:
        _cache_del(key)
    with _fetch_lock(key):
        if not refresh:
            cached = _cache_get(key)
            if cached is not None:
                obj = json.loads(cached)
                return obj["data"], True, obj.get("fetchedAt")
        data = client.shot_details(tournament_id, player_id, round_num, include_radar=True)
        fetched_at = int(time.time() * 1000)
        payload = json.dumps({"fetchedAt": fetched_at, "data": data})
        _cache_set(key, payload, ttl=None if _round_final(data) else LIVE_TTL_S)
        return data, False, fetched_at


@app.post("/api/graphql")
def graphql_passthrough(body: dict[str, Any]) -> JSONResponse:
    """Proxy an arbitrary GraphQL request, injecting the API key server-side."""
    if "query" not in body:
        raise HTTPException(400, "body must include a 'query' field")
    return JSONResponse(client.post_raw(body))


@app.get("/api/schedule")
def schedule(year: str = "2026", tour: str = "R") -> dict:
    """Flat list of tournaments for a season: [{id, name, startDate}]."""
    q = """
    query Schedule($tourCode: String!, $year: String!) {
      schedule(tourCode: $tourCode, year: $year) {
        completed { tournaments { id tournamentName startDate tournamentStatus } }
        upcoming  { tournaments { id tournamentName startDate tournamentStatus } }
      }
    }
    """
    data = client.query(q, {"tourCode": tour, "year": year}, "Schedule")["schedule"]
    out: list[dict] = []
    seen: set[str] = set()
    for bucket in ("completed", "upcoming"):
        for month in data.get(bucket) or []:
            for t in month.get("tournaments") or []:
                if t["id"] in seen:
                    continue
                seen.add(t["id"])
                out.append(
                    {
                        "id": t["id"],
                        "name": t["tournamentName"],
                        "startDate": t.get("startDate"),
                        "status": bucket,
                        # COMPLETED | IN_PROGRESS | NOT_STARTED
                        "tournamentStatus": t.get("tournamentStatus"),
                    }
                )
    out.sort(key=lambda t: t.get("startDate") or 0)
    return {"tournaments": out}


@app.get("/api/leaderboard")
def leaderboard(tournamentId: str) -> dict:
    """Players in a tournament: [{id, name, position, total}]."""
    q = """
    query LB($id: ID!) {
      leaderboardV3(id: $id) {
        leaderboardRoundHeader
        players {
          ... on PlayerRowV3 {
            id
            player { id firstName lastName }
            scoringData { position total thru score teeTime currentRound rounds }
          }
        }
      }
    }
    """
    lb = client.query(q, {"id": tournamentId}, "LB")["leaderboardV3"]
    players = []
    for r in lb["players"]:
        p = r.get("player") if isinstance(r, dict) else None
        if not p:
            continue
        sd = r.get("scoringData") or {}
        # today's strokes (e.g. "61") once the round is finished: rounds is a
        # per-round strokes list ("-" until played), currentRound is 1-based
        rounds = sd.get("rounds") or []
        cur = sd.get("currentRound")
        today_strokes = None
        if sd.get("thru") == "F" and cur and 1 <= cur <= len(rounds) and rounds[cur - 1] != "-":
            today_strokes = rounds[cur - 1]
        players.append(
            {
                "id": p["id"],
                "name": f"{p['firstName']} {p['lastName']}".strip(),
                "position": sd.get("position"),
                "total": sd.get("total"),
                # daily progress: thru = "F" (done) / hole number / "" (not out)
                "thru": sd.get("thru"),
                "today": sd.get("score"),        # today's score to par
                "todayStrokes": today_strokes,   # today's strokes when thru == "F"
                "teeTime": sd.get("teeTime"),    # ms timestamp, set before teeing off
            }
        )
    # e.g. "R3" -> 3: the tournament's latest round with data
    m = re.search(r"(\d+)", lb.get("leaderboardRoundHeader") or "")
    current_round = int(m.group(1)) if m else None
    return {"players": players, "currentRound": current_round}


@app.get("/api/shots")
def shots(
    response: Response,
    tournamentId: str,
    playerId: str,
    round: int = 1,
    refresh: bool = False,
) -> dict:
    """Shot-by-shot data: {holes: [{holeNumber, par, strokes: [...]}]}."""
    data, hit, fetched_at = shot_details_cached(tournamentId, playerId, round, refresh=refresh)
    response.headers["X-Cache"] = "HIT" if hit else "MISS"
    if fetched_at is not None:
        response.headers["X-Data-Fetched-At"] = str(fetched_at)
    return data


@app.get("/api/putts")
def putts(
    response: Response,
    tournamentId: str,
    playerId: str,
    round_num: int = Query(1, alias="round"),
    refresh: bool = False,
) -> dict:
    """First-putt length (ft) and score result per hole, for one player/round.

    A putt is any stroke played from the green. The first-putt length is the
    distance to the hole going into that putt (i.e. the distanceRemaining of the
    stroke that put the ball on the green). Holes finished from off the green
    have no putt.
    """
    data, hit, fetched_at = shot_details_cached(tournamentId, playerId, round_num, refresh=refresh)
    response.headers["X-Cache"] = "HIT" if hit else "MISS"
    if fetched_at is not None:
        response.headers["X-Data-Fetched-At"] = str(fetched_at)
    rows = []
    missed_putts = []  # every putt that didn't hole out, for "shortest missed"
    made_putt_feet = 0.0  # total length of putts holed (ShotLink "feet of putts made")
    for h in data["holes"]:
        strokes = h["strokes"]

        def on_green(s: dict) -> bool:
            return (s.get("fromLocation") or "").lower() == "green"

        green_idx = next((i for i, s in enumerate(strokes) if on_green(s)), None)
        n_putts = sum(1 for s in strokes if on_green(s))
        first_putt_ft = None
        approach_dist = None  # how far the setup shot actually traveled
        approach_from = None  # where that shot was played from
        approach_had = None   # distance to the pin the player HAD going into it
        if green_idx is not None and green_idx > 0:
            setup = strokes[green_idx - 1]
            first_putt_ft = _parse_feet(setup.get("distanceRemaining"))
            approach_dist = setup.get("distance")
            approach_from = setup.get("fromLocation")
            # distance-to-pin before the shot = the previous stroke's remaining,
            # or the full hole length if it was the first stroke (e.g. a par-3 tee shot)
            if green_idx >= 2:
                approach_had = strokes[green_idx - 2].get("distanceRemaining")
            elif h.get("yardage"):
                approach_had = f"{h['yardage']} yds"

        diff, result = _score_result(h.get("score"), h["par"])
        # Every putt except the one that holed out is a "miss". Its length is the
        # distance to the hole going into it = the previous stroke's remaining
        # (the approach for the 1st putt, the prior putt for later ones). Ranking
        # these by length surfaces the painful short misses, and because each
        # putt is measured on its own, a short 2nd/3rd putt sorts correctly even
        # when it's shorter than the first putt on that hole.
        green_idxs = [i for i, s in enumerate(strokes) if on_green(s)]
        for putt_no, gi in enumerate(green_idxs[:-1], start=1):
            if gi == 0:
                continue
            length_ft = _parse_feet(strokes[gi - 1].get("distanceRemaining"))
            if length_ft is None:
                continue
            # what the putt was FOR: holing the stroke at index gi would have
            # closed the hole in gi + 1 strokes
            for_diff = (gi + 1) - h["par"]
            missed_putts.append(
                {
                    "hole": h["holeNumber"],
                    "par": h["par"],
                    "lengthFt": length_ft,
                    "puttNumber": putt_no,
                    "result": result,
                    "scoreToPar": diff,
                    "forScore": _diff_label(for_diff),
                    "forDiff": for_diff,
                }
            )
        # length of the putt that holed out (the made putt), for feet-of-putts-made
        if green_idxs:
            holed = green_idxs[-1]
            made_len = _parse_feet(strokes[holed - 1].get("distanceRemaining")) if holed > 0 else None
            if made_len is not None:
                made_putt_feet += made_len
        rows.append(
            {
                "hole": h["holeNumber"],
                "par": h["par"],
                "score": h.get("score"),
                "scoreToPar": diff,
                "result": result,
                "firstPuttFt": first_putt_ft,
                "approachHad": approach_had,
                "approachDist": approach_dist,
                "approachFrom": approach_from,
                "putts": n_putts,
                "holedOffGreen": n_putts == 0,
            }
        )

    fps = [r["firstPuttFt"] for r in rows if r["firstPuttFt"] is not None]
    summary = {
        "totalPutts": sum(r["putts"] for r in rows),
        "onePutts": sum(1 for r in rows if r["putts"] == 1),
        "threePlusPutts": sum(1 for r in rows if r["putts"] >= 3),
        "avgFirstPuttFt": round(sum(fps) / len(fps), 1) if fps else None,
        "holesHoledOffGreen": sum(1 for r in rows if r["holedOffGreen"]),
    }
    # shortest missed putts first (tie-break by hole for stable ordering). Return
    # the round's top 10 — enough for the daily view (top 5) and for the all-rounds
    # view to aggregate a correct tournament top 10 across rounds.
    missed_putts.sort(key=lambda m: (m["lengthFt"], m["hole"]))
    return {
        "round": data["round"],
        "holes": rows,
        "summary": summary,
        "shortestMissed": missed_putts[:10],
        "madePuttFeet": round(made_putt_feet, 1),
    }


@app.get("/graphiql", response_class=HTMLResponse)
def graphiql() -> str:
    return (STATIC_DIR / "graphiql.html").read_text()


# Serve the Shot Explorer at "/" and any other static assets under it.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
