#!/usr/bin/env python3
"""Fetch published traffic counts for a study area, without anyone typing a path.

============================================================== WHY THIS EXISTS

Until now a run could be compared against real traffic counts only by someone
who knew to build a count set at a command line. So no run a planner could
produce had an accuracy figure at all — not a bad one, none. The figures went
into decisions with nothing said about how close to reality they were, because
the thing that would have said it required an operator step.

State DOTs publish this data free and without a key. The study area's own
boundary says which state it is in. There is nothing for a planner to supply.

======================================================= WHAT IT WILL NOT PRETEND

Most states are not registered yet — four are. A study area outside those does
not get a quiet skip: it gets a recorded reason, so a run without an accuracy
figure is distinguishable from one that was never checked, and both are
distinguishable from one that was checked and did badly.

A study area spanning two states is refused rather than guessed at. Counts from
one state's DOT wearing another's name in an appendix is a falsified citation,
and picking "the state most of the area is in" is exactly how that happens.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
WORKER_DIR = SCRIPT_DIR.parents[1] / "workers" / "aequilibrae_worker"
for candidate in (SCRIPT_DIR, WORKER_DIR):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

import count_sources  # noqa: E402
from lodes import STATE_FIPS_TO_ABBR  # noqa: E402


class CountsUnavailable(RuntimeError):
    """No count set can be built here, with the reason a planner should read."""


def registered_regions() -> list[str]:
    return sorted(count_sources.COUNT_SOURCES)


def region_for_state_fips(state_fips_codes: set[str]) -> str:
    """The DOT whose counts apply to this study area.

    Refuses a multi-state area rather than choosing. Every count row is stamped
    with the agency that published it, and an area straddling a state line has
    no single answer — attributing one state's counts to another is a citation
    that cannot be checked and would not be caught downstream.
    """
    if not state_fips_codes:
        raise CountsUnavailable("The study area did not record which state it is in.")
    if len(state_fips_codes) > 1:
        names = ", ".join(sorted((STATE_FIPS_TO_ABBR.get(f) or f).upper() for f in state_fips_codes))
        raise CountsUnavailable(
            f"This study area spans more than one state ({names}). Published count sets are "
            "per-state, and attributing one state's counts to another would be a citation nobody "
            "could check, so no automatic comparison is made here."
        )

    fips = next(iter(state_fips_codes))
    # Upper-cased on the way out. The worker's map yields lowercase ("ca") and
    # the count registry is keyed uppercase ("CA"), so the two look identical in
    # a log and match nothing — a mismatch that has already cost one debugging
    # round on the command line.
    region = (STATE_FIPS_TO_ABBR.get(fips) or "").upper() or None
    if not region:
        raise CountsUnavailable(f"No state is recorded for FIPS {fips}.")
    if region not in count_sources.COUNT_SOURCES:
        raise CountsUnavailable(
            f"No published traffic-count feed is registered for {region} yet. "
            f"Registered today: {', '.join(registered_regions())}. This run has no accuracy "
            "figure — not a poor one, none — and says so rather than leaving it to be assumed."
        )
    return region


def split_counts_for_calibration(counts_csv: Path, fit_csv: Path, holdout_csv: Path) -> dict[str, Any]:
    """Split a count set so the model is never graded on what it was fitted to.

    THE WHOLE POINT. Calibrating on a set of counts and then validating against
    the same set reports the accuracy of the data the model was fitted to. It
    looks like diligence and means nothing, and `run_screening_model` refuses
    the combination outright — this is how a run gets both honestly: fit on one
    portion, and let the GATE be decided by stations the model never saw.

    Uses the shared engine's own stratified, seed-deterministic split, so the
    stations held back here are the same ones the calibration holds back
    internally. Two different splits would mean the gate's "held out" and the
    calibration's "held out" were different sets, and neither claim would mean
    what it said.
    """
    import csv as csv_module

    import calibration

    with counts_csv.open(newline="") as handle:
        rows = list(csv_module.DictReader(handle))
        fieldnames = list(rows[0].keys()) if rows else []

    if len(rows) < 2:
        raise CountsUnavailable(
            f"Only {len(rows)} count station was found inside this study area. Splitting it would "
            "leave nothing to grade the model on, so calibration is not attempted here."
        )

    fit_rows, holdout_rows = calibration.split_holdout(rows)
    if not holdout_rows or not fit_rows:
        raise CountsUnavailable(
            "The count set could not be split into a fit and a held-back portion, so a calibrated "
            "run could not be graded on stations it never saw."
        )

    for path, subset in ((fit_csv, fit_rows), (holdout_csv, holdout_rows)):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="") as handle:
            writer = csv_module.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(subset)

    return {
        "fit_csv": str(fit_csv),
        "holdout_csv": str(holdout_csv),
        "fit_station_count": len(fit_rows),
        "holdout_station_count": len(holdout_rows),
        "split": (
            f"{len(fit_rows)} stations used to fit the model and {len(holdout_rows)} held back to "
            "grade it. The accuracy this run reports is measured only on the held-back stations."
        ),
    }


def fetch_counts_for_study_area(
    *,
    state_fips_codes: set[str],
    boundary_geojson_path: Path,
    project_db: Path,
    output_csv: Path,
    bbox: tuple[float, float, float, float],
    python_bin: str | None = None,
) -> dict[str, Any]:
    """Build a boundary-clipped count set for this study area, or say why not.

    Shells out to `build_expanded_aadt_counts.py` rather than importing it: that
    script owns the fetch, the normalisation, the boundary clip and the station
    crosswalk, and a second in-process path through the same work is how the two
    drift apart.
    """
    region = region_for_state_fips(state_fips_codes)
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    command = [
        python_bin or sys.executable,
        str(SCRIPT_DIR / "build_expanded_aadt_counts.py"),
        f"--fetch-bbox={','.join(f'{value:.5f}' for value in bbox)}",
        "--region",
        region,
        "--boundary-geojson",
        str(boundary_geojson_path),
        "--db",
        str(project_db),
        "--out",
        str(output_csv),
    ]
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0 or not output_csv.exists():
        raise CountsUnavailable(
            f"The {region} count feed could not be read for this study area: "
            f"{(completed.stderr or completed.stdout or '').strip()[:400] or 'no output'}"
        )

    station_count = max(sum(1 for _ in output_csv.open()) - 1, 0)
    if station_count == 0:
        raise CountsUnavailable(
            f"The {region} count feed returned no stations inside this study area. Published "
            "counts cover state highways; an area with none is not a modelling failure."
        )

    return {
        "region": region,
        "counts_csv": str(output_csv),
        "station_count": station_count,
        "provenance": count_sources.source_provenance(region),
    }
