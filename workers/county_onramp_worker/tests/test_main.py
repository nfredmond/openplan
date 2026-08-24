from __future__ import annotations

import sys
import json
import subprocess
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

dotenv_module = ModuleType("dotenv")
dotenv_module.load_dotenv = lambda *args, **kwargs: None
sys.modules.setdefault("dotenv", dotenv_module)

flask_module = ModuleType("flask")


class _StubFlask:
    def __init__(self, *args, **kwargs) -> None:
        pass

    def get(self, *args, **kwargs):
        def decorator(func):
            return func

        return decorator

    def post(self, *args, **kwargs):
        def decorator(func):
            return func

        return decorator


flask_module.Flask = _StubFlask
flask_module.jsonify = lambda payload: payload
flask_module.request = object()
sys.modules.setdefault("flask", flask_module)

from workers.county_onramp_worker import main as county_worker


class CountyOnrampWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        with county_worker._jobs_lock:
            county_worker._jobs.clear()
        self.temp_dir.cleanup()

    def _job(self) -> dict:
        job = {
            "jobId": "123e4567-e89b-12d3-a456-426614174001",
            "countyRunId": "123e4567-e89b-12d3-a456-426614174002",
            "workspaceId": "123e4567-e89b-12d3-a456-426614174003",
            "runName": "nevada-county-runtime-20260327",
            "geographyType": "county_fips",
            "geographyId": "06057",
            "geographyLabel": "Nevada County, CA",
            "countyPrefix": "NEVADA",
            "runtimeOptions": {
                "keepProject": True,
                "force": True,
                "overallDemandScalar": None,
                "externalDemandScalar": None,
                "hbwScalar": None,
                "hboScalar": None,
                "nhbScalar": None,
                "activitysimContainerImage": None,
                "containerEngineCli": None,
                "activitysimContainerCliTemplate": None,
                "containerNetworkMode": None,
            },
            "artifactTargets": {
                "attemptDirectory": "",
                "scaffoldCsvPath": "",
                "reviewPacketMdPath": "",
                "manifestPath": "",
            },
            "callback": {
                "manifestIngestUrl": "https://openplan.example.com/api/county-runs/test/manifest",
                "bearerToken": None,
            },
        }
        attempt = self.root / "data" / "screening-runs" / job["countyRunId"] / job["jobId"]
        job["artifactTargets"] = {
            "attemptDirectory": str(attempt),
            "scaffoldCsvPath": str(attempt / "validation-scaffold.csv"),
            "reviewPacketMdPath": str(attempt / "validation-review-packet.md"),
            "manifestPath": str(attempt / "manifest.json"),
        }
        return job

    def test_build_bootstrap_command_omits_container_flags_by_default(self) -> None:
        job = self._job()

        with patch.object(county_worker, "REPO_ROOT", self.root), patch.object(
            county_worker, "BOOTSTRAP_SCRIPT", self.root / "bootstrap.py"
        ):
            county_worker.BOOTSTRAP_SCRIPT.write_text("#!/usr/bin/env python3\n")
            command, manifest_path = county_worker._build_bootstrap_command(job)

        self.assertEqual(manifest_path, Path(job["artifactTargets"]["manifestPath"]).resolve())
        self.assertNotIn("--activitysim-container-image", command)
        self.assertNotIn("--container-engine-cli", command)
        self.assertNotIn("--activitysim-container-cli-template", command)
        self.assertNotIn("--container-network-mode", command)

    def test_build_bootstrap_command_includes_configured_container_flags(self) -> None:
        job = self._job()
        job["runtimeOptions"].update(
            {
                "activitysimContainerImage": "python:3.11-slim",
                "containerEngineCli": "docker",
                "activitysimContainerCliTemplate": "python -m pip install activitysim && activitysim run",
                "containerNetworkMode": "bridge",
            }
        )

        with patch.object(county_worker, "REPO_ROOT", self.root), patch.object(
            county_worker, "BOOTSTRAP_SCRIPT", self.root / "bootstrap.py"
        ):
            county_worker.BOOTSTRAP_SCRIPT.write_text("#!/usr/bin/env python3\n")
            command, _ = county_worker._build_bootstrap_command(job)

        self.assertIn("--activitysim-container-image", command)
        self.assertIn("python:3.11-slim", command)
        self.assertIn("--container-engine-cli", command)
        self.assertIn("docker", command)
        self.assertIn("--activitysim-container-cli-template", command)
        self.assertIn("python -m pip install activitysim && activitysim run", command)
        self.assertIn("--container-network-mode", command)
        self.assertIn("bridge", command)

    def test_artifact_targets_outside_the_repo_are_refused_at_parse_time(self) -> None:
        """
        A job's artifact paths decide where this process creates directories and
        where the model then writes. Under docker-compose the repo root is a
        bind mount of the operator's own working tree, so a path that climbs out
        of it writes to their machine. Refused when the payload is parsed —
        which is what makes it a 400 rather than a started job.
        """
        for escaping_path in ("../../etc/openplan-escape.csv", "/etc/openplan-escape.csv"):
            job = self._job()
            job["artifactTargets"]["scaffoldCsvPath"] = escaping_path

            with patch.object(county_worker, "REPO_ROOT", self.root):
                with self.assertRaises(ValueError) as caught:
                    county_worker._parse_payload(job)

            self.assertIn("scaffoldCsvPath", str(caught.exception))

    def test_artifact_targets_inside_the_repo_are_accepted(self) -> None:
        """
        The negative control for the test above: the relative paths the app
        actually sends must still pass. Without this, confinement that rejected
        everything would look identical to confinement that works.
        """
        job = self._job()
        job["artifactTargets"] = {
            "attemptDirectory": f"data/screening-runs/{job['countyRunId']}/{job['jobId']}",
            "scaffoldCsvPath": f"data/screening-runs/{job['countyRunId']}/{job['jobId']}/scaffold.csv",
            "reviewPacketMdPath": f"data/screening-runs/{job['countyRunId']}/{job['jobId']}/review.md",
            "manifestPath": f"data/screening-runs/{job['countyRunId']}/{job['jobId']}/manifest.json",
        }

        with patch.object(county_worker, "REPO_ROOT", self.root):
            parsed = county_worker._parse_payload(job)

        self.assertEqual(parsed["artifactTargets"], job["artifactTargets"])

    def _register_job(self, job: dict, *, status: str = "queued") -> None:
        with county_worker._jobs_lock:
            county_worker._jobs[job["jobId"]] = {
                "jobId": job["jobId"],
                "countyRunId": job["countyRunId"],
                "job": job,
                "status": status,
                "acceptedAt": county_worker._utc_now(),
                "updatedAt": county_worker._utc_now(),
                "cancelEvent": threading.Event(),
                "process": None,
            }

    def test_command_construction_failure_still_posts_a_failed_callback(self) -> None:
        job = self._job()
        self._register_job(job)
        callbacks: list[dict] = []

        with patch.object(
            county_worker, "_build_bootstrap_command", side_effect=FileNotFoundError("missing bootstrap")
        ), patch.object(
            county_worker, "_post_callback", side_effect=lambda _job, payload: callbacks.append(payload)
        ):
            county_worker._run_job(job)

        self.assertEqual(callbacks[-1]["status"], "failed")
        self.assertEqual(callbacks[-1]["jobId"], job["jobId"])
        self.assertEqual(county_worker._public_job_status(job["jobId"])["status"], "failed")

    def test_cancelling_one_run_releases_the_single_worker_queue(self) -> None:
        first = self._job()
        second = self._job()
        second["jobId"] = "123e4567-e89b-12d3-a456-426614174004"
        second_attempt = self.root / "data" / "screening-runs" / second["countyRunId"] / second["jobId"]
        second["artifactTargets"] = {
            "attemptDirectory": str(second_attempt),
            "scaffoldCsvPath": str(second_attempt / "validation-scaffold.csv"),
            "reviewPacketMdPath": str(second_attempt / "validation-review-packet.md"),
            "manifestPath": str(second_attempt / "manifest.json"),
        }
        self._register_job(first)
        self._register_job(second)
        callbacks: list[tuple[str, str]] = []
        first_started = threading.Event()

        def build(job: dict):
            manifest_path = Path(job["artifactTargets"]["manifestPath"])
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            return ["worker-test", job["jobId"]], manifest_path

        class FakeProcess:
            def __init__(self, command, **_kwargs):
                self.command = command
                self.job_id = command[-1]
                self.returncode = None
                self.terminated = False

            def communicate(self, timeout=None):
                if self.job_id == first["jobId"]:
                    first_started.set()
                    if not self.terminated:
                        raise subprocess.TimeoutExpired(self.command, timeout)
                    self.returncode = -15
                    return "", ""
                Path(second["artifactTargets"]["manifestPath"]).write_text(json.dumps({"ok": True}))
                self.returncode = 0
                return "second complete", ""

            def terminate(self):
                self.terminated = True

            def kill(self):
                self.terminated = True

        with patch.object(county_worker, "_build_bootstrap_command", side_effect=build), patch.object(
            county_worker, "_post_callback", side_effect=lambda job, payload: callbacks.append((job["jobId"], payload["status"]))
        ), patch.object(county_worker.subprocess, "Popen", FakeProcess):
            with ThreadPoolExecutor(max_workers=1) as single_worker:
                first_future = single_worker.submit(county_worker._run_job, first)
                second_future = single_worker.submit(county_worker._run_job, second)
                self.assertTrue(first_started.wait(timeout=2))
                with county_worker._jobs_lock:
                    county_worker._jobs[first["jobId"]]["status"] = "cancelling"
                    county_worker._jobs[first["jobId"]]["cancelEvent"].set()
                first_future.result(timeout=2)
                second_future.result(timeout=2)

        self.assertIn((first["jobId"], "cancelled"), callbacks)
        self.assertIn((second["jobId"], "completed"), callbacks)
        self.assertLess(
            callbacks.index((first["jobId"], "cancelled")),
            callbacks.index((second["jobId"], "completed")),
        )


