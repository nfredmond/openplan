"""Study guards use synthetic inputs only; no scientific partition is opened."""
import copy
import ast
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import subprocess
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).parent))
import evaluate
import validate


def score(ape=20, loaded=("a",)):
    row = {"stations": 6, "median_ape": ape, "uncertainty_status": "unavailable"}
    return {"county": row, "road_classes": {"primary": row.copy()},
            "loaded_station_ids": list(loaded), "matched_identity_sha256": "same"}


class StudyTests(unittest.TestCase):
    def test_county_default_bytes_and_opt_in_dispatch(self):
        runtime = evaluate.runtime
        source = subprocess.check_output(["git", "show", "09792dd2d^:scripts/modeling/screening_runtime.py"],
                                         cwd=evaluate.ROOT, text=True)
        function = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)
                        and n.name == "synthesize_demand")
        scope = dict(vars(runtime))
        exec(compile(ast.Module(body=[function], type_ignores=[]), "pre-candidate-runtime", "exec"), scope)
        columns = ["households", "worker_residents", "retail_jobs", "health_jobs", "education_jobs", "accommodation_jobs", "govt_jobs"]
        zones = evaluate.pd.DataFrame({"zone_id": [7, 19, 31, 47], "zone_kind": ["internal", "internal", "external", "external"],
            "est_population": [100., 300., 0., 0.], "total_jobs": [60., 40., 0., 0.],
            **{c: [10., 30., 0., 0.] for c in columns}})
        times = evaluate.np.array([[0., 10., 2., 30.], [10., 0., 30., 2.], [2., 30., 0., 20.], [30., 2., 20., 0.]])
        gateways = [{"zone_id": i, "name": "Shared route", "daily_in": 100., "daily_out": 100.} for i in (31, 47)]
        with tempfile.TemporaryDirectory() as temp:
            directories = [Path(temp) / name for name in ("old", "default", "candidate")]
            for directory in directories: directory.mkdir()
            args = (zones, times, gateways)
            kwargs = {"supplied_internal_matrix": evaluate.np.array([[3., 5.], [7., 11.]])}
            with patch.dict(evaluate.os.environ, {"OPENPLAN_EXTERNAL_DISTRIBUTION": "default"}):
                old = scope["synthesize_demand"](*args, directories[0], **kwargs)
                current = runtime.synthesize_demand(*args, directories[1], **kwargs)
            for filename in ("od_trip_matrix.csv", "demand_layers.json"):
                self.assertEqual((directories[0] / filename).read_bytes(), (directories[1] / filename).read_bytes())
            self.assertEqual(old["matrix"].tobytes(), current["matrix"].tobytes())
            with patch.dict(evaluate.os.environ, {"OPENPLAN_EXTERNAL_DISTRIBUTION": evaluate.distribution.CANDIDATE}):
                candidate = runtime.synthesize_demand(*args, directories[2], **kwargs)
            self.assertNotEqual(candidate["matrix"].tobytes(), current["matrix"].tobytes())
            self.assertEqual(candidate["summary"]["external_distribution"]["ordered_zone_ids"], [7, 19, 31, 47])

    def test_gate_accepts_harmless_extra_field(self):
        b, c = score(30), score(20)
        c["note"] = "harmless"
        self.assertEqual(evaluate.county_decision(b, c, "evaluation", 1), [])

    def test_evaluation_gate(self):
        self.assertIn("evaluation_improvement_below_5_points",
                      evaluate.county_decision(score(30), score(26), "evaluation", 1))

    def test_diagnosis_gate(self):
        self.assertIn("diagnosis_worsened_over_1_point",
                      evaluate.county_decision(score(20), score(22), "diagnosis", 1))

    def test_stratum_gate(self):
        b, c = score(30), score(20)
        c["road_classes"]["primary"]["median_ape"] = 32
        self.assertIn("road_class_worsened:primary", evaluate.county_decision(b, c, "evaluation", 1))

    def test_coverage_gate(self):
        self.assertIn("lost_loaded_station",
                      evaluate.county_decision(score(30), score(20, ()), "evaluation", 1))

    def test_inert_gate(self):
        self.assertIn("inert_candidate", evaluate.county_decision(score(30), score(20), "evaluation", 0))

    def test_missing_gate(self):
        b = score(30)
        b["county"]["stations"] = 0
        self.assertEqual(evaluate.county_decision(b, score(20), "evaluation", 1), ["missing_matched_stations"])

    def test_source_guards(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            archive = directory / "source.zip"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr("development/input.txt", b"public fixture")
            member = {"member": "development/input.txt", "bytes": 14,
                      "sha256": hashlib.sha256(b"public fixture").hexdigest()}
            registry = {"archive": {"path": str(archive), "sha256": evaluate.digest(archive)},
                        "members": [member], "geographies": []}
            self.assertEqual(evaluate.prepare(registry, directory / "good"), [])
            wrong = copy.deepcopy(registry)
            wrong["archive"]["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "Source archive changed"):
                evaluate.prepare(wrong, directory / "wrong-archive")
            wrong = copy.deepcopy(registry)
            wrong["members"] = []
            with self.assertRaisesRegex(ValueError, "Archive membership changed"):
                evaluate.prepare(wrong, directory / "wrong-membership")
            wrong = copy.deepcopy(registry)
            wrong["members"][0]["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "Source member changed"):
                evaluate.prepare(wrong, directory / "wrong-member")

    def test_forbidden_member(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            archive = directory / "source.zip"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr("holdout/input", b"fixture")
            registry = {"archive": {"path": str(archive), "sha256": evaluate.digest(archive)},
                        "members": [{"member": "holdout/input", "bytes": 7,
                                     "sha256": hashlib.sha256(b"fixture").hexdigest()}], "geographies": []}
            with self.assertRaisesRegex(ValueError, "Forbidden source member"):
                evaluate.prepare(registry, directory / "work")

    def test_independent_validator(self):
        case = {"scores": {"baseline": score(30), "candidate": score(20)}, "split": "evaluation",
                "audit": {"external_distribution": {"changed_cells": 2}}, "reasons": [],
                "assignments": {"baseline": {"convergence": {"converged": True}},
                                "candidate": {"convergence": {"converged": True}}},
                "repeat_median_ape_delta": 0.0, "decision": "advance"}
        value = {"scientific_accuracy": "inconclusive", "method": "aequilibrae",
                 "defaults_changed": False, "holdout_accessed": False, "methods_averaged": False,
                 "geographies": [case], "decision": "accepted", "development_decision": "advance"}
        validate.validate(value)
        for change in ("default", "gate", "convergence", "repeat", "matching", "promotion"):
            bad = copy.deepcopy(value)
            c = bad["geographies"][0]
            if change == "default": bad["defaults_changed"] = True
            if change == "gate": c["scores"]["candidate"]["county"]["median_ape"] = 29
            if change == "convergence": c["assignments"]["candidate"]["convergence"]["converged"] = False
            if change == "repeat": c["repeat_median_ape_delta"] = .2
            if change == "matching": c["scores"]["candidate"]["matched_identity_sha256"] = "changed"
            if change == "promotion": bad["scientific_accuracy"] = "validated"
            with self.subTest(change=change), self.assertRaises(AssertionError):
                validate.validate(bad)


if __name__ == "__main__":
    unittest.main()
