#!/usr/bin/env python3
"""Hash-locked pre-registration for the nationwide gateway-volume study.

This is deliberately U.S.-specific research plumbing. Census regions, county
codes, USDA RUCC fields, and FHWA source identity stay here rather than leaking
into country-neutral model types or gateway code.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import random
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import count_sources


REGISTRY_SCHEMA_VERSION = "openplan.gateway-volume-study-registry.v1"
SELECTION_SEED = 20260822
COUNTIES_PER_CELL = 2
EXPECTED_COUNTIES = 32
EXPECTED_PER_HALF = 16
DEFAULT_REGISTRY_PATH = Path("data/modeling/gateway-volume-study-2026-08-22/registry.json")
CANDIDATE_IMPLEMENTATION_FILES = (
    "scripts/modeling/auto_counts.py",
    "scripts/modeling/build_expanded_aadt_counts.py",
    "scripts/modeling/count_sources.py",
    "scripts/modeling/demand_conservation.py",
    "scripts/modeling/gateway_counts.py",
    "scripts/modeling/hpms_count_source.py",
    "scripts/modeling/run_gateway_volume_study.py",
    "scripts/modeling/run_screening_model.py",
    "scripts/modeling/screening_runtime.py",
    "scripts/modeling/validate_screening_observed_counts.py",
    "workers/aequilibrae_worker/count_validation.py",
    "workers/aequilibrae_worker/gateways.py",
    "workers/aequilibrae_worker/assignment_settings.py",
)
USDA_RUCC_URL = "https://www.ers.usda.gov/media/5768/2023-rural-urban-continuum-codes.csv?v=30758"
USDA_RUCC_VINTAGE = "2023 RUCC, updated 2024-01-22"

POPULATION_BANDS = (
    (25_000, 99_999, "25k_to_99k"),
    (100_000, 499_999, "100k_to_499k"),
)
URBANICITY_BY_RUCC = {
    **{code: "metro" for code in range(1, 4)},
    **{code: "nonmetro" for code in range(4, 10)},
}
CENSUS_REGIONS_BY_STATE = {
    "Northeast": frozenset({"09", "23", "25", "33", "44", "50", "34", "36", "42"}),
    "Midwest": frozenset({"17", "18", "26", "39", "55", "19", "20", "27", "29", "31", "38", "46"}),
    "South": frozenset({"10", "11", "12", "13", "24", "37", "45", "51", "54", "01", "21", "28", "47", "05", "22", "40", "48"}),
    "West": frozenset({"04", "08", "16", "30", "32", "35", "49", "56", "02", "06", "15", "41", "53"}),
}

# Every county used to make or inspect modeling choices before this protocol.
# The list is frozen into the registry too; adding a prior run changes the
# selection universe and therefore requires a new dated study, not a rewrite.
PREVIOUSLY_EXAMINED_COUNTIES = frozenset(
    {
        "06007", "06039", "06047", "06053", "06057", "06069", "06107",
        "08014", "08035", "08059", "08077", "08101", "08123",
        "41003", "41005", "41017", "41029", "41041", "41067",
        "53011", "53015", "53029", "53063", "53073", "53077",
    }
)


class GatewayVolumeStudyRegistryError(RuntimeError):
    """The pre-registration is absent, altered, or internally inconsistent."""


_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_payload(payload: Any) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def census_region(state_fips: str) -> str | None:
    return next(
        (region for region, state_codes in CENSUS_REGIONS_BY_STATE.items() if state_fips in state_codes),
        None,
    )


def population_band(population: int) -> str | None:
    return next(
        (name for low, high, name in POPULATION_BANDS if low <= population <= high),
        None,
    )


def parse_rucc_snapshot(raw_csv: bytes) -> list[dict[str, Any]]:
    """Normalize the official long-form RUCC CSV into eligible county rows."""
    try:
        decoded = raw_csv.decode("utf-8-sig")
    except UnicodeDecodeError:
        # The 2023 download is Windows-1252 despite its .csv label (for example,
        # Doña Ana County). Keep the fallback explicit; replacement characters
        # would alter names while leaving the source checksum looking valid.
        decoded = raw_csv.decode("cp1252")
    grouped: dict[str, dict[str, Any]] = {}
    for row in csv.DictReader(io.StringIO(decoded)):
        county_fips = str(row.get("FIPS") or "").zfill(5)
        record = grouped.setdefault(
            county_fips,
            {
                "county_fips": county_fips,
                "state": row.get("State") or "",
                "county_name": row.get("County_Name") or "",
            },
        )
        record[str(row.get("Attribute") or "")] = row.get("Value")

    candidates = []
    for county_fips, record in sorted(grouped.items()):
        if county_fips in PREVIOUSLY_EXAMINED_COUNTIES or len(county_fips) != 5:
            continue
        region = census_region(county_fips[:2])
        try:
            population = int(record.get("Population_2020") or 0)
            rucc = int(record.get("RUCC_2023") or 0)
        except (TypeError, ValueError):
            continue
        band = population_band(population)
        urbanicity = URBANICITY_BY_RUCC.get(rucc)
        if not region or not band or not urbanicity:
            continue
        candidates.append(
            {
                "county_fips": county_fips,
                "county_name": record["county_name"],
                "state": record["state"],
                "census_region": region,
                "population_2020": population,
                "population_band": band,
                "urbanicity": urbanicity,
                "rucc_2023": rucc,
            }
        )
    return candidates


def select_counties(
    candidates: Sequence[Mapping[str, Any]],
    *,
    seed: int = SELECTION_SEED,
) -> dict[str, list[dict[str, Any]]]:
    """Draw two per region/population/urbanicity cell, then split one-and-one."""
    by_cell: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for candidate in candidates:
        cell = (
            str(candidate["census_region"]),
            str(candidate["population_band"]),
            str(candidate["urbanicity"]),
        )
        by_cell.setdefault(cell, []).append(dict(candidate))

    expected_cells = {
        (region, band, urbanicity)
        for region in CENSUS_REGIONS_BY_STATE
        for _, _, band in POPULATION_BANDS
        for urbanicity in ("metro", "nonmetro")
    }
    missing = sorted(cell for cell in expected_cells if len(by_cell.get(cell, [])) < COUNTIES_PER_CELL)
    if missing:
        raise GatewayVolumeStudyRegistryError(
            f"The source snapshot cannot fill {missing}; refusing to shrink or substitute cells."
        )

    halves = {"development": [], "holdout": []}
    for cell in sorted(expected_cells):
        pool = sorted(by_cell[cell], key=lambda county: county["county_fips"])
        rng = random.Random(f"{seed}:{':'.join(cell)}")
        selected = rng.sample(pool, COUNTIES_PER_CELL)
        rng.shuffle(selected)
        for half, county in zip(("development", "holdout"), selected):
            halves[half].append({**county, "half": half})
    for counties in halves.values():
        counties.sort(key=lambda county: county["county_fips"])
    return halves


def current_commit(repo_root: Path) -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repo_root, text=True
    ).strip()


def protocol_contract(code_commit: str) -> dict[str, Any]:
    descriptor = count_sources.observed_count_source_descriptor(count_sources.HPMS_SOURCE_ID)
    return {
        "code_commit_before_candidate_implementation": code_commit,
        "observed_count_source": {
            "source_id": count_sources.HPMS_SOURCE_ID,
            **descriptor,
            "portal_url": (
                "https://data.transportation.gov/Roadways-and-Bridges/"
                "HPMS-Spatial-All-Sections-2024/42um-tgh5"
            ),
        },
        "assignment_profile": {
            "schema_version": "openplan.assignment-profile.v1",
            "profile_id": "aequilibrae-bfw-bpr-tight-v1",
            "engine": "aequilibrae",
            "engine_version": "1.6.2",
            "algorithm": "bfw",
            "vdf": "BPR",
            "vdf_parameters": {"alpha": 0.15, "beta": 4},
            "capacity_field": "capacity",
            "time_field": "travel_time",
            "class_pce": 1,
            "cores": 1,
            "target_gap": 0.0005,
            "max_iterations": 3000,
        },
        "candidate": {
            "one_candidate_only": True,
            "measured_gateway_rule": (
                "Replace the flat per-crossing external volume only when route identity, facility "
                "class, directionality, and distance all agree with an eligible observed section."
            ),
            "unmatched_rule": "Retain the existing flat fallback and label the gateway inferred.",
            "gateway_cap_rule": (
                "Measured crossings may exceed the existing eight-gateway cap; inferred crossings "
                "remain capped. Unsupported crossings contribute no invented observed volume."
            ),
            "network_rule": (
                "Use identical accepted network and external-demand settings for AequilibraE and "
                "ActivitySim assignment; report each separately and never average them."
            ),
        },
        "conservation_chain": [
            "person_trips",
            "vehicle_conversion",
            "internal_demand",
            "external_demand",
            "period_totals",
            "assignment_totals",
            "reported_vmt",
        ],
        "metrics": {
            "county": "paired change in independent-validation median APE, percentage points",
            "pooled": "median APE over the unchanged pooled matched-station set",
            "road_class": "paired median APE by retained-network road class",
        },
        "acceptance_thresholds": {
            "counties_improved_minimum": 12,
            "holdout_counties": 16,
            "median_county_improvement_percentage_points": 5.0,
            "pooled_station_median_must_improve": True,
            "matched_station_set_must_be_identical": True,
            "minimum_road_class_comparisons": 30,
            "maximum_road_class_worsening_percentage_points": 5.0,
            "required_guards": [
                "conservation",
                "convergence",
                "provenance",
                "zone_resolution",
            ],
        },
        "claim_rule": (
            "The existing 30 percent tier is earned only by an individual run's independent "
            "validation and only where zone resolution supports link validation. A national "
            "average never promotes a run."
        ),
        "failure_rule": (
            "If holdout fails, defaults remain unchanged. Publish the dated negative result and "
            "do not fit a scalar, uncap inferred gateways, or select another candidate."
        ),
        "required_outputs": {
            "per_county": [
                "conservation.json",
                "baseline_validation.json",
                "candidate_validation.json",
                "gateway_volume_basis.json",
                "aequilibrae_corridors.json",
                "activitysim_corridors.json",
                "artifact_hashes.json",
            ],
            "development_freeze": "development-freeze.json",
            "holdout_open_marker": "holdout-opened.json",
            "finding": "dated-finding.json",
        },
    }


def _seal_registry(registry: dict[str, Any]) -> dict[str, Any]:
    sealed = json.loads(json.dumps(registry))
    sealed["integrity"] = {
        "county_list_sha256": sha256_payload(sealed["counties"]),
        "protocol_sha256": sha256_payload(sealed["protocol"]),
        "required_output_contract_sha256": sha256_payload(
            sealed["protocol"]["required_outputs"]
        ),
    }
    sealed["integrity"]["registry_payload_sha256"] = sha256_payload(sealed)
    return sealed


def build_registry(raw_rucc_csv: bytes, *, code_commit: str) -> dict[str, Any]:
    counties = select_counties(parse_rucc_snapshot(raw_rucc_csv))
    registry = {
        "schema_version": REGISTRY_SCHEMA_VERSION,
        "study": "nationwide observed-AADT gateway-volume candidate",
        "selection": {
            "seed": SELECTION_SEED,
            "strata": ["Census region", "2020 population band", "2023 RUCC metro/nonmetro"],
            "population_bands": [
                {"name": name, "minimum": low, "maximum": high}
                for low, high, name in POPULATION_BANDS
            ],
            "counties_per_cell": COUNTIES_PER_CELL,
            "previously_examined_counties": sorted(PREVIOUSLY_EXAMINED_COUNTIES),
            "refusal": (
                "All 32 named counties are mandatory. Missing, added, or substituted counties "
                "invalidate the study rather than shrinking it."
            ),
        },
        "source_snapshot": {
            "url": USDA_RUCC_URL,
            "vintage": USDA_RUCC_VINTAGE,
            "sha256": hashlib.sha256(raw_rucc_csv).hexdigest(),
        },
        "protocol": protocol_contract(code_commit),
        "counties": counties,
        "counts": {
            "total": sum(len(rows) for rows in counties.values()),
            "development": len(counties["development"]),
            "holdout": len(counties["holdout"]),
        },
    }
    validate_registry(_seal_registry(registry))
    return _seal_registry(registry)


def validate_registry(registry: Mapping[str, Any]) -> None:
    if registry.get("schema_version") != REGISTRY_SCHEMA_VERSION:
        raise GatewayVolumeStudyRegistryError("Gateway study registry schema is missing or foreign.")
    counties = registry.get("counties") or {}
    if set(counties) != {"development", "holdout"}:
        raise GatewayVolumeStudyRegistryError("Registry must contain exactly development and holdout halves.")
    if len(counties["development"]) != EXPECTED_PER_HALF or len(counties["holdout"]) != EXPECTED_PER_HALF:
        raise GatewayVolumeStudyRegistryError("Registry must contain exactly 16 development and 16 holdout counties.")
    all_rows = [*counties["development"], *counties["holdout"]]
    county_ids = [row.get("county_fips") for row in all_rows]
    if len(county_ids) != EXPECTED_COUNTIES or len(set(county_ids)) != EXPECTED_COUNTIES:
        raise GatewayVolumeStudyRegistryError("Registry counties are missing, duplicated, added, or substituted.")
    for half, rows in counties.items():
        cells = {
            (row.get("census_region"), row.get("population_band"), row.get("urbanicity"))
            for row in rows
        }
        if len(cells) != EXPECTED_PER_HALF:
            raise GatewayVolumeStudyRegistryError(
                f"{half} does not contain exactly one county from each registered stratum."
            )

    integrity = dict(registry.get("integrity") or {})
    recorded_payload = integrity.pop("registry_payload_sha256", None)
    without_payload_hash = json.loads(json.dumps(registry))
    without_payload_hash["integrity"].pop("registry_payload_sha256", None)
    if recorded_payload != sha256_payload(without_payload_hash):
        raise GatewayVolumeStudyRegistryError("Registry payload hash does not match; the protocol was altered.")
    if integrity.get("county_list_sha256") != sha256_payload(counties):
        raise GatewayVolumeStudyRegistryError("County-list hash does not match; refusing a changed geography list.")
    if integrity.get("protocol_sha256") != sha256_payload(registry.get("protocol")):
        raise GatewayVolumeStudyRegistryError("Protocol hash does not match; refusing changed thresholds or settings.")


def write_registry(registry: Mapping[str, Any], path: Path) -> None:
    validate_registry(registry)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(registry, indent=2, sort_keys=True) + "\n"
    if path.exists() and path.read_text() != rendered:
        raise GatewayVolumeStudyRegistryError(
            f"{path} already contains a different pre-registration; refusing to rewrite it."
        )
    path.write_text(rendered)
    sidecar = path.with_suffix(path.suffix + ".sha256")
    digest = hashlib.sha256(rendered.encode("utf-8")).hexdigest()
    expected_sidecar = f"{digest}  {path.name}\n"
    if sidecar.exists() and sidecar.read_text() != expected_sidecar:
        raise GatewayVolumeStudyRegistryError(f"{sidecar} disagrees with the registry; refusing overwrite.")
    sidecar.write_text(expected_sidecar)


def load_registry(path: Path) -> dict[str, Any]:
    path = Path(path)
    if not path.exists() or not path.with_suffix(path.suffix + ".sha256").exists():
        raise GatewayVolumeStudyRegistryError("The hash-locked gateway study registry is missing.")
    raw = path.read_bytes()
    expected = path.with_suffix(path.suffix + ".sha256").read_text().split()[0]
    if hashlib.sha256(raw).hexdigest() != expected:
        raise GatewayVolumeStudyRegistryError("Registry file hash does not match its sidecar.")
    registry = json.loads(raw)
    validate_registry(registry)
    return registry


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_immutable_json(path: Path, payload: Mapping[str, Any]) -> None:
    rendered = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if path.exists() and path.read_text() != rendered:
        raise GatewayVolumeStudyRegistryError(f"{path} is already sealed with different content.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rendered)


def freeze_candidate(
    registry: Mapping[str, Any],
    *,
    candidate_commit: str,
    implementation_hashes: Mapping[str, str],
) -> dict[str, Any]:
    """Freeze the one implementation that development is allowed to inspect."""
    validate_registry(registry)
    if not re.fullmatch(r"[0-9a-f]{40}", candidate_commit):
        raise GatewayVolumeStudyRegistryError("Candidate commit must be one exact full git commit.")
    if not implementation_hashes or any(
        not _SHA256.fullmatch(digest) for digest in implementation_hashes.values()
    ):
        raise GatewayVolumeStudyRegistryError("Every candidate implementation file needs a SHA-256 hash.")
    payload = {
        "schema_version": "openplan.gateway-volume-candidate-freeze.v1",
        "registry_payload_sha256": registry["integrity"]["registry_payload_sha256"],
        "candidate_commit": candidate_commit,
        "candidate_protocol_sha256": sha256_payload(registry["protocol"]["candidate"]),
        "implementation_hashes": dict(sorted(implementation_hashes.items())),
    }
    return {**payload, "freeze_sha256": sha256_payload(payload)}


def validate_candidate_freeze(
    registry: Mapping[str, Any], candidate_freeze: Mapping[str, Any]
) -> None:
    expected = freeze_candidate(
        registry,
        candidate_commit=str(candidate_freeze.get("candidate_commit") or ""),
        implementation_hashes=candidate_freeze.get("implementation_hashes") or {},
    )
    if dict(candidate_freeze) != expected:
        raise GatewayVolumeStudyRegistryError("Candidate freeze is missing, altered, or for another registry.")


def latest_candidate_freeze_path(study_dir: Path) -> Path:
    """Select the newest explicitly versioned freeze without rewriting history."""
    candidates: list[tuple[int, Path]] = []
    for path in Path(study_dir).glob("candidate-freeze*.json"):
        match = re.fullmatch(r"candidate-freeze(?:-v([0-9]+))?\.json", path.name)
        if match:
            candidates.append((int(match.group(1) or 1), path))
    if not candidates:
        raise GatewayVolumeStudyRegistryError(
            "No candidate-freeze.json or versioned successor is present."
        )
    candidates.sort(key=lambda item: item[0])
    return candidates[-1][1]


def freeze_development(
    registry: Mapping[str, Any],
    candidate_freeze: Mapping[str, Any],
    county_outputs: Mapping[str, Mapping[str, str]],
) -> dict[str, Any]:
    """Seal all 16 development outputs before any holdout county may run."""
    validate_candidate_freeze(registry, candidate_freeze)
    expected_counties = {
        row["county_fips"] for row in registry["counties"]["development"]
    }
    if set(county_outputs) != expected_counties:
        missing = sorted(expected_counties - set(county_outputs))
        added = sorted(set(county_outputs) - expected_counties)
        raise GatewayVolumeStudyRegistryError(
            f"Development freeze refuses a changed county set; missing={missing}, added={added}."
        )
    required_outputs = set(registry["protocol"]["required_outputs"]["per_county"])
    for county_fips, hashes in county_outputs.items():
        if set(hashes) != required_outputs or any(not _SHA256.fullmatch(value) for value in hashes.values()):
            raise GatewayVolumeStudyRegistryError(
                f"Development county {county_fips} is missing required output hashes."
            )
    payload = {
        "schema_version": "openplan.gateway-volume-development-freeze.v1",
        "registry_payload_sha256": registry["integrity"]["registry_payload_sha256"],
        "candidate_freeze_sha256": candidate_freeze["freeze_sha256"],
        "county_outputs": {
            county: dict(sorted(hashes.items())) for county, hashes in sorted(county_outputs.items())
        },
    }
    return {**payload, "freeze_sha256": sha256_payload(payload)}


def authorize_holdout(
    registry: Mapping[str, Any],
    candidate_freeze: Mapping[str, Any] | None,
    development_freeze: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Return the one-time holdout-open record, or refuse before execution."""
    if candidate_freeze is None or development_freeze is None:
        raise GatewayVolumeStudyRegistryError(
            "Holdout is sealed until the candidate and all 16 development outputs are frozen."
        )
    validate_candidate_freeze(registry, candidate_freeze)
    expected = freeze_development(
        registry,
        candidate_freeze,
        development_freeze.get("county_outputs") or {},
    )
    if dict(development_freeze) != expected:
        raise GatewayVolumeStudyRegistryError("Development freeze was altered after it was sealed.")
    payload = {
        "schema_version": "openplan.gateway-volume-holdout-open.v1",
        "registry_payload_sha256": registry["integrity"]["registry_payload_sha256"],
        "candidate_freeze_sha256": candidate_freeze["freeze_sha256"],
        "development_freeze_sha256": development_freeze["freeze_sha256"],
        "holdout_counties": [
            row["county_fips"] for row in registry["counties"]["holdout"]
        ],
        "rule": "Open once; do not replace, add, or rerun a county after reading results.",
    }
    return {**payload, "open_record_sha256": sha256_payload(payload)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the nationwide gateway-volume pre-registration.")
    parser.add_argument(
        "--output",
        default=str(_SCRIPT_DIR.parents[1] / DEFAULT_REGISTRY_PATH),
    )
    parser.add_argument("--freeze-candidate", action="store_true")
    parser.add_argument("--freeze-development", action="store_true")
    parser.add_argument(
        "--candidate-freeze-output",
        help="Filename for a superseding immutable freeze, relative to the registry directory.",
    )
    args = parser.parse_args()
    if args.freeze_candidate and args.freeze_development:
        parser.error("choose only one freeze operation")
    repo_root = _SCRIPT_DIR.parents[1]
    output = Path(args.output).resolve()
    if args.freeze_candidate:
        registry = load_registry(output)
        candidate_commit = current_commit(repo_root)
        hashes = {
            relative: sha256_file(repo_root / relative)
            for relative in CANDIDATE_IMPLEMENTATION_FILES
        }
        frozen = freeze_candidate(
            registry,
            candidate_commit=candidate_commit,
            implementation_hashes=hashes,
        )
        path = (
            output.parent / args.candidate_freeze_output
            if args.candidate_freeze_output
            else output.parent / "candidate-freeze.json"
        )
        if path.parent != output.parent:
            raise GatewayVolumeStudyRegistryError(
                "The candidate freeze must stay beside the study registry."
            )
        write_immutable_json(path, frozen)
        print(json.dumps({"candidate_freeze": str(path), "freeze_sha256": frozen["freeze_sha256"]}, indent=2))
        return 0
    if args.freeze_development:
        registry = load_registry(output)
        candidate_path = latest_candidate_freeze_path(output.parent)
        candidate = json.loads(candidate_path.read_text())
        required = registry["protocol"]["required_outputs"]["per_county"]
        county_outputs = {
            row["county_fips"]: {
                name: sha256_file(
                    output.parent / "runs" / "development" / row["county_fips"] / "results" / name
                )
                for name in required
            }
            for row in registry["counties"]["development"]
        }
        frozen = freeze_development(registry, candidate, county_outputs)
        path = output.parent / registry["protocol"]["required_outputs"]["development_freeze"]
        write_immutable_json(path, frozen)
        print(json.dumps({"development_freeze": str(path), "freeze_sha256": frozen["freeze_sha256"]}, indent=2))
        return 0
    import requests

    response = requests.get(USDA_RUCC_URL, timeout=60)
    response.raise_for_status()
    registry = build_registry(response.content, code_commit=current_commit(repo_root))
    write_registry(registry, output)
    print(
        json.dumps(
            {
                "registry": str(output),
                "registry_payload_sha256": registry["integrity"]["registry_payload_sha256"],
                "development": [row["county_fips"] for row in registry["counties"]["development"]],
                "holdout": [row["county_fips"] for row in registry["counties"]["holdout"]],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
