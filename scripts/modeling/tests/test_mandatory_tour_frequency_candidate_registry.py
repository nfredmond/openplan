import csv
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import mandatory_tour_frequency_candidate_registry as candidate  # noqa: E402
import mandatory_tour_frequency_outcomes as outcomes  # noqa: E402
import mandatory_tour_frequency_registry as preregistration  # noqa: E402


DEVELOPMENT_CODES = ["01", "02", "03", "04", "07", "09"]
ACCEPTANCE_CODES = ["05", "06", "08"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def division_rows(codes):
    return [{"division_code": code, "division": f"division_{code}"} for code in codes]


def supported_row(code: str, alternative: str, number: int) -> dict[str, str]:
    tours = preregistration.ALTERNATIVES[alternative]
    return {
        "household_id": f"h-{code}-{number}",
        "person_id": f"p-{code}-{number}",
        "census_division_code": code,
        "stratum_id": f"s-{code}",
        "weekday_weight": str(10 + number),
        "age": str(15 + number),
        "sex_code": "01" if number % 2 else "02",
        "worker_code": "01" if tours["work_tours"] else "02",
        "school_code": "01" if tours["school_tours"] else "02",
        "household_size": "3",
        "workers": "2",
        "drivers": "2",
        "vehicles": "1",
        "income_category_code": "07",
        "urban_rural_code": "01",
        "work_tours": str(tours["work_tours"]),
        "school_tours": str(tours["school_tours"]),
        "alternative": alternative,
        "outcome_status": "supported_alternative",
        "exclusion_reason": "",
    }


class CandidateRegistryFixture:
    def __init__(self, root: Path):
        self.root = root
        self.prereg_path = root / "preregistration.json"
        self.outcomes_dir = root / "outcomes"
        self.outcomes_dir.mkdir()
        self.person_days = self.outcomes_dir / outcomes.OUTPUT_NAME
        self.manifest_path = self.outcomes_dir / outcomes.MANIFEST_NAME
        self.rows = [
            supported_row(code, alternative, number)
            for code in DEVELOPMENT_CODES
            for number, alternative in enumerate(candidate.ALTERNATIVES, start=1)
        ]
        self.write_preregistration()
        self.write_outcomes()

    def write_preregistration(self):
        self.prereg_path.write_text(json.dumps({
            "schema_version": preregistration.SCHEMA_VERSION,
            "status": "pre_registered_before_mandatory_tour_outcome_derivation",
            "selection": {
                "development_divisions": division_rows(DEVELOPMENT_CODES),
                "acceptance_divisions": division_rows(ACCEPTANCE_CODES),
            },
            "reference_model": {"additive_smoothing_alpha": 0.5},
        }, sort_keys=True))

    def write_outcomes(self):
        with self.person_days.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=outcomes.OUTPUT_COLUMNS)
            writer.writeheader()
            writer.writerows(self.rows)
        counts = {
            alternative: {
                "records": sum(row["alternative"] == alternative for row in self.rows),
                "weekday_weight": 1.0,
            }
            for alternative in candidate.ALTERNATIVES
        }
        self.manifest_path.write_text(json.dumps({
            "schema_version": outcomes.SCHEMA_VERSION,
            "status": "development_outcomes_only_acceptance_unopened",
            "study_contract": {"acceptance_outcomes_read": False},
            "source": {"preregistration_sha256": sha256(self.prereg_path)},
            "implementation": {"closure_sha256": "a" * 64},
            "outputs": {
                "person_days": outcomes.OUTPUT_NAME,
                "person_days_sha256": sha256(self.person_days),
                "person_days_size_bytes": self.person_days.stat().st_size,
            },
            "summary": {"supported_alternatives": counts},
        }, sort_keys=True))


