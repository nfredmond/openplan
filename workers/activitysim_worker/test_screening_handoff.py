#!/usr/bin/env python3
"""Regression checks for the retained-network ActivitySim handoff."""

import csv
import json
import tempfile
from pathlib import Path

import supabase_poll as worker


def test_materialized_handoff_includes_exact_network_setup_summary() -> None:
    with tempfile.TemporaryDirectory() as raw_root:
        root = Path(raw_root)
        skim = root / "source.omx"
        zones = root / "zones.csv"
        setup = root / "network_setup_summary.json"
        skim.write_bytes(b"test-skim")
        with zones.open("w", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["GEOID", "zone_id", "centroid_lon", "centroid_lat", "area_sq_mi"],
            )
            writer.writeheader()
            writer.writerow(
                {
                    "GEOID": "test-zone",
                    "zone_id": 1,
                    "centroid_lon": -121,
                    "centroid_lat": 39,
                    "area_sq_mi": 4.5,
                }
            )
        setup_payload = {"centroid_map": {"1": 9876}, "network": {"nodes": 10000}}
        setup.write_text(json.dumps(setup_payload))

        screening = Path(
            worker._materialize_screening_dir(
                "test-run", str(skim), str(zones), str(setup), str(root / "materialized")
            )
        )

        copied = json.loads((screening / "work" / "network_setup_summary.json").read_text())
        assert copied == setup_payload


if __name__ == "__main__":
    test_materialized_handoff_includes_exact_network_setup_summary()
    print("ok  test_materialized_handoff_includes_exact_network_setup_summary")
