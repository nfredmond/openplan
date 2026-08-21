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
import os
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
#: Same environment override the rest of the modeling lane uses, so one machine
#: configures spatialite once.
SPATIALITE_LIBRARY = os.getenv("SPATIALITE_LIBRARY_PATH", "mod_spatialite")

PUBLISHED_DAILY_VMT_PER_CAPITA = {"06": 22.1, "08": 25.3, "41": 23.6, "53": 20.6}


class GammaFitError(RuntimeError):
    """The sweep cannot be graded, with the reason to show."""


def network_vmt(run_dir: Path) -> float:
    """Daily vehicle-miles on real roads, excluding centroid connectors.

    Connectors are modelling artifacts and carried 8.3% of modelled
    vehicle-miles in the study counties — enough to move every figure here.

    NOT CLIPPED TO THE STUDY AREA, and the ratio built from it is therefore one
    end of a bracket rather than a measurement. Measured 2026-08-20
    (`docs/modeling/THE_VMT_RATIO_IS_A_BRACKET_2026-08-20.md`):

      * a screening network is built with a buffer, so **2.6% to 17.9% of these
        vehicle-miles are driven outside the county** whose residents divide
        them — a bias against small study areas, which is what OpenPlan is for.
        Clipping moves the headline median 1.666 to 1.590 and moves Broomfield
        from 1.049 to 0.861, across the line between over- and under-assigning.
      * more fundamentally, this counts EVERY vehicle on the county's roads,
        while `PUBLISHED_DAILY_VMT_PER_CAPITA` below is a per-RESIDENT rate. The
        same runs read a median 0.912 built from resident VMT and 2.223 built
        from this. Both are the model against the same published figure.

    So the number this feeds bounds the over-assignment above; it does not
    measure it. The fix is a county-level published VMT denominator, which this
    repository does not have and which has not been shown to exist for free.
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


def scoped_network_vmt(run_dir: Path) -> dict[str, Any]:
    """Model vehicle-miles reduced to what HPMS would have counted, for the
    county-denominator comparison that sits beside `vmt_ratio`.

    Two reductions, both reported rather than merely applied: clip each link by
    the share of its length inside the analysis boundary, and drop the OSM
    classes HPMS Full Extent does not publish by county. `vmt_sources` owns the
    class list and the arithmetic; the geometry stays here because it needs
    spatialite, and `vmt_sources` is deliberately stdlib-only.
    """
    import sqlite3

    from shapely import wkb  # noqa: PLC0415 - heavy, and only this path needs it
    from shapely.geometry import shape  # noqa: PLC0415

    import vmt_sources  # noqa: PLC0415

    database = run_dir / "work" / "aeq_project" / "project_database.sqlite"
    volumes = run_dir / "run_output" / "link_volumes.csv"
    boundary_path = run_dir / "boundary" / "analysis_boundary.geojson"
    for path in (database, volumes, boundary_path):
        if not path.exists():
            raise GammaFitError(f"{run_dir.name} has no {path.name}; cannot scope its vehicle-miles")

    raw = json.loads(boundary_path.read_text())
    geometry = raw["features"][0]["geometry"] if "features" in raw else raw["geometry"]
    boundary = shape(geometry)

    connection = sqlite3.connect(database)
    try:
        connection.enable_load_extension(True)
        connection.load_extension(SPATIALITE_LIBRARY)
        rows = connection.execute(
            "SELECT link_id, link_type, distance, ST_AsBinary(geometry) FROM links"
        ).fetchall()
    finally:
        connection.close()

    volume_by_link: dict[int, float] = {}
    with volumes.open(newline="") as handle:
        for row in csv.DictReader(handle):
            try:
                volume_by_link[int(row["link_id"])] = float(row.get("PCE_tot") or 0.0)
            except (TypeError, ValueError, KeyError):
                continue

    links = []
    for link_id, link_type, metres, blob in rows:
        volume = volume_by_link.get(int(link_id), 0.0)
        if volume <= 0 or not metres or blob is None:
            continue
        try:
            line = wkb.loads(bytes(blob))
        except Exception:  # noqa: BLE001 - a link without readable geometry is skipped, not guessed
            continue
        try:
            inside = (line.intersection(boundary).length / line.length) if line.length else 0.0
        except Exception:  # noqa: BLE001
            inside = 1.0 if boundary.intersects(line) else 0.0
        links.append({
            "link_type": str(link_type or ""),
            "vehicle_miles": volume * (float(metres) / METERS_PER_MILE),
            "inside_fraction": inside,
        })
    return vmt_sources.scoped_vmt_from_links(links)


def county_scoped_comparison(run_dir: Path, county_fips: str) -> dict[str, Any]:
    """The ratio whose numerator and denominator describe the same thing.

    Best effort by design. `vmt_ratio` is computed offline from files on disk;
    this needs a live HPMS query, and a study that cannot reach the network must
    still grade. So a failure is RECORDED with its reason and the caller keeps
    its other figures — but it is never silently absent, because "not computed"
    and "computed as nothing" are different facts.
    """
    import vmt_sources  # noqa: PLC0415

    try:
        numerator = scoped_network_vmt(run_dir)
        published = vmt_sources.county_vmt(county_fips[:2], county_fips)
    except Exception as error:  # noqa: BLE001 - the reason is the product here
        return {"available": False, "reason": f"{type(error).__name__}: {error}"}

    denominator = float(published["daily_vehicle_miles"])
    if denominator <= 0:
        return {"available": False, "reason": "HPMS reported no vehicle-miles for this county"}
    return {
        "available": True,
        "scope_matched_vmt_ratio": round(numerator["scoped_daily_vehicle_miles"] / denominator, 3),
        "model_scoped_daily_vmt": numerator["scoped_daily_vehicle_miles"],
        "model_unclipped_daily_vmt": numerator["unclipped_daily_vehicle_miles"],
        "dropped_outside_boundary": numerator["dropped_outside_boundary"],
        "dropped_out_of_hpms_scope": numerator["dropped_out_of_hpms_scope"],
        "published_county_daily_vmt": denominator,
        "published_source": published["source"],
        "published_vintage": published["vintage"],
        "published_is_derived": not published["is_published_figure"],
        "note": (
            "Numerator and denominator describe the same thing: vehicle-miles on this county's "
            "federal-aid roads. Reported BESIDE vmt_ratio, which does not — see "
            "docs/modeling/THE_VMT_RATIO_IS_A_BRACKET_2026-08-20.md. The denominator is derived "
            "from HPMS sections, not a published county figure."
        ),
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
        # Reported beside `vmt_ratio`, never instead of it: every figure this
        # lane has published rests on that definition, and redefining a number
        # that appears in dated records is how a record stops being one.
        "county_scoped": county_scoped_comparison(run_dir, county_fips),
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
