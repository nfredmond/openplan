#!/usr/bin/env python3
"""Execute the hash-locked gateway-volume study without opening holdout early."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import gateway_volume_study_registry as registry_tools

REPO_ROOT = _SCRIPT_DIR.parents[1]
DEFAULT_STUDY_DIR = REPO_ROOT / "data" / "modeling" / "gateway-volume-study-2026-08-22"
DEFAULT_RUNS_ROOT = REPO_ROOT / "data" / "screening-runs"
SCHEMA_VERSION = "openplan.gateway-volume-study-county.v1"
CONVERGENCE_ENV = {
    "OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.0005",
    "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS": "3000",
}


class GatewayVolumeStudyError(RuntimeError):
    """A registered study invariant was absent or changed."""


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text())


def write_json(path: Path, payload: Mapping[str, Any]) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_step(command: Sequence[str], *, log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w") as handle:
        completed = subprocess.run(
            list(command),
            cwd=REPO_ROOT,
            env={**os.environ, **CONVERGENCE_ENV},
            stdout=handle,
            stderr=subprocess.STDOUT,
        )
    if completed.returncode:
        tail = "\n".join(log_path.read_text(errors="replace").splitlines()[-20:])
        raise GatewayVolumeStudyError(
            f"{Path(command[1]).name if len(command) > 1 else command[0]} exited "
            f"{completed.returncode}. Last lines:\n{tail}"
        )


def activitysim_executable() -> Path:
    path = REPO_ROOT / "workers" / "activitysim_worker" / ".venv-exec" / "bin" / "activitysim"
    if not path.exists():
        raise GatewayVolumeStudyError(f"ActivitySim executable is missing at {path}")
    return path


def stock_configs_dir() -> Path:
    from activitysim_mtc_inputs import resolve_stock_prototype_mtc

    return Path(resolve_stock_prototype_mtc(None)["configs_dir"])


def matched_station_ids(validation_csv: Path) -> list[str]:
    with Path(validation_csv).open(newline="") as handle:
        return sorted(
            row["station_id"]
            for row in csv.DictReader(handle)
            if row.get("match_status") == "matched"
        )


def validation_record(run_dir: Path) -> dict[str, Any]:
    summary = read_json(run_dir / "validation" / "validation_summary.json")
    stations = matched_station_ids(run_dir / "validation" / "validation_results.csv")
    return {
        "run_dir": str(run_dir),
        "matched_station_ids": stations,
        "matched_station_set_sha256": hashlib.sha256("\n".join(stations).encode()).hexdigest(),
        "summary": summary,
    }


def corridor_change_record(
    baseline_csv: Path,
    candidate_csv: Path,
    network_geojson: Path,
    *,
    label: str,
) -> dict[str, Any]:
    network = read_json(network_geojson)
    road_classes = {
        int(feature["properties"]["link_id"]): str(feature["properties"].get("link_type") or "")
        for feature in network.get("features") or []
    }

    def volumes(path: Path) -> dict[int, tuple[float, str]]:
        with Path(path).open(newline="") as handle:
            return {
                int(float(row["link_id"])): (
                    float(row.get("PCE_tot") or 0.0),
                    road_classes.get(int(float(row["link_id"])), "centroid_connector"),
                )
                for row in csv.DictReader(handle)
            }

    baseline = volumes(baseline_csv)
    candidate = volumes(candidate_csv)
    if set(baseline) != set(candidate):
        raise GatewayVolumeStudyError(
            f"{label} baseline and candidate do not contain the same retained link ids."
        )
    links = []
    for link_id in sorted(baseline):
        base_volume, road_class = baseline[link_id]
        trial_volume, trial_class = candidate[link_id]
        if road_class != trial_class:
            raise GatewayVolumeStudyError(f"{label} link {link_id} changed road class between arms.")
        links.append(
            {
                "link_id": link_id,
                "road_class": road_class,
                "baseline_daily_volume": round(base_volume, 6),
                "candidate_daily_volume": round(trial_volume, 6),
                "change": round(trial_volume - base_volume, 6),
                "change_percent": round((trial_volume - base_volume) / base_volume * 100.0, 6)
                if base_volume > 0
                else None,
            }
        )
    return {
        "schema_version": "openplan.gateway-volume-corridor-change.v1",
        "demand_method": label,
        "is_average": False,
        "interpretation": (
            "Methodological sensitivity to the one frozen gateway-volume candidate; not an "
            "average and not an accuracy claim."
        ),
        "links": links,
    }


def convergence_record(run_dir: Path) -> dict[str, Any]:
    manifest = read_json(run_dir / "bundle_manifest.json")
    convergence = ((manifest.get("assignment") or {}).get("convergence") or {})
    if convergence.get("converged") is not True:
        raise GatewayVolumeStudyError(f"{run_dir} did not converge under the registered profile.")
    return convergence


def assemble_county_outputs(
    *,
    county_dir: Path,
    aeq_baseline: Path,
    aeq_candidate: Path,
    asim_baseline: Path,
    asim_candidate: Path,
    required_outputs: Sequence[str],
) -> dict[str, str]:
    results_dir = county_dir / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    runs = {
        "aequilibrae_baseline": aeq_baseline,
        "aequilibrae_candidate": aeq_candidate,
        "activitysim_baseline": asim_baseline,
        "activitysim_candidate": asim_candidate,
    }
    conservation = {name: read_json(run / "conservation.json") for name, run in runs.items()}
    if any(record.get("status") != "passed" for record in conservation.values()):
        raise GatewayVolumeStudyError("At least one assignment failed the registered conservation chain.")
    write_json(results_dir / "conservation.json", {"runs": conservation})

    baseline_validation = validation_record(aeq_baseline)
    candidate_validation = validation_record(aeq_candidate)
    if baseline_validation["matched_station_ids"] != candidate_validation["matched_station_ids"]:
        raise GatewayVolumeStudyError(
            "Baseline and candidate changed the matched-station exam; refusing the county result."
        )
    write_json(results_dir / "baseline_validation.json", baseline_validation)
    write_json(results_dir / "candidate_validation.json", candidate_validation)

    gateway_basis = {
        "baseline": read_json(aeq_baseline / "gateway_volume_basis.json"),
        "candidate": read_json(aeq_candidate / "gateway_volume_basis.json"),
    }
    if gateway_basis["baseline"].get("stations_consumed") != gateway_basis["candidate"].get("stations_consumed"):
        raise GatewayVolumeStudyError("Baseline and candidate did not reserve the same gateway count sections.")
    write_json(results_dir / "gateway_volume_basis.json", gateway_basis)

    write_json(
        results_dir / "aequilibrae_corridors.json",
        corridor_change_record(
            aeq_baseline / "run_output" / "link_volumes.csv",
            aeq_candidate / "run_output" / "link_volumes.csv",
            aeq_baseline / "run_output" / "retained_network.geojson",
            label="AequilibraE gravity demand",
        ),
    )
    write_json(
        results_dir / "activitysim_corridors.json",
        corridor_change_record(
            asim_baseline / "run_output" / "link_volumes.csv",
            asim_candidate / "run_output" / "link_volumes.csv",
            aeq_baseline / "run_output" / "retained_network.geojson",
            label="ActivitySim activity-based demand",
        ),
    )

    guards = {
        "conservation": True,
        "convergence": {name: convergence_record(run) for name, run in runs.items()},
        "provenance": {
            name: read_json(run / "bundle_manifest.json").get("published_counts")
            for name, run in runs.items()
        },
        "zone_resolution_unchanged": (
            baseline_validation["summary"].get("zone_resolution")
            == candidate_validation["summary"].get("zone_resolution")
        ),
        "matched_station_set_unchanged": True,
    }
    if guards["zone_resolution_unchanged"] is not True:
        raise GatewayVolumeStudyError("Zone resolution changed between baseline and candidate.")

    required = [name for name in required_outputs if name != "artifact_hashes.json"]
    artifact_hashes = {name: sha256_file(results_dir / name) for name in required}
    write_json(results_dir / "artifact_hashes.json", {"artifacts": artifact_hashes, "guards": guards})
    return {
        name: sha256_file(results_dir / name)
        for name in [*required, "artifact_hashes.json"]
    }


def run_county(
    county: Mapping[str, Any],
    *,
    half: str,
    study_dir: Path,
    runs_root: Path,
    force: bool,
    required_outputs: Sequence[str],
) -> dict[str, Any]:
    county_fips = str(county["county_fips"])
    county_dir = study_dir / "runs" / half / county_fips
    status_path = county_dir / "status.json"
    if status_path.exists() and not force:
        status = read_json(status_path)
        if status.get("status") == "completed":
            return status
    started = time.monotonic()
    status: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "county_fips": county_fips,
        "half": half,
        "status": "running",
        "started_at_utc": utc_now(),
    }
    write_json(status_path, status)
    logs = county_dir / "logs"
    work = runs_root / "gateway-volume-study-work" / half / county_fips
    bundle = work / "activitysim_bundle"
    asim_output = work / "activitysim_output"
    demand_package = work / "activitysim_demand_package"
    names = {
        "aeq_baseline": f"gwv-{half}-{county_fips}-aeq-baseline",
        "aeq_candidate": f"gwv-{half}-{county_fips}-aeq-candidate",
        "asim_baseline": f"gwv-{half}-{county_fips}-asim-baseline",
        "asim_candidate": f"gwv-{half}-{county_fips}-asim-candidate",
    }
    runs = {key: runs_root / name for key, name in names.items()}

    def screening_command(key: str, arm: str, *, demand: Path | None = None) -> list[str]:
        command = [
            sys.executable,
            str(_SCRIPT_DIR / "run_screening_model.py"),
            "--name", names[key],
            "--county-fips", county_fips,
            "--counts", "auto",
            "--gateway-volume-study-arm", arm,
            "--keep-project",
        ]
        if key != "aeq_baseline":
            command.extend(["--reuse-network-from-run", str(runs["aeq_baseline"])])
            command.extend(["--reuse-counts-from-run", str(runs["aeq_baseline"])])
        if demand is not None:
            command.extend(["--demand-package-dir", str(demand)])
        if force:
            command.append("--force")
        return command

    try:
        run_step(screening_command("aeq_baseline", "baseline"), log_path=logs / "1-aeq-baseline.log")
        run_step(screening_command("aeq_candidate", "candidate"), log_path=logs / "2-aeq-candidate.log")
        run_step(
            [
                sys.executable,
                str(_SCRIPT_DIR / "build_activitysim_input_bundle.py"),
                "--screening-run-dir", str(runs["aeq_baseline"]),
                "--output-dir", str(bundle),
                "--population", "census",
                "--config-package", "mtc",
                "--force",
            ],
            log_path=logs / "3-activitysim-bundle.log",
        )
        if asim_output.exists():
            shutil.rmtree(asim_output)
        (asim_output / "workdir").mkdir(parents=True, exist_ok=True)
        run_step(
            [
                str(activitysim_executable()), "run",
                "-c", str(bundle / "configs"),
                "-c", str(stock_configs_dir()),
                "-d", str(bundle),
                "-o", str(asim_output / "output"),
                "-w", str(asim_output / "workdir"),
            ],
            log_path=logs / "4-activitysim.log",
        )
        trips_csv = asim_output / "output" / "final_trips.csv"
        if not trips_csv.exists():
            raise GatewayVolumeStudyError("ActivitySim finished without final_trips.csv")
        run_step(
            [
                sys.executable,
                str(_SCRIPT_DIR / "activitysim_demand_package.py"),
                "--trips-csv", str(trips_csv),
                "--zone-attributes-csv", str(runs["aeq_baseline"] / "package" / "zone_attributes.csv"),
                "--output-dir", str(demand_package),
            ],
            log_path=logs / "5-activitysim-demand.log",
        )
        run_step(
            screening_command("asim_baseline", "baseline", demand=demand_package),
            log_path=logs / "6-asim-baseline.log",
        )
        run_step(
            screening_command("asim_candidate", "candidate", demand=demand_package),
            log_path=logs / "7-asim-candidate.log",
        )
        output_hashes = assemble_county_outputs(
            county_dir=county_dir,
            aeq_baseline=runs["aeq_baseline"],
            aeq_candidate=runs["aeq_candidate"],
            asim_baseline=runs["asim_baseline"],
            asim_candidate=runs["asim_candidate"],
            required_outputs=required_outputs,
        )
        status.update({"status": "completed", "output_hashes": output_hashes})
    except KeyboardInterrupt:
        status.update(
            {
                "status": "aborted_before_result",
                "error": {
                    "kind": "KeyboardInterrupt",
                    "message": "Execution stopped before any assignment or validation result was produced.",
                },
                "finished_at_utc": utc_now(),
                "seconds": round(time.monotonic() - started, 1),
            }
        )
        write_json(status_path, status)
        raise
    except Exception as exc:  # noqa: BLE001 - every failed county needs a durable record
        status.update(
            {
                "status": "failed",
                "error": {
                    "kind": exc.__class__.__name__,
                    "message": str(exc),
                    "traceback": traceback.format_exc(limit=8),
                },
            }
        )
    status["finished_at_utc"] = utc_now()
    status["seconds"] = round(time.monotonic() - started, 1)
    write_json(status_path, status)
    return status


def load_freezes(study_dir: Path) -> tuple[dict[str, Any], dict[str, Any] | None]:
    try:
        candidate_path = registry_tools.latest_candidate_freeze_path(study_dir)
    except registry_tools.GatewayVolumeStudyRegistryError as exc:
        raise GatewayVolumeStudyError(
            "A candidate freeze is missing; development may not start."
        ) from exc
    candidate = read_json(candidate_path)
    development_path = study_dir / "development-freeze.json"
    development = read_json(development_path) if development_path.exists() else None
    return candidate, development


def authorize_half(
    half: str,
    registry: Mapping[str, Any],
    study_dir: Path,
    *,
    force: bool,
) -> None:
    candidate, development = load_freezes(study_dir)
    registry_tools.validate_candidate_freeze(registry, candidate)
    if half == "development":
        return
    if force:
        raise GatewayVolumeStudyError("Holdout reruns are refused after results can be read.")
    marker = registry_tools.authorize_holdout(registry, candidate, development)
    marker_path = study_dir / registry["protocol"]["required_outputs"]["holdout_open_marker"]
    if marker_path.exists() and read_json(marker_path) != marker:
        raise GatewayVolumeStudyError("The holdout-open marker was altered.")
    if not marker_path.exists():
        write_json(marker_path, marker)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the locked gateway-volume development or holdout half.")
    parser.add_argument("--half", choices=["development", "holdout"], required=True)
    parser.add_argument("--study-dir", default=str(DEFAULT_STUDY_DIR))
    parser.add_argument("--runs-root", default=str(DEFAULT_RUNS_ROOT))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    study_dir = Path(args.study_dir).resolve()
    registry = registry_tools.load_registry(study_dir / "registry.json")
    authorize_half(args.half, registry, study_dir, force=args.force)
    counties = list(registry["counties"][args.half])
    if args.limit is not None:
        if args.limit < 1:
            raise GatewayVolumeStudyError("--limit must be positive")
        counties = counties[: args.limit]
    statuses = []
    for index, county in enumerate(counties, 1):
        print(f"[{index}/{len(counties)}] {county['county_fips']} {county['county_name']}", flush=True)
        status = run_county(
            county,
            half=args.half,
            study_dir=study_dir,
            runs_root=Path(args.runs_root).resolve(),
            force=args.force,
            required_outputs=registry["protocol"]["required_outputs"]["per_county"],
        )
        print(f"    {status['status']} in {status.get('seconds', 0):.0f}s", flush=True)
        statuses.append(status)
        if status["status"] != "completed":
            break
    write_json(
        study_dir / "runs" / args.half / "batch-summary.json",
        {
            "half": args.half,
            "attempted": [status["county_fips"] for status in statuses],
            "completed": [status["county_fips"] for status in statuses if status["status"] == "completed"],
            "failed": [status["county_fips"] for status in statuses if status["status"] != "completed"],
            "generated_at_utc": utc_now(),
        },
    )
    return 0 if all(status["status"] == "completed" for status in statuses) else 1


if __name__ == "__main__":
    raise SystemExit(main())
