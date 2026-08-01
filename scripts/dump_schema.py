#!/usr/bin/env python
"""Dump the live PGA TOUR GraphQL schema to schema/schema.json and schema/schema.graphql.

Usage:
    uv run scripts/dump_schema.py            # use a known key
    uv run scripts/dump_schema.py --discover # scrape a fresh key from the site
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Make the repo root importable (this is a "virtual" uv project, not installed).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from graphql import build_client_schema, print_schema  # noqa: E402

from pga import PGATourClient  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent.parent / "schema"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--discover",
        action="store_true",
        help="scrape a current x-api-key from the live site bundle first",
    )
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with PGATourClient(discover=args.discover) as client:
        print(f"endpoint : {client.endpoint}")
        print(f"api-key  : {client.api_key}")
        print("introspecting ...")
        introspection = client.introspect()

    schema = build_client_schema(introspection)
    type_count = len(
        [t for t in introspection["__schema"]["types"] if not t["name"].startswith("__")]
    )

    json_path = OUT_DIR / "schema.json"
    sdl_path = OUT_DIR / "schema.graphql"
    json_path.write_text(json.dumps(introspection, indent=2, sort_keys=True))
    sdl_path.write_text(print_schema(schema))

    print(f"types    : {type_count}")
    print(f"wrote    : {json_path.relative_to(OUT_DIR.parent)}")
    print(f"wrote    : {sdl_path.relative_to(OUT_DIR.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
