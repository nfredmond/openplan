#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from screening_boundary import require_boundary_selector


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a screening-grade auto assignment bundle for an arbitrary analysis boundary."
    )
    parser.add_argument("--name", required=True, help="Run name / output folder label")
    parser.add_argument("--boundary-geojson", help="Path to analysis boundary GeoJSON")
    parser.add_argument("--county-fips", help="Optional 5-digit county FIPS helper (e.g. 06057)")
    parser.add_argument("--output-root", help="Optional root folder for screening bundles")
    parser.add_argument("--cache-dir", help="Optional cache for TIGER downloads")
    parser.add_argument(
        "--network-buffer-miles",
        type=float,
        default=2.0,
        help="OSM network download pad around the analysis boundary (default: 2.0)",
    )
    parser.add_argument("--keep-project", action="store_true", help="Retain raw AequilibraE project files")
    parser.add_argument("--force", action="store_true", help="Replace an existing output folder with the same run name")
    parser.add_argument("--counts-csv", help="Optional observed-count station CSV for immediate validation bundle generation")
    parser.add_argument(
        "--ready-median-ape",
        type=float,
        default=30.0,
        help="Median absolute percent error threshold for bounded screening-ready validation (default: 30)",
    )
    parser.add_argument(
        "--ready-critical-ape",
        type=float,
        default=50.0,
        help="Maximum critical-facility absolute percent error threshold for bounded screening-ready validation (default: 50)",
    )
    parser.add_argument(
        "--required-matches",
        type=int,
        default=3,
        help="Minimum matched observed-count stations required for bounded screening-ready validation (default: 3)",
    )
    parser.add_argument(
        "--overall-demand-scalar",
        type=float,
        default=1.0,
        help="Multiply all synthesized trips by this scalar for sensitivity testing (default: 1.0)",
    )
    parser.add_argument(
        "--external-demand-scalar",
        type=float,
        default=1.0,
        help="Multiply inferred external gateway trips by this scalar for sensitivity testing (default: 1.0)",
    )
    parser.add_argument(
        "--hbw-scalar",
        type=float,
        default=1.0,
        help="Multiply home-based work demand by this scalar for sensitivity testing (default: 1.0)",
    )
    parser.add_argument(
        "--hbo-scalar",
        type=float,
        default=1.0,
        help="Multiply home-based other demand by this scalar for sensitivity testing (default: 1.0)",
    )
    parser.add_argument(
        "--nhb-scalar",
        type=float,
        default=1.0,
        help="Multiply non-home-based demand by this scalar for sensitivity testing (default: 1.0)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        require_boundary_selector(args.boundary_geojson, args.county_fips)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    from screening_runtime import run_screening_model

    summary = run_screening_model(
        name=args.name,
        boundary_geojson=args.boundary_geojson,
        county_fips=args.county_fips,
        output_root=args.output_root,
        cache_dir=args.cache_dir,
        network_buffer_miles=args.network_buffer_miles,
        keep_project=args.keep_project,
        force=args.force,
        counts_csv=args.counts_csv,
        ready_median_ape=args.ready_median_ape,
        ready_critical_ape=args.ready_critical_ape,
        required_matches=args.required_matches,
        overall_demand_scalar=args.overall_demand_scalar,
        external_demand_scalar=args.external_demand_scalar,
        hbw_scalar=args.hbw_scalar,
        hbo_scalar=args.hbo_scalar,
        nhb_scalar=args.nhb_scalar,
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
