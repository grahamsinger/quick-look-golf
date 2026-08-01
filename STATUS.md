# PGA TOUR data API — status of what's available

_Last verified: 2026-07-24, live against the 3M Open (`R2026525`)._

This documents the **unofficial pgatour.com GraphQL API** — the backend that
powers pgatour.com and its TOURCAST shot-tracker. It is the only free source of
genuine **shot-by-shot** (ShotLink-derived) PGA TOUR data I could find. It is
undocumented, unsupported, and governed by the pgatour.com Terms of Service.

For context on the alternatives (DataGolf = round-level only; ShotLink
Intelligence = licensed; Sportradar = enterprise), see the notes at the bottom.

---

## Endpoint & auth

| | |
|---|---|
| Prod (queries/mutations) | `https://orchestrator.pgatour.com/graphql` |
| Live (subscriptions, WebSocket) | `https://orchestrator-ws.pgatour.com/graphql` |
| Auth | single `x-api-key` request header |
| Transport | AWS AppSync behind CloudFront |
| Introspection | **enabled** (see below) |

The API key ships in the clear inside the site's JS bundle (`_app-*.js`). Eight
keys are present; any one authenticates. **Keys rotate** — don't hardcode them.
`pga/client.py:discover_keys()` re-scrapes the current keys from the live site.

Known key working on 2026-07-24: `da2-gsrx5bibzbb4njvhl7t37wqyl4`.

---

## What's available (verified working)

- **Introspection is enabled** — the entire schema is queryable. A full dump is
  checked in at `schema/schema.graphql` (SDL, ~8.7k lines) and
  `schema/schema.json` (raw). Regenerate with `uv run scripts/dump_schema.py`.
- **Schema surface: 925 types, 194 queries, 65 mutations, 57 subscriptions.**
  Note the website itself only uses ~124 named operations, so the schema exposes
  considerably more than the site wires up.

### Shot-by-shot (the headline)

`shotDetailsV3(tournamentId: ID!, playerId: ID!, round: Int!, includeRadar: Boolean): ShotDetails`

Returns `ShotDetails → holes[] (ShotDetailHole) → strokes[] (HoleStroke)`. Each
`HoleStroke` carries:

| Field | Example |
|---|---|
| `strokeNumber` | `1` |
| `distance` / `distanceRemaining` | `"282 yds"` / `"102 yds"` |
| `strokeType` | `STROKE`, `PUTT`, `PENALTY`, … (`HoleStrokeType`) |
| `fromLocation` / `toLocation` (+ `*Code`) | `"Tee Box"` → `"Left Rough"` (`OTB`→`ELR`) |
| `playByPlay` | `"282 yds to left rough, 102 yds to hole"` |
| `videoId` | id for the shot clip, when one exists |
| `overview` / `green` | `ShotLinkCoordWrapper` — positional coords (below) |
| `radarData` | TrackMan launch data (below), when `includeRadar: true` |
| `ballPath` | flight-path coordinate array |

Variants: `shotDetailsCompressedV3` (gzip payload, same data), `shotDetailsV4Compressed`,
and `playoffShotDetails` / `tspPlayoffShotDetails` for playoff & team-stroke-play formats.

**Coordinates** (`StrokeCoordinates`): the raw ShotLink `x`/`y`/`z` are redacted
(they return `-1`), but `tourcastX`/`tourcastY` (hole-map pixel space, ~0–16000)
and `enhancedX`/`enhancedY` (normalized) **are** populated — enough to plot every
shot on the hole diagram, just not as raw lat/long or the proprietary ShotLink grid.

**Radar** (`RadarData`, verified populated): `clubSpeed`, `ballSpeed`,
`smashFactor`, `verticalLaunchAngle`, `horizontalLaunchAngle`, `launchSpin`,
`spinAxis`, `apexHeight`, `apexRange`, `apexSide`, `actualFlightTime`, plus
`ballTrajectory` / `normalizedTrajectoryV2` arrays. (Some sub-fields are `0` when
the measurement wasn't captured for a given shot.)

### Everything else worth knowing about

- **Scorecards** — `scorecardV3` / `scorecardCompressedV3(tournamentId, playerId)`:
  hole-level scores, per round/nine.
- **Leaderboards** — `leaderboardV3`, `leaderboardStrokes`, `leaderboardHoleByHole`,
  plus match-play and team-stroke-play variants.
- **Hole detail / course map** — `holeDetails(tournamentId, courseId, hole)`:
  pin positions, hole imagery ("pickle" diagrams), scoring distribution.
- **Live positions** — `groupLocations(tournamentId, round)`: where each group is on course.
- **Reference** — tournaments, schedules, field, tee times, course stats, player
  profiles, stats leaders, odds, standings, weather, news & video.

### Live / streaming

57 `On*` subscriptions over the WebSocket endpoint stream real-time updates:
`OnUpdateGroupLocations`, `OnUpdateScorecardCompressedV3`, `OnUpdateHoleDetails`,
`OnUpdateShotDetailsCompressedV3`, `OnUpdateLeaderboardCompressedV3`, etc. (The
65 `update*` mutations are the AppSync publish side of these; not needed to read.)

### Compressed payloads

Any `*Compressed` operation returns a single `payload: String` that is
**base64-encoded gzip JSON**. Decode with `pga.decode_payload(payload)`
(`base64.b64decode` → `gzip.decompress` → `json.loads`). Used for the bandwidth-
heavy feeds (full scorecards, shot details).

---

## ID formats

- `tournamentId` — e.g. `R2026525` (`R` + season + event). Discover current/past
  IDs via the `tournaments` / schedule queries.
- `playerId` — numeric tour id as a string, e.g. Scottie Scheffler = `46046`.
- `round` — `1`–`4`. `courseId` (for `holeDetails`) — e.g. `883`; it's returned
  inside the scorecard payload (`roundScores[].courseId`).

---

## Caveats & risks

- **Unofficial & undocumented.** No SLA. Fields, keys, and endpoints can change
  without notice — the checked-in schema is a snapshot, re-dump to detect drift.
- **Key rotation.** Prefer `discover_keys()` over the `KNOWN_KEYS` fallback.
- **Terms of Service.** This is pgatour.com's private backend. Rate-limit
  yourself, cache aggressively, and don't redistribute in ways that violate their ToS.
- **Historical depth is unverified.** Confirm how far back `tournamentId`s and
  `shotDetailsV3` resolve before depending on old seasons.
- **Coordinates are tourcast/enhanced space, not raw ShotLink geo.**

---

## Alternatives (for reference)

| Source | Shot-level? | Access |
|---|---|---|
| **pgatour.com GraphQL** (this) | **Yes** (coords + radar) | Free, unofficial |
| DataGolf API | No — round-level SG only | ~Scratch Plus subscription |
| ShotLink Intelligence Program | Yes (raw) | Licensed; historically free for academics |
| Sportradar Golf API | Yes | Commercial / enterprise |
| ESPN hidden JSON, api.pga.com | No — per-hole scores | Free (api.pga.com is PGA _of America_) |

---

## Regenerate this

```bash
uv run scripts/dump_schema.py --discover   # fresh key + fresh schema dump
uv run scripts/example_shots.py            # sanity-check shot data end-to-end
```
