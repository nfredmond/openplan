#!/usr/bin/env python3
import hashlib
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import mandatory_tour_frequency_acceptance_protocol as protocol  # noqa: E402


ROOT = SCRIPT_DIR.parents[1]
ORIGINAL = (
    ROOT
    / "data/modeling/mandatory-tour-frequency-preregistration-2026-08-19.json"
)
CHECKED_IN = (
    ROOT
    / "data/modeling/mandatory-tour-frequency-acceptance-protocol-v2-2026-08-19.json"
)


class MandatoryTourFrequencyAcceptanceProtocolTests(unittest.TestCase):
    def test_only_stochastic_rule_changes_and_familywise_interval_is_locked(self):
        original = json.loads(ORIGINAL.read_text())
        result = protocol.build_protocol(ORIGINAL)
        self.assertEqual(
            result["supersedes"]["preregistration_sha256"],
            hashlib.sha256(ORIGINAL.read_bytes()).hexdigest(),
        )
        self.assertFalse(result["supersedes"]["acceptance_outcomes_read"])
        for name, rule in original["acceptance_rules"].items():
            if name != "stochastic_stability":
                self.assertEqual(result["acceptance_rules"][name], rule)
        stability = result["acceptance_rules"]["stochastic_stability"]
        self.assertEqual(stability["comparison_count"], 100)
        self.assertEqual(stability["per_comparison_two_sided_alpha"], 0.0005)
        self.assertAlmostEqual(stability["normal_critical_value"], 3.4807564043462422)
        self.assertEqual(
            stability["activitysim_seeds"],
            original["acceptance_rules"]["stochastic_stability"]["activitysim_seeds"],
        )
        self.assertEqual(
            stability["alternatives"],
            list(protocol.ALTERNATIVE_ORDER),
        )
        self.assertAlmostEqual(
            result["reason"]["original_independent_check_pass_probability"],
            math.pow(0.95, 100),
        )
        contract = result["implementation_contract"]
        self.assertTrue(
            contract["recorded_before_acceptance_outcomes_were_derived_or_read"]
        )
        self.assertEqual(
            contract["transfer_cells"]["holm_family_alpha"],
            protocol.TRANSFER_CELL_FAMILY_ALPHA,
        )
        self.assertIn("float32", contract["probability_scoring"]["candidate"])
        self.assertEqual(
            contract["survey_estimator"]["confidence_criticals"],
            "Student t, not normal z",
        )

    def test_checked_in_protocol_reproduces_exactly(self):
        self.assertEqual(json.loads(CHECKED_IN.read_text()), protocol.build_protocol(ORIGINAL))

    def test_only_an_unopened_v1_protocol_can_be_superseded(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "changed.json"
            value = json.loads(ORIGINAL.read_text())
            value["status"] = "acceptance_opened"
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(
                protocol.MandatoryTourAcceptanceProtocolError, "still-unopened"
            ):
                protocol.build_protocol(path)

    def test_existing_supersession_is_immutable(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "protocol.json"
            value = protocol.build_protocol(ORIGINAL)
            protocol.write_protocol(value, output)
            protocol.write_protocol(value, output)
            value["reason"]["development_results_used_to_choose_correction"] = True
            with self.assertRaisesRegex(
                protocol.MandatoryTourAcceptanceProtocolError, "rewriting it is forbidden"
            ):
                protocol.write_protocol(value, output)


if __name__ == "__main__":
    unittest.main()
