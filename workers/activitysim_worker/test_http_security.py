"""Real HTTP boundary tests with synthetic operator-owned inputs."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import main as worker
spec = importlib.util.spec_from_file_location("runtime_fixture", HERE / "tests/test_runtime.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class HttpSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.bundle = fixture.build_bundle(self.root)
        self.runtimes = self.root / "runs"
        self.runtimes.mkdir()
        self.env = patch.dict(os.environ, {"OPENPLAN_ACTIVITYSIM_BUNDLE_ROOT": str(self.root),
            "OPENPLAN_ACTIVITYSIM_RUNTIME_ROOT": str(self.runtimes), "ACTIVITYSIM_CLI": "",
            "ACTIVITYSIM_CONTAINER_MEMORY_BYTES": "", "ACTIVITYSIM_CONTAINER_TASKS": "", "ACTIVITYSIM_HOST_MEMORY_BYTES": "", "ACTIVITYSIM_HOST_TASKS": "", "ACTIVITYSIM_CLI_TEMPLATE": "", "ACTIVITYSIM_CONTAINER_IMAGE": "", "ACTIVITYSIM_CONFIG_DIR": ""}, clear=False)
        self.env.start()
        self.token = patch.object(worker, "WORKER_TOKEN", "synthetic-token")
        self.token.start()
        self.client = worker.app.test_client()

    def tearDown(self):
        self.token.stop(); self.env.stop(); self.temporary.cleanup()

    def post(self, payload, token="synthetic-token", endpoint="/jobs"):
        return self.client.post(endpoint, json=payload, headers={} if token is None else {"Authorization": f"Bearer {token}"},
            environ_base={"REMOTE_ADDR": "198.51.100.27"})

    def test_all_endpoints_require_configured_and_present_token_before_runtime(self):
        for endpoint in ("/", "/run", "/jobs"):
            for configured, supplied in (("", None), ("", "x"), ("synthetic-token", None), ("synthetic-token", "wrong")):
                with self.subTest(endpoint=endpoint, configured=bool(configured), supplied=supplied):
                    with patch.object(worker, "WORKER_TOKEN", configured), patch.object(worker, "run_activitysim_runtime") as runtime:
                        response = self.post({"bundlePath": str(self.bundle)}, supplied, endpoint)
                        self.assertEqual(response.status_code, 401)
                        runtime.assert_not_called()

    def test_authenticated_preflight_has_unique_owned_output(self):
        first = self.post({"bundlePath": str(self.bundle), "runLabel": "synthetic"})
        second = self.post({"bundlePath": str(self.bundle), "runLabel": "synthetic"})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        paths = [Path(value.get_json()["runtime_summary_path"]).parent for value in (first, second)]
        self.assertNotEqual(paths[0], paths[1])
        self.assertTrue(all(path.parent == self.runtimes for path in paths))

    def test_request_cannot_choose_executable_or_replace_unrelated_directory(self):
        victim = self.root / "unrelated"; victim.mkdir()
        marker = victim / "keep.txt"; marker.write_text("synthetic")
        for key, value in {"force": True, "runtimeOutputDir": str(victim), "configDir": str(self.root),
            "activitysimCli": sys.executable, "activitysimCliTemplate": "false", "activitysimContainerImage": "image",
            "containerSupervisionSocket": "/untrusted.sock", "container_supervision_socket": "/untrusted.sock", "containerMemoryBytes": 1, "containerTasks": 1, "container_memory_bytes": 1, "container_tasks": 1, "hostMemoryBytes": 1, "hostTasks": 1, "host_memory_bytes": 1, "host_tasks": 1, "containerEngineCli": "false", "activitysimContainerCliTemplate": "false", "containerNetworkMode": "host"}.items():
            with self.subTest(key=key), patch.object(worker, "run_activitysim_runtime") as runtime:
                response = self.post({"bundlePath": str(self.bundle), key: value})
                self.assertEqual(response.status_code, 400)
                runtime.assert_not_called()
                self.assertEqual(marker.read_text(), "synthetic")

    def test_bundle_paths_and_symlinks_cannot_escape_operator_root(self):
        with tempfile.TemporaryDirectory() as other:
            outside = Path(other)
            (self.root / "escape").symlink_to(outside, target_is_directory=True)
            for selected in (str(outside), str(self.root / "escape"), "../outside"):
                with self.subTest(selected=selected), patch.object(worker, "run_activitysim_runtime") as runtime:
                    self.assertEqual(self.post({"bundlePath": selected}).status_code, 400)
                    runtime.assert_not_called()

    def test_operator_selects_execution_and_http_never_forces(self):
        with patch.dict(os.environ, {"ACTIVITYSIM_CLI": sys.executable, "ACTIVITYSIM_HOST_MEMORY_BYTES": "134217728", "ACTIVITYSIM_HOST_TASKS": "16"}), patch.object(worker, "run_activitysim_runtime", return_value={"status": "blocked"}) as runtime:
            self.assertEqual(self.post({"bundlePath": str(self.bundle)}).status_code, 200)
            self.assertEqual(runtime.call_args.kwargs["cli_command"], [sys.executable])
            self.assertFalse(runtime.call_args.kwargs["force"])
            self.assertEqual(runtime.call_args.kwargs["host_memory_bytes"], 134217728)
            self.assertEqual(runtime.call_args.kwargs["host_tasks"], 16)

    def test_operator_selects_container_limits(self):
        with patch.dict(os.environ, {"ACTIVITYSIM_CONTAINER_IMAGE": "synthetic", "ACTIVITYSIM_CONTAINER_MEMORY_BYTES": "67108864", "ACTIVITYSIM_CONTAINER_TASKS": "16", "ACTIVITYSIM_CONTAINER_SUPERVISION_SOCKET": "/run/docker.sock"}), patch.object(worker, "run_activitysim_runtime", return_value={"status": "blocked"}) as runtime:
            self.assertEqual(self.post({"bundlePath": str(self.bundle)}).status_code, 200)
            self.assertEqual(runtime.call_args.kwargs["container_memory_bytes"], 67108864)
            self.assertEqual(runtime.call_args.kwargs["container_tasks"], 16)
            self.assertEqual(runtime.call_args.kwargs["container_supervision_socket"], "/run/docker.sock")

    def test_startup_preflight_refuses_missing_token_and_accepts_owned_configuration(self):
        env = {**os.environ, "OPENPLAN_ACTIVITYSIM_WORKER_TOKEN": ""}
        refused = subprocess.run([sys.executable, "-B", str(HERE / "main.py"), "--check-http-config"], env=env, capture_output=True, text=True)
        self.assertEqual(refused.returncode, 2)
        self.assertIn("WORKER_TOKEN is required", refused.stdout)
        env["OPENPLAN_ACTIVITYSIM_WORKER_TOKEN"] = "synthetic-token"
        accepted = subprocess.run([sys.executable, "-B", str(HERE / "main.py"), "--check-http-config"], env=env, capture_output=True, text=True)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertIn("--check-http-config && exec gunicorn", (HERE / "Dockerfile").read_text())


if __name__ == "__main__":
    unittest.main()
