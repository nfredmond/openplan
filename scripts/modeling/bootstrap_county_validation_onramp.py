#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from pathlib import Path


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

    manifest = {
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
        },
        "runtime": {
            "keep_project": bool(args.keep_project),
            "force": bool(args.force),
            "overall_demand_scalar": args.overall_demand_scalar,
            "external_demand_scalar": args.external_demand_scalar,
            "hbw_scalar": args.hbw_scalar,
            "hbo_scalar": args.hbo_scalar,
            "nhb_scalar": args.nhb_scalar,
        },
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
