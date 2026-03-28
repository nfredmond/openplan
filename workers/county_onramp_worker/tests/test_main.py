from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

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
        self.temp_dir.cleanup()

    def _job(self) -> dict:
        return {
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
                "scaffoldCsvPath": str(self.root / "validation" / "scaffold.csv"),
                "reviewPacketMdPath": str(self.root / "validation" / "review.md"),
                "manifestPath": str(self.root / "validation" / "manifest.json"),
            },
            "callback": {
                "manifestIngestUrl": "https://openplan.example.com/api/county-runs/test/manifest",
                "bearerToken": None,
            },
        }

    def test_build_bootstrap_command_omits_container_flags_by_default(self) -> None:
        job = self._job()

        with patch.object(county_worker, "BOOTSTRAP_SCRIPT", self.root / "bootstrap.py"):
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

        with patch.object(county_worker, "BOOTSTRAP_SCRIPT", self.root / "bootstrap.py"):
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


if __name__ == "__main__":
    unittest.main()