class MandatoryTourCandidateRegistryTests(unittest.TestCase):
    def test_freezes_nested_regularized_geographic_protocol(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = CandidateRegistryFixture(Path(temporary))
            result = candidate.build_registry(fixture.outcomes_dir, fixture.prereg_path)

        self.assertEqual(result["status"], candidate.STATUS)
        self.assertFalse(result["acceptance_outcomes_read"])
        self.assertEqual(
            result["candidate_model"]["alternatives"], list(candidate.ALTERNATIVES)
        )
        self.assertEqual(result["candidate_model"]["reference_alternative"], "work1")
        self.assertIn(
            "zero reproduces the reference probabilities exactly",
            result["candidate_model"]["nesting_proof"],
        )
        self.assertTrue(all(value > 0 for value in result["estimation"]["lambda_grid"]))
        self.assertEqual(
            result["development_selection"]["division_codes"], DEVELOPMENT_CODES
        )
        self.assertEqual(
            result["development_selection"]["development_gate"][
                "minimum_division_log_loss_wins"
            ],
            4,
        )
        self.assertFalse(result["development_selection"]["acceptance_information_allowed"])

    def test_locks_only_predictors_with_matching_runtime_meanings(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = CandidateRegistryFixture(Path(temporary))
            result = candidate.build_registry(fixture.outcomes_dir, fixture.prereg_path)

        self.assertEqual(
            [row["name"] for row in result["candidate_model"]["predictors"]],
            [
                "age_centered_decades",
                "age_centered_decades_squared",
                "female",
                "household_size_minus_one_clip_4",
                "workers_clip_3",
                "vehicles_clip_4",
                "no_vehicle",
            ],
        )
        excluded = result["candidate_model"]["excluded_predictors"]
        self.assertEqual(
            set(excluded),
            {
                "DRVRCNT",
                "URBRUR",
                "linked_roster_R_AGE_young_children",
                "HHFAMINC_IMP",
                "regional_or_LOS_fields",
            },
        )
        self.assertIn("year-2000", excluded["HHFAMINC_IMP"])
        self.assertIn("age 0-5", excluded["linked_roster_R_AGE_young_children"])

    def test_invalid_candidate_predictor_stays_in_scores_as_reference(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = CandidateRegistryFixture(Path(temporary))
            fixture.rows[0]["sex_code"] = "-7"
            fixture.write_outcomes()
            result = candidate.build_registry(fixture.outcomes_dir, fixture.prereg_path)

        self.assertEqual(
            result["development_inventory"]["candidate_predictor_invalid_records"], 1
        )
        self.assertEqual(
            result["development_inventory"][
                "candidate_predictor_invalid_records_by_division"
            ]["01"],
            1,
        )
        self.assertIn(
            "use the reference probabilities",
            result["candidate_model"]["invalid_predictor_row_rule"],
        )

    def test_refuses_acceptance_division_even_with_forged_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = CandidateRegistryFixture(Path(temporary))
            fixture.rows.append(supported_row("05", "work1", 99))
            fixture.write_outcomes()
            with self.assertRaisesRegex(
                candidate.MandatoryTourCandidateRegistryError,
                "locked acceptance divisions: 05",
            ):
                candidate.build_registry(fixture.outcomes_dir, fixture.prereg_path)

    def test_refuses_changed_person_days(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = CandidateRegistryFixture(Path(temporary))
            original = fixture.person_days.read_bytes()
            fixture.person_days.write_bytes(original.replace(b"h-01-1", b"x-01-1", 1))
            self.assertEqual(fixture.person_days.stat().st_size, len(original))
            with self.assertRaisesRegex(
                candidate.MandatoryTourCandidateRegistryError,
                "changed after reconstruction",
            ):
                candidate.build_registry(fixture.outcomes_dir, fixture.prereg_path)

    def test_refuses_manifest_from_another_preregistration(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = CandidateRegistryFixture(Path(temporary))
            prereg = json.loads(fixture.prereg_path.read_text())
            prereg["reference_model"]["additive_smoothing_alpha"] = 0.25
            fixture.prereg_path.write_text(json.dumps(prereg, sort_keys=True))
            with self.assertRaisesRegex(
                candidate.MandatoryTourCandidateRegistryError,
                "exact preregistration",
            ):
                candidate.build_registry(fixture.outcomes_dir, fixture.prereg_path)

    def test_refuses_to_rewrite_a_different_protocol(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = CandidateRegistryFixture(root)
            registry = candidate.build_registry(fixture.outcomes_dir, fixture.prereg_path)
            output = root / "candidate.json"
            candidate.write_registry(registry, output)
            candidate.write_registry(registry, output)
            changed = dict(registry)
            changed["status"] = "changed"
            with self.assertRaisesRegex(
                candidate.MandatoryTourCandidateRegistryError,
                "rewriting is forbidden",
            ):
                candidate.write_registry(changed, output)

    def test_checked_in_registry_matches_exact_development_artifacts(self):
        path = (
            REPO_ROOT
            / "data/modeling/mandatory-tour-frequency-candidate-registry-2026-08-19.json"
        )
        result = json.loads(path.read_text())
        outcome_manifest = json.loads((
            REPO_ROOT
            / "data/modeling/mandatory-tour-frequency-development-outcomes-2026-08-19.json"
        ).read_text())
        prereg_path = (
            REPO_ROOT
            / "data/modeling/mandatory-tour-frequency-preregistration-2026-08-19.json"
        )
        self.assertEqual(result["schema_version"], candidate.SCHEMA_VERSION)
        self.assertEqual(result["status"], candidate.STATUS)
        self.assertEqual(result["source"]["preregistration_sha256"], sha256(prereg_path))
        self.assertEqual(
            result["source"]["development_person_days_sha256"],
            outcome_manifest["outputs"]["person_days_sha256"],
        )
        self.assertEqual(
            result["source"]["development_outcome_manifest_sha256"],
            sha256(
                REPO_ROOT
                / "data/modeling/mandatory-tour-frequency-development-outcomes-2026-08-19.json"
            ),
        )
        self.assertEqual(
            result["source"]["outcome_reconstruction_closure_sha256"],
            outcome_manifest["implementation"]["closure_sha256"],
        )
        self.assertEqual(
            result["development_inventory"]["supported_records"], 2083
        )
        self.assertEqual(
            result["development_inventory"]["candidate_predictor_invalid_records"], 26
        )
        self.assertFalse(result["acceptance_outcomes_read"])

    def test_v2_registry_locks_the_shared_reconstruction_without_changing_person_days(self):
        registry_path = (
            REPO_ROOT
            / "data/modeling/mandatory-tour-frequency-candidate-registry-v2-2026-08-19.json"
        )
        outcome_path = (
            REPO_ROOT
            / "data/modeling/mandatory-tour-frequency-development-outcomes-v2-2026-08-19.json"
        )
        result = json.loads(registry_path.read_text())
        outcome_manifest = json.loads(outcome_path.read_text())
        self.assertEqual(outcome_manifest["schema_version"], outcomes.SCHEMA_VERSION)
        self.assertEqual(outcome_manifest["partition_role"], "development")
        self.assertIsNone(outcome_manifest["source"]["opening_lock_sha256"])
        self.assertEqual(
            outcome_manifest["implementation"], outcomes._implementation_record()
        )
        self.assertEqual(
            outcome_manifest["outputs"]["person_days_sha256"],
            "338133f2f1a3db178f4eb4e45a6f2e4fa75c78ae56085e6d1b2ce75713106b50",
        )
        self.assertEqual(
            result["source"]["development_outcome_manifest_sha256"],
            sha256(outcome_path),
        )
        self.assertEqual(
            result["source"]["development_person_days_sha256"],
            outcome_manifest["outputs"]["person_days_sha256"],
        )
        self.assertEqual(
            result["source"]["outcome_reconstruction_closure_sha256"],
            outcome_manifest["implementation"]["closure_sha256"],
        )
        self.assertEqual(result["development_inventory"]["supported_records"], 2083)
        self.assertEqual(
            result["development_inventory"]["candidate_predictor_invalid_records"],
            26,
        )
        self.assertFalse(result["acceptance_outcomes_read"])


if __name__ == "__main__":
    unittest.main()
