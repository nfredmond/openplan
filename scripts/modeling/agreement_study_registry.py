#!/usr/bin/env python3
"""Choose the counties the agreement study will run on — before it runs.

=========================================================== WHY A REGISTRY

The study asks one question: **does agreement between two independent demand
models predict accuracy against real traffic counts?** That question is only
answerable if the counties are chosen before anyone has seen a result. A
selection made afterwards — or widened when the first answers disappoint — is
how a study concludes whatever its author expected.

So the county list, the split into development and holdout halves, and the
thresholds are written to `data/agreement-study/registry.json` and committed.
**The commit is the pre-registration.** Everything reportable comes from the
holdout half, read once.

===================================================== WHAT LIMITS THE UNIVERSE

Only four states publish the AADT feeds this repository can validate against
(`count_sources.py`): California, Colorado, Oregon and Washington. That is a
disclosed limit of the study, not a claim about where the method works — the
whole point is that agreement is available everywhere and counts are not.

Counties are banded by tract count because zone count drives both runtime and
the intrazonal share, and a study drawn only from small counties would answer a
narrower question than it appears to.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

# The states whose DOTs publish an AADT feed this repo can read. Derived from
# the count-source registry rather than written down again, so a state added
# there becomes eligible here without a second edit.
from count_sources import COUNT_SOURCES

STATE_FIPS_BY_REGION = {"CA": "06", "CO": "08", "OR": "41", "WA": "53"}

# The selection seed. Written down so the same registry can be rebuilt and
# checked, and never changed after the fact — a reseeded selection is a new
# study, not a correction to this one.
SELECTION_SEED = 20260817

# Tract-count bands. A county below the floor has too few zones for a corridor
# comparison to mean much; one above the ceiling costs more machine time than
# the study can spend on a single county.
MIN_TRACTS = 12
MAX_TRACTS = 150
BAND_BREAKS = ((12, 34, "small"), (35, 74, "medium"), (75, 150, "large"))

COUNTIES_PER_CELL = 2  # per (state, band); 4 states x 3 bands x 2 = 24
EXCLUDED_COUNTIES = ("06057",)  # Nevada County: every method decision was made on it

REGISTRY_SCHEMA_VERSION = "openplan.agreement_study_registry.v1"
DEFAULT_REGISTRY_PATH = Path("data") / "agreement-study" / "registry.json"


class AgreementStudyRegistryError(RuntimeError):
    """The registry cannot be built, with the reason to show."""


def eligible_regions() -> list[str]:
    """The count-source regions this study can validate in, in a fixed order."""
    regions = sorted(region for region in COUNT_SOURCES if region in STATE_FIPS_BY_REGION)
    if not regions:
        raise AgreementStudyRegistryError(
            "No count-source region has a state FIPS mapping, so no county is eligible."
        )
    return regions


def band_of(tract_count: int) -> str | None:
    for low, high, name in BAND_BREAKS:
        if low <= tract_count <= high:
            return name
    return None


def fetch_tract_counts(state_fips: str, census_api_key: str) -> dict[str, int]:
    """How many tracts each county in a state has, counted from the ACS itself.

    One request per state, not per county: the county is read off each tract's
    own identifiers, so this needs no county list and works for any state.
    """
    import census_pums as cp

    payload = cp._get_json(
        cp.ACS_5_URL,
        {
            "get": "NAME",
            "for": "tract:*",
            "in": f"state:{state_fips}",
            "key": census_api_key,
        },
        f"The ACS tract list for state {state_fips}",
    )
    rows = cp._rows_to_dicts(payload if isinstance(payload, list) else [])
    if not rows:
        raise AgreementStudyRegistryError(
            f"The ACS returned no tracts for state {state_fips}, so its counties cannot be banded."
        )
    counts: dict[str, int] = {}
    for row in rows:
        county_fips = f"{row.get('state', '')}{row.get('county', '')}"
        if len(county_fips) == 5:
            counts[county_fips] = counts.get(county_fips, 0) + 1
    return counts


def eligible_counties(
    tract_counts_by_region: Mapping[str, Mapping[str, int]],
    *,
    excluded: Sequence[str] = EXCLUDED_COUNTIES,
) -> list[dict[str, Any]]:
    """Every county that could be selected, with its band — sorted, no randomness."""
    excluded_set = {str(code) for code in excluded}
    out: list[dict[str, Any]] = []
    for region in sorted(tract_counts_by_region):
        for county_fips, tract_count in sorted(tract_counts_by_region[region].items()):
            if county_fips in excluded_set:
                continue
            band = band_of(int(tract_count))
            if band is None:
                continue
            out.append(
                {
                    "county_fips": county_fips,
                    "region": region,
                    "tracts": int(tract_count),
                    "band": band,
                }
            )
    return out


def select_counties(
    candidates: Sequence[Mapping[str, Any]],
    *,
    seed: int = SELECTION_SEED,
    per_cell: int = COUNTIES_PER_CELL,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """A seeded, stratified draw — and an honest account of every short cell.

    Returns (selected, shortfalls). A cell with too few eligible counties is
    REPORTED rather than backfilled from another cell: silently taking three
    small counties because a state has no large ones would make the study's
    stratification a claim it does not meet.
    """
    by_cell: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for candidate in candidates:
        by_cell.setdefault((candidate["region"], candidate["band"]), []).append(dict(candidate))

    selected: list[dict[str, Any]] = []
    shortfalls: list[dict[str, Any]] = []
    regions = sorted({c["region"] for c in candidates})
    bands = [name for _, _, name in BAND_BREAKS]
    for region in regions:
        for band in bands:
            pool = sorted(by_cell.get((region, band), []), key=lambda c: c["county_fips"])
            # A fresh generator per cell, seeded from the cell itself: one shared
            # stream would make every cell's draw depend on how many counties the
            # cells before it happened to have.
            rng = random.Random(f"{seed}:{region}:{band}")
            if len(pool) < per_cell:
                shortfalls.append(
                    {
                        "region": region,
                        "band": band,
                        "wanted": per_cell,
                        "available": len(pool),
                        "note": (
                            f"{region} has only {len(pool)} eligible {band} counties "
                            f"({MIN_TRACTS}-{MAX_TRACTS} tracts), so this cell is under-filled."
                        ),
                    }
                )
            for county in rng.sample(pool, min(per_cell, len(pool))):
                selected.append(county)
    selected.sort(key=lambda c: c["county_fips"])
    return selected, shortfalls


def split_dev_holdout(
    selected: Sequence[Mapping[str, Any]], *, seed: int = SELECTION_SEED
) -> dict[str, list[dict[str, Any]]]:
    """Halve each (region, band) cell, so both halves span the same strata.

    Splitting the pooled list instead would let one half end up with most of
    the large counties, and the holdout answer would then differ from the
    development answer for a reason that has nothing to do with agreement.
    """
    by_cell: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for county in selected:
        by_cell.setdefault((county["region"], county["band"]), []).append(dict(county))

    dev: list[dict[str, Any]] = []
    holdout: list[dict[str, Any]] = []
    for cell in sorted(by_cell):
        pool = sorted(by_cell[cell], key=lambda c: c["county_fips"])
        rng = random.Random(f"{seed}:split:{cell[0]}:{cell[1]}")
        rng.shuffle(pool)
        for index, county in enumerate(pool):
            (dev if index % 2 == 0 else holdout).append({**county, "half": "dev" if index % 2 == 0 else "holdout"})
    dev.sort(key=lambda c: c["county_fips"])
    holdout.sort(key=lambda c: c["county_fips"])
    return {"dev": dev, "holdout": holdout}


def pre_registered_rules() -> dict[str, Any]:
    """The rules that must be fixed before the first run, with their reasons."""
    from corridor_agreement import DEFAULT_MINIMUM_VOLUME, GEH_CLOSE, GEH_MARGINAL

    return {
        "agreement_thresholds": {
            "geh_close": GEH_CLOSE,
            "geh_marginal": GEH_MARGINAL,
            "minimum_volume": DEFAULT_MINIMUM_VOLUME,
            "source": "the shipped constants in corridor_agreement.py, unchanged",
        },
        "minimum_stations_per_county": 8,
        "minimum_stations_note": (
            "A county whose clipped count set has fewer than 8 stations is DROPPED AND LOGGED, "
            "never quietly kept: a median error over three stations is not an accuracy figure."
        ),
        "calibration": (
            "Neither side of any comparison may be calibrated. Calibration alters link capacities "
            "and free-flow times, so the network would no longer be held constant. The batch driver "
            "refuses any run manifest carrying a calibration record."
        ),
        "convergence": {
            "rgap_target": 0.0005,
            "max_iterations": 3000,
            "note": (
                "Both sides of every comparison run at these settings. At the default gap the "
                "assignment generates corridor divergence of its own that a reader cannot "
                "distinguish from the demand models disagreeing."
            ),
        },
        "reported_figures": (
            "Only the holdout half is reported, analysed once. Accuracy comes from "
            "validation_summary.json computed on independent stations — never from a "
            "calibration's own holdout_median_ape, which is a best-of-N selection score."
        ),
        "tuning": (
            "Any threshold change is development-only, appended to this registry with the date and "
            "the reason, and never applied retroactively to a holdout result already read."
        ),
    }


def build_registry(
    tract_counts_by_region: Mapping[str, Mapping[str, int]],
    *,
    seed: int = SELECTION_SEED,
    per_cell: int = COUNTIES_PER_CELL,
    excluded: Sequence[str] = EXCLUDED_COUNTIES,
) -> dict[str, Any]:
    candidates = eligible_counties(tract_counts_by_region, excluded=excluded)
    selected, shortfalls = select_counties(candidates, seed=seed, per_cell=per_cell)
    if not selected:
        raise AgreementStudyRegistryError(
            "No county met the eligibility rules, so there is no study to pre-register."
        )
    halves = split_dev_holdout(selected, seed=seed)
    return {
        "schema_version": REGISTRY_SCHEMA_VERSION,
        "question": (
            "Does agreement between two independent demand models predict accuracy against "
            "observed traffic counts, in counties where counts exist?"
        ),
        "why_it_matters": (
            "Only four state DOTs publish AADT feeds this repository can validate against, so in "
            "most of the country a corridor number has no check at all. Two independent demand "
            "models agreeing is evidence that is available everywhere. If agreement predicts "
            "accuracy, it becomes a usable confidence signal where counts do not exist. If it does "
            "not, that negative result stops a bad idea and is still a success."
        ),
        "selection": {
            "seed": seed,
            "regions": sorted(tract_counts_by_region),
            "eligible_tract_range": [MIN_TRACTS, MAX_TRACTS],
            "bands": [{"name": name, "min_tracts": low, "max_tracts": high} for low, high, name in BAND_BREAKS],
            "counties_per_cell": per_cell,
            "excluded_counties": list(excluded),
            "excluded_reason": (
                "Nevada County (06057) is excluded because every method decision in this lane was "
                "made while looking at it. Including it would report the fit of the choices to the "
                "county that shaped them."
            ),
            "candidates_considered": len(candidates),
            "cells_under_filled": shortfalls,
        },
        "pre_registered_rules": pre_registered_rules(),
        "counties": {
            "dev": halves["dev"],
            "holdout": halves["holdout"],
        },
        "counts": {
            "selected": len(selected),
            "dev": len(halves["dev"]),
            "holdout": len(halves["holdout"]),
        },
    }


def write_registry(registry: Mapping[str, Any], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        existing = json.loads(path.read_text())
        if existing.get("counties") != registry.get("counties"):
            raise AgreementStudyRegistryError(
                f"{path} already pre-registers a different set of counties. Rewriting it would "
                "un-pre-register a study that may already have been run; delete it deliberately "
                "and in a commit of its own if that is really what you mean."
            )
    path.write_text(json.dumps(registry, indent=2) + "\n")
    return path


def load_registry(path: Path) -> dict[str, Any]:
    path = Path(path).expanduser().resolve()
    if not path.exists():
        raise AgreementStudyRegistryError(
            f"No study registry at {path}. Build it with agreement_study_registry.py before "
            "running any county, so the selection is pre-registered rather than described later."
        )
    payload = json.loads(path.read_text())
    if payload.get("schema_version") != REGISTRY_SCHEMA_VERSION:
        raise AgreementStudyRegistryError(
            f"{path} has schema version {payload.get('schema_version')!r}, expected "
            f"{REGISTRY_SCHEMA_VERSION!r}."
        )
    return payload


def main() -> int:
    import os

    parser = argparse.ArgumentParser(
        description=(
            "Pre-register the counties the agreement study will run on. The resulting "
            "registry.json is committed BEFORE the first batch run; the commit is the "
            "pre-registration."
        )
    )
    parser.add_argument(
        "--output",
        default=str(_SCRIPT_DIR.parents[1] / DEFAULT_REGISTRY_PATH),
        help="Where to write registry.json",
    )
    parser.add_argument("--seed", type=int, default=SELECTION_SEED, help="Selection seed")
    args = parser.parse_args()

    census_api_key = (os.getenv("CENSUS_API_KEY") or "").strip()
    if not census_api_key:
        raise AgreementStudyRegistryError(
            "A Census API key is required to count each county's tracts. Set CENSUS_API_KEY."
        )

    tract_counts = {
        region: fetch_tract_counts(STATE_FIPS_BY_REGION[region], census_api_key)
        for region in eligible_regions()
    }
    registry = build_registry(tract_counts, seed=args.seed)
    path = write_registry(registry, Path(args.output).expanduser().resolve())
    print(
        json.dumps(
            {
                "registry_path": str(path),
                "counties_selected": registry["counts"],
                "cells_under_filled": registry["selection"]["cells_under_filled"],
                "dev": [c["county_fips"] for c in registry["counties"]["dev"]],
                "holdout": [c["county_fips"] for c in registry["counties"]["holdout"]],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
