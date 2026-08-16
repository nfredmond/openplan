#!/usr/bin/env python3
"""Build a demand package for a study area, at tract or block-group resolution.

WHY THIS EXISTS
===============
`run_screening_model.py --demand-package-dir` can assign ANY demand package —
that seam is what lets two demand models be compared on the same corridors. This
is the first alternative producer for it: the worker lane's `generate_package`,
which can divide a study area into block groups instead of tracts (roughly three
times as many zones) and can seed the trip distribution with real LEHD commute
flows rather than a pure gravity model.

Zone resolution is the measured limit on this model. With 26 tract zones over a
whole county, one link carries about 28% of every trip in it and the average
trip is 12.6 miles centroid-to-centroid — which is why link volumes read far
too high even after both gateway defects were fixed. Finer zones are the lever;
this is how they are reached.

    # Build the package, then assign it:
    python scripts/modeling/build_demand_package.py \\
        --county-fips 06057 --zone-geography block_group --output-dir /tmp/pkg
    python scripts/modeling/run_screening_model.py \\
        --name finer-zones --county-fips 06057 --demand-package-dir /tmp/pkg

WHAT IT WILL NOT DO
===================
Claim a resolution it did not achieve. Block-group refinement can fail — a
study area may have no block-group coverage, or the LEHD residence files that
disaggregate tract population may be unavailable — and the producer falls back
to tracts when it does. This script reports the geography REQUESTED alongside
the one ACHIEVED, so a run that asked for 80 zones and got 26 can never be
mistaken for one that asked for 26.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
WORKER_DIR = SCRIPT_DIR.parents[1] / "workers" / "aequilibrae_worker"
for candidate in (SCRIPT_DIR, WORKER_DIR):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from screening_boundary import require_boundary_selector, resolve_boundary  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a demand package (zone_attributes.csv + od_trip_matrix.csv) for a study area."
    )
    parser.add_argument("--boundary-geojson", help="Path to an analysis boundary GeoJSON")
    parser.add_argument("--county-fips", help="County FIPS helper, e.g. 06057")
    parser.add_argument("--output-dir", required=True, help="Where to write the package")
    parser.add_argument(
        "--zone-geography",
        choices=["tract", "block_group"],
        default="block_group",
        help="Zone resolution to request (default: block_group)",
    )
    parser.add_argument("--cache-dir", help="Cache for boundary/TIGER downloads")
    return parser.parse_args()


def build_demand_package(
    *,
    boundary_geojson: str | None,
    county_fips: str | None,
    output_dir: str,
    zone_geography: str = "block_group",
    cache_dir: str | None = None,
) -> dict[str, Any]:
    from data_pipeline import generate_package

    repo_root = SCRIPT_DIR.parents[1]
    cache_path = Path(cache_dir).expanduser().resolve() if cache_dir else repo_root / "data" / "_screening_cache"
    boundary = resolve_boundary(boundary_geojson, county_fips, cache_path)
    geometry = boundary["geometry"]

    # The BOUNDARY POLYGON, not just its bounding box. `generate_package` keeps
    # a tract only when its centroid falls inside the geometry it is given, so
    # passing the polygon is what stops a county's package from quietly
    # including its neighbours — a bbox around any real county overlaps several.
    manifest = generate_package(
        output_dir=str(Path(output_dir).expanduser().resolve()),
        corridor_geojson=geometry.__geo_interface__,
        zone_geography=zone_geography,
    )

    achieved = str(manifest.get("zone_geography") or "unknown")
    manifest["zone_geography_requested"] = zone_geography
    manifest["zone_geography_achieved"] = achieved
    # THE FALLBACK MUST BE VISIBLE. Recording only what was achieved makes a run
    # that asked for finer zones and silently got coarse ones indistinguishable
    # from one that asked for coarse ones — and the difference is the whole
    # reason to have asked.
    manifest["zone_geography_fell_back"] = achieved != zone_geography
    manifest["study_area"] = {
        "source": boundary.get("source"),
        "label": boundary.get("label"),
        "county_fips": county_fips,
    }

    manifest_path = Path(output_dir).expanduser().resolve() / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    return manifest


def main() -> int:
    args = parse_args()
    try:
        require_boundary_selector(args.boundary_geojson, args.county_fips)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    manifest = build_demand_package(
        boundary_geojson=args.boundary_geojson,
        county_fips=args.county_fips,
        output_dir=args.output_dir,
        zone_geography=args.zone_geography,
        cache_dir=args.cache_dir,
    )

    if manifest["zone_geography_fell_back"]:
        print(
            f"\nNOTE: {manifest['zone_geography_requested']} zones were requested and "
            f"{manifest['zone_geography_achieved']} zones were produced. The package says so, and any "
            "run assigning it inherits that record.",
            file=sys.stderr,
        )
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
