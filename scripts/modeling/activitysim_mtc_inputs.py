#!/usr/bin/env python3
"""Make a screening run runnable by ActivitySim's stock prototype_mtc example.

=========================================================== WHAT THIS DOES

The dual-model comparison needs ActivitySim to actually produce a trip list.
The stock ``prototype_mtc`` example that ships inside the installed ActivitySim
wheel can run OpenPlan's zones today IF it is handed inputs in exactly the
shape its specifications expect: a land-use table with the MTC column
vocabulary, households and persons carrying the MTC person-type codes, and a
skim file containing every matrix the utility expressions reference.

This file builds those inputs. It is the *adapter to one named configuration
package*, the way ``census_pums.py`` is the adapter to one country's data:
everything prototype_mtc-specific lives here and nowhere else.

The route is LAYERED CONFIGS, not edited ones. The stock configuration in
site-packages is never touched; the bundle's own small ``settings.yaml``
overlay (``inherit_settings: True``) is passed as the first ``-c`` and the
stock directory as the second. A SHA-256 of the stock directory is recorded in
the bundle so "unmodified" is checkable at run time, not asserted.

============================================= WHAT IS REAL AND WHAT IS ZERO

Real, from the screening run's own network:
  - every auto TIME matrix (free-flow travel time, identical in all five
    periods — stated in the caveats, not hidden)
  - every auto DIST matrix and DIST/DISTWALK/DISTBIKE (routed network
    distance in miles)

Zero, deliberately:
  - every transit matrix. The stock specifications' own availability tests
    (``TOTIVT > 0``) then disable every transit alternative, so zero is not a
    lie about service levels — it is the documented mechanism for "this model
    run offers no transit".
  - every toll matrix (BTOLL/VTOLL).

Never invented: a skim name the specs reference but this file cannot supply
with either a real value or a documented zero is an error, not a guess.

=================================================== THE COEFFICIENT CAVEAT

Making prototype_mtc run does NOT make its behaviour local. The coefficients
are estimated for the San Francisco Bay Area, and every artifact this module
touches says so. That caveat is prerequisite #3 of the dual-model plan and it
is the reason nothing produced through this path can rise above screening
grade.

Import discipline: module top level is stdlib-only (the preflight worker
image has no numpy), heavy imports live inside the functions that need them.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from screening_metrics import METERS_PER_MILE, intrazonal_miles


class MtcInputError(ValueError):
    """The MTC inputs cannot be built, with the reason a planner should read."""


# --------------------------------------------------------------------------
# Person coding. The code values are ActivitySim's prototype_mtc constants
# (configs/constants.yaml); the derivation from raw PUMS codes was validated
# against the stock example's own persons.csv — the rule below reproduces the
# shipped ptype for all 8,212 example persons exactly (0 mismatches,
# 2026-08-16). tests/test_activitysim_mtc_inputs.py re-runs that check.
# --------------------------------------------------------------------------

PEMPLOY_FULL, PEMPLOY_PART, PEMPLOY_NOT, PEMPLOY_CHILD = 1, 2, 3, 4
PSTUDENT_GRADE_OR_HIGH, PSTUDENT_UNIVERSITY, PSTUDENT_NOT = 1, 2, 3
(
    PTYPE_FULL,
    PTYPE_PART,
    PTYPE_UNIVERSITY,
    PTYPE_NONWORK,
    PTYPE_RETIRED,
    PTYPE_DRIVING,
    PTYPE_SCHOOL,
    PTYPE_PRESCHOOL,
) = range(1, 9)

# PUMS WKHP is usual hours worked per week; 35+ is the Census full-time line.
FULL_TIME_HOURS_PER_WEEK = 35.0

# PUMS SCHG (2019+ coding): 1 nursery/preschool … 14 grade 12, 15 college
# undergraduate, 16 graduate or professional school; blank = not attending.
SCHG_K12_CODES = frozenset(str(code) for code in range(1, 15))
SCHG_UNIVERSITY_CODES = frozenset({"15", "16"})


def derive_pemploy(age: int, esr: Any, wkhp: Any, *, is_working: Callable[[Any], bool]) -> int:
    """MTC employment status from raw PUMS codes.

    ``is_working`` is injected (``census_pums.is_worker`` in production) so the
    single authority on ESR semantics stays in the US adapter.
    """
    if age < 16:
        return PEMPLOY_CHILD
    if not is_working(esr):
        return PEMPLOY_NOT
    try:
        hours = float(wkhp)
    except (TypeError, ValueError):
        # An employed person with unreported usual hours: part-time is the
        # conservative reading, and the caller counts these rows.
        return PEMPLOY_PART
    return PEMPLOY_FULL if hours >= FULL_TIME_HOURS_PER_WEEK else PEMPLOY_PART


def derive_pstudent(schg: Any) -> int:
    code = str(schg or "").strip()
    if code in SCHG_K12_CODES:
        return PSTUDENT_GRADE_OR_HIGH
    if code in SCHG_UNIVERSITY_CODES:
        return PSTUDENT_UNIVERSITY
    return PSTUDENT_NOT


def derive_ptype(age: int, pemploy: int, pstudent: int) -> int:
    """The MTC person type, exactly as the stock example data codes it.

    Precedence, validated against all 8,212 stock persons: full-time work
    beats everything; university enrolment beats age; K-12 enrolment maps by
    age (adults enrolled in grade school are treated as university students);
    children are students whether or not enrolment was reported.
    """
    if pemploy == PEMPLOY_FULL:
        return PTYPE_FULL
    if pstudent == PSTUDENT_UNIVERSITY:
        return PTYPE_UNIVERSITY
    if pstudent == PSTUDENT_GRADE_OR_HIGH:
        if age < 6:
            return PTYPE_PRESCHOOL
        if age < 16:
            return PTYPE_SCHOOL
        if age < 20:
            return PTYPE_DRIVING
        return PTYPE_UNIVERSITY
    if age < 6:
        return PTYPE_PRESCHOOL
    if age < 16:
        return PTYPE_SCHOOL
    if pemploy == PEMPLOY_PART:
        return PTYPE_PART
    if age >= 65:
        return PTYPE_RETIRED
    return PTYPE_NONWORK


# --------------------------------------------------------------------------
# Income. The MTC specifications segment household income in YEAR-2000
# dollars (annotate_households.csv bins income/1000 at 30/60/100); the fitted
# population's incomes arrive in the ACS file's final-year dollars via ADJINC.
# BLS CPI-U annual averages (series CUUR0000SA0): 2000 = 172.2, 2022 =
# 292.655. Historical annual averages do not change; the vintage guard below
# is what keeps this honest if the ACS endpoint is ever repointed.
# --------------------------------------------------------------------------

CPI_U_ANNUAL_2000 = 172.2
CPI_U_ANNUAL_2022 = 292.655
INCOME_DEFLATOR_TO_2000 = CPI_U_ANNUAL_2000 / CPI_U_ANNUAL_2022
INCOME_DEFLATOR_SOURCE_YEAR = 2022


def check_income_vintage(acs5_url: str) -> None:
    """Refuse to deflate incomes from a vintage the deflator was not built for.

    The ACS endpoint year is configurable (CENSUS_ACS5_URL). ADJINC always
    adjusts to the file's own final year, so a repointed endpoint silently
    changes what dollars the incomes are in — and a deflator applied to the
    wrong base year is invisible in every downstream number.
    """
    match = re.search(r"/data/(\d{4})/", str(acs5_url))
    year = int(match.group(1)) if match else None
    if year != INCOME_DEFLATOR_SOURCE_YEAR:
        raise MtcInputError(
            f"The year-2000 income deflator here is built for the {INCOME_DEFLATOR_SOURCE_YEAR} "
            f"ACS vintage, but the configured endpoint is {acs5_url!r}. Update "
            "CPI_U_ANNUAL_* and INCOME_DEFLATOR_SOURCE_YEAR together before using a "
            "different vintage."
        )


# --------------------------------------------------------------------------
# Households and persons in the MTC vocabulary.
# --------------------------------------------------------------------------


def mtc_households(household_rows: Sequence[Mapping[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """The fitted households, renamed and re-denominated for prototype_mtc.

    Requires the census-fitted schema (hht present, incomes in final-year
    dollars). A scaffold population has none of that, and pretending it does
    would put invented household types under Bay Area behaviour — refuse.
    """
    if not household_rows:
        raise MtcInputError("No households were supplied, so there is nothing to convert.")
    missing = [c for c in ("household_id", "home_zone_id", "persons", "workers", "autos", "income", "hht") if c not in household_rows[0]]
    if missing:
        raise MtcInputError(
            "The MTC config package needs households fitted from Census microdata; the supplied "
            f"households are missing {', '.join(missing)}. Build the bundle with --population census."
        )
    rows: list[dict[str, Any]] = []
    hht_unreported = 0
    for row in household_rows:
        try:
            hht = int(float(row.get("hht") or 0))
        except (TypeError, ValueError):
            hht = 0
        if hht == 0:
            hht_unreported += 1
        rows.append(
            {
                "household_id": int(row["household_id"]),
                "home_zone_id": int(row["home_zone_id"]),
                "income": int(round(float(row["income"]) * INCOME_DEFLATOR_TO_2000)),
                "hhsize": int(row["persons"]),
                "HHT": hht,
                "auto_ownership": int(row["autos"]),
                "num_workers": int(row["workers"]),
            }
        )
    accounting = {
        "households": len(rows),
        "hht_unreported": hht_unreported,
        "income_dollar_year": 2000,
        "income_deflator": round(INCOME_DEFLATOR_TO_2000, 6),
        "income_deflator_basis": (
            f"BLS CPI-U annual averages (CUUR0000SA0): {CPI_U_ANNUAL_2000} (2000) / "
            f"{CPI_U_ANNUAL_2022} ({INCOME_DEFLATOR_SOURCE_YEAR})"
        ),
    }
    return rows, accounting


def mtc_persons(person_rows: Sequence[Mapping[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """The fitted persons with MTC person-type codes derived from raw PUMS codes."""
    if not person_rows:
        raise MtcInputError("No persons were supplied, so there is nothing to convert.")
    missing = [c for c in ("person_id", "household_id", "person_num", "age", "sex", "esr", "schg", "wkhp") if c not in person_rows[0]]
    if missing:
        raise MtcInputError(
            "The MTC config package needs persons carrying raw PUMS codes; the supplied persons "
            f"are missing {', '.join(missing)}. Build the bundle with --population census."
        )
    import census_pums as cp  # lazy: pulls numpy via population_synthesis

    rows: list[dict[str, Any]] = []
    hours_unreported_workers = 0
    ptype_counts: dict[int, int] = {}
    for row in person_rows:
        age = int(float(row["age"]))
        esr = row.get("esr")
        wkhp = row.get("wkhp")
        if age >= 16 and cp.is_worker(esr):
            try:
                float(wkhp)
            except (TypeError, ValueError):
                hours_unreported_workers += 1
        pemploy = derive_pemploy(age, esr, wkhp, is_working=cp.is_worker)
        pstudent = derive_pstudent(row.get("schg"))
        ptype = derive_ptype(age, pemploy, pstudent)
        ptype_counts[ptype] = ptype_counts.get(ptype, 0) + 1
        rows.append(
            {
                "person_id": int(row["person_id"]),
                "household_id": int(row["household_id"]),
                "age": age,
                "PNUM": int(row["person_num"]),
                "sex": int(float(row["sex"] or 1)),
                "pemploy": pemploy,
                "pstudent": pstudent,
                "ptype": ptype,
            }
        )
    accounting = {
        "persons": len(rows),
        "workers_with_unreported_hours_treated_part_time": hours_unreported_workers,
        "ptype_counts": {str(k): v for k, v in sorted(ptype_counts.items())},
    }
    return rows, accounting


# --------------------------------------------------------------------------
# Land use in the MTC vocabulary.
# --------------------------------------------------------------------------

# How OpenPlan's screening employment buckets map onto MTC's six NAICS-based
# sectors. The screening source distinguishes retail, health, education,
# accommodation/food and government; MTC's HEREMPN is health + educational +
# recreational services (NAICS 61/62/71/72), which is where accommodation/food
# belongs under the MTC grouping. Everything the source cannot distinguish is
# carried in OTHEMPN rather than invented into FPSEMPN/AGREMPN/MWTEMPN — a
# fabricated sector split would silently steer workplace location choice.
EMPLOYMENT_SECTORS = ("RETEMPN", "FPSEMPN", "HEREMPN", "OTHEMPN", "AGREMPN", "MWTEMPN")

ACRES_PER_SQ_MI = 640.0

# MTC Travel Model One's area-type convention: a composite density of
# (population + 2.5 x employment) per developed acre, banded 0 (regional
# core) … 5 (rural). The breakpoints are MTC's own, applied here to gross
# zone acreage because the screening source has no developed-acres layer —
# which biases large rural zones further toward rural, the right direction
# for honesty (disclosed in the caveats).
AREA_TYPE_BREAKPOINTS = ((300.0, 0), (100.0, 1), (55.0, 2), (30.0, 3), (6.0, 4))
AREA_TYPE_RURAL = 5


def area_type_of(composite_density: float) -> int:
    for threshold, code in AREA_TYPE_BREAKPOINTS:
        if composite_density >= threshold:
            return code
    return AREA_TYPE_RURAL


def internal_zones_in_order(zone_rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Internal zones sorted by zone_id — the one ordering land use, households
    and every skim row must share, because the zero-based recode makes the
    land-use ROW POSITION the zone's identity inside ActivitySim."""
    internal = [
        dict(row)
        for row in zone_rows
        if str(row.get("zone_kind") or "internal").strip().lower() not in ("external", "cordon", "gateway")
    ]
    if not internal:
        raise MtcInputError("The zone table has no internal zones, so there is nothing to model.")
    return sorted(internal, key=lambda row: int(float(row["zone_id"])))


