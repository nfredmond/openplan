#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Lightweight checker for OpenPlan county onramp manifests.")
    parser.add_argument("manifest", help="Path to county onramp manifest JSON")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    path = Path(args.manifest).expanduser().resolve()
    data = json.loads(path.read_text())

    required_top = [
        "schema_version",
        "generated_at",
        "name",
        "county_prefix",
        "run_dir",
        "mode",
        "stage",
        "artifacts",
        "runtime",
        "summary",
    ]
    missing = [key for key in required_top if key not in data]
    if missing:
        raise SystemExit(f"Missing top-level keys: {missing}")

    allowed_stages = {
        "bootstrap-incomplete",
        "runtime-complete",
        "validation-scaffolded",
        "validated-screening",
    }
    if data["stage"] not in allowed_stages:
        raise SystemExit(f"Invalid stage: {data['stage']}")

    if data["schema_version"] != "openplan.county_onramp_manifest.v1":
        raise SystemExit(f"Unexpected schema_version: {data['schema_version']}")

    for key in ["scaffold_csv", "review_packet_md", "run_summary_json", "bundle_manifest_json", "validation_summary_json"]:
        if key not in data["artifacts"]:
            raise SystemExit(f"Missing artifacts.{key}")

    print(f"Manifest OK: {path}")
    print(f"stage={data['stage']}")
    scaffold = ((data.get("summary") or {}).get("scaffold") or {}) if isinstance(data.get("summary"), dict) else {}
    if isinstance(scaffold, dict) and "station_count" in scaffold and "ready_station_count" in scaffold:
        print(f"scaffold_ready={scaffold.get('ready_station_count')}/{scaffold.get('station_count')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
