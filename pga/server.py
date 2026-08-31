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
import logging
import os
import re
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import redis
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import httpx

from .client import GraphQLError, PGATourClient, _USER_AGENT

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


# --- durable tier under Redis ----------------------------------------------
# Redis is the hot cache, but it's a shared service whose lifetime we don't
# control (a machine reboot emptied it once). Entries cached with no TTL are
# immutable — final rounds, course/hole maps — so those are also written to a
# local SQLite file and read back through on a Redis miss (backfilling Redis).
# Live entries (30s TTL) stay Redis-only.
#
# Both tiers are best-effort: a cache failure must never fail the request
# (the fallback is the PGA API). But best-effort must not mean invisible —
# a co-tenant once disabled Redis persistence and nobody knew for a month —
# so failures are caught NARROWLY (a bug in our own code should still raise)
# and each failing site logs one warning per process into server.log.
_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "cache.sqlite"
_DISK_ERRORS = (sqlite3.Error, OSError)
_log = logging.getLogger("golf.cache")
_tier_warned: set[str] = set()


def _tier_warn(site: str, exc: Exception) -> None:
    if site not in _tier_warned:
        _tier_warned.add(site)
        _log.warning("cache tier degraded (%s): %s — continuing without it", site, exc)


def _disk() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


try:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _disk() as _c:
        _c.execute(
            "CREATE TABLE IF NOT EXISTS cache ("
            "key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL)"
        )
except _DISK_ERRORS as _e:
    _tier_warn("sqlite-init", _e)


def _cache_get(key: str) -> str | None:
    try:
        hit = _redis.get(key)
        if hit is not None:
            return hit
    except redis.RedisError as e:
        _tier_warn("redis-get", e)
    try:
        with _disk() as c:
            row = c.execute("SELECT value FROM cache WHERE key = ?", (key,)).fetchone()
    except _DISK_ERRORS as e:
        _tier_warn("sqlite-get", e)
        return None
    if row is None:
        return None
    try:
        _redis.set(key, row[0])  # backfill the hot tier
    except redis.RedisError as e:
        _tier_warn("redis-backfill", e)
    return row[0]


def _cache_set(key: str, value: str, ttl: int | None = None) -> None:
    try:
        if ttl:
            _redis.setex(key, ttl, value)  # short-lived (in-progress round)
        else:
            _redis.set(key, value)  # no expiry: final rounds are immutable
    except redis.RedisError as e:
        _tier_warn("redis-set", e)
    if not ttl:  # immutable entries also go to disk
        try:
            with _disk() as c:
                c.execute(
                    "INSERT OR REPLACE INTO cache (key, value, created_at) VALUES (?, ?, ?)",
                    (key, value, int(time.time())),
                )
        except _DISK_ERRORS as e:
            _tier_warn("sqlite-set", e)


def _cache_del(key: str) -> None:
    try:
        _redis.delete(key)
    except redis.RedisError as e:
        _tier_warn("redis-del", e)
    try:
        with _disk() as c:
            c.execute("DELETE FROM cache WHERE key = ?", (key,))
    except _DISK_ERRORS as e:
        _tier_warn("sqlite-del", e)


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
def schedule(response: Response, year: str = "2026", tour: str = "R", refresh: bool = False) -> dict:
    """Flat list of tournaments for a season: [{id, name, startDate}].

    Cached: a past season's schedule is effectively immutable (durable entry);
    the current season gets a short TTL so statuses roll over during a live
    week. The key leads with the year (not an R-id) so the admin rollup,
    which groups on an R-prefixed second segment, skips these.
    """
    key = f"golf:{CACHE_VERSION}:schedule:{year}:{tour}"
    if refresh:
        _cache_del(key)
    else:
        cached = _cache_get(key)
        if cached is not None:
            response.headers["X-Cache"] = "HIT"
            return json.loads(cached)
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
    payload = {"tournaments": out}
    if out:
        past = year.isdigit() and int(year) < time.localtime().tm_year
        _cache_set(key, json.dumps(payload), ttl=None if past else 600)
    response.headers["X-Cache"] = "MISS"
    return payload


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
                # per-round strokes ("-" until played) + the player's current
                # round: lets the client offer only rounds this player has data
                # for (a missed cut means fewer rounds than the tournament)
                "rounds": rounds,
                "currentRound": cur,
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
            # distance-to-pin before the shot = the previous row's remaining,
            # or the full hole length if it was the first stroke (e.g. a par-3
            # tee shot). A DROP row here is right (post-drop distance = what
            # the player actually had); a PENALTY row has no remaining at all,
            # so walk back to the nearest row that does.
            if green_idx >= 2:
                for prev in range(green_idx - 2, -1, -1):
                    rem = strokes[prev].get("distanceRemaining")
                    if (rem or "").strip():
                        approach_had = rem
                        break
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
            # what the putt was FOR: holing it would close the hole in its own
            # strokeNumber of strokes. Use the feed's number, not the array
            # index — PENALTY/DROP rows are interleaved in strokes[] and made
            # a missed bogey putt read "for Double Bogey" after a water ball.
            for_diff = (strokes[gi].get("strokeNumber") or gi + 1) - h["par"]
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


