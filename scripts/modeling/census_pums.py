#!/usr/bin/env python3
"""Where a United States study area gets real household records — the US adapter.

============================================================ WHAT THIS DOES

``population_synthesis.py`` fits a seed of real households to each zone's
published totals. This file is the half that knows what "real households" and
"published totals" mean *in the United States*: PUMAs, PUMS microdata, ACS
summary tables, and the mapping from a Census category to a control category.

Nothing above it knows any of that. A country that publishes its microdata some
other way needs a sibling of this file, not a change to the synthesiser — which
is the only reason "worldwide eventually" can stay true of the architecture
rather than being a wish.

Nothing here is hardcoded to a place. The study area's own boundary decides which
PUMAs are read, and the PUMA codes are resolved from the boundary at run time.
That is not pedantry: a 2026-03 spec in this repository wrote down PUMA `06100`
for Nevada County, and by the time anyone came back to it the correct code was
`05700`. A code written down is a code that goes stale.

================================================== THE TWO TRAPS IN THIS DATA

**The five-year file spans two PUMA vintages.** Every record in the 2018–2022
ACS 5-year PUMS carries both a ``PUMA10`` and a ``PUMA20`` field, but only one is
filled: records from 2018–2021 have ``PUMA10`` and ``PUMA20 = -0009`` ("not
applicable"); 2022 records are the reverse. Query one vintage and the API returns
HTTP 200 with **a fifth of the sample** and no indication anything is missing —
588 households where the union gives 2,649. Both vintages are queried and unioned
here, and ``seed_provenance`` reports the count so a thin seed is visible.

**HTTP 200 is not evidence at block-group geography.** ``B08202`` (workers per
household) answers 200 with every cell null below tract level, exactly as
``B17001`` does for poverty. So the workers control is tract-only, and a
block-group run drops it *with a recorded reason* rather than fitting a
population in which nobody works.
"""
from __future__ import annotations

import math
import os
from typing import Any, Iterable, Mapping, Sequence

import requests

from population_synthesis import Control, SeedHousehold

ACS_5_URL = os.getenv("CENSUS_ACS5_URL", "https://api.census.gov/data/2022/acs/acs5")
PUMS_URL = os.getenv("CENSUS_ACS5_PUMS_URL", f"{ACS_5_URL}/pums")

# TIGERweb's Public Use Microdata Area layers, one per vintage. Keyless, and the
# same query shape the tract lookup already uses.
PUMA_LAYERS = {
    "2020": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/86/query",
    "2010": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2019/MapServer/0/query",
}

# The PUMS field naming each vintage's code, and the value it carries when the
# record belongs to the other vintage.
PUMA_FIELDS = {"2020": "PUMA20", "2010": "PUMA10"}
PUMA_NOT_APPLICABLE = "-0009"

HTTP_TIMEOUT_SECONDS = float(os.getenv("CENSUS_HTTP_TIMEOUT_SECONDS", "60"))

# The ACS API refuses a request for more than 50 variables with an HTTP 400. A
# full control set needs 93 cells — the age table alone is 49 — so the request is
# split and the pieces are merged per zone. The limit is the API's, not a
# preference: raising it produces a 400, not a slower answer.
ACS_VARIABLES_PER_REQUEST = 45

# One query carries both levels: asking for any person variable switches the
# PUMS response to one row per person, with the household's own fields repeated
# on each. Vacant units drop out of that view, which is what we want — a vacant
# unit is not a household anybody travels from.
PUMS_HOUSEHOLD_VARIABLES = ("SERIALNO", "NP", "HINCP", "ADJINC", "VEH", "TEN", "WGTP")
PUMS_PERSON_VARIABLES = ("SPORDER", "AGEP", "SEX", "ESR", "SCHG", "PWGTP")

# ESR (employment status recode): employed civilians and armed forces, at work or
# temporarily absent. 3 is unemployed, 6 is not in the labour force, and blank is
# a person under 16 — none of whom is a worker for a household worker control.
WORKING_ESR_CODES = frozenset({"1", "2", "4", "5"})


class CensusPumsError(RuntimeError):
    """A seed or a set of marginals could not be built, with the reason to show."""


# --------------------------------------------------------------------------
# Control definitions. Pure data: which categories exist, and which ACS cells
# add up to each one. Verified against the live variables endpoint 2026-08-16.
# --------------------------------------------------------------------------

