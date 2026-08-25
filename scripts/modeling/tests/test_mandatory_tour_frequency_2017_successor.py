#!/usr/bin/env python3
import json
import math
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import mandatory_tour_frequency_2017_successor as successor  # noqa: E402


def model_fixture():
    cells = {
        f"{worker}__{band}": {alternative: 0.2 for alternative in successor.ALTERNATIVES}
        for worker in ("not_worker", "worker")
        for _lower, _upper, band in successor.AGE_BANDS
    }
    return {
        "alternatives": list(successor.ALTERNATIVES),
        "reference_alternative": successor.REFERENCE_ALTERNATIVE,
        "reference_cells": "worker and age only; excluded fields absent",
        "reference_probabilities": cells,
        "features": list(successor.FEATURES),
        "learned_coefficients": {
            alternative: {feature["name"]: 0.0 for feature in successor.FEATURES}
            for alternative in successor.ALTERNATIVES[1:]
        },
        "selected_regularization": 0.03,
    }


class SuccessorContractTests(unittest.TestCase):
    def test_candidate_contract_excludes_student_vehicle_and_geography(self):
        successor.verify_candidate_contract(model_fixture())
        student = model_fixture()
        student["features"][0] = dict(student["features"][0], runtime="is_student")
        with self.assertRaisesRegex(successor.SuccessorError, "student"):
            successor.verify_candidate_contract(student)
        vehicle = model_fixture()
        vehicle["learned_coefficients"]["work2"]["vehicle_count"] = 1.0
        with self.assertRaisesRegex(successor.SuccessorError, "vehicle"):
            successor.verify_candidate_contract(vehicle)

    def test_reference_probability_order_is_explicit_after_sorted_json(self):
        model = json.loads(json.dumps(model_fixture(), sort_keys=True))
        row = {
            "age": 35, "sex_code": "02", "worker_code": "01", "household_size": 2,
            "workers": 1, "alternative": "work1",
        }
        cell = successor.reference_cell(row)
        model["reference_probabilities"][cell] = {
            "school1": 0.3, "school2": 0.1, "work1": 0.4, "work2": 0.15,
            "work_and_school": 0.05,
        }
        candidate, reference, outcomes = successor.probability_arrays(
            [row], model["reference_probabilities"], np.zeros((4, 5))
        )
        np.testing.assert_allclose(reference[0], [0.4, 0.15, 0.3, 0.1, 0.05])
        np.testing.assert_allclose(candidate, reference)
        self.assertEqual(outcomes.tolist(), [0])

    def test_exact_jackknife_factor_and_t_criticals(self):
        replicates = np.ones(successor.REPLICATE_COUNT)
        replicates[0] = 2.0
        standard_error, lower, upper = successor.jackknife(1.0, replicates)
        self.assertAlmostEqual(standard_error, math.sqrt(6 / 7))
        self.assertAlmostEqual(lower, 1.0 - successor.TWO_SIDED_CRITICAL * standard_error)
        self.assertAlmostEqual(upper, 1.0 + successor.TWO_SIDED_CRITICAL * standard_error)
        self.assertEqual(successor.DESIGN_DEGREES_OF_FREEDOM, 84)

    def test_every_substantive_gate_is_required_and_prerequisites_outrank_rejection(self):
        national = {name: {"passed": True} for name in (
            "log_loss_improvement", "total_variation", "choice_shares",
            "tour_means", "reconstruction_coverage",
        )}
        transfer = {"passed": True}
        divisions = {"passed": True}
        self.assertEqual(successor.classify_decision([], national, transfer, divisions), "accepted")
        for name in national:
            changed = json.loads(json.dumps(national))
            changed[name]["passed"] = False
            self.assertEqual(successor.classify_decision([], changed, transfer, divisions), "rejected")
        self.assertEqual(successor.classify_decision([], national, {"passed": False}, divisions), "rejected")
        self.assertEqual(successor.classify_decision([], national, transfer, {"passed": False}), "rejected")
        self.assertEqual(successor.classify_decision(["rare cell failed"], national, transfer, {"passed": False}), "inconclusive")

    def test_every_division_safety_gate_is_required(self):
        entry = {
            "log_loss": {"significant_deterioration": False},
            "distribution_gate_passed": True,
            "coverage_gate_passed": True,
            "tour_gate_passed": True,
        }
        self.assertTrue(successor.division_entry_passes(entry))
        for key in ("distribution_gate_passed", "coverage_gate_passed", "tour_gate_passed"):
            changed = json.loads(json.dumps(entry))
            changed[key] = False
            self.assertFalse(successor.division_entry_passes(changed), key)
        changed = json.loads(json.dumps(entry))
        changed["log_loss"]["significant_deterioration"] = True
        self.assertFalse(successor.division_entry_passes(changed))

    def test_holm_requires_positive_deterioration_and_stops_after_first_nonrejection(self):
        entries = [
            {"name": "a", "point": 0.1, "p_value": 0.001},
            {"name": "b", "point": -0.1, "p_value": 0.2},
            {"name": "c", "point": 0.1, "p_value": 0.04},
        ]
        successor.holm(entries, 0.05)
        by_name = {entry["name"]: entry for entry in entries}
        self.assertTrue(by_name["a"]["significant_deterioration"])
        self.assertFalse(by_name["b"]["significant_deterioration"])
        self.assertFalse(by_name["c"]["significant_deterioration"])

    def test_aggregate_guard_rejects_person_identifiers(self):
        successor.assert_aggregate_only({"division": "01", "records": 4})
        with self.assertRaisesRegex(successor.SuccessorError, "person_id"):
            successor.assert_aggregate_only({"cells": [{"person_id": "secret"}]})

    def test_header_inventory_reads_and_records_only_the_header_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "source.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("table.csv", "A,B\nsecret,outcome\n")
            inventory = successor.zip_header_inventory(archive_path, {"table.csv": {"A", "B"}})
            self.assertEqual(inventory["non_header_rows_read"], 0)
            self.assertEqual(inventory["header_only_contract"]["table.csv"]["columns"], ["A", "B"])
            self.assertNotIn("secret", json.dumps(inventory))

    def test_receipt_is_fsynced_before_source_loader_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = root / "receipt.json"
            result = root / "result.json"
            package = root / "package"
            package.mkdir()
            (package / "coefficient_package.json").write_text("{}\n")
            core = root / "core.zip"
            replicates = root / "replicates.zip"
            core.write_bytes(b"core")
            replicates.write_bytes(b"replicates")
            lock = {"source_sha256": {"core": successor.sha256(core), "replicates": successor.sha256(replicates)}, "evaluator": {"closure_sha256": "closure"}}
            preregistration = {"weekday_estimand": {}, "scope_limits": []}

            def loader(_core, _replicates):
                self.assertTrue(receipt.exists())
                self.assertIn("source_consumed_before_first_non_header_row_read", receipt.read_text())
                return mock.sentinel.source

            with (
                mock.patch.object(successor, "RECEIPT_PATH", receipt),
                mock.patch.object(successor, "RESULT_PATH", result),
                mock.patch.object(successor, "PACKAGE_DIR", package),
                mock.patch.object(successor, "LOCK_PATH", root / "lock.json"),
                mock.patch.object(successor, "PREREGISTRATION_PATH", root / "prereg.json"),
                mock.patch.object(successor, "verify_lock", return_value=(lock, preregistration, model_fixture())),
                mock.patch.object(successor, "evaluate_rows", return_value={"decision": "rejected"}),
                mock.patch.object(successor, "sha256", wraps=successor.sha256),
            ):
                (root / "lock.json").write_text("{}\n")
                (root / "prereg.json").write_text("{}\n")
                value = successor.consume_and_evaluate(core, replicates, source_loader=loader)
            self.assertEqual(value["decision"], "rejected")
            self.assertTrue(result.exists())


if __name__ == "__main__":
    unittest.main()