class JobEndpointAuthorizationTests(unittest.TestCase):
    """This endpoint runs a payload-named subprocess, so an unauthenticated
    caller is RCE. Authorization is a pure function so it can be tested without
    Flask; the route and __main__ call it."""

    def test_configured_token_requires_a_matching_bearer(self) -> None:
        self.assertTrue(
            county_worker._authorize_job_request("s3cret", "Bearer s3cret", "203.0.113.9")
        )
        self.assertFalse(
            county_worker._authorize_job_request("s3cret", "Bearer wrong", "203.0.113.9")
        )
        self.assertFalse(county_worker._authorize_job_request("s3cret", None, "127.0.0.1"))

    def test_no_token_allows_loopback_only(self) -> None:
        # Local single-machine dev with no token: reachable from this box, and
        # from nowhere else. This is the ONLY tokenless-allowed state.
        self.assertTrue(county_worker._authorize_job_request("", None, "127.0.0.1"))
        self.assertTrue(county_worker._authorize_job_request("", None, "::1"))
        # The RCE the fix closes: a tokenless request from off-box is refused
        # even if the server somehow bound a wide interface (e.g. gunicorn).
        self.assertFalse(county_worker._authorize_job_request("", None, "203.0.113.9"))
        self.assertFalse(county_worker._authorize_job_request("", "Bearer anything", "203.0.113.9"))

    def test_status_and_cancel_always_require_the_configured_bearer(self) -> None:
        self.assertTrue(county_worker._authorize_control_request("s3cret", "Bearer s3cret"))
        self.assertFalse(county_worker._authorize_control_request("s3cret", "Bearer wrong"))
        self.assertFalse(county_worker._authorize_control_request("s3cret", None))
        self.assertFalse(county_worker._authorize_control_request("", None))

    def test_startup_refuses_a_wide_bind_without_a_token(self) -> None:
        self.assertIsNotNone(county_worker._startup_bind_refusal("0.0.0.0", ""))
        # A token, or a loopback bind, is allowed to start.
        self.assertIsNone(county_worker._startup_bind_refusal("0.0.0.0", "s3cret"))
        self.assertIsNone(county_worker._startup_bind_refusal("127.0.0.1", ""))
        self.assertIsNone(county_worker._startup_bind_refusal("localhost", ""))


if __name__ == "__main__":
    unittest.main()