SIZE_CONTROL = Control(name="size", level="household", categories=("1", "2", "3", "4_plus"))
INCOME_CONTROL = Control(
    name="income", level="household", categories=("under_35k", "35_to_75k", "75_to_150k", "150k_plus")
)
VEHICLES_CONTROL = Control(
    name="vehicles", level="household", categories=("0", "1", "2", "3_plus")
)
WORKERS_CONTROL = Control(
    name="workers", level="household", categories=("0", "1", "2", "3_plus")
)
AGE_CONTROL = Control(name="age", level="person", categories=("child", "adult", "senior"))


def _cells(table: str, numbers: Iterable[int]) -> tuple[str, ...]:
    return tuple(f"{table}_{number:03d}E" for number in numbers)


# B11016 has no one-person FAMILY household — a family is two or more people —
# so the one-person category is the nonfamily cell alone.
SIZE_CELLS = {
    "1": _cells("B11016", [10]),
    "2": _cells("B11016", [3, 11]),
    "3": _cells("B11016", [4, 12]),
    "4_plus": _cells("B11016", [5, 6, 7, 8, 13, 14, 15, 16]),
}

INCOME_CELLS = {
    "under_35k": _cells("B19001", range(2, 8)),
    "35_to_75k": _cells("B19001", range(8, 13)),
    "75_to_150k": _cells("B19001", range(13, 16)),
    "150k_plus": _cells("B19001", [16, 17]),
}

VEHICLE_CELLS = {
    "0": _cells("B25044", [3, 10]),
    "1": _cells("B25044", [4, 11]),
    "2": _cells("B25044", [5, 12]),
    "3_plus": _cells("B25044", [6, 7, 8, 13, 14, 15]),
}

WORKER_CELLS = {
    "0": _cells("B08202", [2]),
    "1": _cells("B08202", [3]),
    "2": _cells("B08202", [4]),
    "3_plus": _cells("B08202", [5]),
}

# B01001 is sex by age; each category sums the male and female cells that fall in
# it. The 18 and 65 boundaries land between published cells (15-17 | 18-19 and
# 62-64 | 65-66), so no age group is split across two controls.
AGE_CELLS = {
    "child": _cells("B01001", [3, 4, 5, 6, 27, 28, 29, 30]),
    "adult": _cells("B01001", list(range(7, 20)) + list(range(31, 44))),
    "senior": _cells("B01001", [20, 21, 22, 23, 24, 25, 44, 45, 46, 47, 48, 49]),
}

CONTROL_CELLS = {
    SIZE_CONTROL.name: SIZE_CELLS,
    INCOME_CONTROL.name: INCOME_CELLS,
    VEHICLES_CONTROL.name: VEHICLE_CELLS,
    WORKERS_CONTROL.name: WORKER_CELLS,
    AGE_CONTROL.name: AGE_CELLS,
}

# Verified live 2026-08-16: B08202 answers HTTP 200 with every cell null at block
# group. The other four tables return real values at both geographies.
TRACT_ONLY_CONTROLS = {
    WORKERS_CONTROL.name: (
        "Workers per household (ACS table B08202) is not published below tract level. The Census "
        "API answers a block-group request for it with no error and no data, so this run fits "
        "household size, income, vehicles and person age, and does not control how many people in "
        "each household work."
    )
}


def controls_for_geography(zone_geography: str | None) -> tuple[list[Control], dict[str, str]]:
    """The controls this run can actually fit, and why any were left out.

    Returns the usable controls AND the dropped ones with their reasons, so a
    caller cannot take a reduced control set without also being handed the fact
    that it was reduced.
    """
    is_block_group = str(zone_geography or "").lower() in ("block_group", "blockgroup", "bg")
    all_controls = [SIZE_CONTROL, INCOME_CONTROL, VEHICLES_CONTROL, WORKERS_CONTROL, AGE_CONTROL]
    if not is_block_group:
        return all_controls, {}
    dropped = dict(TRACT_ONLY_CONTROLS)
    return [c for c in all_controls if c.name not in dropped], dropped


# The share of a zone's people who live in households rather than in group
# quarters. The seed excludes group quarters deliberately — a dormitory or a
# nursing home is not a household anyone drives from — so the person-level age
# control has to be scaled to the household population or it asks the fit to
# place people the seed does not contain.
HOUSEHOLD_POPULATION_CELL = "B09019_002E"
TOTAL_POPULATION_CELL = "B01003_001E"
POPULATION_UNIVERSE_CELLS = (HOUSEHOLD_POPULATION_CELL, TOTAL_POPULATION_CELL)


