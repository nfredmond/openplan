#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from screening_runtime import export_loaded_links_geojson


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rebuild loaded_links.geojson/top_loaded_links.geojson for a legacy assignment run from link_volumes.csv + project_database.sqlite"
    )
    parser.add_argument("--run-output-dir", required=True, help="Directory containing link_volumes.csv")
    parser.add_argument("--project-db", required=True, help="Path to the matching AequilibraE project_database.sqlite")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    run_output_dir = Path(args.run_output_dir).expanduser().resolve()
    project_db = Path(args.project_db).expanduser().resolve()
    link_volumes_path = run_output_dir / "link_volumes.csv"

    if not link_volumes_path.exists():
        raise FileNotFoundError(f"Missing link volumes: {link_volumes_path}")
    if not project_db.exists():
        raise FileNotFoundError(f"Missing project DB: {project_db}")

    link_results = pd.read_csv(link_volumes_path)
    export_loaded_links_geojson(project_db.parent, link_results, run_output_dir)
    print(f"hydrated geometry for {run_output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
