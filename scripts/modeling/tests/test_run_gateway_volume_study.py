#!/usr/bin/env python3
"""Execution guards for the frozen gateway-volume study."""
from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import gateway_volume_study_registry as registry_tools  # noqa: E402
import run_gateway_volume_study as study  # noqa: E402

REPO_ROOT = SCRIPT_DIR.parents[1]
REGISTRY_PATH = REPO_ROOT / registry_tools.DEFAULT_REGISTRY_PATH


class CorridorChangeIsNotAnAverage(unittest.TestCase):
    def test_same_link_set_is_compared_arithmetically(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            network = root / "network.geojson"
            network.write_text(
                json.dumps(
                    {
                        "features": [
                            {"properties": {"link_id": 1, "link_type": "trunk"}},
                            {"properties": {"link_id": 2, "link_type": "primary"}},
                        ]
                    }
                )
            )

            def write_volumes(path: Path, rows: list[tuple[int, float]]) -> None:
                with path.open("w", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=["link_id", "PCE_tot"])
                    writer.writeheader()
                    writer.writerows({"link_id": link_id, "PCE_tot": volume} for link_id, volume in rows)

            baseline = root / "baseline.csv"
            candidate = root / "candidate.csv"
            write_volumes(baseline, [(1, 100), (2, 0)])
            write_volumes(candidate, [(1, 80), (2, 20)])
            result = study.corridor_change_record(baseline, candidate, network, label="probe")
            self.assertFalse(result["is_average"])
            self.assertEqual(result["links"][0]["change"], -20)
            self.assertEqual(result["links"][0]["change_percent"], -20)
            self.assertIsNone(result["links"][1]["change_percent"])
            self.assertEqual(result["links"][0]["road_class"], "trunk")

    def test_changed_link_set_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            network = root / "network.geojson"
            network.write_text(json.dumps({"features": []}))
            for name, link_id in (("baseline", 1), ("candidate", 2)):
                with (root / f"{name}.csv").open("w", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=["link_id", "PCE_tot"])
                    writer.writeheader()
                    writer.writerow({"link_id": link_id, "PCE_tot": 10})
            with self.assertRaisesRegex(study.GatewayVolumeStudyError, "same retained link ids"):
                study.corridor_change_record(
                    root / "baseline.csv", root / "candidate.csv", network, label="probe"
                )


class HoldoutCannotOpenEarly(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = registry_tools.load_registry(REGISTRY_PATH)
        self.tmp = tempfile.TemporaryDirectory()
        self.study_dir = Path(self.tmp.name)
        candidate = registry_tools.freeze_candidate(
            self.registry,
            candidate_commit="a" * 40,
            implementation_hashes={"candidate.py": "b" * 64},
        )
        study.write_json(self.study_dir / "candidate-freeze.json", candidate)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_development_can_run_after_candidate_is_frozen(self) -> None:
        study.authorize_half("development", self.registry, self.study_dir, force=False)

    def test_holdout_refuses_without_all_development_outputs(self) -> None:
        with self.assertRaisesRegex(registry_tools.GatewayVolumeStudyRegistryError, "sealed"):
            study.authorize_half("holdout", self.registry, self.study_dir, force=False)

    def test_holdout_force_rerun_is_refused(self) -> None:
        with self.assertRaisesRegex(study.GatewayVolumeStudyError, "reruns are refused"):
            study.authorize_half("holdout", self.registry, self.study_dir, force=True)


if __name__ == "__main__":
    unittest.main()
