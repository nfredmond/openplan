import json
import tempfile
import unittest
from pathlib import Path

from prepare_validation_instrument_study import audit_study


class InstrumentStudyReadinessTests(unittest.TestCase):
    def registry(self):
        return {
            "study_id": "fixture",
            "methods": ["aequilibrae", "activitysim"],
            "counties": [{"geography_id": "x", "aequilibrae": "a", "activitysim": "b"}],
            "required_files": {
                "network": "network.sqlite", "observations": "observations.csv",
                "match_audit": "match.json", "model_output": "volumes.csv",
            },
        }

    def write_method(self, root: Path, name: str, observations: str = "same", contaminated: bool = False):
        path = root / name
        path.mkdir()
        (path / "network.sqlite").write_bytes(b"network")
        (path / "observations.csv").write_text(observations)
        audit = {"frozen_before_model_volume": True, "matches": [{"link_id": "1"}]}
        if contaminated:
            audit["matches"][0]["modeled_volume"] = 99
        (path / "match.json").write_text(json.dumps(audit))
        (path / "volumes.csv").write_text("this must never be read")

    def test_ready_only_with_identical_inputs_and_prevolume_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_method(root, "a")
            self.write_method(root, "b")
            result = audit_study(root, self.registry())
        self.assertEqual(result["readiness"], "ready")
        self.assertFalse(result["model_output_bytes_read"])

    def test_mismatch_and_modeled_value_contamination_refuse_study(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_method(root, "a")
            self.write_method(root, "b", observations="different", contaminated=True)
            result = audit_study(root, self.registry())
        self.assertEqual(result["readiness"], "not_ready")
        self.assertFalse(result["counties"][0]["same_observations"])
        self.assertEqual(
            result["counties"][0]["methods"]["activitysim"]["match_audit_state"],
            "contains modeled volumes",
        )
        self.assertNotIn("this must never be read", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
