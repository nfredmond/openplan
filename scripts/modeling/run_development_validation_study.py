#!/usr/bin/env python3
"""Run paired development baselines only after every frozen instrument passes."""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
WORKER_DIR = ROOT / "workers" / "aequilibrae_worker"
for directory in (SCRIPT_DIR, WORKER_DIR):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

import model_validation_core
import validation_instrument as instrument


RESULT_SCHEMA = "openplan.development-validation-study-result.v1"
READINESS_SCHEMA = "openplan.development-validation-instrument-readiness.v2"
METHODS = ("aequilibrae", "activitysim")
VOLUME_FIELDS = ("PCE_tot", "demand_tot", "volume", "loaded_volume")


class StudyRefused(RuntimeError):
    """The controlled study cannot proceed without weakening its contract."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the frozen development validation study.")
    parser.add_argument("--registry", required=True)
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--output-root", default="data/modeling/development-validation-study-2026-08-28")
    parser.add_argument("--created-at")
    parser.add_argument("--verify-only", action="store_true")
    return parser.parse_args()


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise StudyRefused(f"Required JSON is unreadable: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise StudyRefused(f"Required JSON is not an object: {path}")
    return value


def _resolve(repo_root: Path, path: str) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else repo_root / candidate


def _verify_protocol_hashes(repo_root: Path, registry: Mapping[str, Any]) -> None:
    frozen = registry.get("frozen_protocol")
    if not isinstance(frozen, Mapping):
        raise StudyRefused("Preregistration has no frozen protocol block")
    for key in ("v1_readiness_registry", "nationwide_preregistration"):
        path = _resolve(repo_root, str(frozen.get(key) or ""))
        expected = frozen.get(key + "_sha256")
        if not path.is_file() or instrument.sha256_file(path) != expected:
            raise StudyRefused(f"Frozen protocol artifact changed: {key}")
    if frozen.get("validation_rules_version") != model_validation_core.VALIDATION_RULES_VERSION:
        raise StudyRefused("Preregistered validation rules do not match the shared evaluator")
    if frozen.get("matcher_version") != instrument.MATCHER_VERSION:
        raise StudyRefused("Preregistered matcher version does not match the assignment-blind matcher")


def preflight_readiness(
    repo_root: Path,
    registry_path: Path,
    output_root: Path,
) -> dict[str, Any]:
    """Validate all seven custody packages without opening assignment output."""
    registry = _load(registry_path)
    if registry.get("schema") != "openplan.development-validation-instrument-study.v2":
        raise StudyRefused("Study requires the v2 development preregistration")
    _verify_protocol_hashes(repo_root, registry)
    free_bytes = shutil.disk_usage(output_root if output_root.exists() else output_root.parent).free
    minimum = int((registry.get("run_policy") or {}).get("minimum_free_bytes") or 0)
    if free_bytes < minimum:
        raise StudyRefused(f"Disk preflight found {free_bytes} free bytes; preregistration requires {minimum}")
    readiness_path = output_root / "instrument-readiness.json"
    readiness = _load(readiness_path)
    if readiness.get("schema") != READINESS_SCHEMA:
        raise StudyRefused("Instrument readiness record does not use v2 custody")
    if readiness.get("preregistration_sha256") != instrument.sha256_file(registry_path):
        raise StudyRefused("Instrument readiness does not bind the exact v2 preregistration")
    if readiness.get("model_output_bytes_read") is not False:
        raise StudyRefused("Instrument readiness does not prove output-blind preparation")
    expected = [str(item["geography_id"]) for item in registry["counties"]]
    rows = readiness.get("counties")
    if not isinstance(rows, list) or [str(item.get("geography_id")) for item in rows] != expected:
        raise StudyRefused("Instrument readiness does not cover every registered geography in order")
    verified = []
    for row in rows:
        geography_id = str(row["geography_id"])
        if row.get("ready") is not True:
            raise StudyRefused(f"Instrument gate failed for {geography_id}")
        network = _resolve(repo_root, str(row["network_path"]))
        package = _resolve(repo_root, str(row["observation_package_path"]))
        audit = _resolve(repo_root, str(row["match_audit_path"]))
        if instrument.sha256_file(network) != row.get("network_sha256"):
            raise StudyRefused(f"Frozen network custody failed for {geography_id}")
        if instrument.sha256_file(package) != row.get("observation_package_sha256"):
            raise StudyRefused(f"Observation package custody failed for {geography_id}")
        if instrument.sha256_file(audit) != row.get("match_audit_sha256"):
            raise StudyRefused(f"Match audit custody failed for {geography_id}")
        instrument.validate_observation_package(package)
        instrument.validate_match_audit(audit, network, package, registry_path)
        verified.append({
            "geography_id": geography_id,
            "network": network, "observation_package": package, "match_audit": audit,
            "network_sha256": row["network_sha256"],
            "observation_package_sha256": row["observation_package_sha256"],
            "match_audit_sha256": row["match_audit_sha256"],
        })
    if readiness.get("readiness") != "ready" or len(verified) != len(expected):
        raise StudyRefused("Every registered geography must pass before any assignment output is revealed")
    return {
        "study_id": registry["study_id"],
        "preregistration_sha256": instrument.sha256_file(registry_path),
        "free_bytes": free_bytes,
        "counties": verified,
    }


def default_executor(command: Sequence[str], cwd: Path) -> None:
    subprocess.run(list(command), cwd=cwd, check=True)


def _run_name(geography_id: str, method: str) -> str:
    return f"v039-development-{geography_id}-{method}"


def _run_command(
    repo_root: Path,
    output_root: Path,
    county: Mapping[str, Any],
    method: str,
    *,
    aequilibrae_run: Path | None = None,
) -> tuple[list[str], Path]:
    geography_id = str(county["geography_id"])
    run_name = _run_name(geography_id, method)
    run_root = output_root / "runs"
    command = [
        str(repo_root / "workers" / "aequilibrae_worker" / ".venv" / "bin" / "python"),
        str(repo_root / "scripts" / "modeling" / "run_screening_model.py"),
        "--name", run_name,
        "--county-fips", geography_id,
        "--output-root", str(run_root),
        "--cache-dir", str(repo_root / "data" / "_screening_cache"),
        "--keep-project",
        "--counts", "none",
    ]
    if method == "aequilibrae":
        command.extend(["--reuse-network-from-run", str(_resolve(repo_root, str(county["network_seed_run"])))])
    elif method == "activitysim":
        if aequilibrae_run is None:
            raise StudyRefused("ActivitySim assignment requires the completed paired AequilibraE run")
        command.extend([
            "--reuse-network-from-run", str(aequilibrae_run),
            "--demand-package-dir", str(_resolve(repo_root, str(county["activitysim_demand_package"]))),
        ])
    else:
        raise StudyRefused(f"Unregistered method: {method}")
    return command, run_root / run_name


def _completed_run(path: Path) -> bool:
    return all((path / relative).is_file() for relative in (
        "work/aeq_project/project_database.sqlite",
        "run_output/link_volumes.csv",
        "run_output/evidence_packet.json",
        "run_summary.json",
    ))


def run_assignments(
    repo_root: Path,
    output_root: Path,
    registry: Mapping[str, Any],
    *,
    executor: Callable[[Sequence[str], Path], None] = default_executor,
) -> dict[str, dict[str, Path]]:
    runs: dict[str, dict[str, Path]] = {}
    for county in registry["counties"]:
        geography_id = str(county["geography_id"])
        runs[geography_id] = {}
        aeq_command, aeq_path = _run_command(repo_root, output_root, county, "aequilibrae")
        if not _completed_run(aeq_path):
            executor(aeq_command, repo_root)
        if not _completed_run(aeq_path):
            raise StudyRefused(f"AequilibraE baseline did not produce complete evidence for {geography_id}")
        runs[geography_id]["aequilibrae"] = aeq_path
        asim_command, asim_path = _run_command(
            repo_root, output_root, county, "activitysim", aequilibrae_run=aeq_path
        )
        if not _completed_run(asim_path):
            executor(asim_command, repo_root)
        if not _completed_run(asim_path):
            raise StudyRefused(f"ActivitySim baseline did not produce complete evidence for {geography_id}")
        runs[geography_id]["activitysim"] = asim_path
    return runs


def read_link_volumes(path: Path) -> dict[str, float]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        volume_field = next((field for field in VOLUME_FIELDS if field in fields), None)
        if volume_field is None or "link_id" not in fields:
            raise StudyRefused(f"Model output has no supported link or volume field: {path}")
        result = {}
        for row in reader:
            try:
                result[str(row["link_id"])] = float(row[volume_field])
            except (TypeError, ValueError):
                raise StudyRefused(f"Model output has a nonnumeric {volume_field} value: {path}")
    return result


def _proven_object(value: Any) -> dict[str, Any] | str:
    return dict(value) if isinstance(value, Mapping) else "unknown"


def _study_artifact(path: Path, repo_root: Path) -> dict[str, Any]:
    try:
        path.relative_to(repo_root)
    except ValueError:
        return instrument.artifact_record(path)
    return instrument.artifact_record(path, relative_to=repo_root)


def build_validation_input_bundle(
    repo_root: Path,
    registry_path: Path,
    output_root: Path,
    geography_id: str,
    custody: Mapping[str, Any],
    *,
    created_at: str,
) -> dict[str, Any]:
    """Bind the exact assignment-blind inputs that both methods must reuse."""
    package_path = Path(custody["observation_package"])
    instrument_dir = package_path.parent
    observations_csv = instrument_dir / "observations.csv"
    if not observations_csv.is_file():
        raise StudyRefused(f"Frozen compatibility CSV is missing for {geography_id}")
    return {
        "schema": "openplan.validation-input-bundle.v1",
        "study_id": str(_load(registry_path)["study_id"]),
        "geography_id": geography_id,
        "frozen_at": created_at,
        "model_output_bytes_read": False,
        "preregistration": _study_artifact(registry_path, repo_root),
        "network": _study_artifact(Path(custody["network"]), repo_root),
        "observation_package": _study_artifact(package_path, repo_root),
        "compatibility_csv": _study_artifact(observations_csv, repo_root),
        "pre_volume_match_audit": _study_artifact(Path(custody["match_audit"]), repo_root),
        "readiness_gate": _study_artifact(output_root / "instrument-readiness.json", repo_root),
    }


def build_comparison_basis(
    method: str,
    geography_id: str,
    run_dir: Path,
    custody: Mapping[str, Any],
    registry: Mapping[str, Any],
    evidence_dir: Path,
    *,
    created_at: str,
) -> dict[str, Any]:
    output_path = run_dir / "run_output" / "link_volumes.csv"
    evidence = _load(run_dir / "run_output" / "evidence_packet.json")
    assignment = evidence.get("assignment") if isinstance(evidence.get("assignment"), Mapping) else {}
    convergence = assignment.get("convergence") if isinstance(assignment.get("convergence"), Mapping) else {}
    profile = convergence.get("assignment_profile")
    profile_payload = convergence.get("assignment_profile_payload_json")
    profile_artifact: dict[str, Any] | str = "unknown"
    conversion: dict[str, Any] | str = "unknown"
    if isinstance(profile, Mapping) and isinstance(profile_payload, str):
        expected = json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        if profile_payload != expected:
            raise StudyRefused(f"Assignment profile payload is not canonical for {geography_id}/{method}")
        profile_path = evidence_dir / "assignment-profile.json"
        profile_path.parent.mkdir(parents=True, exist_ok=True)
        profile_path.write_text(profile_payload)
        profile_hash = instrument.sha256_file(profile_path)
        profile_artifact = {"profile": dict(profile), "artifact_sha256": profile_hash}
        class_pce = profile.get("class_pce")
        if isinstance(class_pce, (int, float)) and not isinstance(class_pce, bool) and float(class_pce) == 1.0:
            conversion = {"status": "proven", "factor": 1.0, "artifact_sha256": profile_hash}
    engine_versions = evidence.get("engine_versions")
    engine = {
        "name": str(evidence.get("engine") or "unknown"),
        "versions": dict(engine_versions),
    } if isinstance(engine_versions, Mapping) else "unknown"
    direction_basis = {
        "basis": "two_way",
        "evidence": "pre-volume audit sums frozen paired carriageways and retains single two-way links",
        "artifact_sha256": custody["match_audit_sha256"],
    }
    return {
        "schema": model_validation_core.COMPARISON_BASIS_SCHEMA,
        "basis_id": f"{geography_id}:{method}:development-basis-v1",
        "model_run_id": _run_name(geography_id, method),
        "model_output_artifact": {
            "artifact_id": f"{geography_id}:{method}:link-volumes",
            "artifact_type": "link_volumes",
            "sha256": instrument.sha256_file(output_path),
        },
        "model_base_year": "unknown",
        "day_basis": "unknown",
        "assignment_period": {"label": "daily", "hours": list(range(24))},
        "vehicle_basis": {"unit": "pce", "vehicle_pce_conversion": conversion},
        "direction_basis": direction_basis,
        "planning_use": registry["planning_use"],
        "scenario": {"scenario_id": f"{geography_id}:baseline", "role": "baseline"},
        "engine": engine,
        "coefficient_package": "unknown",
        "population_vintage": "unknown",
        "assignment_profile": profile_artifact,
        "network_settings": _proven_object(assignment.get("network_settings")),
        "network_state_hashes": {
            "network": custody["network_sha256"],
            "observation_package": custody["observation_package_sha256"],
            "pre_volume_match_audit": custody["match_audit_sha256"],
        },
        "acceptance_rule": "unknown",
        "frozen_at": created_at,
    }


def _strata(
    observations: Sequence[Mapping[str, Any]], assessment: Mapping[str, Any]
) -> dict[str, Any]:
    facility_by_id = {
        str(item["observation_id"]): str(((item.get("match_audit") or {}).get("facility") or {}).get("link_type") or "unknown")
        if isinstance((item.get("match_audit") or {}).get("facility"), Mapping) else "unknown"
        for item in observations
    }
    result: dict[str, Counter[str]] = {
        "source": Counter(), "facility_class": Counter(), "evidence_grade": Counter(),
        "comparability": Counter(), "match_status": Counter(),
    }
    for item in observations:
        result["source"][str((item.get("source") or {}).get("dataset_id") or "unknown")] += 1
        result["facility_class"][facility_by_id[str(item["observation_id"])]] += 1
        result["evidence_grade"][str(item.get("evidence_grade") or "unknown")] += 1
        result["match_status"][str((item.get("match_audit") or {}).get("status") or "unknown")] += 1
    for observation_id, findings in (assessment.get("comparability_findings") or {}).items():
        del observation_id
        for finding in findings:
            result["comparability"][f"{finding.get('key')}:{finding.get('status')}"] += 1
    return {key: dict(sorted(counter.items())) for key, counter in result.items()}


def evaluate_runs(
    repo_root: Path,
    registry_path: Path,
    output_root: Path,
    gate: Mapping[str, Any],
    runs: Mapping[str, Mapping[str, Path]],
    *,
    created_at: str,
) -> dict[str, Any]:
    registry = _load(registry_path)
    custody_by_id = {str(item["geography_id"]): item for item in gate["counties"]}
    county_results = []
    for county in registry["counties"]:
        geography_id = str(county["geography_id"])
        custody = custody_by_id[geography_id]
        package = instrument.validate_observation_package(custody["observation_package"])
        audit = instrument.validate_match_audit(
            custody["match_audit"], custody["network"], custody["observation_package"], registry_path
        )
        observations = instrument.bind_match_audit_to_observations(package, audit)
        input_bundle = build_validation_input_bundle(
            repo_root, registry_path, output_root, geography_id, custody, created_at=created_at
        )
        input_bundle_bytes = instrument.canonical_json_bytes(input_bundle)
        input_bundle_sha256 = instrument.sha256_bytes(input_bundle_bytes)
        methods = {}
        for method in METHODS:
            run_dir = runs[geography_id][method]
            network_path = run_dir / "work" / "aeq_project" / "project_database.sqlite"
            if instrument.sha256_file(network_path) != custody["network_sha256"]:
                raise StudyRefused(f"{method} did not use the frozen network for {geography_id}")
            evidence_dir = output_root / "results" / geography_id / method
            basis = build_comparison_basis(
                method, geography_id, run_dir, custody, registry, evidence_dir, created_at=created_at
            )
            output_path = run_dir / "run_output" / "link_volumes.csv"
            volumes = read_link_volumes(output_path)
            selected = instrument.aggregate_selected_volumes(observations, volumes)
            assessment = model_validation_core.assess_validation(
                observations, basis, selected,
                partition={"kind": "development", "id": geography_id},
                assessment_id=f"{geography_id}:{method}:assessment-v1",
                created_at=created_at,
                validation_input_bundle_sha256=input_bundle_sha256,
            )
            if assessment["scientific_outcome"] != "inconclusive":
                raise StudyRefused("Development study has no frozen acceptance rule and cannot emit pass or fail")
            evidence_dir.mkdir(parents=True, exist_ok=True)
            basis_path = evidence_dir / "comparison-basis.json"
            assessment_path = evidence_dir / "assessment.json"
            input_bundle_path = evidence_dir / "validation-input-bundle.json"
            input_bundle_path.write_bytes(input_bundle_bytes)
            # The rules-v4 core hashes the canonical JSON payload itself. Write
            # those exact bytes so the assessment's basis hash is also the hash
            # of the downloadable artifact, not a near-identical newline variant.
            basis_path.write_text(model_validation_core.canonical_json(basis))
            assessment_path.write_bytes(instrument.canonical_json_bytes(assessment))
            if assessment["exact_inputs"]["comparison_basis_sha256"] != instrument.sha256_file(basis_path):
                raise StudyRefused(f"Persisted comparison basis hash changed for {geography_id}/{method}")
            methods[method] = {
                "run_id": _run_name(geography_id, method),
                "network_sha256": custody["network_sha256"],
                "observation_package_sha256": custody["observation_package_sha256"],
                "match_audit_sha256": custody["match_audit_sha256"],
                "model_output_sha256": instrument.sha256_file(output_path),
                "validation_input_bundle_sha256": instrument.sha256_file(input_bundle_path),
                "comparison_basis_sha256": instrument.sha256_file(basis_path),
                "assessment_sha256": instrument.sha256_file(assessment_path),
                "scientific_outcome": assessment["scientific_outcome"],
                "metrics": assessment["metrics"],
                "coverage": assessment["coverage"],
                "strata": _strata(observations, assessment),
            }
        if methods["aequilibrae"]["network_sha256"] != methods["activitysim"]["network_sha256"]:
            raise StudyRefused(f"Paired methods used different networks for {geography_id}")
        if methods["aequilibrae"]["observation_package_sha256"] != methods["activitysim"]["observation_package_sha256"]:
            raise StudyRefused(f"Paired methods used different observation packages for {geography_id}")
        if methods["aequilibrae"]["match_audit_sha256"] != methods["activitysim"]["match_audit_sha256"]:
            raise StudyRefused(f"Paired methods used different match audits for {geography_id}")
        county_results.append({
            "geography_id": geography_id,
            "source_attempts": {item["source_id"]: item["status"] for item in package["source_attempts"]},
            "methods": methods,
        })
    git_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo_root, check=True, text=True, capture_output=True
    ).stdout.strip()
    app_version = str(_load(repo_root / "openplan" / "package.json")["version"])
    result = {
        "schema": RESULT_SCHEMA,
        "study_id": registry["study_id"],
        "created_at": created_at,
        "git_sha": git_sha,
        "app_version": app_version,
        "preregistration_sha256": gate["preregistration_sha256"],
        "readiness": "ready",
        "counties": county_results,
        "method_aggregation": "separate",
        "scientific_outcome": "inconclusive",
        "claims": {
            "california": "partial", "nationwide": "partial",
            "defaults_changed": False, "calibrated": False, "acceptance_holdout_opened": False,
        },
    }
    result_path = output_root / "study-result.json"
    result_path.write_bytes(instrument.canonical_json_bytes(result))
    write_report(output_root / "study-report.md", result)
    return result


def write_report(path: Path, result: Mapping[str, Any]) -> None:
    lines = [
        "# Development validation instrument result", "",
        f"Date: {str(result['created_at'])[:10]}",
        f"Git SHA: `{result['git_sha']}`", f"OpenPlan: `{result['app_version']}`", "",
        "## Decision", "",
        "The frozen development study is scientifically inconclusive. No use-specific acceptance rule was frozen, so these diagnostics cannot pass or fail a model, change defaults, calibrate a candidate, or support a California or nationwide accuracy claim.",
        "", "AequilibraE and ActivitySim remain separate. Their values are not averaged.", "",
        "## County and method results", "",
        "| Geography | Method | Outcome | Matched | Ambiguous | Excluded | Unloaded | Grade C diagnostics | Model output SHA-256 |",
        "|---|---|---|---:|---:|---:|---:|---:|---|",
    ]
    for county in result["counties"]:
        for method, item in county["methods"].items():
            coverage = item["coverage"]
            lines.append(
                f"| {county['geography_id']} | {method} | {item['scientific_outcome']} | "
                f"{coverage.get('matched', 0)} | {coverage.get('ambiguous', 0)} | "
                f"{coverage.get('excluded', 0)} | {coverage.get('unloaded', 0)} | "
                f"{coverage.get('diagnostic', 0)} | `{item['model_output_sha256']}` |"
            )
    lines.extend(["", "## Source attempts", "", "| Geography | Source | State |", "|---|---|---|"])
    for county in result["counties"]:
        for source, status in county["source_attempts"].items():
            lines.append(f"| {county['geography_id']} | {source} | {status} |")
    lines.extend([
        "", "## Bound artifacts", "",
        "Every method result binds the release-source Git SHA and version plus the exact preregistration, network, observation package, match audit, validation input bundle, model output, comparison basis, and assessment hashes in `study-result.json`.",
    ])
    path.write_text("\n".join(lines) + "\n")


def run_study(
    repo_root: Path,
    registry_path: Path,
    output_root: Path,
    *,
    created_at: str | None = None,
    executor: Callable[[Sequence[str], Path], None] = default_executor,
    verify_only: bool = False,
) -> dict[str, Any]:
    timestamp = created_at or datetime.now(timezone.utc).isoformat()
    gate = preflight_readiness(repo_root, registry_path, output_root)
    if verify_only:
        return gate
    registry = _load(registry_path)
    runs = run_assignments(repo_root, output_root, registry, executor=executor)
    return evaluate_runs(repo_root, registry_path, output_root, gate, runs, created_at=timestamp)


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    registry_path = _resolve(repo_root, args.registry).resolve()
    output_root = _resolve(repo_root, args.output_root).resolve()
    try:
        result = run_study(
            repo_root, registry_path, output_root,
            created_at=args.created_at, verify_only=args.verify_only,
        )
    except (StudyRefused, instrument.InstrumentError, subprocess.CalledProcessError) as exc:
        print(f"development validation study refused: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
