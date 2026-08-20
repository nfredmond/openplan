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

    def _write_runnable_layered_bundle(self, *, digest: str | None = None) -> tuple[Path, Path]:
        """A runnable bundle whose descriptor layers over a fake stock dir."""
        bundle_dir = build_bundle(self.root)
        (bundle_dir / "configs" / "settings.yaml").write_text("inherit_settings: True\n")
        (bundle_dir / "configs" / "network_los.yaml").write_text("zone_system: 1\n")
        stock_dir = self.root / "stock_configs"
        stock_dir.mkdir()
        (stock_dir / "settings.yaml").write_text("models: []\n")
        (stock_dir / "spec.csv").write_text("Label,Expression\n")
        if digest is None:
            scripts_modeling = WORKER_DIR.parents[1] / "scripts" / "modeling"
            if str(scripts_modeling) not in sys.path:
                sys.path.insert(0, str(scripts_modeling))
            from activitysim_mtc_inputs import stock_configs_digest

            digest = stock_configs_digest(stock_dir)
        (bundle_dir / "configs" / "openplan_config_package.json").write_text(
            json.dumps(
                {
                    "schema_version": "openplan.activitysim_config_package.v0",
                    "package_type": "activitysim_config_package",
                    "package_status": "runnable_config_package",
                    "config_package": "mtc",
                    "runnable": True,
                    "layered_stock_configs": {
                        "path": str(stock_dir),
                        "specs_sha256": digest,
                        "source_example": "prototype_mtc",
                    },
                },
                indent=2,
            )
        )
        return bundle_dir, stock_dir

    def _fake_activitysim_cli(self) -> Path:
        """A stand-in CLI accepting the real `activitysim run` flag shape,
        recording every -c it was handed."""
        fake_cli = self.root / "fake_activitysim.py"
        fake_cli.write_text(
            "\n".join(
                [
                    "import argparse, json",
                    "from pathlib import Path",
                    "parser = argparse.ArgumentParser()",
                    "parser.add_argument('verb')",
                    "parser.add_argument('-c', action='append')",
                    "parser.add_argument('-d')",
                    "parser.add_argument('-o')",
                    "parser.add_argument('-w')",
                    "args = parser.parse_args()",
                    "out = Path(args.o)",
                    "out.mkdir(parents=True, exist_ok=True)",
                    "(out / 'final_trips.csv').write_text('trip_id\\n1\\n')",
                    "(out / 'received_config_dirs.json').write_text(json.dumps(args.c))",
                ]
            )
            + "\n"
        )
        return fake_cli

    def test_a_runnable_bundle_layers_the_stock_configs_as_a_second_dash_c(self) -> None:
        bundle_dir, stock_dir = self._write_runnable_layered_bundle()
        fake_cli = self._fake_activitysim_cli()

        summary = run_activitysim_runtime(
            bundle_path=str(bundle_dir),
            cli_command=[sys.executable, str(fake_cli)],
        )

        self.assertEqual(summary["status"], "succeeded")
        self.assertEqual(summary["mode"], "activitysim_cli")
        # What the CHILD received, not just what the metadata claims.
        output_dir = Path(summary["runtime_dir"]) / "output"
        received = json.loads((output_dir / "received_config_dirs.json").read_text())
        self.assertEqual(received, [str((bundle_dir / "configs").resolve()), str(stock_dir)])

    def test_a_modified_stock_configuration_is_refused(self) -> None:
        bundle_dir, stock_dir = self._write_runnable_layered_bundle()
        (stock_dir / "spec.csv").write_text("Label,Expression\nedited,1\n")
        fake_cli = self._fake_activitysim_cli()

        summary = run_activitysim_runtime(
            bundle_path=str(bundle_dir),
            cli_command=[sys.executable, str(fake_cli)],
        )

        self.assertEqual(summary["status"], "failed")
        runtime_manifest = json.loads(Path(summary["runtime_manifest_path"]).read_text())
        run_stage = next(s for s in runtime_manifest["stages"] if s["stage_key"] == "run_activitysim")
        self.assertIn("no longer matches", " ".join(err["message"] for err in run_stage["errors"]))

    def test_a_modified_accepted_component_is_refused_before_execution(self) -> None:
        bundle_dir, _ = self._write_runnable_layered_bundle()
        accepted_file = bundle_dir / "configs" / "accepted_component.csv"
        accepted_file.write_text("coefficient,value\nconstant,1\n")
        descriptor_path = bundle_dir / "configs" / "openplan_config_package.json"
        descriptor = json.loads(descriptor_path.read_text())
        import hashlib

        descriptor["accepted_components"] = [{
            "component": "auto_ownership",
            "installed_files_sha256": {
                accepted_file.name: hashlib.sha256(accepted_file.read_bytes()).hexdigest(),
            },
        }]
        descriptor_path.write_text(json.dumps(descriptor, indent=2))
        accepted_file.write_text("coefficient,value\nconstant,2\n")

        summary = run_activitysim_runtime(
            bundle_path=str(bundle_dir),
            cli_command=[sys.executable, str(self._fake_activitysim_cli())],
        )

        self.assertEqual(summary["status"], "failed")
        runtime_manifest = json.loads(Path(summary["runtime_manifest_path"]).read_text())
        run_stage = next(s for s in runtime_manifest["stages"] if s["stage_key"] == "run_activitysim")
        errors = " ".join(err["message"] for err in run_stage["errors"])
        self.assertIn("auto_ownership changed after bundle construction", errors)

    def test_a_missing_stock_configuration_is_refused_with_the_path_named(self) -> None:
        bundle_dir, stock_dir = self._write_runnable_layered_bundle()
        import shutil as _shutil

        _shutil.rmtree(stock_dir)
        fake_cli = self._fake_activitysim_cli()

        summary = run_activitysim_runtime(
            bundle_path=str(bundle_dir),
            cli_command=[sys.executable, str(fake_cli)],
        )

        self.assertEqual(summary["status"], "failed")
        runtime_manifest = json.loads(Path(summary["runtime_manifest_path"]).read_text())
        run_stage = next(s for s in runtime_manifest["stages"] if s["stage_key"] == "run_activitysim")
        joined = " ".join(err["message"] for err in run_stage["errors"])
        self.assertIn("not present on this machine", joined)
        self.assertIn(str(stock_dir), joined)

    def test_container_command_mounts_layered_configs_read_only(self) -> None:
        bundle_dir, stock_dir = self._write_runnable_layered_bundle()
        runtime_dir = self.root / "runtime-layered"
        runtime_dir.mkdir(parents=True)

        with mock.patch("runtime.shutil.which", return_value="/usr/bin/docker"):
            command, metadata = build_container_command(
                bundle_dir=bundle_dir,
                config_dir=bundle_dir / "configs",
                runtime_dir=runtime_dir,
                image="python:3.11-slim",
                engine_command=["docker"],
                layered_config_dirs=[stock_dir],
            )

        stock_mounts = [m for m in metadata["mounts"] if m["source"] == str(stock_dir.resolve())]
        self.assertEqual(len(stock_mounts), 1)
        self.assertTrue(stock_mounts[0]["read_only"])
        inner = metadata["inner_command"]
        config_flags = [inner[i + 1] for i, part in enumerate(inner) if part == "-c"]
        self.assertEqual(config_flags, ["/openplan/bundle/configs", "/openplan/stock_configs"])

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
