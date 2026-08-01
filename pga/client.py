"""Minimal client for the unofficial PGA TOUR GraphQL API.

The API is AWS AppSync behind CloudFront. Auth is a single `x-api-key` header
whose value ships, in the clear, inside the pgatour.com JS bundle. Those keys
rotate, so `discover_keys()` re-scrapes them from the live site; `KNOWN_KEYS`
is only a last-resort fallback.
"""

from __future__ import annotations

import base64
import gzip
import json
import re
from typing import Any

import httpx
from graphql import build_client_schema, get_introspection_query

PROD_ENDPOINT = "https://orchestrator.pgatour.com/graphql"
WS_ENDPOINT = "https://orchestrator-ws.pgatour.com/graphql"  # subscriptions
SITE = "https://www.pgatour.com/"

# Fallback keys observed in the site bundle on 2026-07-24. These rotate — prefer
# PGATourClient(discover=True) to pull fresh ones. Order is arbitrary; the client
# tries each until one authenticates.
KNOWN_KEYS = [
    "da2-gsrx5bibzbb4njvhl7t37wqyl4",
    "da2-teu6bwqcgzaobbu2aazt3i7lkq",
    "da2-fmi36ir4dvavljcurr2ofyiota",
    "da2-w3m42v7r35cavjcei2kuiefigq",
    "da2-coitqxzlkrdknf6y6laddb3w4e",
    "da2-kquzxb3w4vhezhjosk5a74xx2u",
    "da2-ikmqdnxdbjarxhmgocdn3c2ude",
    "da2-krhfp4ml2bgp5cjsm5a7uezcva",
]

_KEY_RE = re.compile(r"da2-[a-z0-9]{26}")
_SCRIPT_SRC_RE = re.compile(r'<script[^>]+src="([^"]+)"')
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


def decode_payload(payload: str) -> Any:
    """Decode a `*Compressed` query's `payload` field (base64-encoded gzip JSON)."""
    raw = base64.b64decode(payload)
    return json.loads(gzip.decompress(raw))


class GraphQLError(RuntimeError):
    """Raised when a GraphQL response contains an `errors` array."""

    def __init__(self, errors: list[dict]):
        self.errors = errors
        super().__init__("; ".join(e.get("message", str(e)) for e in errors))


class PGATourClient:
    def __init__(
        self,
        endpoint: str = PROD_ENDPOINT,
        api_key: str | None = None,
        discover: bool = False,
        timeout: float = 30.0,
    ):
        self.endpoint = endpoint
        self._http = httpx.Client(
            timeout=timeout, headers={"user-agent": _USER_AGENT}
        )
        if discover:
            keys = self.discover_keys()
            self.api_key = keys[0] if keys else KNOWN_KEYS[0]
        else:
            self.api_key = api_key or KNOWN_KEYS[0]

    # -- introspection / bundle scraping ------------------------------------

    def discover_keys(self) -> list[str]:
        """Scrape the current x-api-key values from the live site bundle."""
        html = self._http.get(SITE).text
        srcs = _SCRIPT_SRC_RE.findall(html)
        keys: list[str] = []
        seen: set[str] = set()
        for src in srcs:
            if "_app" not in src and "webpack" not in src and "main" not in src:
                continue
            url = src if src.startswith("http") else SITE.rstrip("/") + src
            try:
                js = self._http.get(url).text
            except httpx.HTTPError:
                continue
            for k in _KEY_RE.findall(js):
                if k not in seen:
                    seen.add(k)
                    keys.append(k)
        return keys

    # -- core request -------------------------------------------------------

    def _post(self, body: dict) -> httpx.Response:
        """POST with the current key; on an auth failure, assume the key rotated,
        re-scrape fresh keys from the site bundle, and retry each candidate once.
        The working key sticks on the instance so the recovery cost is paid once.
        """
        resp = self._http.post(
            self.endpoint, json=body, headers={"x-api-key": self.api_key}
        )
        if resp.status_code not in (401, 403):
            resp.raise_for_status()
            return resp
        candidates = [
            k for k in [*self.discover_keys(), *KNOWN_KEYS] if k != self.api_key
        ]
        for key in dict.fromkeys(candidates):  # dedupe, keep order
            retry = self._http.post(
                self.endpoint, json=body, headers={"x-api-key": key}
            )
            if retry.status_code not in (401, 403):
                self.api_key = key
                retry.raise_for_status()
                return retry
        resp.raise_for_status()  # every key failed — surface the original 401/403
        return resp

    def query(
        self,
        query: str,
        variables: dict | None = None,
        operation_name: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {"query": query}
        if variables is not None:
            body["variables"] = variables
        if operation_name is not None:
            body["operationName"] = operation_name
        data = self._post(body).json()
        if data.get("errors"):
            raise GraphQLError(data["errors"])
        return data["data"]

    def post_raw(self, body: dict) -> dict:
        """Forward an arbitrary GraphQL body and return the full response.

        Unlike `query()`, this does NOT raise on GraphQL `errors` — it returns
        the raw `{"data": ..., "errors": ...}` envelope. Used by the server's
        passthrough proxy so GraphiQL can surface errors itself.
        """
        return self._post(body).json()

    def introspect(self) -> dict:
        """Return the raw introspection result: {"__schema": {...}}."""
        return self.query(get_introspection_query(descriptions=True))

    def client_schema(self):
        """Return a graphql-core GraphQLSchema built from live introspection."""
        return build_client_schema(self.introspect())

    # -- convenience --------------------------------------------------------

    def shot_details(
        self,
        tournament_id: str,
        player_id: str,
        round_num: int,
        include_radar: bool = True,
    ) -> dict:
        """Shot-by-shot data for one player/round (holes -> strokes)."""
        q = """
        query ShotDetailsV3($t: ID!, $p: ID!, $r: Int!, $radar: Boolean) {
          shotDetailsV3(tournamentId: $t, playerId: $p, round: $r, includeRadar: $radar) {
            playerId round
            holes {
              holeNumber par score yardage
              strokes {
                strokeNumber distance distanceRemaining strokeType
                fromLocation toLocation fromLocationCode toLocationCode
                playByPlay finalStroke videoId
                overview { leftToRightCoords {
                  fromCoords { tourcastX tourcastY enhancedX enhancedY }
                  toCoords   { tourcastX tourcastY enhancedX enhancedY }
                } }
                radarData { clubSpeed ballSpeed smashFactor
                            verticalLaunchAngle launchSpin apexHeight }
              }
            }
          }
        }
        """
        return self.query(
            q,
            {"t": tournament_id, "p": player_id, "r": round_num, "radar": include_radar},
            operation_name="ShotDetailsV3",
        )["shotDetailsV3"]

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "PGATourClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
