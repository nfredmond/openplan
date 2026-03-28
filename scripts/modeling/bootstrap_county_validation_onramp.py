#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from run_behavioral_demand_prototype import PIPELINE_MANIFEST_NAME, run_behavioral_demand_prototype


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a county screening build and immediately generate validation-onramp artifacts."
    )
    parser.add_argument("--name", required=True, help="Run name for the screening build")
    parser.add_argument("--county-fips", help="County FIPS code, e.g. 06061")
    parser.add_argument("--county-prefix", required=True, help="Validation station prefix, e.g. PLACER")
    parser.add_argument("--existing-run-dir", help="Use an already completed screening run directory instead of building")
    parser.add_argument("--python-bin", help="Explicit Python binary for run_screening_model.py when building a new run")
    parser.add_argument("--output-csv", required=True, help="Path for generated validation scaffold CSV")
    parser.add_argument("--output-md", required=True, help="Path for generated validation review packet markdown")
    parser.add_argument("--output-manifest", help="Optional JSON manifest path for orchestration/backends")
    parser.add_argument("--limit", type=int, default=8, help="Max scaffold rows to emit")
    parser.add_argument("--bbox-padding-deg", type=float, default=0.006, help="BBox padding in degrees")
    parser.add_argument("--source-agency", default="TBD", help="Default source agency placeholder")
    parser.add_argument("--keep-project", action="store_true", help="Retain AequilibraE project for diagnostics")
    parser.add_argument("--force", action="store_true", help="Replace existing run directory")
    parser.add_argument("--overall-demand-scalar", type=float, help="Optional overall demand scalar")
    parser.add_argument("--external-demand-scalar", type=float, help="Optional external demand scalar")
    parser.add_argument("--hbw-scalar", type=float, help="Optional HBW scalar")
    parser.add_argument("--hbo-scalar", type=float, help="Optional HBO scalar")
    parser.add_argument("--nhb-scalar", type=float, help="Optional NHB scalar")
    parser.add_argument("--activitysim-container-image", help="Optional ActivitySim container image override")
    parser.add_argument("--container-engine-cli", help="Optional container engine command, e.g. 'docker'")
    parser.add_argument(
        "--activitysim-container-cli-template",
        help="Optional ActivitySim container CLI template passed through to the runtime worker",
    )
    parser.add_argument("--container-network-mode", help="Optional container network mode, e.g. 'bridge'")
    return parser.parse_args()


def run_cmd(command: list[str], cwd: Path) -> None:
    print("+", " ".join(shlex.quote(part) for part in command), flush=True)
    subprocess.run(command, cwd=str(cwd), check=True)


def write_manifest(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))


def read_json_if_exists(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text())


def derive_stage(run_summary: dict | None, validation_summary: dict | None) -> str:
    if validation_summary:
        status = ((validation_summary.get("screening_gate") or {}).get("status_label") or "").strip().lower()
        if status == "bounded screening-ready":
            return "validated-screening"
        return "validation-scaffolded"
    if run_summary:
        return "runtime-complete"
    return "bootstrap-incomplete"


def get_nested(mapping: dict | None, *keys: str):
    current = mapping
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def behavioral_output_root(run_dir: Path) -> Path:
    return run_dir / "behavioral_demand_prototype"


def behavioral_manifest_path(run_dir: Path) -> Path:
    return behavioral_output_root(run_dir) / PIPELINE_MANIFEST_NAME


def summarize_activitysim_bundle(behavioral_manifest: dict[str, Any] | None) -> dict[str, Any]:
    bundle_step = ((behavioral_manifest or {}).get("steps") or {}).get("build_activitysim_input_bundle") or {}
    bundle_artifacts = bundle_step.get("artifacts") or {}
    bundle_metadata = bundle_step.get("metadata") or {}
    bundle_status = bundle_step.get("status")
    if bundle_status in {"succeeded", "completed"}:
        return {
            "status": "completed",
            "output_dir": bundle_artifacts.get("bundle_dir"),
            "manifest_path": bundle_artifacts.get("bundle_manifest_path"),
            "land_use_rows": bundle_metadata.get("land_use_rows"),
            "households": bundle_metadata.get("households"),
            "persons": bundle_metadata.get("persons"),
            "skim_mode": bundle_metadata.get("skim_mode"),
        }

    if bundle_status == "failed":
        error = next(
            (entry for entry in (behavioral_manifest or {}).get("errors", []) if entry.get("step_key") == "build_activitysim_input_bundle"),
            None,
        )
        return {
            "status": "failed",
            "output_dir": bundle_artifacts.get("bundle_dir"),
            "manifest_path": bundle_artifacts.get("bundle_manifest_path"),
            "land_use_rows": None,
            "households": None,
            "persons": None,
            "skim_mode": None,
            "error": error,
        }

    return {
        "status": "not-built",
        "output_dir": None,
        "manifest_path": None,
        "land_use_rows": None,
        "households": None,
        "persons": None,
        "skim_mode": None,
    }


