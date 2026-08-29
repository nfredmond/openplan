#!/usr/bin/env python3
"""Freeze the v4 registry for the v0.43 structural demand diagnosis."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
V3 = Path("scripts/modeling/development/california_validation_instrument_study.v3.json")
V41_ROOT = Path("data/modeling/comparable-observation-study-2026-08-28")
V39_ROOT = Path("data/modeling/development-validation-study-2026-08-28")
METHODS = ("aequilibrae", "activitysim")


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(path: Path, *, logical: bool = False) -> str:
    payload = gzip.decompress(path.read_bytes()) if logical and path.suffix == ".gz" else path.read_bytes()
    return hashlib.sha256(payload).hexdigest()


def record(relative: Path, *, logical: bool = False) -> dict[str, Any]:
    path = ROOT / relative
    if not path.is_file():
        raise RuntimeError(f"Required frozen artifact is unavailable: {relative}")
    payload = gzip.decompress(path.read_bytes()) if logical and path.suffix == ".gz" else path.read_bytes()
    result = {"path": str(relative)[:-3] if logical and str(relative).endswith(".gz") else str(relative), "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload)}
    if logical and path.suffix == ".gz":
        result.update({"stored_path": str(relative), "stored_sha256": digest(path)})
    return result


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def build_registry() -> dict[str, Any]:
    predecessor = load(ROOT / V3)
    v41_result = load(ROOT / V41_ROOT / "study-result.json")
    diagnosis_by_key = {
        (str(item["geography_id"]), str(item["method"])): item
        for item in v41_result["diagnoses"]
    }
    geographies = []
    shared_external_hashes: set[str] = set()
    for geography in predecessor["counties"]:
        geography_id = str(geography["geography_id"])
        methods = {}
        for method in METHODS:
            run = V39_ROOT / "runs" / f"v039-development-{geography_id}-{method}"
            result_dir = V41_ROOT / "results" / geography_id / method
            instrument_dir = V41_ROOT / "instruments" / geography_id
            layers = load(ROOT / run / "package" / "demand_layers.json")
            external_layer_hash = hashlib.sha256(canonical({
                "external_gateways": layers.get("external_gateways") or [],
                "external_trips": layers.get("external_trips"),
                "external_demand_scalar": (layers.get("trip_rates") or {}).get("external_demand_scalar"),
                "gateway_passthrough_share": (layers.get("trip_rates") or {}).get("gateway_passthrough_share"),
            }).encode()).hexdigest()
            shared_external_hashes.add(external_layer_hash)
            prior = diagnosis_by_key[(geography_id, method)]
            methods[method] = {
                "run_id": f"v039-development-{geography_id}-{method}",
                "demand_source": layers.get("demand_source", "unknown"),
                "artifacts": {
                    "observation_package_v2": record(instrument_dir / "observation-package-v2.json.gz", logical=True),
                    "pre_volume_match_audit_v2": record(instrument_dir / "pre-volume-match-audit-v2.json.gz", logical=True),
                    "v041_input_bundle": record(result_dir / "validation-input-bundle-v2.json"),
                    "v041_comparison_basis": record(result_dir / "comparison-basis-v2.json.gz", logical=True),
                    "v041_assessment": record(result_dir / "assessment-v2.json.gz", logical=True),
                    "v041_diagnosis": record(result_dir / "structural-diagnosis-v2.json"),
                    "network": record(V39_ROOT / "instruments" / geography_id / "network" / "project_database.sqlite"),
                    "boundary": record(run / "boundary" / "analysis_boundary.geojson"),
                    "zone_attributes": record(run / "package" / "zone_attributes.csv"),
                    "od_matrix": record(run / "package" / "od_trip_matrix.csv"),
                    "demand_layers": record(run / "package" / "demand_layers.json"),
                    "assignment_profile": record(V39_ROOT / "results" / geography_id / method / "assignment-profile.json"),
                    "network_setup_summary": record(run / "work" / "network_setup_summary.json"),
                    "conservation": record(run / "conservation.json"),
                    "model_output": record(run / "run_output" / "link_volumes.csv"),
                },
                "v041_bindings": dict(prior["bindings"]),
                "external_layer_sha256": external_layer_hash,
                "person_to_vehicle_conversion": (
                    (layers.get("conservation_accounting") or {}).get("vehicle_conversion", "unknown")
                    if method == "activitysim" else "not_activitysim"
                ),
                "source_vintages": {
                    "lodes": {
                        "status": "not_recorded_in_frozen_package",
                        "vintage": "unknown",
                        "seed_coverage": "unknown",
                        "assumed_commute_share": "unknown",
                        "fallback_use": "unknown",
                        "limitation": "LODES is home-to-work job-location evidence, not all-purpose travel or vehicle trips. The frozen package does not prove that LODES shaped this matrix.",
                    },
                    "gateway_cap": 8,
                    "gateway_volume_basis": "inferred_from_registered_road_class_defaults",
                    "non_work_through_travel": "unsupported",
                },
            }
        if methods["aequilibrae"]["external_layer_sha256"] != methods["activitysim"]["external_layer_sha256"]:
            raise RuntimeError(f"Methods do not share the external layer in {geography_id}")
        geographies.append({**geography, "methods": methods})
    if len(shared_external_hashes) != len(geographies):
        raise RuntimeError("External layers unexpectedly repeat across geographies")
    return {
        "schema": "openplan.development-structural-demand-study.v4",
        "study_id": "seven-county-structural-demand-and-loading-diagnosis-v4",
        "title": "Structural demand distribution, external travel, and network loading diagnosis",
        "partition": "development",
        "predecessor": record(V3),
        "v041_study_result": record(V41_ROOT / "study-result.json"),
        "adapters": predecessor["adapters"],
        "methods": list(METHODS),
        "geographies": geographies,
        "policy": {
            "freeze_all_audits_before_output": True,
            "average_methods": False,
            "rank_methods": False,
            "select_candidate": False,
            "calibrate": False,
            "change_defaults": False,
            "define_acceptance_criteria": False,
            "open_holdout": False,
            "scientific_outcome": "inconclusive",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="scripts/modeling/development/california_structural_demand_study.v4.json")
    args = parser.parse_args()
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(canonical(build_registry()) + "\n")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