# --- course map (spatial shot viz) -----------------------------------------
# TOURCAST's static asset host has a georeferenced aerial per tournament, and
# its config API has the offset that maps shot coords (tourcast feet) onto it:
#   world_m = 0.3048 * tourcast - (offset.x, offset.y)   (rotate: see config)
#   pixels  = world-file (tfw) affine, full-res scaled to the 2048px jpg
# Verified ~1 m (pins land on greens). Assets are static per tournament, so we
# cache the bundle in Redis with no expiry.
_assets_http = httpx.Client(timeout=10.0, headers={"user-agent": _USER_AGENT})
_TOURCAST_MODELS = "https://tourcast.pgatour.com/models"
_TOURCAST_CONFIG = "https://orchestrator-config.pgatour.com/tourcast/pga-tour"


@app.get("/api/coursemap")
def coursemap(response: Response, tournamentId: str, refresh: bool = False) -> dict:
    """Everything the Course view needs to project shots onto the aerial."""
    key = f"golf:{CACHE_VERSION}:coursemap:{tournamentId}"
    if refresh:
        _cache_del(key)
    else:
        cached = _cache_get(key)
        if cached is not None:
            response.headers["X-Cache"] = "HIT"
            return json.loads(cached)
    base = f"{_TOURCAST_MODELS}/{tournamentId}/3D_Assets"
    try:
        tfw_r = _assets_http.get(f"{base}/terrain/course.tfw")
        cfg_r = _assets_http.get(f"{_TOURCAST_CONFIG}/{tournamentId}")
        if tfw_r.status_code != 200 or cfg_r.status_code != 200:
            return {"available": False}
        tfw = [float(x) for x in tfw_r.text.split()]
        offset = cfg_r.json().get("offsetConfig") or {}
        course_data = {}
        cd_r = _assets_http.get(f"{base}/data/courseData.json")
        if cd_r.status_code == 200:
            course_data = cd_r.json()
    except (httpx.HTTPError, ValueError):
        return {"available": False}
    if len(tfw) < 8 or not offset:
        return {"available": False}
    out = {
        "available": True,
        "imageUrl": f"{base}/terrain/course.jpg",
        # world-file affine: [pxSizeX, rot, rot, pxSizeY(neg), topLeftX, topLeftY]
        # + the full-res raster size the tfw refers to (the jpg is 2048x2048)
        "tfw": {"a": tfw[0], "e": tfw[3], "c": tfw[4], "f": tfw[5],
                "fullW": tfw[6], "fullH": tfw[7]},
        "offset": {"x": offset.get("x", 0), "y": offset.get("y", 0),
                   "rotate": offset.get("rotate", 0)},
        # per-hole [pinX, pinY, teeX, teeY] in world meters (for labels/crops)
        "pinsTees": (course_data.get("pinsTees") or [[]])[0],
        "holeCenterLines": course_data.get("holeCenterLines") or [],
    }
    _cache_set(key, json.dumps(out))
    response.headers["X-Cache"] = "MISS"
    return out


