#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shlex
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
WORKER_DIR = SCRIPT_DIR.parents[1] / "workers" / "activitysim_worker"

if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

from build_activitysim_input_bundle import build_activitysim_input_bundle
from extract_activitysim_behavioral_kpis import extract_activitysim_behavioral_kpis
from ingest_activitysim_runtime_outputs import ingest_activitysim_runtime_outputs
from runtime import run_activitysim_runtime

PIPELINE_MANIFEST_NAME = "behavioral_demand_prototype_manifest.json"
DEFAULT_OUTPUT_ROOT_NAME = "behavioral_demand_prototype"
STEP_SEQUENCE = [
    "build_activitysim_input_bundle",
    "run_activitysim_runtime",
    "ingest_activitysim_runtime_outputs",
    "extract_activitysim_behavioral_kpis",
]
EXECUTED_RUNTIME_MODES = {"activitysim_cli", "activitysim_container_cli"}


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the end-to-end OpenPlan behavioral-demand prototype flow from a completed screening run."
    )
    parser.add_argument("--screening-run-dir", required=True, help="Completed screening run directory")
    parser.add_argument(
        "--output-root",
        help="Root directory for prototype outputs (default: <screening-run-dir>/behavioral_demand_prototype)",
    )
    parser.add_argument(
        "--skim-mode",
        choices=["copy", "symlink"],
        default="copy",
        help="How to materialize the screening skim into the ActivitySim input bundle",
    )
    parser.add_argument("--config-dir", help="Optional ActivitySim config directory override for the runtime step")
    parser.add_argument("--activitysim-cli", help="Optional ActivitySim CLI command override")
    parser.add_argument(
        "--activitysim-cli-template",
        help=(
            "Optional ActivitySim command template with placeholders such as "
            "{config_dir}, {data_dir}, {output_dir}, {working_dir}, {bundle_dir}, {runtime_dir}"
        ),
    )
    parser.add_argument("--activitysim-container-image", help="Optional container image override for the runtime step")
    parser.add_argument("--container-engine-cli", help="Optional container engine command override")
    parser.add_argument(
        "--activitysim-container-cli-template",
        help=(
            "Optional ActivitySim command template executed inside the container with placeholders such as "
            "{config_dir}, {data_dir}, {output_dir}, {working_dir}, {bundle_dir}, {runtime_dir}"
        ),
    )
    parser.add_argument(
        "--container-network-mode",
        default="none",
        help="Optional container network mode for the ActivitySim runtime step. Defaults to 'none'.",
    )
    parser.add_argument("--run-label", help="Optional label recorded in the runtime metadata")
    parser.add_argument("--force", action="store_true", help="Replace an existing output root")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def dedupe_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    seen = set()
    for value in values:
        if not isinstance(value, str) or not value or value in seen:
            continue
        result.append(value)
        seen.add(value)
    return result


def default_output_root(screening_run_dir: Path) -> Path:
    return screening_run_dir / DEFAULT_OUTPUT_ROOT_NAME


def behavioral_runtime_status(runtime_summary: dict[str, Any] | None) -> str | None:
    if not runtime_summary:
        return None
    runtime_mode = runtime_summary.get("mode")
    runtime_status = runtime_summary.get("status")
    if runtime_status == "succeeded" and runtime_mode in EXECUTED_RUNTIME_MODES:
        return "behavioral_runtime_succeeded"
    if runtime_status == "blocked" or runtime_mode == "preflight_only":
        return "behavioral_runtime_blocked"
    if runtime_status == "failed":
        return "behavioral_runtime_failed"
    return None


def pipeline_status(
    *,
    runtime_summary: dict[str, Any] | None,
    errors: list[dict[str, Any]],
) -> str:
    if errors:
        return "prototype_pipeline_failed"
    lane_status = behavioral_runtime_status(runtime_summary)
    if lane_status == "behavioral_runtime_succeeded":
        return "behavioral_runtime_succeeded"
    if lane_status == "behavioral_runtime_blocked":
        return "prototype_preflight_complete"
    if lane_status == "behavioral_runtime_failed":
        return "behavioral_runtime_failed"
    return "prototype_pipeline_running"


