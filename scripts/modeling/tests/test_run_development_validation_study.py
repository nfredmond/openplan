from __future__ import annotations

import json
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

import run_development_validation_study as study
import validation_instrument as instrument
from test_validation_instrument import NOW, observation, write_boundary, write_network


class StudyFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.output_root = self.temp / "study"
        self.output_root.mkdir()
        self.registry_path = self.temp / "registry.json"
        self.network = self.temp / "network.sqlite"
        write_network(self.network, [
            (1, "Route 1", "primary", 1, [(-121.0005, 38.999), (-121.0005, 39.001)]),
            (2, "Route 1", "primary", -1, [(-120.9995, 38.999), (-120.9995, 39.001)]),
        ])
        seed_run = self.temp / "seed"
        (seed_run / "work" / "aeq_project").mkdir(parents=True)
        shutil.copyfile(self.network, seed_run / "work" / "aeq_project" / "project_database.sqlite")
        demand_package = self.temp / "demand"
        demand_package.mkdir()
        self.registry = {
            "schema": "openplan.development-validation-instrument-study.v2",
            "study_id": "fixture-study", "title": "fixture", "partition": "development",
            "planning_use": "development-only baseline diagnostic",
            "frozen_protocol": {
                "v1_readiness_registry": "scripts/modeling/development/california_validation_instrument_study.v1.json",
                "v1_readiness_registry_sha256": instrument.sha256_file(ROOT / "scripts/modeling/development/california_validation_instrument_study.v1.json"),
                "nationwide_preregistration": "docs/modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json",
                "nationwide_preregistration_sha256": instrument.sha256_file(ROOT / "docs/modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json"),
                "matcher_version": instrument.MATCHER_VERSION, "validation_rules_version": 4,
            },
            "methods": ["aequilibrae", "activitysim"],
            "counties": [{
                "geography_id": "fixture", "network_seed_run": str(seed_run),
                "activitysim_demand_package": str(demand_package),
            }],
            "source_policy": {},
            "run_policy": {"minimum_free_bytes": 0, "acceptance_rule": "unknown"},
        }
        self.registry_path.write_text(json.dumps(self.registry))
        instrument_dir = self.output_root / "instruments" / "fixture"
        instrument_dir.mkdir(parents=True)
        frozen_network = instrument_dir / "network" / "project_database.sqlite"
        frozen_network.parent.mkdir()
        shutil.copyfile(self.network, frozen_network)
        boundary = self.temp / "boundary.geojson"
        write_boundary(boundary)
        source = instrument_dir / "sources" / "fixture" / "response.bin"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"exact source")
        attempt = {
            "source_id": "fixture", "adapter": "fixture", "status": "available", "attempted_at": NOW,
            "source_url": "https://example.test", "artifacts": [instrument.artifact_record(source, relative_to=instrument_dir)],
            "record_count": 1, "reason": "exact",
        }
        instrument.build_observation_package(
            instrument_dir, geography_id="fixture", boundary_path=boundary,
            subdivisions=[{"country": "US", "subdivision": "AA"}],
            source_attempts=[attempt], observations=[observation("one")], created_at=NOW,
        )
        package = instrument_dir / "observation-package.json"
        audit = instrument_dir / "pre-volume-match-audit.json"
        instrument.build_pre_volume_match_audit(
            frozen_network, package, self.registry_path, audit, created_at=NOW
        )
        self.readiness_path = self.output_root / "instrument-readiness.json"
        self.readiness = {
            "schema": study.READINESS_SCHEMA, "study_id": "fixture-study", "created_at": NOW,
            "preregistration_sha256": instrument.sha256_file(self.registry_path),
            "model_output_bytes_read": False, "readiness": "ready", "ready_counties": 1, "county_count": 1,
            "counties": [{
                "geography_id": "fixture", "ready": True,
                "network_path": str(frozen_network), "network_sha256": instrument.sha256_file(frozen_network),
                "observation_package_path": str(package), "observation_package_sha256": instrument.sha256_file(package),
                "match_audit_path": str(audit), "match_audit_sha256": instrument.sha256_file(audit),
            }],
        }
        self.readiness_path.write_text(json.dumps(self.readiness))

    def tearDown(self):
        self.temporary.cleanup()

    def executor(self, command, cwd):
        del cwd
        name = command[command.index("--name") + 1]
        output_root = Path(command[command.index("--output-root") + 1])
        run = output_root / name
        (run / "work" / "aeq_project").mkdir(parents=True)
        shutil.copyfile(self.network, run / "work" / "aeq_project" / "project_database.sqlite")
        (run / "run_output").mkdir()
        method = "activitysim" if name.endswith("activitysim") else "aequilibrae"
        value = 200 if method == "activitysim" else 100
        (run / "run_output" / "link_volumes.csv").write_text(
            f"link_id,PCE_tot\n1,{value}\n2,{value}\n"
        )
        profile = {
            "schema_version": "openplan.assignment-profile.v1", "profile_id": "fixture", "engine": "aequilibrae",
            "engine_version": "1.6.2", "algorithm": "bfw", "vdf": "BPR", "vdf_parameters": {"alpha": 0.15, "beta": 4},
            "capacity_field": "capacity", "time_field": "travel_time", "class_pce": 1,
            "cores": 1, "target_gap": 0.0005, "max_iterations": 3000,
        }
        payload = json.dumps(profile, sort_keys=True, separators=(",", ":"))
        evidence = {
            "engine": "AequilibraE screening runtime", "engine_versions": {"aequilibrae": "1.6.2"},
            "assignment": {"convergence": {"assignment_profile": profile, "assignment_profile_payload_json": payload},
                           "network_settings": {"source": "fixture"}},
        }
        (run / "run_output" / "evidence_packet.json").write_text(json.dumps(evidence))
        (run / "run_summary.json").write_text("{}")