@app.get("/api/holemap")
def holemap(response: Response, tournamentId: str, hole: int, refresh: bool = False) -> dict:
    """Per-hole aerial + world-file for the Course view's hole zoom.

    Unlike course.tfw, the per-hole world files carry rotation terms (each
    hole's image is oriented so the hole runs down the frame), so the client
    needs the full 6-term affine, not just scale + origin.
    """
    key = f"golf:{CACHE_VERSION}:holemap:{tournamentId}:{hole}"
    if refresh:
        _cache_del(key)
    else:
        cached = _cache_get(key)
        if cached is not None:
            response.headers["X-Cache"] = "HIT"
            return json.loads(cached)
    base = f"{_TOURCAST_MODELS}/{tournamentId}/3D_Assets"
    try:
        tfw_r = _assets_http.get(f"{base}/terrain/terrain{hole:02d}.tfw")
        if tfw_r.status_code != 200:
            return {"available": False}
        tfw = [float(x) for x in tfw_r.text.split()]
    except (httpx.HTTPError, ValueError):
        return {"available": False}
    if len(tfw) < 8:
        return {"available": False}
    out = {
        "available": True,
        "imageUrl": f"{base}/terrain/terrain{hole:02d}.jpg",
        # world-file lines: A, D, B, E, C, F (+ full-res raster W, H; the jpg
        # itself is 4096x4096, squashed — the client un-squashes via viewBox)
        "tfw": {"a": tfw[0], "d": tfw[1], "b": tfw[2], "e": tfw[3],
                "c": tfw[4], "f": tfw[5], "fullW": tfw[6], "fullH": tfw[7]},
    }
    _cache_set(key, json.dumps(out))
    response.headers["X-Cache"] = "MISS"
    return out


def _fill_others(blk: dict, by_hole: dict[int, int]) -> None:
    for r in blk["rows"]:
        if r.get("hole"):
            r["others"] = by_hole.get(r["hole"], 0)
        else:
            rng = (range(1, 10) if r.get("label") == "OUT"
                   else range(10, 19) if r.get("label") == "IN" else range(1, 19))
            r["others"] = sum(v for h, v in by_hole.items() if h in rng)


def _derive_others(blocks: list[dict]) -> None:
    """Fill each row's `others` (triple bogey or worse) where it's derivable.

    The API's buckets stop at double bogey, but every player who completed a
    hole lands in exactly one bucket — so a finished round's field size is
    the max bucket-sum across its holes, and each hole's shortfall from that
    is triples+. Derived per round (each round carries its own field size,
    so cuts are handled), never for a live round (holes the field hasn't
    reached would masquerade as others); the All Rounds block sums the
    per-round values and is skipped while any round is live. A mid-round WD
    can overstate by one on the holes they never played — rare, and a live
    week self-corrects on the next 30 s re-fetch.
    """
    per_round: dict[int, dict[int, int]] = {}
    for blk in blocks:
        if not blk["round"] or blk["live"]:
            continue
        sums = {
            r["hole"]: sum(r.get(k) or 0 for k in ("eagles", "birdies", "pars", "bogeys", "doubles"))
            for r in blk["rows"] if r.get("hole")
        }
        if not sums:
            continue
        n = max(sums.values())
        per_round[blk["round"]] = {h: max(0, n - s) for h, s in sums.items()}
        _fill_others(blk, per_round[blk["round"]])
    if not per_round or any(b["live"] for b in blocks):
        return
    agg: dict[int, int] = {}
    for m in per_round.values():
        for h, v in m.items():
            agg[h] = agg.get(h, 0) + v
    for blk in blocks:
        if not blk["round"]:
            _fill_others(blk, agg)


