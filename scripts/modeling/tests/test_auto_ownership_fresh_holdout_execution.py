#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import evaluate_auto_ownership_fresh_holdout as evaluator  # noqa: E402
import prepare_auto_ownership_fresh_holdout as preparation  # noqa: E402
import run_auto_ownership_transfer_study as transfer  # noqa: E402


class FreshHoldoutExecutionTests(unittest.TestCase):
    def test_preparation_uses_census_population_and_component_isolation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry_path = root / "registry.json"
            registry_path.write_text(json.dumps({
                "status": "pre_registered_before_candidate_execution",
                "geographies": [{"geography_id": "place-a", "label": "Place A"}],
            }))
            studies = root / "studies"
            screening = root / "screening"
            commands = []

            def fake_run(command, *, log_path, env=None):
                commands.append(command)
                if "run_screening_model.py" in command[1]:
                    run_dir = Path(command[command.index("--output-root") + 1]) / command[command.index("--name") + 1]
                    run_dir.mkdir(parents=True)
                    (run_dir / "bundle_manifest.json").write_text("{}")
                elif "build_activitysim_input_bundle.py" in command[1]:
                    bundle = Path(command[command.index("--output-dir") + 1])
                    bundle.mkdir(parents=True)
                    (bundle / "households.csv").write_text("fixture\n")
                    (bundle / "configs").mkdir()
                else:
                    output = Path(command[command.index("-o") + 1])
                    output.mkdir(parents=True)
                    (output / "final_households.csv").write_text("fixture\n")

            with (
                mock.patch.object(preparation, "run_step", side_effect=fake_run),
                mock.patch.object(preparation, "activitysim_executable", return_value="activitysim"),
                mock.patch.object(preparation, "stock_configs_dir", return_value=root / "stock"),
            ):
                results = preparation.prepare(registry_path, studies, screening)
            self.assertEqual(results[0]["status"], "completed")
            build = next(command for command in commands if "build_activitysim_input_bundle.py" in command[1])
            self.assertEqual(build[build.index("--population") + 1], "census")
            activitysim = commands[-1]
            self.assertIn(str(screening / "_borrowed_evaluation_config"), activitysim)
            self.assertNotIn("--counts", commands[0])

    def _locked_fixture(self, root: Path):
        overlay = root / "overlay"
        overlay.mkdir()
        (overlay / "coeff.csv").write_text("locked\n")
        manifest = {
            "status": "candidate_not_accepted_for_production",
            "files_sha256": {"coeff.csv": transfer._sha256(overlay / "coeff.csv")},
        }
        (overlay / "coefficient_package.json").write_text(json.dumps(manifest))
        runs = root / "runs"
        (runs / "place-a").mkdir(parents=True)
        registry = {
            "schema_version": "openplan.activitysim-auto-ownership-fresh-holdout.v1",
            "status": "pre_registered_before_candidate_execution",
            "candidate": {
                "package_manifest_sha256": transfer._sha256(overlay / "coefficient_package.json"),
                "package_status": "candidate_not_accepted_for_production",
                "coefficient_files_sha256": manifest["files_sha256"],
            },
            "geographies": [{"geography_id": "place-a"}],
            "acceptance_rules": {
                "minimum_relative_aggregate_improvement": 0.15,
                "minimum_geography_win_share": 0.75,
                "maximum_absolute_bias_disadvantage": 0.02,
                "maximum_single_geography_tv_disadvantage": 0.05,
            },
        }
        registry_path = root / "registry.json"
        registry_path.write_text(json.dumps(registry))
        return overlay, runs, registry_path

    def test_lock_refuses_extra_geography_and_modified_candidate_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            overlay, runs, registry = self._locked_fixture(root)
            lock = transfer.validate_fresh_holdout(registry, runs, overlay)
            self.assertEqual(lock["geography_ids"], ["place-a"])
            (runs / "unregistered").mkdir()
            with self.assertRaisesRegex(transfer.TransferStudyError, "extra=.*unregistered"):
                transfer.validate_fresh_holdout(registry, runs, overlay)
            (runs / "unregistered").rmdir()
            (overlay / "coeff.csv").write_text("changed\n")
            with self.assertRaisesRegex(transfer.TransferStudyError, "coefficient coeff.csv changed"):
                transfer.validate_fresh_holdout(registry, runs, overlay)

    def test_registry_run_refuses_incomplete_inputs_before_candidate_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            overlay, runs, registry = self._locked_fixture(root)
            with (
                mock.patch.object(transfer.subprocess, "run") as subprocess_run,
                self.assertRaisesRegex(transfer.TransferStudyError, "incomplete retained inputs"),
            ):
                transfer.run_study(
                    runs, overlay, root / "stock", root / "cli", root / "output",
                    registry_path=registry,
                )
            self.assertEqual(subprocess_run.call_count, 0)

    def test_evaluator_applies_every_preregistered_rule(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, _, registry_path = self._locked_fixture(root)
            registry = json.loads(registry_path.read_text())
            registry["geographies"] = [{"geography_id": "place-a"}, {"geography_id": "place-b"}]
            registry_path.write_text(json.dumps(registry))
            transfer_result = {
                "fresh_holdout_lock": {"registry_sha256": evaluator._sha256(registry_path)},
                "borrowed_mtc": {
                    "choice_distribution_total_variation": 0.2,
                    "mean_vehicle_bias": 0.05,
                },
                "candidate_national": {
                    "choice_distribution_total_variation": 0.1,
                    "mean_vehicle_bias": 0.06,
                },
                "candidate_lower_distribution_error_geographies": 2,
                "results": [
                    self._result("place-a", 0.2, 0.1),
                    self._result("place-b", 0.2, 0.11),
                ],
            }
            result_path = root / "result.json"
            result_path.write_text(json.dumps(transfer_result))
            decision = evaluator.evaluate(registry_path, result_path)
            self.assertTrue(decision["accepted"])
            self.assertTrue(all(row["passed"] for row in decision["checks"].values()))

            transfer_result["candidate_national"]["mean_vehicle_bias"] = 0.08
            result_path.write_text(json.dumps(transfer_result))
            rejected = evaluator.evaluate(registry_path, result_path)
            self.assertFalse(rejected["accepted"])
            self.assertFalse(rejected["checks"]["absolute_bias_disadvantage"]["passed"])

    @staticmethod
    def _result(key, borrowed_tv, candidate_tv):
        return {
            "geography_key": key,
            "borrowed_mtc": {"metrics": {"distribution_calibration": {
                "total_variation_distance": borrowed_tv,
            }}},
            "candidate_national": {"metrics": {"distribution_calibration": {
                "total_variation_distance": candidate_tv,
            }}},
        }


if __name__ == "__main__":
    unittest.main()