def initial_manifest(screening_run_dir: Path, output_root: Path) -> dict[str, Any]:
    return {
        "schema_version": "openplan.behavioral_demand_prototype.v0",
        "manifest_type": "behavioral_demand_prototype_manifest",
        "created_at_utc": _utc_now(),
        "updated_at_utc": _utc_now(),
        "prototype": True,
        "source": {
            "screening_run_dir": str(screening_run_dir),
        },
        "output_root": str(output_root),
        "pipeline_status": "prototype_pipeline_running",
        "behavioral_runtime_status": None,
        "runtime_mode": None,
        "steps": {
            step_key: {
                "step_key": step_key,
                "status": "queued",
                "started_at_utc": None,
                "completed_at_utc": None,
                "artifacts": {},
                "caveats": [],
            }
            for step_key in STEP_SEQUENCE
        },
        "artifacts": {
            "pipeline_manifest_path": str(output_root / PIPELINE_MANIFEST_NAME),
        },
        "caveats": [],
        "errors": [],
    }


def update_pipeline_manifest(
    manifest: dict[str, Any],
    output_root: Path,
    *,
    runtime_summary: dict[str, Any] | None = None,
) -> None:
    manifest["updated_at_utc"] = _utc_now()
    manifest["behavioral_runtime_status"] = behavioral_runtime_status(runtime_summary)
    manifest["runtime_mode"] = runtime_summary.get("mode") if runtime_summary else None
    manifest["pipeline_status"] = pipeline_status(runtime_summary=runtime_summary, errors=manifest["errors"])
    manifest["caveats"] = dedupe_strings(manifest["caveats"])
    write_json(output_root / PIPELINE_MANIFEST_NAME, manifest)


def record_step_start(manifest: dict[str, Any], step_key: str) -> None:
    step = manifest["steps"][step_key]
    step["status"] = "running"
    step["started_at_utc"] = _utc_now()