@app.get("/api/coursestats")
def coursestats(response: Response, tournamentId: str, refresh: bool = False) -> dict:
    """Hole-by-hole field scoring for the week (the site's Course Stats tab):
    scoring average, to-par diff, difficulty rank, and per-score counts, with
    an "All Rounds" block plus one block per completed/live round.

    Row order is preserved from the feed (holes 1-9, OUT, 10-18, IN, TOTAL);
    hole rows carry `hole`, summary rows carry `label` instead. `doubles` is
    exactly double bogeys — triples+ aren't bucketed by the API, so `others`
    is derived (see _derive_others) and absent where it can't be.
    """
    key = f"golf:{CACHE_VERSION}:coursestats2:{tournamentId}"
    if refresh:
        _cache_del(key)
    else:
        cached = _cache_get(key)
        if cached is not None:
            response.headers["X-Cache"] = "HIT"
            return json.loads(cached)
    q = """
    query CourseStats($tid: ID!) {
      courseStats(tournamentId: $tid) {
        courses {
          courseId courseName par yardage hostCourse
          roundHoleStats {
            roundHeader roundNum live
            holeStats {
              __typename
              ... on CourseHoleStats {
                courseHoleNum parValue yards
                scoringAverage scoringAverageDiff scoringDiffTendency
                eagles birdies pars bogeys doubleBogey rank
              }
              ... on SummaryRow {
                rowType par yardage scoringAverage scoringAverageDiff scoringDiffTendency
                eagles birdies pars bogeys doubleBogey
              }
            }
          }
        }
      }
    }
    """
    try:
        data = client.query(q, {"tid": tournamentId}, "CourseStats").get("courseStats")
    except GraphQLError:
        data = None  # events without ShotLink stats
    courses = []
    for cr in (data or {}).get("courses") or []:
        blocks = []
        for blk in cr.get("roundHoleStats") or []:
            rows = []
            for row in blk.get("holeStats") or []:
                common = {
                    "avg": row.get("scoringAverage"),
                    "diff": row.get("scoringAverageDiff"),
                    "tendency": row.get("scoringDiffTendency"),
                    "eagles": row.get("eagles"),
                    "birdies": row.get("birdies"),
                    "pars": row.get("pars"),
                    "bogeys": row.get("bogeys"),
                    "doubles": row.get("doubleBogey"),
                }
                if row.get("__typename") == "CourseHoleStats":
                    rows.append({
                        "hole": row.get("courseHoleNum"),
                        "par": row.get("parValue"),
                        "yards": row.get("yards"),
                        "rank": row.get("rank"),
                        **common,
                    })
                else:  # OUT / IN / TOTAL
                    rows.append({
                        "label": row.get("rowType"),
                        "par": row.get("par"),
                        "yards": row.get("yardage"),
                        **common,
                    })
            blocks.append({
                "label": blk.get("roundHeader"),
                "round": blk.get("roundNum"),
                "live": bool(blk.get("live")),
                "rows": rows,
            })
        _derive_others(blocks)
        courses.append({
            "courseId": cr.get("courseId"),
            "courseName": cr.get("courseName"),
            "par": cr.get("par"),
            "yardage": cr.get("yardage"),
            "hostCourse": bool(cr.get("hostCourse")),
            "rounds": blocks,
        })
    out = {"available": bool(courses), "courses": courses}
    if courses:
        # immutable once rounds 1-4 all have a non-live block; otherwise the
        # numbers still move (live play, or future rounds not yet listed)
        played = {b["round"] for c in courses for b in c["rounds"] if b["round"]}
        live = any(b["live"] for c in courses for b in c["rounds"])
        final = played >= {1, 2, 3, 4} and not live
        _cache_set(key, json.dumps(out), ttl=None if final else LIVE_TTL_S)
    response.headers["X-Cache"] = "MISS"
    return out


_HBH_Q = """
query HBH($tid: ID!, $r: Int!) {
  leaderboardHoleByHole(tournamentId: $tid, round: $r) {
    currentRound
    courseHoleHeaders { courseId holeHeaders { holeNumber par } }
    courses { id courseName hostCourse }
    playerData { playerId courseId out in total totalToPar scores { holeNumber par score } }
  }
}
"""


