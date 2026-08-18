#!/usr/bin/env python3
"""Grade a gamma sweep against the pre-registered rule. Arithmetic only.

===================================================== WHAT THIS IS FOR

OpenPlan's screening model produces ~2.16x the published amount of driving
because the gravity model sends trips roughly twice as far as real trips go.
This reads a sweep of gamma multipliers and reports, for each one, the two
things the pre-registration named: how close the model's VMT per capita lands
to the published figure, and what happens to the error against traffic counts.

============================================== WHY THE TWO ARE KEPT APART

The fit is judged on **published VMT per capita** (FHWA / Census). The counts
are then an INDEPENDENT check the fit never saw. Fitting to counts and
reporting count error is the trap this lane has documented twice, so this file
never lets the count figures choose the multiplier — it only reports them.

`docs/modeling/TRIP_LENGTH_CALIBRATION_2026-08-17.md` is the pre-registration.
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

REPO_ROOT = _SCRIPT_DIR.parents[1]
METERS_PER_MILE = 1609.34

#: Daily VMT per capita, FHWA Highway Statistics 2022 table VM-2 divided by
#: Census Bureau 2022 population estimates. Read from the published table on
#: 2026-08-17, not recalled — an earlier comparison in this lane used recalled
#: figures and was wrong by 10-15 points.
PUBLISHED_DAILY_VMT_PER_CAPITA = {"06": 22.1, "08": 25.3, "41": 23.6, "53": 20.6}


class GammaFitError(RuntimeError):
    """The sweep cannot be graded, with the reason to show."""


def network_vmt(run_dir: Path) -> float:
    """Daily vehicle-miles on real roads, excluding centroid connectors.

    Connectors are modelling artifacts and carried 8.3% of modelled
    vehicle-miles in the study counties — enough to move every figure here.
    """
    import sqlite3

    database = run_dir / "work" / "aeq_project" / "project_database.sqlite"
    volumes = run_dir / "run_output" / "link_volumes.csv"
    if not database.exists() or not volumes.exists():
        raise GammaFitError(f"{run_dir.name} kept no project database or link volumes")

    connection = sqlite3.connect(database)
    try:
        lengths = {
            int(row[0]): (str(row[1] or ""), float(row[2] or 0.0))
            for row in connection.execute("SELECT link_id, link_type, distance FROM links")
        }
    finally:
        connection.close()

    total = 0.0
    with volumes.open(newline="") as handle:
        for row in csv.DictReader(handle):
            try:
                link_id = int(row["link_id"])
                volume = float(row.get("PCE_tot") or 0.0)
            except (TypeError, ValueError, KeyError):
                continue
            if volume <= 0 or link_id not in lengths:
                continue
            link_type, metres = lengths[link_id]
            if link_type == "centroid_connector":
                continue
            total += volume * metres / METERS_PER_MILE
    return total


def county_population(run_dir: Path) -> float:
    zones = run_dir / "package" / "zone_attributes.csv"
    if not zones.exists():
        raise GammaFitError(f"{run_dir.name} has no zone table")
    with zones.open(newline="") as handle:
        return sum(float(row.get("est_population") or 0) for row in csv.DictReader(handle))


def count_accuracy(run_dir: Path, validation_subdir: str = "validation") -> dict[str, Any]:
    """Median error and bias against observed counts — REPORTED, never fitted.

    `validation_subdir` exists because BOTH ARMS MUST BE GRADED ON THE SAME
    STATION SET. Runs made before ramp counts were excluded and shared-link
    pairings resolved (2026-08-17) match more stations than current runs do —
    102 against 75 in one county — and comparing those two directly would
    credit a gamma change with a station-set change. A baseline re-validated
    with current code lives in its own directory, and this is how it is read.
    """
    results = run_dir / validation_subdir / "validation_results.csv"
    if not results.exists():
        # A run legitimately has no count grading when its county publishes no
        # counts, and its VMT ratio is still valid — so this is not an error.
        # But it is REPORTED: a run never graded from the requested directory
        # would otherwise be summarized alongside runs that were, and an arm
        # assembled from a prefix glob would quietly average a different set
        # than its neighbour while claiming the same one.
        return {
            "stations": 0,
            "median_ape": None,
            "bias": None,
            "by_road_class": {},
            "validation_dir_missing": validation_subdir,
        }
    matched: list[dict[str, str]] = []
    with results.open(newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("match_status") == "matched" and row.get("absolute_percent_error"):
                matched.append(row)
    if not matched:
        return {"stations": 0, "median_ape": None, "bias": None, "by_road_class": {}}

    by_class: dict[str, list[float]] = {}
    for row in matched:
        by_class.setdefault(row.get("model_link_type") or "unknown", []).append(
            float(row["absolute_percent_error"])
        )
    return {
        "stations": len(matched),
        "median_ape": round(statistics.median(float(r["absolute_percent_error"]) for r in matched), 2),
        "bias": round(
            statistics.median(float(r["volume_ratio_model_obs"] or 0) for r in matched), 3
        ),
        "by_road_class": {
            name: {"stations": len(values), "median_ape": round(statistics.median(values), 2)}
            for name, values in sorted(by_class.items())
        },
    }


def grade_run(run_dir: Path, county_fips: str, validation_subdir: str = "validation") -> dict[str, Any]:
    published = PUBLISHED_DAILY_VMT_PER_CAPITA.get(county_fips[:2])
    if published is None:
        raise GammaFitError(
            f"No published VMT per capita for state {county_fips[:2]}; this study covers "
            f"{sorted(PUBLISHED_DAILY_VMT_PER_CAPITA)} only."
        )
    population = county_population(run_dir)
    if population <= 0:
        raise GammaFitError(f"{run_dir.name} recorded no population")
    vmt = network_vmt(run_dir)
    return {
        "county_fips": county_fips,
        "run_dir": str(run_dir),
        "model_vmt_per_capita": round(vmt / population, 2),
        "published_vmt_per_capita": published,
        "vmt_ratio": round((vmt / population) / published, 3),
        "counts": count_accuracy(run_dir, validation_subdir),
        "validation_read_from": validation_subdir,
    }


def summarize_arm(runs: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """One gamma multiplier's result across its counties."""
    if not runs:
        return {"counties": 0}
    ratios = [run["vmt_ratio"] for run in runs]
    apes = [run["counts"]["median_ape"] for run in runs if run["counts"]["median_ape"] is not None]
    by_class: dict[str, list[float]] = {}
    for run in runs:
        for name, block in run["counts"]["by_road_class"].items():
            if block["stations"] >= 3:
                by_class.setdefault(name, []).append(block["median_ape"])
    return {
        "counties": len(runs),
        "county_fips": sorted({run["county_fips"] for run in runs}),
        "median_vmt_ratio": round(statistics.median(ratios), 3),
        "median_count_ape": round(statistics.median(apes), 2) if apes else None,
        "stations": sum(run["counts"]["stations"] for run in runs),
        "median_ape_by_road_class": {
            name: round(statistics.median(values), 2) for name, values in sorted(by_class.items())
        },
    }


