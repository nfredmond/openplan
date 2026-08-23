#!/usr/bin/env python3
"""The study CLI must actually reach the runtime arm it names."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import run_screening_model as driver  # noqa: E402
import screening_runtime as runtime  # noqa: E402


class GatewayVolumeDriverWiring(unittest.TestCase):
    def run_arm(self, arm: str | None) -> dict:
        argv = ["run_screening_model.py", "--name", "probe", "--county-fips", "39029"]
        if arm:
            argv.extend(["--gateway-volume-study-arm", arm])
        with patch.object(sys, "argv", argv):
            args = driver.parse_args()
        captured = {}

        def fake_runtime(**kwargs):
            captured.update(kwargs)
            return {}

        driver._run(fake_runtime, args)
        return captured

    def test_baseline_reaches_the_baseline_runtime_arm(self) -> None:
        self.assertEqual(self.run_arm("baseline")["gateway_volume_mode"], "study_baseline")

    def test_candidate_reaches_the_candidate_runtime_arm(self) -> None:
        self.assertEqual(self.run_arm("candidate")["gateway_volume_mode"], "study_candidate")

    def test_ordinary_runs_keep_the_production_default(self) -> None:
        self.assertEqual(self.run_arm(None)["gateway_volume_mode"], "default")

    def test_baseline_discovers_all_but_changes_neither_volume_nor_cap(self) -> None:
        self.assertEqual(
            runtime.gateway_volume_policy("study_baseline"),
            {
                "discover_full_candidate_pool": True,
                "apply_measured_volumes": False,
                "retain_all_measured": False,
            },
        )

    def test_candidate_applies_counts_and_lifts_only_the_measured_cap(self) -> None:
        self.assertEqual(
            runtime.gateway_volume_policy("study_candidate"),
            {
                "discover_full_candidate_pool": True,
                "apply_measured_volumes": True,
                "retain_all_measured": True,
            },
        )

    def test_unknown_study_arm_is_refused(self) -> None:
        with self.assertRaises(runtime.ConfigurationError):
            runtime.gateway_volume_policy("post_holdout_repair")


if __name__ == "__main__":
    unittest.main()