def _holebyhole_round(tid: str, rnd: int, refresh: bool = False,
                      final_hint: bool = False) -> dict:
    """Trimmed leaderboardHoleByHole for one round, cached.

    Durable once the round is over: every player either has a full scorecard
    or none (a partial card means live play — or an overnight suspension —
    so those stay on the short TTL), or the tournament has moved past the
    round. That heuristic has a blind spot: a mid-round WD in the FINAL
    round leaves a permanently partial card with currentRound == round, so
    the round would sit on the TTL forever — `final_hint=True` (set by the
    season bulk loader, which only walks completed tournaments) overrides
    it and pins the round durable. Field members who didn't play the round
    (missed cut, WD) are dropped. `diff` = the player's round total relative
    to par, summed from per-hole scores so multi-course weeks use each
    card's own pars.
    """
    key = f"golf:{CACHE_VERSION}:holebyhole:{tid}:{rnd}"
    if refresh:
        _cache_del(key)
    else:
        cached = _cache_get(key)
        if cached is not None:
            return json.loads(cached)
    try:
        data = client.query(_HBH_Q, {"tid": tid, "r": rnd}, "HBH").get("leaderboardHoleByHole")
    except GraphQLError:
        data = None
    out: dict[str, Any] = {"available": False}
    partial = False
    if data:
        # per-course hole pars (the header list interleaves OUT/IN/TOTAL
        # columns — a "par" above 6 is one of those, not a hole)
        pars: dict[str, dict[int, int]] = {}
        for ch in data.get("courseHoleHeaders") or []:
            m = {}
            for h in ch.get("holeHeaders") or []:
                try:
                    p = int(h.get("par"))
                except (TypeError, ValueError):
                    continue
                if 1 <= (h.get("holeNumber") or 0) <= 18 and p <= 6:
                    m[h["holeNumber"]] = p
            pars[ch.get("courseId")] = m
        courses = data.get("courses") or []
        host = next((c.get("id") for c in courses if c.get("hostCourse")),
                    courses[0].get("id") if courses else None)
        players = []
        for p in data.get("playerData") or []:
            scores = []
            diff = 0
            for s in p.get("scores") or []:
                sc = (s.get("score") or "").strip()
                if not sc or sc == "-":
                    continue
                d = int(sc) - (s.get("par") or 0)
                diff += d
                scores.append({"h": s.get("holeNumber"), "par": s.get("par"), "s": int(sc)})
            if not scores:
                continue
            if len(scores) < 18:
                partial = True
            players.append({
                "id": p.get("playerId"),
                "courseId": p.get("courseId"),
                "scores": scores,
                "diff": diff,
                "out": p.get("out"),
                "inn": p.get("in"),
                "total": p.get("total"),
                "toPar": p.get("totalToPar"),
            })
        out = {
            "available": bool(players),
            "round": rnd,
            "currentRound": data.get("currentRound"),
            "pars": pars.get(host) or {},
            "multiCourse": len(courses) > 1,
            "players": players,
        }
    final = out["available"] and (
        final_hint or (out.get("currentRound") or 0) > rnd or not partial
    )
    _cache_set(key, json.dumps(out), ttl=None if final else LIVE_TTL_S)
    return out


@app.get("/api/holebyhole")
def holebyhole(response: Response, tournamentId: str, round: int, refresh: bool = False) -> dict:
    """Full-field hole-by-hole scores for one round (the Field view).

    Each player also gets `start`: their cumulative tournament score to par
    entering the round (summed from the earlier rounds' cached scorecards),
    so the client can draw the running-race chart — every cell the player's
    tournament total through that hole.
    """
    data = dict(_holebyhole_round(tournamentId, round, refresh=refresh))
    if data.get("available"):
        starts: dict[str, int] = {}
        for r in range(1, round):
            prior = _holebyhole_round(tournamentId, r)
            for p in prior.get("players") or []:
                starts[p["id"]] = starts.get(p["id"], 0) + p["diff"]
        data["players"] = [{**p, "start": starts.get(p["id"], 0)} for p in data["players"]]
    return data


# --- season bulk download ---------------------------------------------------
# One background job at a time walks a season's completed tournaments and
# warms the field-facing caches: hole-by-hole scorecards for every played
# round, the course-stats table, and the aerial assets (course map + the 18
# hole world files). Shot-level detail (shotDetailsV3) is deliberately NOT
# bulk-fetched — that's ~600 GraphQL queries per event; player rounds keep
# loading on demand. A few tournaments run concurrently, each fetching
# sequentially with a pause between its upstream calls — cache hits skip the
# pause, so re-running a season is a cheap fill-in-the-gaps pass.
_BULK_WORKERS = 4         # tournaments in flight at once
_BULK_PACE_S = 0.5        # between GraphQL queries that actually hit the API
_BULK_ASSET_PACE_S = 0.1  # between tourcast CDN asset fetches
_bulk_lock = threading.Lock()
_bulk_cancel = threading.Event()
_bulk: dict[str, Any] = {"running": False}

# Every run is audited to its own file (kept out of server.log's uvicorn
# noise): one line per event — rounds fetched vs expected, per-round player
# counts, a scorecard cross-check, stats/aerial coverage, duration — WARN
# with "!!" flags when something's off, plus a per-job summary. This is the
# durable record when many seasons get walked; grep '!!' to find anomalies.
_blog = logging.getLogger("golf.bulk")
if not _blog.handlers:
    try:
        _bh = logging.FileHandler(_DB_PATH.parent / "bulkload.log")
        _bh.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(message)s"))
        _blog.addHandler(_bh)
        _blog.setLevel(logging.INFO)
        _blog.propagate = False
    except OSError as _e:
        _tier_warn("bulk-log", _e)


