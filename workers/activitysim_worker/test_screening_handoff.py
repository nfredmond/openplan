#!/usr/bin/env python3
"""Regression checks for the retained-network ActivitySim handoff."""

import csv
import hashlib
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

# This file-copy test never contacts Supabase; importing the worker still needs
# configuration. Restore the caller's environment after importing it.
with patch.dict(os.environ, {
    "SUPABASE_URL": "http://127.0.0.1:1",
    "SUPABASE_SERVICE_ROLE_KEY": "synthetic-unit-test-only",
}):
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

        run_id = "00000001-1111-4111-8111-111111111111"
        consumer_stage_id = "00000002-1111-4111-8111-111111111111"
        sources = [
            {"id": f"{index:08d}-1111-4111-8111-111111111111",
             "run_id": run_id, "stage_id": "00000003-1111-4111-8111-111111111111",
             "attempt_id": None, "artifact_type": kind,
             "content_hash": hashlib.sha256(path.read_bytes()).hexdigest(),
             "file_size_bytes": path.stat().st_size,
             "model_run_stages": {"status": "succeeded", "attempt_managed": False}}
            for index, (kind, path) in enumerate([
                ("skim_matrix", skim), ("zone_attributes", zones),
                ("network_setup_summary", setup),
            ], start=4)
        ]
        screening = Path(
            worker._materialize_screening_dir(
                run_id, str(skim), str(zones), str(setup), str(root / "materialized"),
                source_artifacts=sources, consumer_stage_id=consumer_stage_id
            )
        )

        copied = json.loads((screening / "work" / "network_setup_summary.json").read_text())
        assert copied == setup_payload
        manifest = json.loads((screening / "bundle_manifest.json").read_text())
        assert manifest["model_run_id"] == run_id
        assert manifest["consumer_stage_id"] == consumer_stage_id
        assert manifest["source_artifacts"] == sources


if __name__ == "__main__":
    test_materialized_handoff_includes_exact_network_setup_summary()
    print("ok  test_materialized_handoff_includes_exact_network_setup_summary")
