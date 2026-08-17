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
    parser.add_argument(
        "--demand-package-dir",
        help=(
            "Use an existing demand package (zone_attributes.csv + od_trip_matrix.csv) instead of "
            "building zones and synthesizing trips. Everything downstream — network, cordons, "
            "assignment, VMT — runs identically, which is what makes two demand models comparable "
            "on the same corridors. The package describes internal zones only; boundary cordons "
            "are added here. See scripts/modeling/demand_package.py."
        ),
    )
    parser.add_argument(
        "--zone-package-dir",
        help=(
            "Use an existing package's ZONE SYSTEM only (zone_attributes.csv) and let this model "
            "generate the trips onto it. The counterpart to --demand-package-dir, and the one that "
            "isolates a variable: comparing a full demand package against a default run changes the "
            "zones AND the demand model together, which cannot say which caused a difference."
        ),
    )
    parser.add_argument(
        "--calibrate-to-counts",
        help=(
            "OPT-IN. Path to an observed-count CSV (see build_expanded_aadt_counts.py). Fits "
            "per-road-class speed and capacity factors toward those counts, validating every step "
            "against a 30%% holdout that is never fitted. Produces a disclosed "
            "'calibrated_to_counts' claim, NOT the screening default, and does not by itself make "
            "a run pass the screening gate."
        ),
    )
    parser.add_argument(
        "--counts",
        choices=["auto", "none"],
        default="none",
        help=(
            "'auto' fetches this study area's published DOT traffic counts (no key, no path to "
            "supply) and compares the run against them. Where no feed is registered for the state, "
            "the run records that it has no accuracy figure rather than leaving it unsaid."
        ),
    )
    parser.add_argument(
        "--calibrate",
        action="store_true",
        help=(
            "With --counts auto, also FIT the model to those counts. The count set is split first: "
            "the model is fitted on one portion and graded on stations it never saw. Produces a "
            "disclosed 'calibrated_to_counts' claim and does not by itself make a run pass the gate."
        ),
    )
    parser.add_argument(
        "--reuse-network-from-run",
        help=(
            "Adopt the road network, zone centroids and gateways of an earlier run made with "
            "--keep-project, instead of downloading OSM again. Required when two runs are to be "
            "COMPARED: OSM changes continuously, so two separately-downloaded networks are two "
            "different networks and any difference in link volumes cannot be attributed to the "
            "demand. Refuses if the study areas or zone systems differ."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        require_boundary_selector(args.boundary_geojson, args.county_fips)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    from screening_runtime import ConfigurationError, run_screening_model

    # A setup problem is printed as a sentence and nothing else. Only
    # ConfigurationError — anything unexpected still prints its full traceback,
    # because a friendly line that hides a real crash is worse than the crash.
    try:
        summary = _run(run_screening_model, args)
    except ConfigurationError as exc:
        print(f"\n{exc}\n", file=sys.stderr)
        return 2

    return _finish(summary, args)


def _run(run_screening_model, args):
    return run_screening_model(
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
        demand_package_dir=args.demand_package_dir,
        zone_package_dir=args.zone_package_dir,
        calibrate_counts_csv=args.calibrate_to_counts,
        counts_mode=args.counts,
        calibrate_to_counts=args.calibrate,
        reuse_network_from=args.reuse_network_from_run,
    )


def _finish(summary, args) -> int:
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