def acs_variables_for(controls: Sequence[Control], *, include_margins: bool = True) -> list[str]:
    """Every ACS cell the given controls need, deduplicated and ordered.

    Margins of error are fetched with the estimates by default. They are how the
    fit is graded: a tract-level estimate of one household-size or age cell is
    published with a margin of error that is commonly half the estimate, so
    "within the margin" is the only threshold the source data can justify.
    """
    seen: dict[str, None] = {}
    for control in controls:
        for category in control.categories:
            for cell in CONTROL_CELLS[control.name][category]:
                seen.setdefault(cell, None)
                if include_margins:
                    seen.setdefault(cell[:-1] + "M", None)
    for cell in POPULATION_UNIVERSE_CELLS:
        seen.setdefault(cell, None)
    return list(seen)


def _cell_value(acs_row: Mapping[str, Any], cell: str) -> float | None:
    value = acs_row.get(cell)
    if value in (None, "", "null"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def household_population_share(acs_row: Mapping[str, Any]) -> float:
    """What fraction of this zone's people live in households, not group quarters.

    Usually near 1, and occasionally not: a tract holding a university hall, a
    prison or a large care home can be mostly group quarters. Fitting the age
    control to total population there would ask the seed — which contains no
    group-quarters records at all — to produce people it has none of, and the
    zone's household population would be inflated to cover them.
    """
    in_households = _cell_value(acs_row, HOUSEHOLD_POPULATION_CELL)
    total = _cell_value(acs_row, TOTAL_POPULATION_CELL)
    if in_households is None or total is None or total <= 0:
        return 1.0
    return max(0.0, min(1.0, in_households / total))


def zone_targets_from_acs(
    acs_row: Mapping[str, Any], controls: Sequence[Control]
) -> dict[str, dict[str, float]]:
    """Turn one zone's raw ACS cells into per-control category totals.

    A null cell is read as zero, which is right for a suppressed small count and
    is why the fit's own ``unmet_controls`` — not this function — is where a zone
    with no usable marginals becomes visible.

    Person-level targets are scaled to the household population. The age table
    counts everyone in the zone including group quarters; the seed contains only
    households. Left unscaled the two describe different populations, and the
    fit would spend its effort chasing a gap that is by construction unclosable.
    """
    share = household_population_share(acs_row)
    targets: dict[str, dict[str, float]] = {}
    for control in controls:
        scale = share if control.level == "person" else 1.0
        totals: dict[str, float] = {}
        for category in control.categories:
            total = 0.0
            for cell in CONTROL_CELLS[control.name][category]:
                value = _cell_value(acs_row, cell)
                if value is not None:
                    total += value
            totals[category] = total * scale
        targets[control.name] = totals
    return targets


def zone_margins_from_acs(
    acs_row: Mapping[str, Any], controls: Sequence[Control]
) -> dict[str, dict[str, float]]:
    """The published margin of error on each category total.

    Margins of cells added together combine in quadrature — the root of the sum
    of squares — which is the Census Bureau's own published rule for aggregating
    them, not an approximation chosen here. Adding them directly would overstate
    the uncertainty of a category built from eight cells by roughly threefold and
    make every fit look acceptable.
    """
    share = household_population_share(acs_row)
    margins: dict[str, dict[str, float]] = {}
    for control in controls:
        scale = share if control.level == "person" else 1.0
        totals: dict[str, float] = {}
        for category in control.categories:
            squares = 0.0
            for cell in CONTROL_CELLS[control.name][category]:
                value = _cell_value(acs_row, cell[:-1] + "M")
                if value is not None:
                    squares += value * value
            totals[category] = math.sqrt(squares) * scale
        margins[control.name] = totals
    return margins


# --------------------------------------------------------------------------
# PUMS record → control categories. Pure; the categories must partition the
# same way the ACS cells above do, or the fit chases targets that mean
# something different from what it is counting.
# --------------------------------------------------------------------------


def size_category(persons: int) -> str:
    if persons <= 1:
        return "1"
    if persons == 2:
        return "2"
    if persons == 3:
        return "3"
    return "4_plus"


def adjusted_income(raw_income: Any, adjustment: Any) -> float | None:
    """Household income in the file's final-year dollars, or None if not reported.

    ADJINC is essential rather than cosmetic: the five-year sample mixes 2018 and
    2022 dollars, while the ACS income table it is fitted to is entirely in
    final-year dollars. Skipping the adjustment shifts early-year households a
    bracket down and quietly overstates how many households are poor.

    The API serves the factor already divided (``1.042311``) where the published
    flat files carry it as an integer (``1042311``); both are accepted, because a
    factor of a million applied by accident would not look like an error in any
    downstream number.
    """
    if raw_income in (None, "", "null"):
        return None
    try:
        income = float(raw_income)
    except (TypeError, ValueError):
        return None
    # The PUMS "not applicable" sentinel for group quarters and vacant units.
    if income <= -50000:
        return None
    factor = 1.0
    if adjustment not in (None, "", "null"):
        try:
            factor = float(adjustment)
        except (TypeError, ValueError):
            factor = 1.0
        if factor > 100:
            factor = factor / 1_000_000.0
    return income * factor


def income_category(income: float | None) -> str | None:
    if income is None:
        return None
    # A negative household income is a real answer — a business loss — and it
    # belongs in the lowest bracket, which is where the ACS table puts it too.
    if income < 35_000:
        return "under_35k"
    if income < 75_000:
        return "35_to_75k"
    if income < 150_000:
        return "75_to_150k"
    return "150k_plus"


def vehicle_category(raw_vehicles: Any) -> str | None:
    if raw_vehicles in (None, "", "null"):
        return None
    try:
        vehicles = int(float(raw_vehicles))
    except (TypeError, ValueError):
        return None
    if vehicles < 0:
        return None
    if vehicles >= 3:
        return "3_plus"
    return str(vehicles)


def worker_category(worker_count: int) -> str:
    if worker_count >= 3:
        return "3_plus"
    return str(max(0, worker_count))


def is_worker(raw_esr: Any) -> bool:
    return str(raw_esr).strip() in WORKING_ESR_CODES


def age_category(raw_age: Any) -> str | None:
    if raw_age in (None, "", "null"):
        return None
    try:
        age = int(float(raw_age))
    except (TypeError, ValueError):
        return None
    if age < 18:
        return "child"
    if age < 65:
        return "adult"
    return "senior"


def _rows_to_dicts(payload: Sequence[Sequence[Any]]) -> list[dict[str, Any]]:
    if not payload:
        return []
    header = [str(name) for name in payload[0]]
    return [dict(zip(header, row)) for row in payload[1:]]


def seed_households_from_pums(person_rows: Sequence[Mapping[str, Any]]) -> tuple[list[SeedHousehold], dict[str, Any]]:
    """Group PUMS person records into seed households, and say what was dropped.

    Group quarters records are excluded: a dormitory or prison population is not
    a household, carries a household weight of zero, and reports its income as a
    sentinel that would land every one of them in the lowest bracket.

    Returns the seed AND a count of what was set aside and why. A seed silently
    reduced to a handful of records still fits, still converges, and still
    produces a population — one drawn from almost nobody.
    """
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for row in person_rows:
        serial = str(row.get("SERIALNO") or "").strip()
        if not serial:
            continue
        grouped.setdefault(serial, []).append(row)

    households: list[SeedHousehold] = []
    dropped = {"group_quarters": 0, "zero_weight": 0, "unclassifiable": 0}

    for serial, people in grouped.items():
        first = people[0]
        if "GQ" in serial.upper():
            dropped["group_quarters"] += 1
            continue
        try:
            weight = float(first.get("WGTP") or 0.0)
        except (TypeError, ValueError):
            weight = 0.0
        if weight <= 0:
            dropped["zero_weight"] += 1
            continue

        income = income_category(adjusted_income(first.get("HINCP"), first.get("ADJINC")))
        vehicles = vehicle_category(first.get("VEH"))
        if income is None or vehicles is None:
            # A household that cannot be placed on a control dimension cannot be
            # fitted on it, and silently defaulting it to a category would put a
            # household the survey never described into a planner's numbers.
            dropped["unclassifiable"] += 1
            continue

        workers = sum(1 for person in people if is_worker(person.get("ESR")))
        age_counts: dict[str, int] = {}
        for person in people:
            category = age_category(person.get("AGEP"))
            if category:
                age_counts[category] = age_counts.get(category, 0) + 1

        households.append(
            SeedHousehold(
                household_id=serial,
                weight=weight,
                household_category={
                    SIZE_CONTROL.name: size_category(len(people)),
                    INCOME_CONTROL.name: income,
                    VEHICLES_CONTROL.name: vehicles,
                    WORKERS_CONTROL.name: worker_category(workers),
                },
                person_categories={AGE_CONTROL.name: age_counts},
                persons=len(people),
            )
        )

    return households, dropped


# --------------------------------------------------------------------------
# The network half. Everything above this line is testable without it.
# --------------------------------------------------------------------------


def _get_json(url: str, params: Mapping[str, Any], label: str) -> Any:
    try:
        response = requests.get(url, params=params, timeout=HTTP_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise CensusPumsError(f"{label} could not be reached: {exc}") from exc
    if response.status_code == 204:
        return []
    if response.status_code != 200:
        raise CensusPumsError(
            f"{label} answered HTTP {response.status_code}: {response.text.strip()[:300]}"
        )
    try:
        return response.json()
    except ValueError as exc:
        raise CensusPumsError(f"{label} did not return JSON: {response.text.strip()[:300]}") from exc


def resolve_pumas(bbox: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    """Every PUMA touching this study area, in both vintages.

    Both are needed because the five-year microdata file is split between them —
    see this module's header. A PUMA present in only one vintage is still
    returned; its records simply come from the years that used it.
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    found: list[dict[str, Any]] = []
    for vintage, url in PUMA_LAYERS.items():
        payload = _get_json(
            url,
            {
                "geometry": f"{min_lon},{min_lat},{max_lon},{max_lat}",
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
                "outFields": "GEOID,NAME,STATE,PUMA",
                "returnGeometry": "false",
                "f": "json",
            },
            f"The TIGERweb {vintage} Public Use Microdata Area layer",
        )
        if isinstance(payload, dict) and payload.get("error"):
            raise CensusPumsError(
                f"The TIGERweb {vintage} Public Use Microdata Area layer refused the query: "
                f"{payload['error']}"
            )
        for feature in (payload or {}).get("features", []):
            attributes = feature.get("attributes") or {}
            code = str(attributes.get("PUMA") or "").strip()
            state = str(attributes.get("STATE") or "").strip()
            if not code or not state:
                continue
            found.append(
                {
                    "vintage": vintage,
                    "state_fips": state,
                    "puma": code,
                    "name": str(attributes.get("NAME") or "").strip(),
                }
            )
    if not found:
        raise CensusPumsError(
            "No Public Use Microdata Area covers this study area, so there is no household sample "
            "to build a population from."
        )
    return found


def fetch_pums_person_rows(
    pumas: Sequence[Mapping[str, Any]], census_api_key: str
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Fetch the microdata for every PUMA and vintage, and report what each gave.

    The per-vintage counts are returned rather than summed away. A vintage that
    answers with nothing is the exact shape of the silent-fifth-of-the-sample
    failure this module's header describes, and it is only visible if the counts
    are kept apart.
    """
    if not census_api_key:
        raise CensusPumsError(
            "A Census API key is required to read household microdata. Get a free one at "
            "https://api.census.gov/data/key_signup.html and set CENSUS_API_KEY."
        )
    variables = list(PUMS_HOUSEHOLD_VARIABLES) + list(PUMS_PERSON_VARIABLES)
    rows: list[dict[str, Any]] = []
    per_source: list[dict[str, Any]] = []

    for puma in pumas:
        vintage = str(puma["vintage"])
        field = PUMA_FIELDS[vintage]
        payload = _get_json(
            PUMS_URL,
            {
                "get": ",".join(variables),
                "for": f"state:{puma['state_fips']}",
                field: puma["puma"],
                "key": census_api_key,
            },
            f"The {vintage} microdata for PUMA {puma['state_fips']}{puma['puma']}",
        )
        fetched = _rows_to_dicts(payload if isinstance(payload, list) else [])
        # A record belonging to the other vintage carries the sentinel rather
        # than a blank, so a plain emptiness check would keep all of them.
        fetched = [r for r in fetched if str(r.get(field, "")).strip() != PUMA_NOT_APPLICABLE]
        rows.extend(fetched)
        per_source.append(
            {
                "vintage": vintage,
                "state_fips": puma["state_fips"],
                "puma": puma["puma"],
                "name": puma["name"],
                "person_records": len(fetched),
            }
        )

    if not rows:
        raise CensusPumsError(
            "The Census microdata endpoint returned no household records for any Public Use "
            "Microdata Area covering this study area, so no population can be synthesised."
        )
    return rows, {"sources": per_source, "person_records": len(rows)}


def fetch_acs_zone_controls(
    geoids: Sequence[str], controls: Sequence[Control], census_api_key: str
) -> dict[str, dict[str, Any]]:
    """Fetch the control marginals for every zone, keyed by GEOID.

    Queried a county at a time — which county each zone is in comes off the
    GEOID itself, so a study area crossing a county or state line needs no
    special case and no list of places anywhere in this file.
    """
    if not census_api_key:
        raise CensusPumsError(
            "A Census API key is required to read the zone totals a population is fitted to."
        )
    variables = acs_variables_for(controls)
    if not variables:
        raise CensusPumsError("No control variables were requested, so there is nothing to fit to.")

    wanted = {str(geoid).strip() for geoid in geoids if str(geoid).strip()}
    if not wanted:
        raise CensusPumsError("No zones were supplied, so there are no totals to fetch.")
    # 11 digits is a tract, 12 a block group. Deriving it per zone rather than
    # trusting a caller's label keeps a mislabelled package from querying the
    # wrong geography and silently matching nothing.
    lengths = {len(geoid) for geoid in wanted}
    if lengths - {11, 12}:
        raise CensusPumsError(
            f"Zone identifiers must be 11-digit tract or 12-digit block-group GEOIDs; found lengths "
            f"{sorted(lengths)}."
        )

    counties = sorted({(geoid[:2], geoid[2:5]) for geoid in wanted})
    collected: dict[str, dict[str, Any]] = {}

    for state_fips, county_fips in counties:
        for geography, in_clause in (
            ("block group", f"state:{state_fips} county:{county_fips} tract:*"),
            ("tract", f"state:{state_fips} county:{county_fips}"),
        ):
            if geography == "block group" and 12 not in lengths:
                continue
            if geography == "tract" and 11 not in lengths:
                continue
            for start in range(0, len(variables), ACS_VARIABLES_PER_REQUEST):
                chunk = variables[start : start + ACS_VARIABLES_PER_REQUEST]
                payload = _get_json(
                    ACS_5_URL,
                    {
                        "get": ",".join(chunk),
                        "for": f"{geography}:*",
                        "in": in_clause,
                        "key": census_api_key,
                    },
                    f"The ACS {geography} totals for county {state_fips}{county_fips}",
                )
                for row in _rows_to_dicts(payload if isinstance(payload, list) else []):
                    geoid = (
                        f"{row.get('state', '')}{row.get('county', '')}{row.get('tract', '')}"
                        f"{row.get('block group', '')}"
                    )
                    if geoid in wanted:
                        # Merged rather than replaced: each chunk carries a
                        # different slice of the cells for the same zone.
                        collected.setdefault(geoid, {}).update(row)

    missing = sorted(wanted - set(collected))
    if missing:
        raise CensusPumsError(
            f"{len(missing)} of {len(wanted)} zones have no published totals to fit to "
            f"(first: {missing[0]}). A population fitted to only some of a study area would "
            "leave the rest empty without saying so."
        )
    return collected


def seed_provenance(
    pumas: Sequence[Mapping[str, Any]],
    fetch_summary: Mapping[str, Any],
    seed_size: int,
    dropped: Mapping[str, int],
) -> dict[str, Any]:
    """What the synthetic population is drawn from, in words a report can carry.

    Names the areas the sample actually covers. A PUMA is at least 100,000 people
    and rural ones span several counties, so a household mix fitted for one small
    town is drawn from a far wider area than the map shows — true of every
    population synthesiser, and worth saying rather than leaving to be discovered.
    """
    names = sorted({str(p.get("name") or "").strip() for p in pumas if p.get("name")})
    thin_note = ""
    if seed_size < 500:
        thin_note = (
            f" Only {seed_size} sampled households were available, which is a thin basis for "
            "reproducing a zone's household mix; treat the fitted composition as indicative."
        )
    return {
        "source": "US Census Bureau ACS 5-year Public Use Microdata Sample (PUMS)",
        "endpoint": PUMS_URL,
        "puma_names": names,
        "puma_sources": list(fetch_summary.get("sources", [])),
        "person_records": fetch_summary.get("person_records", 0),
        "seed_households": seed_size,
        "dropped": dict(dropped),
        "note": (
            "Household composition is drawn from real anonymised survey records for "
            f"{', '.join(names) if names else 'the covering Public Use Microdata Areas'}, then "
            "reweighted so each zone reproduces its own published totals. A Public Use Microdata "
            "Area covers at least 100,000 people, so the mix of household types comes from a wider "
            "area than the study area itself." + thin_note
        ),
    }