class ReadinessTests(StudyFixture):
    def test_output_bytes_cannot_change_readiness(self):
        gate_one = study.preflight_readiness(ROOT, self.registry_path, self.output_root)
        output = self.output_root / "runs" / "arbitrary" / "run_output" / "link_volumes.csv"
        output.parent.mkdir(parents=True)
        output.write_bytes(b"first")
        gate_two = study.preflight_readiness(ROOT, self.registry_path, self.output_root)
        output.write_bytes(b"completely different")
        gate_three = study.preflight_readiness(ROOT, self.registry_path, self.output_root)
        for gate in (gate_two, gate_three):
            self.assertEqual(gate["preregistration_sha256"], gate_one["preregistration_sha256"])
            self.assertEqual(gate["counties"][0]["match_audit_sha256"], gate_one["counties"][0]["match_audit_sha256"])

    def test_failed_county_gate_prevents_every_executor_call(self):
        payload = dict(self.readiness)
        payload["readiness"] = "not_ready"
        payload["counties"] = [{**payload["counties"][0], "ready": False}]
        self.readiness_path.write_text(json.dumps(payload))
        calls = []
        with self.assertRaisesRegex(study.StudyRefused, "gate failed"):
            study.run_study(
                ROOT, self.registry_path, self.output_root,
                created_at=NOW, executor=lambda command, cwd: calls.append((command, cwd)),
            )
        self.assertEqual(calls, [])

    def test_custody_failure_is_not_swallowed(self):
        self.readiness["counties"][0]["network_sha256"] = "0" * 64
        self.readiness_path.write_text(json.dumps(self.readiness))
        with self.assertRaisesRegex(study.StudyRefused, "network custody"):
            study.preflight_readiness(ROOT, self.registry_path, self.output_root)


class EvaluationTests(StudyFixture):
    def test_methods_share_frozen_inputs_remain_separate_and_unknown_facts_stay_unknown(self):
        result = study.run_study(
            ROOT, self.registry_path, self.output_root, created_at=NOW, executor=self.executor
        )
        county = result["counties"][0]
        aeq = county["methods"]["aequilibrae"]
        asim = county["methods"]["activitysim"]
        self.assertEqual(aeq["network_sha256"], asim["network_sha256"])
        self.assertEqual(aeq["observation_package_sha256"], asim["observation_package_sha256"])
        self.assertEqual(aeq["match_audit_sha256"], asim["match_audit_sha256"])
        self.assertNotEqual(aeq["model_output_sha256"], asim["model_output_sha256"])
        self.assertEqual(result["method_aggregation"], "separate")
        self.assertNotIn("average", json.dumps(result).lower())
        self.assertEqual(result["scientific_outcome"], "inconclusive")
        for method in study.METHODS:
            basis_path = self.output_root / "results" / "fixture" / method / "comparison-basis.json"
            input_path = self.output_root / "results" / "fixture" / method / "validation-input-bundle.json"
            assessment_path = self.output_root / "results" / "fixture" / method / "assessment.json"
            basis = json.loads(basis_path.read_text())
            input_bundle = json.loads(input_path.read_text())
            assessment = json.loads(assessment_path.read_text())
            self.assertEqual(basis["model_base_year"], "unknown")
            self.assertEqual(basis["day_basis"], "unknown")
            self.assertEqual(basis["coefficient_package"], "unknown")
            self.assertEqual(basis["population_vintage"], "unknown")
            self.assertEqual(basis["acceptance_rule"], "unknown")
            self.assertEqual(input_bundle["schema"], "openplan.validation-input-bundle.v1")
            self.assertFalse(input_bundle["model_output_bytes_read"])
            self.assertNotIn("modeled_volume", json.dumps(input_bundle).lower())
            self.assertEqual(
                assessment["exact_inputs"]["validation_input_bundle_sha256"],
                instrument.sha256_file(input_path),
            )
            self.assertEqual(
                assessment["exact_inputs"]["comparison_basis_sha256"],
                instrument.sha256_file(basis_path),
            )

    def test_different_run_network_is_refused_before_evaluation(self):
        def wrong_network(command, cwd):
            self.executor(command, cwd)
            name = command[command.index("--name") + 1]
            if name.endswith("activitysim"):
                run = Path(command[command.index("--output-root") + 1]) / name
                with (run / "work" / "aeq_project" / "project_database.sqlite").open("ab") as handle:
                    handle.write(b"changed")

        with self.assertRaisesRegex(study.StudyRefused, "did not use the frozen network"):
            study.run_study(
                ROOT, self.registry_path, self.output_root, created_at=NOW, executor=wrong_network
            )


if __name__ == "__main__":
    unittest.main()
