#!/usr/bin/env python3
"""Readiness-only audit for the preregistered seven-county instrument study.

This script never opens model-output bytes. It hashes network, observation, and
match-audit packages and refuses readiness unless both methods use identical
network/observation packages and the match audit explicitly says it was frozen
before modeled volumes were revealed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


MODELED_VALUE_KEYS = {
    "best_modeled_daily_pce", "modeled", "modeled_volume", "model_volume", "pce_tot", "volume"
}


def sha256_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def contains_modeled_values(value: Any) -> bool:
    if isinstance(value, dict):
        return any(key in MODELED_VALUE_KEYS or contains_modeled_values(item) for key, item in value.items())
    if isinstance(value, list):
        return any(contains_modeled_values(item) for item in value)
    return False


def match_audit_is_preregistered(path: Path) -> tuple[bool, str]:
    if not path.is_file():
        return False, "missing"
    try:
        payload = json.loads(path.read_text())
    except (OSError, ValueError):
        return False, "unreadable"
    if contains_modeled_values(payload):
        return False, "contains modeled volumes"
    if not isinstance(payload, dict) or payload.get("frozen_before_model_volume") is not True:
        return False, "no explicit pre-volume freeze"
    return True, "frozen before model volume"


def audit_study(repo_root: Path, registry: dict[str, Any]) -> dict[str, Any]:
    required = registry["required_files"]
    counties = []
    for item in registry["counties"]:
        methods = {}
        for method in registry["methods"]:
            run_dir = repo_root / item[method]
            network = run_dir / required["network"]
            observations = run_dir / required["observations"]
            match_audit = run_dir / required["match_audit"]
            output = run_dir / required["model_output"]
            match_ready, match_state = match_audit_is_preregistered(match_audit)
            methods[method] = {
                "run_dir": item[method],
                "network_sha256": sha256_file(network),
                "observations_sha256": sha256_file(observations),
                "match_audit_sha256": sha256_file(match_audit),
                "match_audit_state": match_state,
                "model_output_present_but_not_read": output.is_file(),
                "method_ready": all((network.is_file(), observations.is_file(), output.is_file(), match_ready)),
            }
        same_network = len({methods[m]["network_sha256"] for m in methods if methods[m]["network_sha256"]}) == 1
        observation_hashes = [methods[m]["observations_sha256"] for m in methods]
        same_observations = None not in observation_hashes and len(set(observation_hashes)) == 1
        ready = same_network and same_observations and all(methods[m]["method_ready"] for m in methods)
        counties.append({
            "geography_id": item["geography_id"],
            "same_network": same_network,
            "same_observations": same_observations,
            "ready": ready,
            "methods": methods,
        })
    ready_count = sum(1 for county in counties if county["ready"])
    return {
        "schema": "openplan.development-validation-instrument-readiness.v1",
        "study_id": registry["study_id"],
        "readiness": "ready" if ready_count == len(counties) else "not_ready",
        "ready_counties": ready_count,
        "county_count": len(counties),
        "model_output_bytes_read": False,
        "counties": counties,
        "decision": (
            "The instrument study may run without changing defaults or opening an acceptance holdout."
            if ready_count == len(counties)
            else "Do not run or publish comparative metrics; prerequisites are not frozen consistently."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit readiness for the development-only validation instrument study.")
    parser.add_argument("--registry", required=True)
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()
    registry = json.loads(Path(args.registry).read_text())
    print(json.dumps(audit_study(Path(args.repo_root).resolve(), registry), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
