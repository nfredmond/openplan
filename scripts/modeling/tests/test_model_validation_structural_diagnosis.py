from __future__ import annotations

import json
import inspect
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MODELING = ROOT / "scripts" / "modeling"
TESTS = Path(__file__).resolve().parent
for directory in (MODELING, TESTS):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

import model_validation_structural_diagnosis as diagnosis
import run_validation_structural_diagnosis as runner
import validation_instrument as instrument
from test_validation_instrument import InstrumentFixture, NOW, observation, write_network


class AssignmentBlindDiagnosisTests(InstrumentFixture):
    def test_full_link_geometry_missing_coordinates_ties_and_registry_jurisdictions_stay_separate(self):
        missing = observation("missing")
        missing["geometry"] = {
            "type": "source_coordinate",
            "latitude": 39.0,
            "longitude_magnitude": 121.0,
            "longitude_hemisphere": "unknown",
        }
        tied = observation("tied", lon=-121.0, lat=39.0)
        long_link = observation("long-link", lon=-121.1, lat=39.0)
        absent = observation("network-absent", lon=-123.0, lat=39.0)
        paired = observation("paired", lon=-120.98, lat=39.0)
        attempts = [
            {
                "source_id": "national-empty",
                "adapter": "registry",
                "status": "supported_but_empty",
                "attempted_at": NOW,
                "source_url": "https://example.test/empty",
                "artifacts": [],
                "record_count": 0,
                "reason": "The source returned no records.",
            },
            {
                "source_id": "country-unsupported",
                "adapter": "registry",
                "status": "geography_unsupported",
                "attempted_at": NOW,
                "source_url": "https://example.test/unsupported",
                "artifacts": [],
                "record_count": 0,
                "reason": "The adapter does not cover this country.",
            },
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package_path, _ = self.make_package(
                root,
                observations=[missing, tied, long_link, absent, paired],
                attempts=attempts,
                subdivisions=[
                    {"country": "US", "subdivision": "AA"},
                    {"country": "US", "subdivision": "BB"},
                    {"country": "ZZ", "subdivision": "01"},
                ],
            )
            network = root / "network.sqlite"
            write_network(network, [
                (1, "Route 1", "primary", 0, [(-121.1, 39.0), (-120.9, 39.0)]),
                (2, "Route 1", "primary", 0, [(-121.0001, 38.999), (-121.0001, 39.001)]),
                (3, "Route 1", "primary", 0, [(-120.9999, 38.999), (-120.9999, 39.001)]),
                (4, "Route 1", "primary", 1, [(-120.9805, 38.999), (-120.9805, 39.001)]),
                (5, "Route 1", "primary", -1, [(-120.9795, 38.999), (-120.9795, 39.001)]),
            ])
            preregistration = root / "registry.json"
            preregistration.write_text("{}")
            audit_path = root / "audit.json"
            original_audit = instrument.build_pre_volume_match_audit(
                network, package_path, preregistration, audit_path, created_at=NOW
            )
            payload = diagnosis.build_assignment_blind_diagnosis(
                repo_root=root,
                geography_id="fixture-geography",
                network_path=network,
                observation_package_path=package_path,
                match_audit_path=audit_path,
                preregistration_path=preregistration,
                created_at=NOW,
            )

            self.assertFalse(payload["model_output_bytes_read"])
            self.assertEqual(payload["match_changes"], 0)
            self.assertEqual(payload["observation"]["missing_usable_point_coordinates"], 1)
            self.assertGreaterEqual(payload["matching"]["full_link_within_radius_but_centroid_outside"], 1)
            self.assertGreaterEqual(payload["matching"]["genuine_network_absence_within_search_distance"], 1)
            self.assertEqual(
                payload["jurisdictions"]["intersected_subdivisions"],
                [
                    {"country": "US", "subdivision": "AA"},
                    {"country": "US", "subdivision": "BB"},
                    {"country": "ZZ", "subdivision": "01"},
                ],
            )
            self.assertEqual(
                [item["status"] for item in payload["source_attempts"]],
                ["supported_but_empty", "geography_unsupported"],
            )
            tied_record = next(item for item in payload["matching"]["records"] if item["observation_id"] == "tied")
            self.assertEqual(tied_record["frozen_status"], "ambiguous")
            self.assertGreaterEqual(len(tied_record["frozen_candidate_link_ids"]), 2)
            paired_record = next(item for item in payload["matching"]["records"] if item["observation_id"] == "paired")
            self.assertEqual(paired_record["frozen_selected_link_id"], "4+5")
            self.assertEqual(original_audit, json.loads(audit_path.read_text()))
            self.assertNotIn("modeled_volume", json.dumps(payload).lower())

    def test_changed_frozen_bytes_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / "frozen.json"
            artifact.write_text("{}")
            record = {"path": "frozen.json", "sha256": instrument.sha256_file(artifact)}
            self.assertEqual(runner._verified_artifact(root, record, "fixture"), artifact)
            artifact.write_text('{"changed":true}')
            with self.assertRaisesRegex(diagnosis.DiagnosisRefused, "changed"):
                runner._verified_artifact(root, record, "fixture")


class PostAssignmentDiagnosisTests(unittest.TestCase):
    def setUp(self):
        self.audit = {
            "matches": [
                {
                    "observation_id": "zero-or-negative",
                    "status": "matched",
                    "selected_link_id": "1+2",
                    "carriageway": {"link_ids": [1, 2]},
                },
                {
                    "observation_id": "unloaded-one-method",
                    "status": "matched",
                    "selected_link_id": "3",
                    "carriageway": {"link_ids": [3]},
                },
                {
                    "observation_id": "excluded",
                    "status": "excluded",
                    "selected_link_id": "unknown",
                    "carriageway": "unknown",
                },
            ]
        }

    def test_zero_negative_and_unloaded_records_are_retained_without_averaging(self):
        aeq = diagnosis.build_network_loading_records(self.audit, {"1": 0.0, "2": 0.0}, "aequilibrae")
        asim = diagnosis.build_network_loading_records(
            self.audit, {"1": -5.0, "2": 0.0, "3": 10.0}, "activitysim"
        )
        comparison = diagnosis.compare_methods(aeq, asim)

        self.assertEqual(aeq["unloaded_records"], 1)
        self.assertEqual(aeq["output_missing_records"], 1)
        self.assertEqual(asim["negative_loaded_records"], 1)
        self.assertEqual(len(comparison["records"]), 2)
        first = next(
            item for item in comparison["records"] if item["observation_id"] == "zero-or-negative"
        )
        self.assertEqual(first["aequilibrae"]["raw_value"], 0.0)
        self.assertEqual(first["activitysim"]["raw_value"], -5.0)
        self.assertEqual(first["aequilibrae_minus_activitysim"], 5.0)
        self.assertEqual(first["aequilibrae_to_activitysim_ratio"], -0.0)
        second = next(
            item for item in comparison["records"] if item["observation_id"] == "unloaded-one-method"
        )
        self.assertFalse(second["aequilibrae"]["output_row_present"])
        self.assertEqual(second["aequilibrae_minus_activitysim"], "unknown")
        self.assertEqual(comparison["aggregation"], "none")
        self.assertEqual(comparison["ranking"], "none")
        self.assertEqual(comparison["winner"], "none")

    def test_methods_with_changed_frozen_link_ids_are_refused(self):
        aeq = diagnosis.build_network_loading_records(self.audit, {"1": 1, "2": 2}, "aequilibrae")
        changed = json.loads(json.dumps(self.audit))
        changed["matches"][0]["carriageway"]["link_ids"] = [1]
        asim = diagnosis.build_network_loading_records(changed, {"1": 1}, "activitysim")
        with self.assertRaisesRegex(diagnosis.DiagnosisRefused, "identical frozen"):
            diagnosis.compare_methods(aeq, asim)

    def test_evidence_ledger_never_invents_year_day_population_or_coefficients(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            basis_path = root / "comparison-basis.json"
            profile_path = root / "assignment-profile.json"
            profile_path.write_text('{"profile":"exact"}')
            profile_hash = instrument.sha256_file(profile_path)
            basis = {
                "model_base_year": "unknown",
                "day_basis": "unknown",
                "assignment_period": {"label": "daily", "hours": list(range(24))},
                "direction_basis": {"basis": "two_way", "artifact_sha256": "a" * 64},
                "vehicle_basis": {
                    "unit": "pce",
                    "vehicle_pce_conversion": {"status": "proven", "factor": 1.0},
                },
                "assignment_profile": {"profile": {"profile": "exact"}, "artifact_sha256": profile_hash},
                "population_vintage": "unknown",
                "coefficient_package": "unknown",
            }
            basis_path.write_bytes(instrument.canonical_json_bytes(basis))
            ledger = diagnosis.build_evidence_ledger(
                basis,
                instrument.artifact_record(basis_path, relative_to=root),
                profile_path,
                root,
            )
            for key in ("model_year", "day_basis", "population_vintage", "coefficients"):
                self.assertEqual(ledger[key], {"status": "unknown", "value": "unknown", "evidence": []})
            for key in ("assignment_period", "direction", "vehicle_pce_basis", "assignment_profile"):
                self.assertEqual(ledger[key]["status"], "proved")
                self.assertRegex(ledger[key]["evidence"][0]["sha256"], r"^[0-9a-f]{64}$")
                self.assertTrue(ledger[key]["evidence"][0]["path"])


class RegistryContractTests(unittest.TestCase):
    def test_registry_freezes_v039_sources_and_geographies_stay_data_driven(self):
        registry_path = ROOT / "scripts/modeling/development/california_validation_structural_diagnosis.v1.json"
        registry = json.loads(registry_path.read_text())
        for label, record in registry["source_study"].items():
            path = ROOT / record["path"]
            self.assertEqual(instrument.sha256_file(path), record["sha256"], label)
        source_registry = json.loads((ROOT / registry["source_study"]["preregistration"]["path"]).read_text())
        core_text = (ROOT / "scripts/modeling/model_validation_structural_diagnosis.py").read_text()
        runner_text = (ROOT / "scripts/modeling/run_validation_structural_diagnosis.py").read_text()
        for county in source_registry["counties"]:
            self.assertNotIn(county["geography_id"], core_text)
            self.assertNotIn(county["geography_id"], runner_text)
        blind_loop = runner_text.index("# Complete every assignment-blind county stage")
        output_lookup = runner_text.index('source["readiness_path"].parent / "runs"')
        self.assertLess(blind_loop, output_lookup)
        self.assertNotIn(
            "model_output_path",
            inspect.signature(diagnosis.build_assignment_blind_diagnosis).parameters,
        )

    def test_contract_schemas_keep_outcome_and_methods_separate(self):
        final_schema = json.loads(
            (ROOT / "schemas/model-validation-structural-diagnosis-v1.schema.json").read_text()
        )
        result_schema = json.loads(
            (ROOT / "schemas/model-validation-structural-diagnosis-study-result-v1.schema.json").read_text()
        )
        blind_schema = json.loads(
            (ROOT / "schemas/model-validation-assignment-blind-diagnosis-v1.schema.json").read_text()
        )
        self.assertEqual(final_schema["properties"]["scientific_outcome"]["const"], "inconclusive")
        self.assertEqual(final_schema["properties"]["method_aggregation"]["const"], "separate")
        self.assertFalse(blind_schema["properties"]["model_output_bytes_read"]["const"])
        self.assertIn("assignment_profile", final_schema["properties"]["exact_inputs"]["required"])
        self.assertEqual(
            blind_schema["properties"]["exact_inputs"]["required"],
            ["preregistration", "network", "observation_package", "pre_volume_match_audit"],
        )
        self.assertEqual(result_schema["properties"]["claims"]["properties"]["california"]["const"], "partial")
        self.assertEqual(result_schema["properties"]["claims"]["properties"]["nationwide"]["const"], "partial")


if __name__ == "__main__":
    unittest.main()
