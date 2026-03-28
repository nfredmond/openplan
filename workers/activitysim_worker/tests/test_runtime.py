from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parents[1]
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

from runtime import BundleContractError, run_activitysim_runtime


def build_bundle(root: Path) -> Path:
    bundle_dir = root / "bundle"
    (bundle_dir / "configs").mkdir(parents=True)
    (bundle_dir / "skims").mkdir(parents=True)
    (bundle_dir / "land_use.csv").write_text("zone_id,households\n1,10\n")
    (bundle_dir / "households.csv").write_text("household_id,home_zone_id\n1,1\n")
    (bundle_dir / "persons.csv").write_text("person_id,household_id\n1,1\n")
    (bundle_dir / "skims" / "travel_time_skims.omx").write_bytes(b"omx")
    (bundle_dir / "configs" / "README.md").write_text("# scaffold\n")
    (bundle_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": "openplan.activitysim_input_bundle.v0",
                "bundle_type": "activitysim_input_bundle",
                "files": {
                    "manifest": "manifest.json",
                    "land_use": "land_use.csv",
                    "households": "households.csv",
                    "persons": "persons.csv",
                    "skim_omx": "skims/travel_time_skims.omx",
                },
            },
            indent=2,
        )
    )
    return bundle_dir


class ActivitySimRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_preflight_only_when_config_is_placeholder_only(self) -> None:
        bundle_dir = build_bundle(self.root)

        summary = run_activitysim_runtime(bundle_path=str(bundle_dir))

        self.assertEqual(summary["mode"], "preflight_only")
        self.assertEqual(summary["status"], "blocked")
        self.assertEqual(summary["stage_statuses"]["validate_inputs"], "succeeded")
        self.assertEqual(summary["stage_statuses"]["prepare_activitysim_inputs"], "succeeded")
        self.assertEqual(summary["stage_statuses"]["run_activitysim"], "blocked")
        self.assertEqual(summary["stage_statuses"]["collect_outputs"], "succeeded")

        runtime_manifest = json.loads(Path(summary["runtime_manifest_path"]).read_text())
        self.assertEqual(runtime_manifest["config_package"]["package_status"], "placeholder_only")
        self.assertIn("placeholder-only", " ".join(runtime_manifest["caveats"]))

    def test_preflight_only_when_bundle_contains_starter_config_kit(self) -> None:
        bundle_dir = build_bundle(self.root)
        (bundle_dir / "configs" / "settings.yaml").write_text("models: []\n")
        (bundle_dir / "configs" / "constants.yaml").write_text("starter: true\n")
        (bundle_dir / "configs" / "openplan_config_package.json").write_text(
            json.dumps(
                {
                    "schema_version": "openplan.activitysim_config_package.v0",
                    "package_type": "activitysim_config_package",
                    "package_status": "starter_executable_kit",
                    "starter_version": "v0",
                    "runnable": False,
                },
                indent=2,
            )
        )

        summary = run_activitysim_runtime(bundle_path=str(bundle_dir))

        self.assertEqual(summary["mode"], "preflight_only")
        self.assertEqual(summary["status"], "blocked")
        self.assertEqual(summary["stage_statuses"]["run_activitysim"], "blocked")

        runtime_manifest = json.loads(Path(summary["runtime_manifest_path"]).read_text())
        self.assertEqual(runtime_manifest["config_package"]["package_status"], "starter_executable_kit")
        self.assertIn("starter executable config kit", " ".join(runtime_manifest["caveats"]))

    def test_real_cli_mode_runs_when_command_and_settings_exist(self) -> None:
        bundle_dir = build_bundle(self.root)
        (bundle_dir / "configs" / "settings.yaml").write_text("models: []\n")

        fake_cli = self.root / "fake_activitysim.py"
        fake_cli.write_text(
            "\n".join(
                [
                    "import argparse",
                    "from pathlib import Path",
                    "parser = argparse.ArgumentParser()",
                    "parser.add_argument('--config-dir')",
                    "parser.add_argument('--data-dir')",
                    "parser.add_argument('--output-dir')",
                    "parser.add_argument('--working-dir')",
                    "args = parser.parse_args()",
                    "output_dir = Path(args.output_dir)",
                    "output_dir.mkdir(parents=True, exist_ok=True)",
                    "(output_dir / 'final_trips.csv').write_text('trip_id\\n1\\n')",
                    "print('fake activitysim run complete')",
                ]
            )
            + "\n"
        )

        summary = run_activitysim_runtime(
            bundle_path=str(bundle_dir),
            cli_template=(
                f"{sys.executable} {fake_cli} "
                "--config-dir {config_dir} --data-dir {data_dir} "
                "--output-dir {output_dir} --working-dir {working_dir}"
            ),
        )

        self.assertEqual(summary["mode"], "activitysim_cli")
        self.assertEqual(summary["status"], "succeeded")
        self.assertEqual(summary["stage_statuses"]["run_activitysim"], "succeeded")

        runtime_manifest = json.loads(Path(summary["runtime_manifest_path"]).read_text())
        self.assertEqual(runtime_manifest["status"], "succeeded")
        self.assertEqual(runtime_manifest["config_package"]["package_status"], "runnable_config_package")
        collected_paths = runtime_manifest["artifacts"]["collected_outputs"]
        self.assertIn("output/final_trips.csv", collected_paths)

    def test_invalid_bundle_contract_fails_cleanly(self) -> None:
        bundle_dir = build_bundle(self.root)
        (bundle_dir / "persons.csv").unlink()

        summary = run_activitysim_runtime(bundle_path=str(bundle_dir))

        self.assertEqual(summary["status"], "failed")
        runtime_manifest = json.loads(Path(summary["runtime_manifest_path"]).read_text())
        self.assertEqual(runtime_manifest["status"], "failed")
        self.assertTrue(runtime_manifest["errors"])
        self.assertIn("missing required file", runtime_manifest["errors"][0]["message"].lower())

    def test_requires_exactly_one_input_locator(self) -> None:
        bundle_dir = build_bundle(self.root)
        with self.assertRaises(BundleContractError):
            run_activitysim_runtime(
                bundle_path=str(bundle_dir),
                manifest_path=str(bundle_dir / "manifest.json"),
            )


if __name__ == "__main__":
    unittest.main()
