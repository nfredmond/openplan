#!/usr/bin/env python3
"""Pre-register untouched US geographies for auto-ownership transfer validation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import requests

from us_census_divisions import DIVISION_STATE_FIPS, census_division_for_state_fips


SCHEMA_VERSION = "openplan.activitysim-auto-ownership-fresh-holdout.v1"
ACS_COUNTY_URL = "https://api.census.gov/data/2024/acs/acs5"
ACS_VINTAGE = "2024 ACS 5-year"
SELECTION_SEED = 20260819
MIN_POPULATION = 40_000
MAX_POPULATION = 160_000


class FreshHoldoutRegistryError(RuntimeError):
    pass


def fetch_county_population() -> list[dict[str, Any]]:
    api_key = (os.getenv("CENSUS_API_KEY") or "").strip()
    if not api_key:
        raise FreshHoldoutRegistryError(
            f"The {ACS_VINTAGE} county inventory requires CENSUS_API_KEY"
        )
    response = requests.get(
        ACS_COUNTY_URL,
        params={"get": "NAME,B01003_001E", "for": "county:*", "key": api_key},
        timeout=120,
    )
    if response.status_code != 200:
        raise FreshHoldoutRegistryError(
            f"The {ACS_VINTAGE} county request failed with HTTP {response.status_code}"
        )
    try:
        payload = response.json()
    except requests.exceptions.JSONDecodeError as exc:
        raise FreshHoldoutRegistryError(
            f"The {ACS_VINTAGE} county request returned non-JSON content"
        ) from exc
    if not isinstance(payload, list) or len(payload) < 2:
        raise FreshHoldoutRegistryError(f"The {ACS_VINTAGE} returned no county rows")
    header = payload[0]
    rows = []
    for values in payload[1:]:
        row = dict(zip(header, values))
        state_fips = str(row.get("state") or "").zfill(2)
        county_code = str(row.get("county") or "").zfill(3)
        division = census_division_for_state_fips(state_fips)
        try:
            population = int(row.get("B01003_001E"))
        except (TypeError, ValueError):
            continue
        if division and len(county_code) == 3:
            rows.append({
                "geography_id": state_fips + county_code,
                "label": row.get("NAME"),
                "state_fips": state_fips,
                "census_division": division,
                "population": population,
            })
    return rows


def select_geographies(
    counties: Sequence[Mapping[str, Any]],
    *,
    excluded_geography_ids: Iterable[str],
    seed: int = SELECTION_SEED,
) -> list[dict[str, Any]]:
    excluded = {str(value) for value in excluded_geography_ids}
    county_rows = [dict(row) for row in counties]
    selected = []
    for division in sorted(DIVISION_STATE_FIPS):
        candidates = sorted(
            (
                dict(row)
                for row in county_rows
                if row.get("census_division") == division
                and MIN_POPULATION <= int(row.get("population", -1)) <= MAX_POPULATION
                and str(row.get("geography_id")) not in excluded
            ),
            key=lambda row: row["geography_id"],
        )
        if not candidates:
            raise FreshHoldoutRegistryError(
                f"No untouched {division} county meets the disclosed population range"
            )
        selected.append(random.Random(f"{seed}:{division}").choice(candidates))
    return sorted(selected, key=lambda row: row["census_division"])


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_registry(
    counties: Sequence[Mapping[str, Any]],
    *,
    excluded_geography_ids: Iterable[str],
    candidate_package_manifest: str | Path,
    seed: int = SELECTION_SEED,
) -> dict[str, Any]:
    package_path = Path(candidate_package_manifest).resolve()
    package = json.loads(package_path.read_text())
    if package.get("status") != "candidate_not_accepted_for_production":
        raise FreshHoldoutRegistryError(
            "The fresh holdout may evaluate only a hash-locked, unaccepted candidate"
        )
    for filename, expected_digest in (package.get("files_sha256") or {}).items():
        artifact_path = package_path.parent / filename
        if not artifact_path.is_file() or _sha256(artifact_path) != expected_digest:
            raise FreshHoldoutRegistryError(
                f"Candidate artifact {filename} does not match its package manifest"
            )
    excluded = sorted({str(value) for value in excluded_geography_ids})
    selected = select_geographies(counties, excluded_geography_ids=excluded, seed=seed)
    return {
        "schema_version": SCHEMA_VERSION,
        "status": "pre_registered_before_candidate_execution",
        "question": (
            "Does the unchanged nationally estimated auto-ownership component reproduce "
            "vehicle-count distributions better than borrowed MTC behavior on untouched places?"
        ),
        "selection": {
            "source": ACS_VINTAGE,
            "source_url": ACS_COUNTY_URL,
            "seed": seed,
            "strategy": "one stable seeded draw from each United States Census division",
            "population_range": [MIN_POPULATION, MAX_POPULATION],
            "excluded_geography_ids": excluded,
            "excluded_reason": (
                "Every excluded geography shaped or was read during prior modeling studies; "
                "none may be reused as an untouched acceptance holdout."
            ),
        },
        "candidate": {
            "component": package.get("component"),
            "package_manifest_sha256": _sha256(package_path),
            "package_status": package.get("status"),
            "coefficient_files_sha256": package.get("files_sha256"),
        },
        "acceptance_rules": {
            "primary_metric": "household-weighted vehicle-share total variation distance",
            "minimum_relative_aggregate_improvement": 0.15,
            "minimum_geography_win_share": 0.75,
            "maximum_absolute_bias_disadvantage": 0.02,
            "maximum_single_geography_tv_disadvantage": 0.05,
            "decision": (
                "Accept this component only if every rule passes. Household exact accuracy and "
                "individual MAE remain diagnostics because they compare separate realizations."
            ),
        },
        "geographies": selected,
        "geography_count": len(selected),
    }


def write_registry(path: Path, registry: Mapping[str, Any]) -> None:
    if path.exists():
        existing = json.loads(path.read_text())
        if existing != registry:
            raise FreshHoldoutRegistryError(
                f"{path} already locks a different holdout; rewriting it would invalidate the study"
            )
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n")


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_package_manifest")
    parser.add_argument("output")
    parser.add_argument("--exclude-registry", action="append", default=[])
    parser.add_argument("--exclude-geography", action="append", default=[])
    parser.add_argument("--seed", type=int, default=SELECTION_SEED)
    args = parser.parse_args(argv)
    excluded = list(args.exclude_geography)
    for registry_path in args.exclude_registry:
        payload = json.loads(Path(registry_path).read_text())
        for half in (payload.get("counties") or {}).values():
            excluded.extend(str(row["county_fips"]) for row in half)
    registry = build_registry(
        fetch_county_population(),
        excluded_geography_ids=excluded,
        candidate_package_manifest=args.candidate_package_manifest,
        seed=args.seed,
    )
    write_registry(Path(args.output), registry)
    print(json.dumps(registry, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