def _to_par_num(s: Any) -> int | None:
    if s in (None, "", "-"):
        return None
    s = str(s).strip()
    if s.upper() == "E":
        return 0
    try:
        return int(s)  # int("+2") parses
    except ValueError:
        return None


def _verify_round(data: dict) -> int:
    """Cross-check each full scorecard: our per-hole diff sum vs the API's
    own round toPar. Returns the number of cards that disagree — should be
    zero; anything else means a parsing or upstream-data anomaly."""
    bad = 0
    for p in data.get("players") or []:
        if len(p.get("scores") or []) != 18:
            continue
        tp = _to_par_num(p.get("toPar"))
        if tp is not None and tp != p.get("diff"):
            bad += 1
    return bad


def _bulk_flags(rec: dict) -> list[str]:
    """Classify what's anomalous about one event's haul. Expected absences
    (no aerials on an old season, no data at all before coverage starts)
    aren't flagged — flags mean 'look at this one'."""
    flags = []
    if rec["error"]:
        flags.append(f"error: {rec['error']}")
    if rec["fieldRounds"]:
        exp = rec["expectedRounds"]
        if exp and rec["fieldRounds"] < exp:
            flags.append(f"only {rec['fieldRounds']}/{exp} field rounds")
        if any(n < 2 for n in rec["players"]):
            flags.append("a round with <2 players")
        if not rec["stats"]:
            flags.append("scorecards but no course stats")
    elif rec["stats"]:
        # two known causes, indistinguishable here: team/match-play formats
        # never have per-player cards, and pre-2014 majors aren't covered
        flags.append("no individual scorecards in the feed")
    if rec["verifyFails"]:
        flags.append(f"{rec['verifyFails']} cards disagree with API toPar")
    if rec["coursemap"] and rec["holemaps"] < 18:
        flags.append(f"aerials incomplete ({rec['holemaps']}/18 holes)")
    if _bulk_cancel.is_set():
        flags.append("stopped mid-event; re-run the season to fill in")
    return flags


def _bulk_pace(cache_hit: bool, pause: float = _BULK_PACE_S) -> None:
    if not cache_hit:
        time.sleep(pause)


def _bulk_one(tid: str) -> dict:
    """Warm one tournament's caches; returns what landed + audit fields."""
    rec: dict[str, Any] = {"id": tid, "fieldRounds": 0, "expectedRounds": None,
                           "players": [], "verifyFails": 0, "stats": False,
                           "coursemap": False, "holemaps": 0, "error": None,
                           "flags": [], "secs": 0.0}
    t0 = time.monotonic()
    try:
        hit = _cache_get(f"golf:{CACHE_VERSION}:holebyhole:{tid}:1") is not None
        r1 = _holebyhole_round(tid, 1, final_hint=True)
        _bulk_pace(hit)
        if r1.get("available"):
            rec["fieldRounds"] = 1
            rec["players"].append(len(r1.get("players") or []))
            rec["verifyFails"] += _verify_round(r1)
            # round 1's currentRound = the last round played, so a 54-hole
            # weather week costs three queries, not four
            rec["expectedRounds"] = min(r1.get("currentRound") or 4, 4)
            for rnd in range(2, rec["expectedRounds"] + 1):
                if _bulk_cancel.is_set():
                    return rec
                hit = _cache_get(f"golf:{CACHE_VERSION}:holebyhole:{tid}:{rnd}") is not None
                rr = _holebyhole_round(tid, rnd, final_hint=True)
                if rr.get("available"):
                    rec["fieldRounds"] += 1
                    rec["players"].append(len(rr.get("players") or []))
                    rec["verifyFails"] += _verify_round(rr)
                else:
                    rec["players"].append(0)
                _bulk_pace(hit)
        resp = Response()
        rec["stats"] = bool(coursestats(resp, tid).get("available"))
        _bulk_pace(resp.headers.get("X-Cache") == "HIT")
        resp = Response()
        rec["coursemap"] = bool(coursemap(resp, tid).get("available"))
        _bulk_pace(resp.headers.get("X-Cache") == "HIT", _BULK_ASSET_PACE_S)
        if rec["coursemap"]:
            for h in range(1, 19):
                if _bulk_cancel.is_set():
                    return rec
                resp = Response()
                if holemap(resp, tid, h).get("available"):
                    rec["holemaps"] += 1
                _bulk_pace(resp.headers.get("X-Cache") == "HIT", _BULK_ASSET_PACE_S)
    except Exception as e:  # noqa: BLE001 — keep walking the season; report it
        rec["error"] = str(e)
    finally:
        # in finally so the early cancel returns still get audited
        rec["secs"] = round(time.monotonic() - t0, 1)
        rec["flags"] = _bulk_flags(rec)
    return rec


