#!/usr/bin/env python3
"""The contract between a demand model and the assignment that uses it.

============================================================== WHAT THIS IS FOR

A screening run has two halves. The first decides WHO TRAVELS WHERE — zones, and
a matrix of daily trips between them. The second decides WHICH ROADS THEY USE —
download the network, attach centroids, add the boundary cordons, assign, and
measure. Only the second half is expensive to get right, and OpenPlan has
exactly one of it.

The two halves already meet at two files, written by every producer in the
repository:

    package/zone_attributes.csv     the zone system
    package/od_trip_matrix.csv      daily trips between those zones

This module makes that meeting point explicit and checked, so that the demand
half can be REPLACED without touching the assignment half:

  - `screening_runtime`'s own gravity model (the default today);
  - the worker lane's `generate_package`, which can build finer block-group
    zones and seed the distribution with real LODES commute flows;
  - and eventually an activity-based model's trip table.

Same network, same cordons, same assignment, different demand. That is what
makes a comparison between two demand models mean anything: hold everything
downstream constant, and a difference in a corridor is attributable to the
demand model rather than to routing.

======================================================= WHAT IT DELIBERATELY IS NOT

It is not a general-purpose loader. Every check below refuses rather than
repairs, because the failure it prevents is silent: a zone table whose rows do
not line up with the matrix beside it produces a complete run, a plausible map,
and numbers that describe nothing. There is no error to notice later — which is
why the alignment is asserted here, once, loudly.

Cordon zones are NOT part of the contract. A gateway is a property of the road
network and the study-area boundary, not of the demand model — no demand
producer knows where a highway crosses a county line, and an activity-based
model has no concept of one. The assignment half adds cordons itself, after
reading a package. A package therefore describes internal zones only, and
saying so is what keeps the two halves from both trying to own them.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ZONE_ATTRIBUTES_NAME = "zone_attributes.csv"
OD_MATRIX_NAME = "od_trip_matrix.csv"

#: Columns the ASSIGNMENT half actually reads. A producer that omits one of
#: these cannot be used, and the error names it.
#:
#: Deliberately shorter than the full zone table `screening_runtime` writes:
#: `worker_residents`, `retail_jobs` and friends feed the built-in gravity
#: model, and a package that supplies its own matrix has already used whatever
#: it needed. Requiring them would refuse a perfectly good ActivitySim trip
#: table for lacking inputs to a model it replaces.
REQUIRED_ZONE_COLUMNS = (
    "zone_id",
    "centroid_lon",  # where the centroid connector attaches
    "centroid_lat",
    "area_sq_mi",  # intrazonal trip length
    "est_population",  # the VMT denominator
)

#: Filled in when a producer omits them, because they are descriptive rather
#: than load-bearing. Each default is the honest one for a package that did not
#: say: no jobs recorded, no name, an internal zone.
OPTIONAL_ZONE_DEFAULTS: dict[str, Any] = {
    "GEOID": "",
    "NAMELSAD": "",
    "zone_kind": "internal",
    "total_jobs": 0.0,
    "retail_jobs": 0.0,
    "health_jobs": 0.0,
    "education_jobs": 0.0,
    "accommodation_jobs": 0.0,
    "govt_jobs": 0.0,
    "households": 0.0,
    "worker_residents": 0.0,
    "area_share": 1.0,
}


class DemandPackageError(ValueError):
    """A package that cannot be trusted to line up with its own matrix."""


def _read_zone_table(package_dir: Path) -> pd.DataFrame:
    zone_path = package_dir / ZONE_ATTRIBUTES_NAME
    if not zone_path.exists():
        raise DemandPackageError(f"No {ZONE_ATTRIBUTES_NAME} in {package_dir}")

    zones = pd.read_csv(zone_path)
    missing = [column for column in REQUIRED_ZONE_COLUMNS if column not in zones.columns]
    if missing:
        raise DemandPackageError(
            f"{zone_path} is missing required column(s): {', '.join(missing)}. "
            f"The assignment needs {', '.join(REQUIRED_ZONE_COLUMNS)}."
        )
    if zones.empty:
        raise DemandPackageError(f"{zone_path} has no zones")

    for column, default in OPTIONAL_ZONE_DEFAULTS.items():
        if column not in zones.columns:
            zones[column] = default

    zones["zone_id"] = zones["zone_id"].astype(int)
    if zones["zone_id"].duplicated().any():
        duplicates = sorted(zones.loc[zones["zone_id"].duplicated(), "zone_id"].unique())
        raise DemandPackageError(f"{zone_path} repeats zone_id(s): {duplicates}")

    # A cordon in a supplied package is a producer claiming something it cannot
    # know. Refusing is better than dropping it: a silently discarded zone
    # shifts every matrix row after it.
    supplied_cordons = zones.loc[zones["zone_kind"] == "external", "zone_id"].tolist()
    if supplied_cordons:
        raise DemandPackageError(
            f"{zone_path} declares external cordon zone(s) {supplied_cordons}. A package describes "
            "internal zones only — cordons depend on the road network and the study-area boundary, "
            "and the assignment adds them itself after reading this package."
        )

    for column in ("centroid_lon", "centroid_lat", "area_sq_mi", "est_population"):
        values = pd.to_numeric(zones[column], errors="coerce")
        if not np.isfinite(values.to_numpy(dtype=float)).all():
            raise DemandPackageError(f"{zone_path} has missing or non-numeric values in '{column}'")
        zones[column] = values.astype(float)

    return zones


def _read_od_matrix(package_dir: Path, zones: pd.DataFrame) -> np.ndarray:
    od_path = package_dir / OD_MATRIX_NAME
    if not od_path.exists():
        raise DemandPackageError(f"No {OD_MATRIX_NAME} in {package_dir}")

    od = pd.read_csv(od_path, index_col=0)
    zone_ids = zones["zone_id"].tolist()

    # THE CHECK THIS MODULE EXISTS FOR. A matrix whose labels do not match the
    # zone table produces a run that completes and describes nothing.
    row_ids = [int(value) for value in od.index]
    column_ids = [int(value) for value in od.columns]
    if row_ids != zone_ids or column_ids != zone_ids:
        raise DemandPackageError(
            f"{od_path} does not line up with {ZONE_ATTRIBUTES_NAME}: the table lists "
            f"{len(zone_ids)} zones {zone_ids[:4]}… and the matrix is {len(row_ids)}x{len(column_ids)} "
            f"labelled {row_ids[:4]}…. Rows and columns must be the zone ids, in the table's order."
        )

    matrix = od.to_numpy(dtype=float)
    if not np.isfinite(matrix).all():
        raise DemandPackageError(f"{od_path} contains missing or non-numeric trip values")
    if (matrix < 0).any():
        raise DemandPackageError(f"{od_path} contains negative trip values")
    return matrix


def read_demand_package(package_dir: Path) -> dict[str, Any]:
    """Load and CHECK a demand package. Raises rather than repairing.

    Returns the zone table, the trip matrix, and a provenance record naming
    where the demand came from — which has to travel with the run, because
    "which model produced this number" is the question the whole comparison
    exists to answer, and a run that cannot say is not evidence of anything.
    """
    package_dir = Path(package_dir).expanduser().resolve()
    if not package_dir.is_dir():
        raise DemandPackageError(f"Demand package directory does not exist: {package_dir}")

    zones = _read_zone_table(package_dir)
    matrix = _read_od_matrix(package_dir, zones)

    # A producer's own manifest, carried through verbatim when there is one. It
    # is how a reader learns the zone geography actually achieved, the demand
    # method, and the data vintages — none of which the assignment half can
    # work out for itself.
    manifest_path = package_dir / "manifest.json"
    manifest: dict[str, Any] | None = None
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
        except json.JSONDecodeError as exc:
            raise DemandPackageError(f"{manifest_path} is not readable JSON: {exc}") from exc

    return {
        "zones": zones,
        "matrix": matrix,
        "provenance": {
            "demand_source": "supplied_package",
            "package_dir": str(package_dir),
            "zone_count": int(len(zones)),
            "total_trips": round(float(matrix.sum()), 2),
            # None, never {} — an absent manifest and an empty one are different
            # facts about what the producer was willing to say.
            "producer_manifest": manifest,
        },
    }


def expand_matrix_for_cordons(matrix: np.ndarray, total_zone_count: int) -> np.ndarray:
    """Grow a supplied internal matrix to the full zone system, cordons included.

    The assignment half appends one zone per boundary crossing AFTER the package
    is read, so the supplied matrix is smaller than the final zone system. The
    new rows and columns are zero: a demand producer said nothing about travel
    through cordons it does not know exist, and zero is what "said nothing"
    means here. `build_external_gateway_matrix` fills them in immediately after.

    Internal zones keep their positions, which is what makes this safe — the
    cordons are appended to the end of the zone table, never interleaved.
    """
    internal_count = matrix.shape[0]
    if total_zone_count < internal_count:
        raise DemandPackageError(
            f"Cannot fit a {internal_count}-zone matrix into a {total_zone_count}-zone system"
        )
    expanded = np.zeros((total_zone_count, total_zone_count), dtype=float)
    expanded[:internal_count, :internal_count] = matrix
    return expanded
