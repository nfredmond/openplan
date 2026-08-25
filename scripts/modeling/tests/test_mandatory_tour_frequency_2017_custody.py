#!/usr/bin/env python3
"""Keep the closed 2017 evaluator and evidence exactly as they were committed."""

from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
CUSTODY_LOCK = (
    REPO_ROOT
    / "data/modeling/mandatory-tour-frequency-2017-successor-custody-lock-2026-08-24.json"
)


class MandatoryTourFrequency2017CustodyTests(unittest.TestCase):
    def test_closed_evaluator_and_evidence_match_the_custody_lock(self) -> None:
        lock = json.loads(CUSTODY_LOCK.read_text())
        self.assertEqual(
            lock["schema_version"],
            "openplan.mandatory-tour-frequency-2017-successor.custody-lock.v1",
        )
        self.assertEqual(lock["status"], "closed_inconclusive_immutable")
        paths = [entry["path"] for entry in lock["files"]]
        self.assertEqual(
            set(paths),
            {
                "scripts/modeling/mandatory_tour_frequency_2017_successor.py",
                "scripts/modeling/us_nhts_diaries.py",
                "scripts/modeling/tests/test_mandatory_tour_frequency_2017_successor.py",
                "data/modeling/mandatory-tour-frequency-2017-successor-preregistration-2026-08-24.json",
                "data/modeling/mandatory-tour-frequency-2017-successor-opening-lock-2026-08-24.json",
                "data/modeling/mandatory-tour-frequency-2017-successor-opening-receipt-2026-08-24.json",
                "data/modeling/mandatory-tour-frequency-2017-successor-result-2026-08-24.json",
                "docs/modeling/MANDATORY_TOUR_2017_SUCCESSOR_PREREGISTRATION_2026-08-24.md",
                "docs/modeling/MANDATORY_TOUR_2017_SUCCESSOR_RESULT_2026-08-24.md",
                "data/modeling/activitysim-mandatory-tour-frequency-2017-successor/coefficient_package.json",
                "data/modeling/activitysim-mandatory-tour-frequency-2017-successor/mandatory_tour_frequency.csv",
                "data/modeling/activitysim-mandatory-tour-frequency-2017-successor/mandatory_tour_frequency.yaml",
                "data/modeling/activitysim-mandatory-tour-frequency-2017-successor/mandatory_tour_frequency_coefficients.csv",
                "data/modeling/activitysim-mandatory-tour-frequency-2017-successor/mandatory_tour_frequency_model.json",
            },
        )
        self.assertNotIn("source_paths", json.dumps(lock))
        self.assertNotIn("core.csv.zip", json.dumps(lock))
        self.assertNotIn("replicates.csv.zip", json.dumps(lock))
        for entry in lock["files"]:
            path = REPO_ROOT / entry["path"]
            self.assertTrue(path.is_file(), entry["path"])
            measured = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(measured, entry["sha256"], entry["path"])


if __name__ == "__main__":
    unittest.main()
