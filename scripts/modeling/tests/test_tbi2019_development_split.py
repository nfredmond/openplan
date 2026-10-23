"""Synthetic checks for roster-only access and whole-household splitting."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tbi2019_development_split as split


class SplitTests(unittest.TestCase):
    def setUp(self):
        self.spec = split.load_spec()
        self.rows = [{"hh_id": i, "home_county": "Anoka County, MN", "survey_year": 2019}
                     for i in range(1, 11)]

    def test_exact_independent_rank_and_conservation(self):
        result = split.partition(self.rows, self.spec)
        ranked = sorted(range(1, 11), key=lambda i: hashlib.sha256(
            (self.spec["seed"] + "\n" + str(i)).encode()).hexdigest())
        self.assertEqual({r["hh_id"] for r in result if r["partition"] == "held_out"}, set(ranked[:2]))
        self.assertEqual({r["hh_id"] for r in result}, set(range(1, 11)))
        self.assertEqual(len(result), 10)
        self.assertEqual(result, split.partition(list(reversed(self.rows)), self.spec))
        self.assertTrue(all(r["in_study_region"] for r in result))

    def test_county_stratification_and_missing(self):
        rows = self.rows + [{"hh_id": i, "home_county": None, "survey_year": 2019}
                            for i in range(11, 16)]
        result = split.partition(rows, self.spec)
        other = [r for r in result if r["county"] == "__missing__"]
        self.assertEqual(len(other), 5)
        self.assertEqual(sum(r["partition"] == "held_out" for r in other), 1)
        self.assertFalse(any(r["in_study_region"] for r in other))
        report = split.summary(result)
        self.assertEqual(sum(c["households"] for c in report["counts"]), 15)
        self.assertEqual(report["assignment_sha256"], split.sha256(split.canonical(result)))

    def test_outcome_field_refused(self):
        self.rows[0]["mode_type"] = "Walk"
        with self.assertRaisesRegex(ValueError, "only the three outcome-free fields"):
            split.partition(self.rows, self.spec)

    def test_invalid_id_refused(self):
        for value in (0, -1, "123", True, None):
            with self.subTest(value=value):
                self.rows[0]["hh_id"] = value
                with self.assertRaisesRegex(ValueError, "positive integer"):
                    split.partition(self.rows, self.spec)

    def test_duplicate_refused(self):
        with self.assertRaisesRegex(ValueError, "duplicate household ID"):
            split.partition(self.rows + [self.rows[0]], self.spec)

    def test_wrong_wave_refused(self):
        self.rows[0]["survey_year"] = 2023
        with self.assertRaisesRegex(ValueError, "only the 2019 wave"):
            split.partition(self.rows, self.spec)

    def test_bad_county_refused(self):
        self.rows[0]["home_county"] = 27003
        with self.assertRaisesRegex(ValueError, "publisher label"):
            split.partition(self.rows, self.spec)

    def test_query_projection(self):
        query = split.request_parameters(1000)
        self.assertEqual(query["outFields"], "hh_id,home_county,survey_year")
        self.assertEqual(query["orderByFields"], "hh_id ASC")
        self.assertEqual(query["resultOffset"], "1000")
        self.assertNotIn("outFields", split.request_parameters())

    def test_page_refusals(self):
        with self.assertRaisesRegex(ValueError, "publisher returned an error"):
            split.validate_page({"error": {"code": 400}}, 10)
        for payload in ({}, {"features": []}, {"features": [dict(attributes=r) for r in self.rows]}):
            with self.assertRaisesRegex(ValueError, "empty, malformed or exceeds"):
                split.validate_page(payload, 2)
        with self.assertRaisesRegex(ValueError, "outside the outcome-free projection"):
            split.validate_page({"features": [{"attributes": {"hh_id": 1, "mode_type": "Walk"}}]}, 10)

    def test_spec_tamper(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "SPLIT.json").write_text("{}")
            (root / "SPLIT.sha256").write_text("0" * 64)
            with patch.object(split, "STUDY", root):
                with self.assertRaisesRegex(ValueError, "specification hash mismatch"):
                    split.load_spec()

    def response(self, data):
        from io import BytesIO
        return BytesIO(json.dumps(data).encode())

    def test_acquisition_end_to_end_synthetic(self):
        responses = [self.response({"count": 10}),
                     self.response({"features": [{"attributes": r} for r in self.rows]}),
                     self.response({"count": 10})]
        with tempfile.TemporaryDirectory() as tmp, patch.object(split.urllib.request, "urlopen", side_effect=responses) as fetch:
            run = Path(tmp) / "run"
            split.acquire(run)
            report = json.loads((run / "split-summary.json").read_text())
            self.assertEqual(report["households"], 10)
            self.assertEqual(report["held_out_outcome_rows_read"], 0)
            self.assertEqual(len(json.loads((run / "source-manifest.json").read_text())), 3)
            self.assertTrue(all("FeatureServer/1/query?" in c.args[0] for c in fetch.call_args_list))
            with self.assertRaises(FileExistsError):
                split.acquire(run)

    def test_invalid_census(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(split.urllib.request, "urlopen", return_value=self.response({"count": 0})):
            with self.assertRaisesRegex(ValueError, "census is not a positive integer"):
                split.acquire(Path(tmp) / "run")

    def test_census_change(self):
        responses = [self.response({"count": 10}),
                     self.response({"features": [{"attributes": r} for r in self.rows]}),
                     self.response({"count": 11})]
        with tempfile.TemporaryDirectory() as tmp, patch.object(split.urllib.request, "urlopen", side_effect=responses):
            with self.assertRaisesRegex(ValueError, "census changed during acquisition"):
                split.acquire(Path(tmp) / "run")


if __name__ == "__main__":
    unittest.main()
