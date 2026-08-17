#!/usr/bin/env python3
"""Build a study area's synthetic population, zone by zone, from real records.

This is the orchestrator: it holds the order of operations and nothing else.
The arithmetic lives in ``population_synthesis.py`` and the United States data
in ``census_pums.py``, and both are tested without a network. What is left here
is the sequence — resolve the sample areas, fetch the records, fetch the zone
totals, fit each zone, expand the households, copy their real people across —
plus the provenance that has to travel with the result.

=================================================== WHY THE FETCHES ARE INJECTED

Every network call arrives as a parameter with a real default. That is what lets
the sequence itself be tested: the ordering bugs in a pipeline like this one —
fitting a zone against another zone's totals, expanding a household against
another household's people, numbering two zones' households the same — all
produce a complete population and a finished run, and none of them can be caught
by testing the pieces separately.

======================================================= WHAT IT REFUSES TO DO

It will not fall back to a scaffold. If the microdata cannot be reached, this
raises rather than quietly producing households invented from zone averages: a
population built from the model's own inputs is exactly what this replaces, and
one that appears under the same filename without saying so is worse than none.
"""
from __future__ import annotations

from typing import Any, Callable, Mapping, Sequence

import census_pums as cp
from population_synthesis import (
    ZoneFit,
    build_seed_matrix,
    fit_quality_summary,
    margins_summary,
    synthesize_zone,
)

# Cordon zones stand for traffic entering from outside the study area. Nobody
# lives in one, and fitting a population to it would put residents at a point on
# the boundary and then let them make trips as though they lived there.
EXTERNAL_ZONE_KINDS = frozenset({"external", "cordon", "gateway"})

# How far beyond the zones' own extent to look for sample areas. A study area
# whose edge sits just inside a PUMA boundary would otherwise miss the sample
# covering most of its own population.
PUMA_SEARCH_MARGIN_DEGREES = 0.05


class SyntheticPopulationError(RuntimeError):
    """No population could be built, with the reason a planner should read."""