def summarize_behavioral_prototype_from_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    artifacts = manifest.get("artifacts") or {}
    return {
        "output_root": manifest.get("output_root"),
        "manifest_path": artifacts.get("pipeline_manifest_path"),
        "pipeline_status": manifest.get("pipeline_status"),
        "behavioral_runtime_status": manifest.get("behavioral_runtime_status"),
        "runtime_mode": manifest.get("runtime_mode"),
        "bundle_manifest_path": artifacts.get("bundle_manifest_path"),
        "runtime_manifest_path": artifacts.get("runtime_manifest_path"),
        "runtime_summary_path": artifacts.get("runtime_summary_path"),
        "ingestion_summary_path": artifacts.get("ingestion_summary_path"),
        "kpi_summary_path": artifacts.get("kpi_summary_path"),
        "kpi_packet_path": artifacts.get("kpi_packet_path"),
        "caveats": list(manifest.get("caveats") or []),
    }


def behavioral_runtime_posture(
    runtime_mode: str | None,
    runtime_options: dict[str, Any],
) -> str:
    if runtime_mode == "activitysim_container_cli":
        image = runtime_options.get("activitysim_container_image")
        network_mode = runtime_options.get("container_network_mode")
        if image and network_mode:
            return f"containerized ActivitySim runtime requested via {image} on {network_mode} networking"
        if image:
            return f"containerized ActivitySim runtime requested via {image}"
        return "containerized ActivitySim runtime requested"
    if runtime_options.get("activitysim_container_image"):
        image = runtime_options["activitysim_container_image"]
        return f"containerized ActivitySim runtime configured via {image}, but not executed"
    if runtime_mode == "activitysim_cli":
        return "host ActivitySim CLI runtime executed"
    if runtime_mode == "preflight_only":
        return "preflight only; no executable ActivitySim runtime succeeded"
    return "behavioral runtime posture not yet recorded"