def mtc_land_use(
    zone_rows: Sequence[Mapping[str, Any]],
    households_rows: Sequence[Mapping[str, Any]],
    persons_rows: Sequence[Mapping[str, Any]],
    enrollment_by_geoid: Mapping[str, Mapping[str, float]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """One MTC land-use row per internal zone.

    Population and household totals come from the population that is actually
    in the bundle, so the two tables can never disagree; employment comes from
    the screening zone attributes; enrolment from ACS B14001 (by residence —
    the risk that a school's seats sit in a different zone from its students
    is disclosed, not hidden).
    """
    zones = internal_zones_in_order(zone_rows)

    tothh: dict[int, int] = {}
    totpop: dict[int, int] = {}
    age0519: dict[int, int] = {}
    for row in households_rows:
        zone = int(row["home_zone_id"])
        tothh[zone] = tothh.get(zone, 0) + 1
    for row in persons_rows:
        zone = int(row["home_zone_id"])
        totpop[zone] = totpop.get(zone, 0) + 1
        age = int(float(row["age"]))
        if 5 <= age <= 19:
            age0519[zone] = age0519.get(zone, 0) + 1

    out: list[dict[str, Any]] = []
    zones_missing_enrollment = []
    for row in zones:
        zone_id = int(float(row["zone_id"]))
        geoid = str(row.get("GEOID") or "").strip()
        total_jobs = float(row.get("total_jobs") or 0)
        retail = float(row.get("retail_jobs") or 0)
        here = (
            float(row.get("health_jobs") or 0)
            + float(row.get("education_jobs") or 0)
            + float(row.get("accommodation_jobs") or 0)
        )
        govt = float(row.get("govt_jobs") or 0)
        categorized = retail + here + govt
        other = govt + max(0.0, total_jobs - categorized)
        totemp = int(round(retail + here + other))

        acres = float(row.get("area_sq_mi") or 0) * ACRES_PER_SQ_MI
        zone_hh = tothh.get(zone_id, 0)
        zone_pop = totpop.get(zone_id, 0)
        # Gross acreage split between residential and commercial/industrial in
        # proportion to households vs jobs; the SUM is what the stock density
        # expressions divide by, and it is floored at 1 acre so an empty or
        # zero-area zone cannot divide by zero.
        weight_hh = float(zone_hh)
        weight_emp = float(totemp)
        if weight_hh + weight_emp > 0:
            resacre = acres * weight_hh / (weight_hh + weight_emp)
        else:
            resacre = acres / 2.0
        ciacre = max(acres - resacre, 0.0)
        if resacre + ciacre < 1.0:
            resacre = 1.0
            ciacre = 0.0

        density = (zone_pop + 2.5 * totemp) / (resacre + ciacre)

        enrollment = enrollment_by_geoid.get(geoid)
        if enrollment is None:
            zones_missing_enrollment.append(geoid or str(zone_id))
            enrollment = {"high_school": 0.0, "college": 0.0}

        out.append(
            {
                "zone_id": zone_id,
                # Never referenced by any non-legacy spec expression; kept so
                # the stock keep_columns list needs no editing.
                "DISTRICT": 1,
                "SD": 1,
                # 0 matches NONE of MTC's nine Bay Area county ids (1-9), so
                # no county-specific dummy in auto_ownership.csv or
                # free_parking.csv fires on someone else's study area.
                "county_id": 0,
                "TOTHH": zone_hh,
                "TOTPOP": zone_pop,
                "TOTACRE": round(acres, 4),
                "RESACRE": round(resacre, 4),
                "CIACRE": round(ciacre, 4),
                "TOTEMP": totemp,
                "AGE0519": age0519.get(zone_id, 0),
                "RETEMPN": int(round(retail)),
                "FPSEMPN": 0,
                "HEREMPN": int(round(here)),
                "OTHEMPN": int(round(other)),
                "AGREMPN": 0,
                "MWTEMPN": 0,
                "PRKCST": 0.0,
                "OPRKCST": 0.0,
                "area_type": area_type_of(density),
                "HSENROLL": float(enrollment.get("high_school") or 0.0),
                "COLLFTE": float(enrollment.get("college") or 0.0),
                "COLLPTE": 0.0,
                # 1 = flat, the MTC convention's mildest value; the screening
                # source carries no terrain layer.
                "TOPOLOGY": 1,
                "TERMINAL": 0.0,
                "source_geoid": geoid,
            }
        )

    # The six sectors must sum to TOTEMP row by row — workplace location
    # spreads its size term across them, and a gap between the sectors and the
    # total would be invisible until work locations came out wrong.
    for row in out:
        sector_sum = sum(int(row[s]) for s in EMPLOYMENT_SECTORS)
        row["TOTEMP"] = sector_sum

    accounting = {
        "zones": len(out),
        "employment_mapping": {
            "RETEMPN": "retail_jobs",
            "HEREMPN": "health_jobs + education_jobs + accommodation_jobs",
            "OTHEMPN": "govt_jobs + uncategorised remainder of total_jobs",
            "FPSEMPN": "0 (not distinguished by the screening land-use source)",
            "AGREMPN": "0 (not distinguished by the screening land-use source)",
            "MWTEMPN": "0 (not distinguished by the screening land-use source)",
        },
        "area_type_convention": (
            "MTC Travel Model One composite density (population + 2.5 x employment per acre) over "
            "GROSS zone acreage, breakpoints 300/100/55/30/6 for area types 0-4, else 5 (rural)"
        ),
        "zones_missing_enrollment": zones_missing_enrollment,
        "enrollment_source": "ACS B14001 (enrolment by residence)",
    }
    return out, accounting


# --------------------------------------------------------------------------
# Skims. The inventory is read live from the installed stock example's own
# skims.omx — never recalled — and cross-checked against a live scan of every
# skim name the stock spec files reference.
# --------------------------------------------------------------------------

# Every accessor spelling that appears in the 1.5.1 prototype_mtc specs.
_BRACKET_SKIM_RE = re.compile(
    r"(?:skims|od_skims|odt_skims|odr_skims|dot_skims|dor_skims|dp_skims|"
    r"trip_od_skims|trip_odt_skims)\[\s*['\"]([A-Za-z0-9_]+)['\"]\s*\]"
)
# Tuple-style lookups: skim_od[('NAME', 'AM')], skim_dict.lookup(..., ('NAME', 'MD')).
_TUPLE_SKIM_RE = re.compile(r"\(\s*['\"]([A-Za-z0-9_]+)['\"]\s*,\s*['\"](EA|AM|MD|PM|EV)['\"]\s*\)")

AUTO_SKIM_FAMILIES = ("SOV", "SOVTOLL", "HOV2", "HOV2TOLL", "HOV3", "HOV3TOLL")
NONMOTORIZED_DISTANCE_NAMES = frozenset({"DIST", "DISTWALK", "DISTBIKE"})
UNREACHABLE_SENTINEL = 9999.0
# Intrazonal travel is real travel: a zero diagonal would trip the specs' own
# ``SOV_TIME > 0`` availability tests and push every intrazonal trip onto
# walking. Distance uses the repo-wide intrazonal_miles convention; time
# assumes local-street speed.
INTRAZONAL_SPEED_MPH = 15.0


def required_skim_names(stock_configs_dir: Path) -> set[str]:
    """Every skim base name the stock specs reference, counted live.

    Scans the top-level CSV and YAML files of the stock configs directory
    (sub-directories hold legacy variants that are not part of the run).
    """
    stock_configs_dir = Path(stock_configs_dir)
    names: set[str] = set()
    for pattern in ("*.csv", "*.yaml"):
        for path in sorted(stock_configs_dir.glob(pattern)):
            text = path.read_text(errors="replace")
            names.update(match.group(1) for match in _BRACKET_SKIM_RE.finditer(text))
            names.update(match.group(1) for match in _TUPLE_SKIM_RE.finditer(text))
    if not names:
        raise MtcInputError(
            f"No skim references were found under {stock_configs_dir} — that is not a runnable "
            "ActivitySim spec directory."
        )
    return names


def stock_skim_inventory(stock_skims_omx: Path) -> list[str]:
    """The full matrix inventory of the stock example's skim file."""
    import openmatrix as omx  # lazy heavy import

    with omx.open_file(str(stock_skims_omx), "r") as handle:
        return [str(name) for name in handle.list_matrices()]


def classify_skim_name(matrix_name: str) -> str:
    """'time', 'distance', or 'zero' for one OMX matrix name."""
    base = matrix_name.partition("__")[0]
    if base in NONMOTORIZED_DISTANCE_NAMES:
        return "distance"
    family, _, component = base.rpartition("_")
    if family in AUTO_SKIM_FAMILIES:
        if component == "TIME":
            return "time"
        if component == "DIST":
            return "distance"
        return "zero"  # BTOLL / VTOLL
    return "zero"  # transit, in every family and component


def zone_row_positions(
    omx_node_ids: Sequence[int],
    centroid_map: Mapping[Any, Any],
    internal_zone_ids: Sequence[int],
) -> list[int]:
    """Skim-row position of each internal zone, via the recorded centroid map.

    The screening OMX rows are ordered by centroid NODE id, and the node ids
    are minted by the network builder — nothing guarantees they sort like zone
    ids. This composes the OMX's own index with the run's recorded
    zone-to-node map instead of assuming, and refuses on any mismatch.
    """
    position_of_node = {int(node): position for position, node in enumerate(omx_node_ids)}
    node_of_zone = {int(float(k)): int(v) for k, v in centroid_map.items()}
    positions: list[int] = []
    for zone_id in internal_zone_ids:
        node = node_of_zone.get(int(zone_id))
        if node is None:
            raise MtcInputError(
                f"Zone {zone_id} has no centroid node in the screening run's network summary; the "
                "skim rows cannot be mapped to zones."
            )
        position = position_of_node.get(node)
        if position is None:
            raise MtcInputError(
                f"Zone {zone_id}'s centroid node {node} is not in the skim file's index; the skim "
                "was built for a different network."
            )
        positions.append(position)
    return positions


def expand_skims(
    *,
    source_omx: Path,
    output_omx: Path,
    internal_zone_rows: Sequence[Mapping[str, Any]],
    centroid_map: Mapping[Any, Any],
    stock_configs_dir: Path,
    stock_skims_omx: Path,
) -> dict[str, Any]:
    """Write the full stock skim inventory with real auto values and zero transit.

    The output mirrors the installed stock example's matrix names exactly
    (positional zero-based zone indexing, no OMX mapping — like stock), so a
    future ActivitySim release that changes the inventory changes this output
    with it. A spec-referenced name missing from the inventory is an error.
    """
    import numpy as np
    import openmatrix as omx

    zones = internal_zones_in_order(internal_zone_rows)
    zone_ids = [int(float(row["zone_id"])) for row in zones]
    areas = [float(row.get("area_sq_mi") or 0) for row in zones]

    inventory = stock_skim_inventory(stock_skims_omx)
    required = required_skim_names(stock_configs_dir)
    missing = sorted(required - {name.partition("__")[0] for name in inventory})
    if missing:
        raise MtcInputError(
            "The stock specs reference skim names absent from the stock skim inventory — the "
            f"installed example is inconsistent with itself: {', '.join(missing[:10])}"
        )

    with omx.open_file(str(source_omx), "r") as handle:
        matrices = {str(name) for name in handle.list_matrices()}
        if "travel_time" not in matrices:
            raise MtcInputError(
                f"The screening skim file {source_omx} has no 'travel_time' matrix; found "
                f"{sorted(matrices)}."
            )
        if "distance" not in matrices:
            raise MtcInputError(
                f"The screening skim file {source_omx} has no 'distance' matrix. Re-run the "
                "screening model with a build that skims distance alongside travel time "
                "(compute_freeflow_skims does since the MTC config package landed)."
            )
        mappings = handle.list_mappings()
        if not mappings:
            raise MtcInputError(
                f"The screening skim file {source_omx} carries no zone index mapping, so its rows "
                "cannot be attributed to zones."
            )
        node_index = handle.mapping(mappings[0])  # label -> row position
        omx_node_ids = [int(label) for label, _ in sorted(node_index.items(), key=lambda kv: kv[1])]
        time_full = np.array(handle["travel_time"], dtype=float)
        dist_full = np.array(handle["distance"], dtype=float)

    positions = zone_row_positions(omx_node_ids, centroid_map, zone_ids)
    select = np.ix_(positions, positions)
    time_minutes = time_full[select]
    dist_miles = dist_full[select] / METERS_PER_MILE

    n = len(zone_ids)
    off_diagonal = ~np.eye(n, dtype=bool)
    unreachable = off_diagonal & (~np.isfinite(time_minutes) | (time_minutes <= 0))
    unreachable_pairs = int(unreachable.sum())
    time_minutes[unreachable] = UNREACHABLE_SENTINEL
    dist_miles[off_diagonal & (~np.isfinite(dist_miles) | (dist_miles <= 0))] = UNREACHABLE_SENTINEL

    diagonal_miles = np.array([intrazonal_miles(area) for area in areas])
    np.fill_diagonal(dist_miles, diagonal_miles)
    np.fill_diagonal(time_minutes, diagonal_miles / INTRAZONAL_SPEED_MPH * 60.0)

    zeros = np.zeros((n, n))
    counts = {"time": 0, "distance": 0, "zero": 0}
    output_omx.parent.mkdir(parents=True, exist_ok=True)
    with omx.open_file(str(output_omx), "w") as out:
        for name in inventory:
            kind = classify_skim_name(name)
            counts[kind] += 1
            if kind == "time":
                out[name] = time_minutes
            elif kind == "distance":
                out[name] = dist_miles
            else:
                out[name] = zeros
        # Deliberately NO zone mapping: like the stock file, rows are
        # positional and the zero-based recode of land_use.zone_id is the
        # authority on which row is which zone.

    return {
        "matrices_written": len(inventory),
        "zones": n,
        "matrix_counts": counts,
        "required_spec_names": len(required),
        "unreachable_pairs_sentinelled": unreachable_pairs,
        "unreachable_sentinel": UNREACHABLE_SENTINEL,
        "auto_times": "free-flow travel time, identical in all five periods",
        "auto_distances": "routed network distance in miles",
        "transit_and_tolls": "zero in every period; the stock availability tests disable those alternatives",
        "diagonal_convention": (
            "distance = intrazonal_miles(area) = half the radius of the equal-area circle; "
            f"time = that distance at {INTRAZONAL_SPEED_MPH:g} mph"
        ),
        "source_omx": str(source_omx),
        "stock_skims_omx": str(stock_skims_omx),
    }


# --------------------------------------------------------------------------
# The config overlay. Small, generated, and layered OVER the stock directory
# via a second -c; nothing here edits or shadows a stock spec file. (A
# constants.yaml here would SHADOW the stock one entirely — file resolution
# in layered config dirs is first-match — so this package writes none.)
# --------------------------------------------------------------------------

# The stock model list minus the three reporting steps this lane does not
# consume: write_trip_matrices (needs its own skim-writing config),
# track_skim_usage and summarize. The 29 behavioural steps are untouched.
MTC_MODEL_STEPS = [
    "initialize_landuse",
    "initialize_households",
    "compute_accessibility",
    "school_location",
    "workplace_location",
    "auto_ownership_simulate",
    "free_parking",
    "cdap_simulate",
    "mandatory_tour_frequency",
    "mandatory_tour_scheduling",
    "joint_tour_frequency",
    "joint_tour_composition",
    "joint_tour_participation",
    "joint_tour_destination",
    "joint_tour_scheduling",
    "non_mandatory_tour_frequency",
    "non_mandatory_tour_destination",
    "non_mandatory_tour_scheduling",
    "tour_mode_choice_simulate",
    "atwork_subtour_frequency",
    "atwork_subtour_destination",
    "atwork_subtour_scheduling",
    "atwork_subtour_mode_choice",
    "stop_frequency",
    "trip_purpose",
    "trip_destination",
    "trip_purpose_and_destination",
    "trip_scheduling",
    "trip_mode_choice",
    "write_data_dictionary",
    "write_tables",
]

MTC_LAND_USE_KEEP_COLUMNS = [
    "DISTRICT",
    "SD",
    "county_id",
    "TOTHH",
    "TOTPOP",
    "TOTACRE",
    "RESACRE",
    "CIACRE",
    "TOTEMP",
    "AGE0519",
    "RETEMPN",
    "FPSEMPN",
    "HEREMPN",
    "OTHEMPN",
    "AGREMPN",
    "MWTEMPN",
    "PRKCST",
    "OPRKCST",
    "area_type",
    "HSENROLL",
    "COLLFTE",
    "COLLPTE",
    "TOPOLOGY",
    "TERMINAL",
]


def mtc_settings_yaml() -> str:
    models = "\n".join(f"  - {step}" for step in MTC_MODEL_STEPS)
    land_use_keeps = "\n".join(f"      - {column}" for column in MTC_LAND_USE_KEEP_COLUMNS)
    return (
        "# OpenPlan overlay for the stock prototype_mtc configuration.\n"
        "# Layered as the FIRST -c over the untouched stock directory; every\n"
        "# top-level key here REPLACES the stock key, everything else is\n"
        "# inherited. The stock coefficients are Bay Area estimates — see the\n"
        "# bundle caveats.\n"
        "inherit_settings: True\n"
        "\n"
        "# All households, one process, no sharrow on the first runnable slice.\n"
        "households_sample_size: 0\n"
        "multiprocess: False\n"
        "sharrow: False\n"
        "\n"
        "input_table_list:\n"
        "  - tablename: households\n"
        "    filename: households.csv\n"
        "    index_col: household_id\n"
        "    recode_columns:\n"
        "      home_zone_id: land_use.zone_id\n"
        "    keep_columns:\n"
        "      - home_zone_id\n"
        "      - income\n"
        "      - hhsize\n"
        "      - HHT\n"
        "      - auto_ownership\n"
        "      - num_workers\n"
        "  - tablename: persons\n"
        "    filename: persons.csv\n"
        "    index_col: person_id\n"
        "    keep_columns:\n"
        "      - household_id\n"
        "      - age\n"
        "      - PNUM\n"
        "      - sex\n"
        "      - pemploy\n"
        "      - pstudent\n"
        "      - ptype\n"
        "  - tablename: land_use\n"
        "    filename: land_use.csv\n"
        "    index_col: zone_id\n"
        "    recode_columns:\n"
        "      zone_id: zero-based\n"
        "    keep_columns:\n"
        f"{land_use_keeps}\n"
        "\n"
        "models:\n"
        f"{models}\n"
        "\n"
        "output_tables:\n"
        "  h5_store: False\n"
        "  action: include\n"
        "  prefix: final_\n"
        "  tables:\n"
        "    - checkpoints\n"
        "    - accessibility\n"
        "    - tablename: land_use\n"
        "      decode_columns:\n"
        "        zone_id: land_use.zone_id\n"
        "    - tablename: households\n"
        "      decode_columns:\n"
        "        home_zone_id: land_use.zone_id\n"
        "    - tablename: persons\n"
        "      decode_columns:\n"
        "        home_zone_id: land_use.zone_id\n"
        "        school_zone_id: nonnegative | land_use.zone_id\n"
        "        workplace_zone_id: nonnegative | land_use.zone_id\n"
        "    - tablename: tours\n"
        "      decode_columns:\n"
        "        origin: land_use.zone_id\n"
        "        destination: land_use.zone_id\n"
        "    - tablename: trips\n"
        "      decode_columns:\n"
        "        origin: land_use.zone_id\n"
        "        destination: land_use.zone_id\n"
        "    - joint_tour_participants\n"
    )


def mtc_network_los_yaml(taz_skims_relative_path: str = "skims/mtc_skims.omx") -> str:
    # skim_time_periods mirrors the stock file verbatim: the period labels are
    # what the specs' time-dependent lookups key on.
    return (
        "# OpenPlan network LOS for the prototype_mtc config package.\n"
        "# Self-contained: the skim file below is the only one read.\n"
        "inherit_settings: False\n"
        "zone_system: 1\n"
        "name: openplan_prototype_mtc_package\n"
        "read_skim_cache: False\n"
        "write_skim_cache: False\n"
        f"taz_skims: {taz_skims_relative_path}\n"
        "skim_time_periods:\n"
        "    time_window: 1440\n"
        "    period_minutes: 60\n"
        "    periods: [0, 3, 5, 9, 14, 18, 24]\n"
        "    labels: ['EA', 'EA', 'AM', 'MD', 'PM', 'EV']\n"
    )


def mtc_config_caveats() -> list[str]:
    """What every reader of an MTC-package bundle must be told.

    Built from this module's own constants so the words can never drift from
    the arithmetic they describe.
    """
    return [
        (
            "The travel behaviour is ActivitySim's stock prototype_mtc example — coefficients "
            "estimated for the San Francisco Bay Area (MTC Travel Model One) — applied unmodified "
            "to this study area. Nothing above screening grade can rest on this output."
        ),
        "All five skim periods carry the same free-flow travel time; congestion by time of day is not represented.",
        (
            "Every transit skim is zero, which disables every transit alternative through the "
            "specifications' own availability tests; all motorised travel is allocated to autos."
        ),
        (
            f"Household incomes were deflated to year-{2000} dollars (BLS CPI-U annual averages "
            f"{CPI_U_ANNUAL_2000}/{CPI_U_ANNUAL_2022}) because the MTC specifications segment "
            "income in 2000 dollars."
        ),
        (
            "School and college enrolment come from ACS table B14001, which counts enrolled "
            "residents of each zone, not seats at schools located there."
        ),
        (
            "Employment sectors FPSEMPN, AGREMPN and MWTEMPN are zero because the screening "
            "land-use source does not distinguish them; uncategorised employment is carried in "
            "OTHEMPN."
        ),
        (
            "Zone densities and area types are computed over gross zone acreage; a large, mostly "
            "undeveloped zone reads as more rural than its developed core is."
        ),
    ]


# --------------------------------------------------------------------------
# Stock-configuration provenance: where the specs live, which version, and a
# digest that makes "unmodified" checkable instead of asserted.
# --------------------------------------------------------------------------


def stock_configs_digest(configs_dir: Path) -> str:
    """SHA-256 over every file under the stock configs directory, recursively.

    Deterministic: files are hashed in sorted relative-path order with the
    path baked into the stream, so a renamed file changes the digest too.
    """
    configs_dir = Path(configs_dir)
    digest = hashlib.sha256()
    for path in sorted(p for p in configs_dir.rglob("*") if p.is_file()):
        digest.update(str(path.relative_to(configs_dir)).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def resolve_stock_prototype_mtc(explicit_dir: str | None = None) -> dict[str, Any]:
    """Locate the installed stock prototype_mtc example.

    Resolution order: an explicit path, the importable activitysim package,
    then the repository's ActivitySim worker venv. The resolved path travels
    into the bundle manifest so the run is reproducible.
    """
    candidates: list[tuple[str, Path]] = []
    if explicit_dir:
        explicit = Path(explicit_dir).expanduser().resolve()
        # Accept the example root or its configs/ subdirectory — being strict
        # about which of the two was meant helps nobody.
        candidates.append(("explicit", explicit.parent if explicit.name == "configs" else explicit))
    else:
        # A presence probe, not a dependency: the modeling environment does not
        # ship ActivitySim, so this must never import it — find_spec answers
        # "is it installed here" without loading anything.
        import importlib.util

        spec = importlib.util.find_spec("activitysim")
        if spec and spec.origin:
            candidates.append(
                (
                    "installed activitysim package",
                    Path(spec.origin).resolve().parent / "examples" / "prototype_mtc",
                )
            )
        venv_glob = sorted(
            (_SCRIPT_DIR.parents[1] / "workers" / "activitysim_worker" / ".venv-exec" / "lib").glob(
                "python*/site-packages/activitysim/examples/prototype_mtc"
            )
        )
        candidates.extend(("activitysim worker venv", path) for path in venv_glob)

    for how, root in candidates:
        configs = root / "configs"
        skims = root / "data" / "skims.omx"
        if configs.is_dir() and (configs / "settings.yaml").exists() and skims.exists():
            return {
                "root": root,
                "configs_dir": configs,
                "stock_skims_omx": skims,
                "resolved_via": how,
                "activitysim_version": _activitysim_version_near(root),
            }
    raise MtcInputError(
        "The stock prototype_mtc example could not be found. Install ActivitySim (the worker venv "
        "at workers/activitysim_worker/.venv-exec has it) or pass --stock-configs-dir explicitly."
    )


def _activitysim_version_near(example_root: Path) -> str | None:
    """The installed ActivitySim version, read from the dist-info next to the example."""
    # example root = .../site-packages/activitysim/examples/prototype_mtc
    site_packages = example_root.parents[2]
    for dist_info in site_packages.glob("activitysim-*.dist-info"):
        match = re.match(r"activitysim-([^-]+)\.dist-info", dist_info.name)
        if match:
            return match.group(1)
    return None


def read_centroid_map(network_summary_path: Path) -> dict[int, int]:
    """The zone-to-centroid-node map a screening run recorded for its network."""
    if not network_summary_path.exists():
        raise MtcInputError(
            f"No network setup summary at {network_summary_path}; without its centroid map the "
            "skim rows cannot be attributed to zones. Re-run the screening model — every run "
            "since the map was added writes this file."
        )
    payload = json.loads(network_summary_path.read_text())
    centroid_map = payload.get("centroid_map")
    if not isinstance(centroid_map, dict) or not centroid_map:
        raise MtcInputError(f"{network_summary_path} has no usable 'centroid_map'.")
    return {int(float(k)): int(v) for k, v in centroid_map.items()}


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description=(
            "Inspect the stock prototype_mtc configuration this adapter builds inputs for: the "
            "live skim-name requirement, the matrix inventory, and the specs digest."
        )
    )
    parser.add_argument("--stock-configs-dir", help="Explicit prototype_mtc example directory (its parent holds data/)")
    args = parser.parse_args()

    stock = resolve_stock_prototype_mtc(
        str(Path(args.stock_configs_dir)) if args.stock_configs_dir else None
    )
    required = sorted(required_skim_names(stock["configs_dir"]))
    inventory = stock_skim_inventory(stock["stock_skims_omx"])
    print(
        json.dumps(
            {
                "stock_root": str(stock["root"]),
                "resolved_via": stock["resolved_via"],
                "activitysim_version": stock["activitysim_version"],
                "required_skim_base_names": len(required),
                "stock_matrix_inventory": len(inventory),
                "specs_sha256": stock_configs_digest(stock["configs_dir"]),
                "required_names": required,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
