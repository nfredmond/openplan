#!/usr/bin/env python3
"""Execution guards for the frozen gateway-volume study."""
from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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


class EveryAssignmentUsesOneCountSnapshot(unittest.TestCase):
    def test_three_comparison_arms_reuse_the_baselines_network_and_counts(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            commands: list[list[str]] = []

            def fake_run_step(command, *, log_path):
                commands.append(list(command))
                if log_path.name == "4-activitysim.log":
                    trips = root / "work" / "gateway-volume-study-work" / "development" / "09160" / "activitysim_output" / "output" / "final_trips.csv"
                    trips.parent.mkdir(parents=True, exist_ok=True)
                    trips.write_text("trip_id\n")

            with (
                patch.object(study, "run_step", side_effect=fake_run_step),
                patch.object(study, "activitysim_executable", return_value=Path("/tmp/activitysim")),
                patch.object(study, "stock_configs_dir", return_value=Path("/tmp/configs")),
                patch.object(study, "assemble_county_outputs", return_value={"result.json": "a" * 64}),
            ):
                result = study.run_county(
                    {"county_fips": "09160"},
                    half="development",
                    study_dir=root / "study",
                    runs_root=root / "work",
                    force=False,
                    required_outputs=["result.json"],
                )

            self.assertEqual(result["status"], "completed")
            screening = [
                command for command in commands if Path(command[1]).name == "run_screening_model.py"
            ]
            self.assertEqual(len(screening), 4)
            self.assertNotIn("--reuse-counts-from-run", screening[0])
            for command in screening[1:]:
                self.assertIn("--reuse-network-from-run", command)
                self.assertIn("--reuse-counts-from-run", command)
                count_source = command[command.index("--reuse-counts-from-run") + 1]
                self.assertTrue(count_source.endswith("gwv-development-09160-aeq-baseline"))

    def test_an_interrupt_is_recorded_before_it_is_re_raised(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            with patch.object(study, "run_step", side_effect=KeyboardInterrupt):
                with self.assertRaises(KeyboardInterrupt):
                    study.run_county(
                        {"county_fips": "09160"},
                        half="development",
                        study_dir=root / "study",
                        runs_root=root / "work",
                        force=False,
                        required_outputs=["result.json"],
                    )
            status = study.read_json(
                root / "study" / "runs" / "development" / "09160" / "status.json"
            )
            self.assertEqual(status["status"], "aborted_before_result")
            self.assertEqual(status["error"]["kind"], "KeyboardInterrupt")


if __name__ == "__main__":
    unittest.main()