def record_step_finish(
    manifest: dict[str, Any],
    step_key: str,
    *,
    status: str,
    artifacts: dict[str, Any],
    caveats: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    step = manifest["steps"][step_key]
    step["status"] = status
    step["completed_at_utc"] = _utc_now()
    step["artifacts"] = artifacts
    step["caveats"] = dedupe_strings(list(caveats or []))
    if metadata is not None:
        step["metadata"] = metadata


def record_error(
    manifest: dict[str, Any],
    *,
    step_key: str,
    exc: Exception,
) -> None:
    manifest["errors"].append(
        {
            "step_key": step_key,
            "kind": exc.__class__.__name__,
            "message": str(exc),
        }
    )
    step = manifest["steps"][step_key]
    step["status"] = "failed"
    step["completed_at_utc"] = _utc_now()


def run_behavioral_demand_prototype(
    *,
    screening_run_dir: str,
    output_root: str | None = None,
    skim_mode: str = "copy",
    config_dir: str | None = None,
    activitysim_cli: str | None = None,
    activitysim_cli_template: str | None = None,
    activitysim_container_image: str | None = None,
    container_engine_cli: str | None = None,
    activitysim_container_cli_template: str | None = None,
    container_network_mode: str | None = "none",
    run_label: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    screening_path = Path(screening_run_dir).expanduser().resolve()
    if not screening_path.exists():
        raise RuntimeError(f"Screening run directory does not exist: {screening_path}")

    resolved_output_root = Path(output_root).expanduser().resolve() if output_root else default_output_root(screening_path)
    if resolved_output_root.exists():
        if not force:
            raise RuntimeError(f"Output root already exists: {resolved_output_root}")
        shutil.rmtree(resolved_output_root)
    resolved_output_root.mkdir(parents=True, exist_ok=True)

    bundle_dir = resolved_output_root / "activitysim_bundle"
    runtime_dir = resolved_output_root / "runtime"
    ingestion_dir = resolved_output_root / "ingestion"
    kpi_dir = resolved_output_root / "kpis"

    manifest = initial_manifest(screening_path, resolved_output_root)
    manifest["artifacts"].update(
        {
            "bundle_dir": str(bundle_dir),
            "runtime_dir": str(runtime_dir),
            "ingestion_dir": str(ingestion_dir),
            "kpi_dir": str(kpi_dir),
        }
    )
    update_pipeline_manifest(manifest, resolved_output_root)

    bundle_summary: dict[str, Any] | None = None
    runtime_summary: dict[str, Any] | None = None
    ingestion_summary: dict[str, Any] | None = None
    kpi_summary: dict[str, Any] | None = None

    try:
        step_key = "build_activitysim_input_bundle"
        record_step_start(manifest, step_key)
        update_pipeline_manifest(manifest, resolved_output_root)
        bundle_summary = build_activitysim_input_bundle(
            screening_run_dir=str(screening_path),
            output_dir=str(bundle_dir),
            skim_mode=skim_mode,
            force=False,
        )
        bundle_manifest = read_json(Path(bundle_summary["manifest_path"]))
        record_step_finish(
            manifest,
            step_key,
            status="succeeded",
            artifacts={
                "bundle_dir": bundle_summary["output_dir"],
                "bundle_manifest_path": bundle_summary["manifest_path"],
            },
            caveats=list(bundle_summary.get("caveats", [])),
            metadata={
                "land_use_rows": bundle_summary["land_use_rows"],
                "households": bundle_summary["households"],
                "persons": bundle_summary["persons"],
                "skim_mode": bundle_summary["skim_mode"],
                "bundle_type": bundle_manifest.get("bundle_type"),
            },
        )
        manifest["caveats"].extend(bundle_summary.get("caveats", []))
        manifest["artifacts"]["bundle_manifest_path"] = bundle_summary["manifest_path"]
        update_pipeline_manifest(manifest, resolved_output_root)

        step_key = "run_activitysim_runtime"
        record_step_start(manifest, step_key)
        update_pipeline_manifest(manifest, resolved_output_root)
        runtime_summary = run_activitysim_runtime(
            bundle_path=str(bundle_dir),
            runtime_dir=str(runtime_dir),
            config_dir=config_dir,
            cli_command=shlex.split(activitysim_cli) if activitysim_cli else None,
            cli_template=activitysim_cli_template,
            container_image=activitysim_container_image,
            container_engine_command=shlex.split(container_engine_cli) if container_engine_cli else None,
            container_template=activitysim_container_cli_template,
            container_network_mode=container_network_mode,
            run_label=run_label,
            force=False,
        )
        runtime_manifest = read_json(Path(runtime_summary["runtime_manifest_path"]))
        record_step_finish(
            manifest,
            step_key,
            status=str(runtime_summary["status"]),
            artifacts={
                "runtime_dir": runtime_summary["runtime_dir"],
                "runtime_manifest_path": runtime_summary["runtime_manifest_path"],
                "runtime_summary_path": runtime_summary["runtime_summary_path"],
            },
            caveats=list(runtime_summary.get("caveats", [])),
            metadata={
                "mode": runtime_summary.get("mode"),
                "stage_statuses": runtime_summary.get("stage_statuses", {}),
                "runtime_type": runtime_manifest.get("runtime_type"),
            },
        )
        manifest["caveats"].extend(runtime_summary.get("caveats", []))
        manifest["artifacts"]["runtime_manifest_path"] = runtime_summary["runtime_manifest_path"]
        manifest["artifacts"]["runtime_summary_path"] = runtime_summary["runtime_summary_path"]
        update_pipeline_manifest(manifest, resolved_output_root, runtime_summary=runtime_summary)

        step_key = "ingest_activitysim_runtime_outputs"
        record_step_start(manifest, step_key)
        update_pipeline_manifest(manifest, resolved_output_root, runtime_summary=runtime_summary)
        ingestion_summary = ingest_activitysim_runtime_outputs(
            runtime_dir=str(runtime_dir),
            output_dir=str(ingestion_dir),
            force=False,
        )
        ingestion_payload = read_json(Path(ingestion_summary["summary_path"]))
        record_step_finish(
            manifest,
            step_key,
            status="succeeded",
            artifacts={
                "ingestion_dir": ingestion_summary["ingestion_dir"],
                "ingestion_summary_path": ingestion_summary["summary_path"],
                "artifact_metadata_path": ingestion_summary["artifact_metadata_path"],
            },
            caveats=list(ingestion_summary.get("caveats", [])),
            metadata={
                "mode": ingestion_summary.get("mode"),
                "status": ingestion_summary.get("status"),
                "output_file_count": ingestion_summary.get("output_file_count"),
                "output_table_count": ingestion_summary.get("output_table_count"),
                "common_tables": {
                    key: bool(value) for key, value in ingestion_payload.get("common_tables", {}).items()
                },
            },
        )
        manifest["caveats"].extend(ingestion_summary.get("caveats", []))
        manifest["artifacts"]["ingestion_summary_path"] = ingestion_summary["summary_path"]
        manifest["artifacts"]["artifact_metadata_path"] = ingestion_summary["artifact_metadata_path"]
        update_pipeline_manifest(manifest, resolved_output_root, runtime_summary=runtime_summary)

        step_key = "extract_activitysim_behavioral_kpis"
        record_step_start(manifest, step_key)
        update_pipeline_manifest(manifest, resolved_output_root, runtime_summary=runtime_summary)
        kpi_summary = extract_activitysim_behavioral_kpis(
            ingestion_summary=ingestion_summary["summary_path"],
            output_dir=str(kpi_dir),
            force=False,
        )
        kpi_payload = read_json(Path(kpi_summary["summary_path"]))
        record_step_finish(
            manifest,
            step_key,
            status="succeeded",
            artifacts={
                "kpi_dir": kpi_summary["kpi_dir"],
                "kpi_summary_path": kpi_summary["summary_path"],
                "kpi_packet_path": kpi_summary["packet_path"],
            },
            caveats=list(kpi_payload.get("caveats", [])),
            metadata={
                "availability_status": kpi_summary.get("availability_status"),
                "coverage": kpi_summary.get("coverage", {}),
            },
        )
        manifest["caveats"].extend(kpi_payload.get("caveats", []))
        manifest["artifacts"]["kpi_summary_path"] = kpi_summary["summary_path"]
        manifest["artifacts"]["kpi_packet_path"] = kpi_summary["packet_path"]
        update_pipeline_manifest(manifest, resolved_output_root, runtime_summary=runtime_summary)

    except Exception as exc:
        failed_step = next(
            (step for step in STEP_SEQUENCE if manifest["steps"][step]["status"] == "running"),
            STEP_SEQUENCE[-1],
        )
        record_error(manifest, step_key=failed_step, exc=exc)
        update_pipeline_manifest(manifest, resolved_output_root, runtime_summary=runtime_summary)
        raise

    final_payload = {
        "output_root": str(resolved_output_root),
        "manifest_path": str(resolved_output_root / PIPELINE_MANIFEST_NAME),
        "pipeline_status": manifest["pipeline_status"],
        "behavioral_runtime_status": manifest["behavioral_runtime_status"],
        "runtime_mode": manifest["runtime_mode"],
        "bundle_manifest_path": bundle_summary["manifest_path"] if bundle_summary else None,
        "runtime_manifest_path": runtime_summary["runtime_manifest_path"] if runtime_summary else None,
        "runtime_summary_path": runtime_summary["runtime_summary_path"] if runtime_summary else None,
        "ingestion_summary_path": ingestion_summary["summary_path"] if ingestion_summary else None,
        "kpi_summary_path": kpi_summary["summary_path"] if kpi_summary else None,
        "kpi_packet_path": kpi_summary["packet_path"] if kpi_summary else None,
        "caveats": manifest["caveats"],
    }
    return final_payload


def main() -> int:
    args = parse_args()
    result = run_behavioral_demand_prototype(
        screening_run_dir=args.screening_run_dir,
        output_root=args.output_root,
        skim_mode=args.skim_mode,
        config_dir=args.config_dir,
        activitysim_cli=args.activitysim_cli,
        activitysim_cli_template=args.activitysim_cli_template,
        activitysim_container_image=args.activitysim_container_image,
        container_engine_cli=args.container_engine_cli,
        activitysim_container_cli_template=args.activitysim_container_cli_template,
        container_network_mode=args.container_network_mode,
        run_label=args.run_label,
        force=args.force,
    )
    print(json.dumps(result, indent=2))
    return 0 if result["pipeline_status"] in {"prototype_preflight_complete", "behavioral_runtime_succeeded"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