def _bulk_run_one(t: dict) -> None:
    if _bulk_cancel.is_set():  # queued behind the cancel: don't start
        return
    with _bulk_lock:
        _bulk["current"].append(t["name"])
    rec = _bulk_one(t["id"])
    rec["name"] = t["name"]
    parts = [f"{rec['id']} {t['name']}:"]
    if rec["fieldRounds"] or rec["expectedRounds"]:
        parts.append(f"rounds {rec['fieldRounds']}/{rec['expectedRounds'] or '?'}")
        parts.append("players " + "/".join(map(str, rec["players"])))
    else:
        parts.append("no scorecards")
    parts.append("stats " + ("y" if rec["stats"] else "n"))
    parts.append(f"aerials {rec['holemaps']}/18" if rec["coursemap"] else "aerials n")
    parts.append(f"{rec['secs']}s")
    line = " ".join(parts)
    if rec["flags"]:
        _blog.warning("%s  !! %s", line, "; ".join(rec["flags"]))
    else:
        _blog.info(line)
    with _bulk_lock:
        if t["name"] in _bulk["current"]:
            _bulk["current"].remove(t["name"])
        _bulk["results"].append(rec)
        _bulk["done"] += 1


def _bulk_worker(year: str) -> None:
    t0 = time.monotonic()
    try:
        tourns = schedule(Response(), year=year)["tournaments"]
    except Exception as e:  # noqa: BLE001
        _blog.error("=== %s aborted: schedule fetch failed: %s", year, e)
        with _bulk_lock:
            _bulk.update(running=False, error=f"schedule: {e}", finishedAt=time.time())
        return
    # only completed events: a live week's numbers are still moving, and a
    # future one has nothing to fetch
    todo = [t for t in tourns if t.get("tournamentStatus") == "COMPLETED"]
    _blog.info("=== %s start: %d completed events (%d skipped, not completed)",
               year, len(todo), len(tourns) - len(todo))
    with _bulk_lock:
        _bulk.update(total=len(todo), skipped=len(tourns) - len(todo))
    with ThreadPoolExecutor(max_workers=_BULK_WORKERS, thread_name_prefix="bulk") as pool:
        list(pool.map(_bulk_run_one, todo))
    with _bulk_lock:
        _bulk["cancelled"] = _bulk_cancel.is_set()
        _bulk.update(running=False, current=[], finishedAt=time.time())
        results = list(_bulk["results"])
    flagged = [r for r in results if r["flags"]]
    _blog.info("=== %s done%s: %d/%d events in %ds · %d clean · %d flagged",
               year, " (CANCELLED)" if _bulk_cancel.is_set() else "",
               len(results), len(todo), round(time.monotonic() - t0),
               len(results) - len(flagged), len(flagged))
    if flagged:
        _blog.warning("=== %s flagged: %s", year,
                      "; ".join(f"{r['name']} ({', '.join(r['flags'])})" for r in flagged))


@app.get("/api/bulkload")
def bulkload_status() -> dict:
    """Progress of the season download job ({running: false} if none yet)."""
    with _bulk_lock:
        return json.loads(json.dumps(_bulk))  # snapshot, not the live dict


@app.post("/api/bulkload")
def bulkload_start(year: str) -> dict:
    """Kick off a season download (409 if one is already running)."""
    if not (year.isdigit() and 2012 <= int(year) <= time.localtime().tm_year):
        raise HTTPException(400, f"year must be 2012–{time.localtime().tm_year}")
    with _bulk_lock:
        if _bulk.get("running"):
            raise HTTPException(409, "a season download is already running")
        _bulk_cancel.clear()
        _bulk.clear()
        _bulk.update(running=True, year=year, total=None, skipped=0, done=0,
                     current=[], results=[], error=None, cancelled=False,
                     startedAt=time.time(), finishedAt=None)
    threading.Thread(target=_bulk_worker, args=(year,), daemon=True).start()
    return bulkload_status()


