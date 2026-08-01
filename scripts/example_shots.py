#!/usr/bin/env python
"""Pull shot-by-shot data for one player/round and print it.

Usage:
    uv run scripts/example_shots.py                     # Scheffler, 3M Open 2026, R1
    uv run scripts/example_shots.py R2026525 46046 2    # tournamentId playerId round
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pga import PGATourClient  # noqa: E402


def main() -> int:
    args = sys.argv[1:]
    tournament_id = args[0] if len(args) > 0 else "R2026525"  # 3M Open 2026
    player_id = args[1] if len(args) > 1 else "46046"  # Scottie Scheffler
    round_num = int(args[2]) if len(args) > 2 else 1

    with PGATourClient() as client:
        data = client.shot_details(tournament_id, player_id, round_num)

    holes = data["holes"]
    print(f"player {data['playerId']}  round {data['round']}  ({len(holes)} holes)\n")
    for hole in holes[:2]:  # first two holes for brevity
        print(f"Hole {hole['holeNumber']}  par {hole['par']}  "
              f"({hole['yardage']} yds)  scored {hole['score']}")
        for s in hole["strokes"]:
            radar = s.get("radarData") or {}
            ball = radar.get("ballSpeed")
            radar_str = f"  [ball {ball} mph]" if ball else ""
            print(f"  {s['strokeNumber']}. {s['playByPlay']}"
                  f"  ({s['fromLocation']} -> {s['toLocation']}){radar_str}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