def run_or_reuse_behavioral_prototype(
    run_dir: Path,
    *,
    force: bool,
    runtime_options: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    existing_manifest = read_json_if_exists(behavioral_manifest_path(run_dir))
    if existing_manifest and not force:
        return summarize_behavioral_prototype_from_manifest(existing_manifest), existing_manifest

    result = run_behavioral_demand_prototype(
        screening_run_dir=str(run_dir),
        output_root=str(behavioral_output_root(run_dir)),
        force=force,
        activitysim_container_image=runtime_options.get("activitysim_container_image"),
        container_engine_cli=runtime_options.get("container_engine_cli"),
        activitysim_container_cli_template=runtime_options.get("activitysim_container_cli_template"),
        container_network_mode=runtime_options.get("container_network_mode"),
    )
    manifest = read_json_if_exists(Path(result["manifest_path"]))
    return result, manifest


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]

    if args.existing_run_dir:
        run_dir = Path(args.existing_run_dir).expanduser().resolve()
    else:
        if not args.county_fips:
            raise SystemExit("--county-fips is required unless --existing-run-dir is provided")
        python_bin = args.python_bin or sys.executable
        run_model_cmd = [
            python_bin,
            "scripts/modeling/run_screening_model.py",
            "--name",
            args.name,
            "--county-fips",
            args.county_fips,
        ]
        if args.keep_project:
            run_model_cmd.append("--keep-project")
        if args.force:
            run_model_cmd.append("--force")
        optional_scalars = {
            "--overall-demand-scalar": args.overall_demand_scalar,
            "--external-demand-scalar": args.external_demand_scalar,
            "--hbw-scalar": args.hbw_scalar,
            "--hbo-scalar": args.hbo_scalar,
            "--nhb-scalar": args.nhb_scalar,
        }
        for flag, value in optional_scalars.items():
            if value is not None:
                run_model_cmd.extend([flag, str(value)])

        run_cmd(run_model_cmd, repo_root)
        run_dir = repo_root / "data" / "screening-runs" / args.name
    scaffold_cmd = [
        sys.executable,
        "scripts/modeling/generate_validation_scaffold.py",
        "--run-dir",
        str(run_dir),
        "--output-csv",
        args.output_csv,
        "--output-md",
        args.output_md,
        "--county-prefix",
        args.county_prefix,
        "--limit",
        str(args.limit),
        "--bbox-padding-deg",
        str(args.bbox_padding_deg),
        "--source-agency",
        args.source_agency,
    ]
    run_cmd(scaffold_cmd, repo_root)

    run_summary = read_json_if_exists(run_dir / "run_summary.json")
    validation_summary = read_json_if_exists(run_dir / "validation" / "validation_summary.json")
    bundle_manifest = read_json_if_exists(run_dir / "bundle_manifest.json")
    runtime_options = {
        "keep_project": bool(args.keep_project),
        "force": bool(args.force),
        "overall_demand_scalar": args.overall_demand_scalar,
        "external_demand_scalar": args.external_demand_scalar,
        "hbw_scalar": args.hbw_scalar,
        "hbo_scalar": args.hbo_scalar,
        "nhb_scalar": args.nhb_scalar,
        "activitysim_container_image": args.activitysim_container_image,
        "container_engine_cli": args.container_engine_cli,
        "activitysim_container_cli_template": args.activitysim_container_cli_template,
        "container_network_mode": args.container_network_mode,
    }
    behavioral_prototype, behavioral_manifest = run_or_reuse_behavioral_prototype(
        run_dir,
        force=args.force,
        runtime_options=runtime_options,
    )
    activitysim_bundle = summarize_activitysim_bundle(behavioral_manifest)
    runtime_posture = behavioral_runtime_posture(behavioral_prototype.get("runtime_mode"), runtime_options)

    manifest = {
        "schema_version": "openplan.county_onramp_manifest.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "name": args.name,
        "county_fips": args.county_fips,
        "county_prefix": args.county_prefix,
        "run_dir": str(run_dir),
        "mode": "existing-run" if args.existing_run_dir else "build-and-bootstrap",
        "stage": derive_stage(run_summary, validation_summary),
        "artifacts": {
            "scaffold_csv": str(Path(args.output_csv).expanduser().resolve()),
            "review_packet_md": str(Path(args.output_md).expanduser().resolve()),
            "run_summary_json": str((run_dir / 'run_summary.json').resolve()) if (run_dir / 'run_summary.json').exists() else None,
            "bundle_manifest_json": str((run_dir / 'bundle_manifest.json').resolve()) if (run_dir / 'bundle_manifest.json').exists() else None,
            "validation_summary_json": str((run_dir / 'validation' / 'validation_summary.json').resolve()) if (run_dir / 'validation' / 'validation_summary.json').exists() else None,
            "activitysim_bundle_manifest_json": activitysim_bundle.get("manifest_path"),
            "behavioral_prototype_manifest_json": behavioral_prototype.get("manifest_path"),
            "behavioral_runtime_manifest_json": behavioral_prototype.get("runtime_manifest_path"),
            "behavioral_runtime_summary_json": behavioral_prototype.get("runtime_summary_path"),
            "behavioral_ingestion_summary_json": behavioral_prototype.get("ingestion_summary_path"),
            "behavioral_kpi_summary_json": behavioral_prototype.get("kpi_summary_path"),
            "behavioral_kpi_packet_md": behavioral_prototype.get("kpi_packet_path"),
        },
        "runtime": runtime_options,
        "summary": {
            "run": {
                "zone_count": get_nested(run_summary, "zones", "count") or get_nested(run_summary, "zone_count") or get_nested(run_summary, "zones"),
                "population_total": get_nested(run_summary, "zones", "population_total") or get_nested(run_summary, "population_total"),
                "jobs_total": get_nested(run_summary, "zones", "jobs_total") or get_nested(run_summary, "jobs_total"),
                "loaded_links": get_nested(run_summary, "assignment", "loaded_links") or get_nested(run_summary, "loaded_links"),
                "final_gap": get_nested(run_summary, "assignment", "convergence", "final_gap") or get_nested(run_summary, "final_gap"),
                "total_trips": get_nested(run_summary, "demand", "total_trips") or get_nested(run_summary, "total_trips"),
            },
            "validation": validation_summary,
            "bundle_validation": (bundle_manifest or {}).get("validation"),
            "activitysim_bundle": activitysim_bundle,
            "behavioral_prototype": {
                "pipeline_status": behavioral_prototype.get("pipeline_status"),
                "runtime_status": behavioral_prototype.get("behavioral_runtime_status"),
                "runtime_mode": behavioral_prototype.get("runtime_mode"),
                "runtime_posture": runtime_posture,
                "output_root": behavioral_prototype.get("output_root"),
                "prototype_manifest_path": behavioral_prototype.get("manifest_path"),
                "runtime_manifest_path": behavioral_prototype.get("runtime_manifest_path"),
                "runtime_summary_path": behavioral_prototype.get("runtime_summary_path"),
                "ingestion_summary_path": behavioral_prototype.get("ingestion_summary_path"),
                "kpi_summary_path": behavioral_prototype.get("kpi_summary_path"),
                "kpi_packet_path": behavioral_prototype.get("kpi_packet_path"),
                "caveats": behavioral_prototype.get("caveats", []),
            },
        },
    }
    if args.output_manifest:
        manifest_path = Path(args.output_manifest).expanduser().resolve()
        write_manifest(manifest_path, manifest)
        print(f"Wrote manifest to {manifest_path}")

    print(f"Completed county validation on-ramp bootstrap for {args.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