@app.delete("/api/bulkload")
def bulkload_cancel() -> dict:
    """Ask the running job to stop after the current fetch."""
    _bulk_cancel.set()
    return bulkload_status()


@app.get("/api/cachestats")
def cachestats() -> dict:
    """Admin inventory: everything cached, grouped by tournament.

    Scans both tiers — SQLite is the durable record, Redis adds the hot/live
    entries (a Redis-only entry is a live payload on its 30 s TTL). Keys are
    structured (kind:tournament:...), so the rollup needs no payload reads.
    """
    prefix = f"golf:{CACHE_VERSION}:"
    entries: dict[str, dict] = {}
    try:
        with _disk() as c:
            for k, n, ts in c.execute("SELECT key, LENGTH(value), created_at FROM cache"):
                entries[k] = {"size": n, "disk": True, "redis": False, "at": ts}
    except _DISK_ERRORS as e:
        _tier_warn("sqlite-scan", e)
    redis_ok = True
    try:
        keys = list(_redis.scan_iter(match=prefix + "*", count=1000))
        if keys:
            pipe = _redis.pipeline()
            for k in keys:
                pipe.strlen(k)
            for k, n in zip(keys, pipe.execute()):
                e = entries.setdefault(k, {"size": 0, "disk": False, "at": None})
                e["redis"] = True
                e["size"] = max(e.get("size") or 0, n or 0)
    except redis.RedisError as e:
        redis_ok = False
        _tier_warn("redis-scan", e)

    tourns: dict[str, dict] = {}
    for k, e in entries.items():
        parts = k[len(prefix):].split(":")
        kind, tid = parts[0], parts[1] if len(parts) > 1 else ""
        if not tid.startswith("R"):
            continue
        rec = tourns.setdefault(tid, {
            "id": tid, "bytes": 0, "diskEntries": 0, "liveEntries": 0, "at": None,
            "coursemap": False, "coursestats": False, "holemaps": 0,
            "holebyhole": [], "shotPlayers": set(), "shotRounds": 0,
        })
        rec["bytes"] += e["size"]
        if e["disk"]:
            rec["diskEntries"] += 1
        else:
            rec["liveEntries"] += 1  # Redis-only: a live payload on TTL
        if e.get("at"):
            rec["at"] = max(rec["at"] or 0, e["at"])
        if kind == "coursemap":
            rec["coursemap"] = True
        elif kind == "coursestats2":
            rec["coursestats"] = True
        elif kind == "holemap":
            rec["holemaps"] += 1
        elif kind == "holebyhole" and len(parts) > 2:
            rec["holebyhole"].append(int(parts[2]))
        elif kind == "shotdetails" and len(parts) > 3:
            rec["shotPlayers"].add(parts[2])
            rec["shotRounds"] += 1
    out = []
    for rec in tourns.values():
        rec["shotPlayers"] = len(rec["shotPlayers"])
        rec["holebyhole"] = sorted(set(rec["holebyhole"]))
        out.append(rec)
    out.sort(key=lambda r: r["id"], reverse=True)
    try:
        db_bytes = _DB_PATH.stat().st_size
    except OSError:
        db_bytes = None
    return {"redisOk": redis_ok, "dbBytes": db_bytes, "entryCount": len(entries),
            "tournaments": out}


@app.get("/admin", response_class=HTMLResponse)
def admin() -> str:
    return (STATIC_DIR / "admin.html").read_text()


@app.get("/graphiql", response_class=HTMLResponse)
def graphiql() -> str:
    return (STATIC_DIR / "graphiql.html").read_text()


# Browsers happily reuse cached ES modules across visits, so after a deploy
# the app could run half-old code until a hard reload (stale hole-9 trails
# were exactly this). no-cache = revalidate every time: StaticFiles answers
# unchanged files with a tiny 304, changed ones with fresh bytes.
@app.middleware("http")
async def _no_stale_frontend(request, call_next):
    response = await call_next(request)
    p = request.url.path
    if p == "/" or p.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-cache"
    return response


# Serve the Shot Explorer at "/" and any other static assets under it.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