def internal_zones(zone_rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """The zones people actually live in, with the fields synthesis needs."""
    kept: list[dict[str, Any]] = []
    for row in zone_rows:
        if str(row.get("zone_kind") or "").strip().lower() in EXTERNAL_ZONE_KINDS:
            continue
        geoid = str(row.get("GEOID") or "").strip()
        if not geoid:
            continue
        kept.append(
            {
                "GEOID": geoid,
                "zone_id": int(float(row["zone_id"])),
                "centroid_lon": float(row.get("centroid_lon") or 0.0),
                "centroid_lat": float(row.get("centroid_lat") or 0.0),
            }
        )
    if not kept:
        raise SyntheticPopulationError(
            "This study area has no internal zones with a Census identifier, so there is nothing to "
            "fit a population to."
        )
    return kept


def zones_bbox(zones: Sequence[Mapping[str, Any]], margin: float = PUMA_SEARCH_MARGIN_DEGREES) -> tuple[float, float, float, float]:
    lons = [float(z["centroid_lon"]) for z in zones]
    lats = [float(z["centroid_lat"]) for z in zones]
    return (min(lons) - margin, min(lats) - margin, max(lons) + margin, max(lats) + margin)


def zone_geography_of(zones: Sequence[Mapping[str, Any]]) -> str:
    """Tract or block group, read from the identifiers rather than a label.

    A package mislabelled in its manifest would otherwise ask for the wrong ACS
    geography and match no zone at all — or worse, match the parent tracts and
    fit every block group to its tract's totals.
    """
    lengths = {len(str(zone["GEOID"])) for zone in zones}
    if lengths == {12}:
        return "block_group"
    if lengths == {11}:
        return "tract"
    raise SyntheticPopulationError(
        f"The zones carry Census identifiers of mixed or unrecognised lengths {sorted(lengths)}; "
        "a population cannot be fitted without knowing which published geography they are."
    )


def _person_rows_for(
    household_row: Mapping[str, Any],
    people: Sequence[Mapping[str, Any]],
    first_person_id: int,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    person_id = first_person_id
    for number, person in enumerate(people, start=1):
        rows.append(
            {
                "person_id": person_id,
                "household_id": household_row["household_id"],
                "person_num": number,
                "home_zone_id": household_row["home_zone_id"],
                "age": int(float(person.get("AGEP") or 0)),
                "sex": int(float(person.get("SEX") or 1)),
                "is_worker": 1 if cp.is_worker(person.get("ESR")) else 0,
                "is_student": 1 if cp.is_student(person.get("SCHG")) else 0,
                # The raw survey codes, carried verbatim: downstream adapters
                # (the ActivitySim MTC package derives its person types from
                # ESR/SCHG/WKHP) need the codes, not our reductions of them.
                "esr": str(person.get("ESR") or "").strip(),
                "schg": str(person.get("SCHG") or "").strip(),
                "wkhp": str(person.get("WKHP") or "").strip(),
                "seed_household_id": household_row["seed_household_id"],
                "source_geoid": household_row["source_geoid"],
                "synthesis_method": household_row["synthesis_method"],
            }
        )
        person_id += 1
    return rows


SYNTHESIS_METHOD = "acs_pums_seed_iterative_proportional_updating"


def synthesize_study_area(
    zone_rows: Sequence[Mapping[str, Any]],
    *,
    census_api_key: str,
    resolve_pumas: Callable[..., Any] = cp.resolve_pumas,
    fetch_pums_person_rows: Callable[..., Any] = cp.fetch_pums_person_rows,
    fetch_acs_zone_controls: Callable[..., Any] = cp.fetch_acs_zone_controls,
) -> dict[str, Any]:
    """Fit and expand a population for every internal zone in a study area."""
    zones = internal_zones(zone_rows)
    geography = zone_geography_of(zones)
    controls, dropped_controls = cp.controls_for_geography(geography)

    try:
        pumas = resolve_pumas(zones_bbox(zones))
        person_rows, fetch_summary = fetch_pums_person_rows(pumas, census_api_key)
        zone_controls = fetch_acs_zone_controls([z["GEOID"] for z in zones], controls, census_api_key)
    except cp.CensusPumsError as exc:
        # Deliberately not caught into a fallback. See this module's header.
        raise SyntheticPopulationError(str(exc)) from exc

    seed, dropped_records = cp.seed_households_from_pums(person_rows)
    if not seed:
        raise SyntheticPopulationError(
            "Every microdata record covering this study area was set aside "
            f"({dropped_records}), leaving no households to build a population from."
        )
    people_by_seed = cp.group_persons_by_serial(person_rows)
    matrix = build_seed_matrix(seed, controls)

    households: list[dict[str, Any]] = []
    persons: list[dict[str, Any]] = []
    fits: list[ZoneFit] = []
    next_household_id = 1
    next_person_id = 1

    for zone in sorted(zones, key=lambda z: z["zone_id"]):
        geoid = zone["GEOID"]
        acs_row = zone_controls[geoid]
        rows, fit = synthesize_zone(
            seed,
            controls,
            cp.zone_targets_from_acs(acs_row, controls),
            zone_id=zone["zone_id"],
            first_household_id=next_household_id,
            seed_matrix=matrix,
            margins=cp.zone_margins_from_acs(acs_row, controls),
        )
        fits.append(fit)
        next_household_id += len(rows)
        for row in rows:
            people = people_by_seed.get(row["seed_household_id"], [])
            household = {
                "household_id": row["household_id"],
                "home_zone_id": row["home_zone_id"],
                "persons": len(people),
                "workers": sum(1 for p in people if cp.is_worker(p.get("ESR"))),
                "autos": _autos_of(people),
                "income": _income_of(people),
                # Raw Census household/family type (HHT, 1-7), verbatim from
                # the seed record — the ActivitySim MTC package's family/
                # non-family terms read it directly.
                "hht": _hht_of(people),
                "seed_household_id": row["seed_household_id"],
                "source_geoid": geoid,
                "synthesis_method": SYNTHESIS_METHOD,
            }
            households.append(household)
            person_rows_out = _person_rows_for(household, people, next_person_id)
            persons.extend(person_rows_out)
            next_person_id += len(person_rows_out)

    return {
        "households": households,
        "persons": persons,
        "summary": {
            "households": len(households),
            "persons": len(persons),
            "workers": sum(row["is_worker"] for row in persons),
            "zones_with_households": len({row["home_zone_id"] for row in households}),
            "zone_geography": geography,
        },
        "fit_quality": fit_quality_summary(fits),
        "fit_grading_note": margins_summary(fits),
        "dropped_controls": dropped_controls,
        "provenance": cp.seed_provenance(pumas, fetch_summary, len(seed), dropped_records),
        "method": SYNTHESIS_METHOD,
    }


def _autos_of(people: Sequence[Mapping[str, Any]]) -> int:
    if not people:
        return 0
    return int(float(people[0].get("VEH") or 0) or 0)


def _hht_of(people: Sequence[Mapping[str, Any]]) -> int:
    """The household's HHT code, or 0 when the survey did not report one."""
    if not people:
        return 0
    try:
        return int(float(people[0].get("HHT") or 0))
    except (TypeError, ValueError):
        return 0


def _income_of(people: Sequence[Mapping[str, Any]]) -> int:
    if not people:
        return 0
    income = cp.adjusted_income(people[0].get("HINCP"), people[0].get("ADJINC"))
    return int(round(income)) if income is not None else 0
