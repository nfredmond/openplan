#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shlex
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a county screening build and immediately generate validation-onramp artifacts."
    )
    parser.add_argument("--name", required=True, help="Run name for the screening build")
    parser.add_argument("--county-fips", required=True, help="County FIPS code, e.g. 06061")
    parser.add_argument("--county-prefix", required=True, help="Validation station prefix, e.g. PLACER")
    parser.add_argument("--output-csv", required=True, help="Path for generated validation scaffold CSV")
    parser.add_argument("--output-md", required=True, help="Path for generated validation review packet markdown")
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


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]

    run_model_cmd = [
        sys.executable,
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

    print(f"Completed county validation on-ramp bootstrap for {args.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
