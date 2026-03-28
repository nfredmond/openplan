from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

WORKER_DIR = Path(__file__).resolve().parents[1]
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

from runtime import (
    BundleContractError,
    build_container_command,
    detect_activitysim_capability,
    run_activitysim_runtime,
)


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

    def test_starter_config_can_run_with_real_cli_template(self) -> None:
        bundle_dir = build_bundle(self.root)
        (bundle_dir / "configs" / "settings.yaml").write_text("models: []\n")
        (bundle_dir / "configs" / "constants.yaml").write_text("starter: true\n")
        (bundle_dir / "configs" / "network_los.yaml").write_text("zone_system: 1\n")
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
        self.assertEqual(runtime_manifest["config_package"]["package_status"], "starter_executable_kit")
        self.assertIn("starter executable config kit", " ".join(runtime_manifest["caveats"]))
        collected_paths = runtime_manifest["artifacts"]["collected_outputs"]
        self.assertIn("output/final_trips.csv", collected_paths)

    def test_detects_container_mode_when_image_and_engine_are_configured(self) -> None:
        bundle_dir = build_bundle(self.root)
        config_dir = bundle_dir / "configs"
        (config_dir / "settings.yaml").write_text("models: []\n")

        with mock.patch("runtime.shutil.which", return_value="/usr/bin/docker"):
            capability = detect_activitysim_capability(
                bundle_dir=bundle_dir,
                config_dir=config_dir,
                cli_command=None,
                cli_template=None,
                container_image="python:3.11-slim",
                container_engine_command=["docker"],
                container_template=None,
                container_network_mode="bridge",
            )

        self.assertTrue(capability["available"])
        self.assertEqual(capability["mode"], "activitysim_container_cli")
        self.assertEqual(capability["execution_backend"], "container_cli")
        self.assertEqual(capability["container_image"], "python:3.11-slim")
        self.assertEqual(capability["container_engine_command"], ["/usr/bin/docker"])
        self.assertEqual(capability["container_network_mode"], "bridge")

    def test_builds_container_command_with_explicit_mounts(self) -> None:
        bundle_dir = build_bundle(self.root)
        config_dir = bundle_dir / "configs"
        runtime_dir = self.root / "runtime"
        runtime_dir.mkdir(parents=True)

        with mock.patch("runtime.shutil.which", return_value="/usr/bin/docker"):
            command, metadata = build_container_command(
                bundle_dir=bundle_dir,
                config_dir=config_dir,
                runtime_dir=runtime_dir,
                image="python:3.11-slim",
                engine_command=["docker"],
                container_template="python -m activitysim run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}",
            )

        self.assertEqual(command[0], "/usr/bin/docker")
        self.assertIn("python:3.11-slim", command)
        self.assertIn("--network", command)
        self.assertIn("none", command)
        self.assertEqual(metadata["network_mode"], "none")
        self.assertEqual(metadata["container_paths"]["bundle_dir"], "/openplan/bundle")
        self.assertEqual(metadata["container_paths"]["home_dir"], "/openplan/runtime/home")
        self.assertEqual(metadata["container_paths"]["config_dir"], "/openplan/bundle/configs")
        self.assertEqual(metadata["container_paths"]["output_dir"], "/openplan/runtime/output")
        self.assertTrue(any(mount["target"] == "/openplan/runtime" for mount in metadata["mounts"]))
        self.assertTrue(any(mount["target"] == "/openplan/bundle" and mount["read_only"] for mount in metadata["mounts"]))

    def test_builds_container_command_with_network_override(self) -> None:
        bundle_dir = build_bundle(self.root)
        config_dir = bundle_dir / "configs"
        runtime_dir = self.root / "runtime-network"
        runtime_dir.mkdir(parents=True)

        with mock.patch("runtime.shutil.which", return_value="/usr/bin/docker"):
            command, metadata = build_container_command(
                bundle_dir=bundle_dir,
                config_dir=config_dir,
                runtime_dir=runtime_dir,
                image="python:3.11-slim",
                engine_command=["docker"],
                container_template="python -m activitysim run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}",
                network_mode="bridge",
            )

        self.assertIn("--network", command)
        self.assertIn("bridge", command)
        self.assertEqual(metadata["network_mode"], "bridge")

    def test_container_mode_records_runtime_manifest_metadata(self) -> None:
        bundle_dir = build_bundle(self.root)
        (bundle_dir / "configs" / "settings.yaml").write_text("models: []\n")
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

        def fake_run(command: list[str], cwd: str, capture_output: bool, text: bool, check: bool):
            output_dir = Path(cwd).parent / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / "final_trips.csv").write_text("trip_id\n1\n")
            return mock.Mock(returncode=0, stdout="container run complete\n", stderr="")

        with (
            mock.patch("runtime.shutil.which", return_value="/usr/bin/docker"),
            mock.patch("runtime.subprocess.run", side_effect=fake_run),
        ):
            summary = run_activitysim_runtime(
                bundle_path=str(bundle_dir),
                container_image="python:3.11-slim",
                container_engine_command=["docker"],
                container_template="python -m activitysim run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}",
                container_network_mode="bridge",
            )

        self.assertEqual(summary["mode"], "activitysim_container_cli")
        self.assertEqual(summary["status"], "succeeded")

        runtime_manifest = json.loads(Path(summary["runtime_manifest_path"]).read_text())
        self.assertEqual(runtime_manifest["execution"]["backend"], "container_cli")
        self.assertEqual(runtime_manifest["execution"]["container_image"], "python:3.11-slim")
        self.assertEqual(runtime_manifest["execution"]["container_network_mode"], "bridge")
        self.assertEqual(runtime_manifest["mode"], "activitysim_container_cli")
        self.assertIn("output/final_trips.csv", runtime_manifest["artifacts"]["collected_outputs"])

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
