"""A historical-source option must preserve exact-byte refusal."""
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import verify_comparable_observation_study as verifier


class MatcherSourceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)

    def test_retained_source_is_hashed_without_execution(self):
        source = self.directory / "retained.py"
        payload = b'raise RuntimeError("must never execute archived source")\n'
        source.write_bytes(payload)
        audit = {"matcher": {"sha256": hashlib.sha256(payload).hexdigest()}}
        verifier.verify_matcher_source(audit, source, "fixture")


    def test_current_source_cannot_replace_retained_bytes(self):
        source = self.directory / "current.py"
        source.write_bytes(b"corrected matching algorithm\n")
        audit = {"matcher": {"sha256": hashlib.sha256(b"historical algorithm\n").hexdigest()}}
        with self.assertRaisesRegex(verifier.VerificationError, "fixture matcher hash changed"):
            verifier.verify_matcher_source(audit, source, "fixture")


    def test_missing_source_is_not_replaced_by_a_recorded_hash(self):
        with self.assertRaisesRegex(verifier.VerificationError, "artifact is missing"):
            verifier.verify_matcher_source({"matcher": {"sha256": "a" * 64}}, self.directory / "absent.py", "fixture")


    def test_missing_recorded_hash_is_refused(self):
        source = self.directory / "retained.py"
        source.write_bytes(b"historical algorithm\n")
        with self.assertRaisesRegex(verifier.VerificationError, "matcher hash changed"):
            verifier.verify_matcher_source({}, source, "fixture")

if __name__ == "__main__":
    unittest.main()