#: The four rules from `docs/modeling/TRIP_LENGTH_CALIBRATION_2026-08-17.md`,
#: written before any parameter was fitted. They live here as code so that
#: closing the experiment is arithmetic rather than someone reading a table and
#: deciding how they feel about it.
VMT_RATIO_TARGET = 1.0
VMT_RATIO_TOLERANCE = 0.35
REQUIRED_APE_IMPROVEMENT_POINTS = 20.0
CLASS_WORSENING_POINTS = 10.0
MINIMUM_CLASS_STATIONS = 20
MULTIPLIER_BAND = (0.5, 3.0)


def stations_by_class(runs: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for run in runs:
        for name, block in run["counts"]["by_road_class"].items():
            totals[name] = totals.get(name, 0) + int(block["stations"])
    return totals


def grade_against_preregistered_criteria(
    *,
    multiplier: float,
    baseline_arm: Mapping[str, Any],
    candidate_arm: Mapping[str, Any],
    candidate_runs: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Apply the four pre-registered rules. Adoption requires ALL of them.

    Graded on whatever counties are passed in. The pre-registration grades
    criteria 1-3 on the HOLDOUT counties; passing development counties here
    answers "is this worth confirming", never "adopt this".
    """
    criteria: list[dict[str, Any]] = []

    ratio = candidate_arm.get("median_vmt_ratio")
    low, high = VMT_RATIO_TARGET - VMT_RATIO_TOLERANCE, VMT_RATIO_TARGET + VMT_RATIO_TOLERANCE
    criteria.append({
        "criterion": 1,
        "rule": f"median model/published VMT per capita within {low}-{high}",
        "value": ratio,
        "passes": ratio is not None and low <= ratio <= high,
    })

    before, after = baseline_arm.get("median_count_ape"), candidate_arm.get("median_count_ape")
    improvement = round(before - after, 2) if before is not None and after is not None else None
    criteria.append({
        "criterion": 2,
        "rule": f"median count error improves by at least {REQUIRED_APE_IMPROVEMENT_POINTS} points",
        "value": improvement,
        "from": before,
        "to": after,
        "passes": improvement is not None and improvement >= REQUIRED_APE_IMPROVEMENT_POINTS,
    })

    counts = stations_by_class(candidate_runs)
    worsened = []
    for name, after_class in (candidate_arm.get("median_ape_by_road_class") or {}).items():
        before_class = (baseline_arm.get("median_ape_by_road_class") or {}).get(name)
        stations = counts.get(name, 0)
        if before_class is None or stations < MINIMUM_CLASS_STATIONS:
            continue
        if after_class - before_class > CLASS_WORSENING_POINTS:
            worsened.append({
                "road_class": name, "stations": stations,
                "from": before_class, "to": after_class,
                "worse_by_points": round(after_class - before_class, 2),
            })
    criteria.append({
        "criterion": 3,
        "rule": (
            f"no road class with at least {MINIMUM_CLASS_STATIONS} stations gets worse by more "
            f"than {CLASS_WORSENING_POINTS} points"
        ),
        "value": worsened,
        "classes_below_the_station_floor": sorted(n for n, c in counts.items() if c < MINIMUM_CLASS_STATIONS),
        "passes": not worsened,
    })

    criteria.append({
        "criterion": 4,
        "rule": f"multiplier between {MULTIPLIER_BAND[0]}x and {MULTIPLIER_BAND[1]}x",
        "value": multiplier,
        "passes": MULTIPLIER_BAND[0] <= multiplier <= MULTIPLIER_BAND[1],
    })

    failed = [c["criterion"] for c in criteria if not c["passes"]]
    return {
        "multiplier": multiplier,
        "criteria": criteria,
        "adoptable": not failed,
        "failed_criteria": failed,
        "verdict": (
            "All four pre-registered criteria pass."
            if not failed
            else f"Fails criteri{'on' if len(failed) == 1 else 'a'} {', '.join(str(c) for c in failed)}. "
            "The defaults stay and the result is reported as measured."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Grade a gamma sweep against published VMT per capita, reporting count error separately."
    )
    parser.add_argument(
        "--runs-root", default=str(REPO_ROOT / "data" / "screening-runs"),
        help="Where the run directories live",
    )
    parser.add_argument(
        "--prefix", action="append", required=True,
        help="One per arm: 'gam1.5' matches gam1.5-06069 etc. Repeat for each multiplier.",
    )
    parser.add_argument("--baseline-prefix", default="study", help="The unmultiplied arm's prefix")
    parser.add_argument(
        "--validation-subdir", default="validation",
        help=(
            "Which validation directory EVERY arm is graded from. Use this to re-grade a whole "
            "sweep with a corrected validator: all arms must come from the same one or they are "
            "compared on different rules."
        ),
    )
    parser.add_argument(
        "--baseline-validation-subdir", default=None,
        help=(
            "Which validation directory the BASELINE arm is graded from. Baselines predating the "
            "ramp and shared-link exclusions must be re-validated with current code and read from "
            "that directory, or the two arms are graded on different station sets."
        ),
    )
    parser.add_argument(
        "--county", action="append",
        help=(
            "Restrict every arm to these county FIPS codes. Without it an arm is whatever the "
            "prefix glob catches, which silently mixes in other runs and other counties."
        ),
    )
    parser.add_argument(
        "--multiplier", action="append", default=None, metavar="PREFIX=VALUE",
        help=(
            "Name the gamma multiplier an arm used, e.g. gam2-0=2.0, so the four pre-registered "
            "criteria can be applied to it. Repeat per arm."
        ),
    )
    parser.add_argument("--output", help="Write the full result as JSON")
    args = parser.parse_args()

    root = Path(args.runs_root).expanduser().resolve()
    arms: dict[str, list[dict[str, Any]]] = {}
    problems: list[str] = []

    for prefix in [args.baseline_prefix, *args.prefix]:
        runs: list[dict[str, Any]] = []
        # A prefix containing '*' is used as the pattern itself. Without this
        # 'study' matches study-06047-base AND study-06047-asim/-floor, folding
        # the activity-based and noise-floor arms into the trip-based
        # baseline's VMT median.
        pattern = prefix if "*" in prefix else f"{prefix}-*"
        for run_dir in sorted(root.glob(pattern)):
            parts = run_dir.name.split("-")
            county = next((part for part in parts if part.isdigit() and len(part) == 5), None)
            if county is None:
                continue
            if args.county and county not in args.county:
                continue
            try:
                subdir = args.validation_subdir
                if prefix == args.baseline_prefix and args.baseline_validation_subdir:
                    subdir = args.baseline_validation_subdir
                runs.append(grade_run(run_dir, county, subdir))
            except GammaFitError as exc:
                # Named, never skipped silently: an arm quietly missing a county
                # is an arm graded on a different set than its neighbour.
                problems.append(f"{run_dir.name}: {exc}")
        arms[prefix] = runs

    multipliers: dict[str, float] = {}
    for pair in args.multiplier or []:
        prefix, _, value = pair.partition("=")
        try:
            multipliers[prefix] = float(value)
        except ValueError:
            problems.append(f"--multiplier {pair}: not a number")

    requested = sorted(set(args.county or []))
    arm_coverage = {
        prefix: {
            "counties_present": sorted({run["county_fips"] for run in runs}),
            "counties_missing": sorted(set(requested) - {run["county_fips"] for run in runs}),
        }
        for prefix, runs in arms.items()
    }

    baseline_arm = summarize_arm(arms.get(args.baseline_prefix, []))
    grading = {
        prefix: grade_against_preregistered_criteria(
            multiplier=multiplier,
            baseline_arm=baseline_arm,
            candidate_arm=summarize_arm(arms.get(prefix, [])),
            candidate_runs=arms.get(prefix, []),
        )
        for prefix, multiplier in multipliers.items()
        if arms.get(prefix)
    }

    payload = {
        "schema_version": "openplan.gamma_fit.v1",
        "published_source": "FHWA Highway Statistics 2022 table VM-2 / Census 2022 population",
        "counties_requested": args.county,
        "runs_without_count_grading": {
            prefix: [
                Path(run["run_dir"]).name
                for run in runs
                if (run.get("counts") or {}).get("validation_dir_missing")
            ]
            for prefix, runs in arms.items()
        },
        "graded_from": {
            "every_arm": args.validation_subdir,
            "baseline_override": args.baseline_validation_subdir,
        },
        "arms": {prefix: summarize_arm(runs) for prefix, runs in arms.items()},
        "per_county": {prefix: runs for prefix, runs in arms.items()},
        # WHICH ARMS CAN BE COMPARED TO EACH OTHER AT ALL.
        #
        # An arm summarized over four counties and one over five are two
        # different medians, and the difference between them is the missing
        # county, not the parameter. This happened: a x4.0 arm lost one county
        # to an unfinished run and its median VMT ratio rose from 1.38 to 1.51,
        # which read as the curve reversing. Every county had in fact fallen
        # monotonically. The run WAS named in `runs_that_could_not_be_graded`
        # and I read the medians instead, so the fact now travels with the
        # comparison rather than beside it.
        "arms_are_comparable": len({tuple(sorted(a["counties_present"])) for a in arm_coverage.values()}) <= 1,
        "arm_coverage": arm_coverage,
        "preregistered_grading": grading,
        "runs_that_could_not_be_graded": problems,
        "what_this_is_not": [
            "The multiplier is chosen on published VMT per capita. The count figures are reported "
            "beside it as an independent check the fit never saw, and must not be used to choose.",
            "A right total is not a right distribution: matching VMT per capita says the model "
            "produces the right amount of driving, not that it is on the right roads.",
        ],
    }
    if args.output:
        Path(args.output).write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({"arms": payload["arms"], "ungraded": problems}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
