import csv
import hashlib
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np


SCRIPT_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import fit_mandatory_tour_frequency_candidate as fit  # noqa: E402
import mandatory_tour_frequency_candidate_registry as protocol  # noqa: E402
from test_mandatory_tour_frequency_candidate_registry import (  # noqa: E402
    CandidateRegistryFixture,
    supported_row,
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def model_row(
    *,
    choice: int,
    cell: str = "worker_not_student",
    weight: float = 1.0,
    features=None,
    division: str = "01",
):
    return {
        "division": division,
        "cell": cell,
        "choice": choice,
        "weight": weight,
        "features": [0.2, 0.04, 1.0, 2.0, 1.0, 1.0, 0.0]
        if features is None
        else features,
    }


class MandatoryTourCandidateFitTests(unittest.TestCase):
    def test_reference_uses_normalized_survey_weights_and_smoothing(self):
        rows = [
            model_row(choice=0, weight=9),
            model_row(choice=1, weight=1),
        ]
        result = fit.reference_probabilities(rows, alpha=0.5)
        # Normalized weights are 1.8 and 0.2, then alpha is added five times.
        expected = [2.3 / 4.5, 0.7 / 4.5, 0.5 / 4.5, 0.5 / 4.5, 0.5 / 4.5]
        np.testing.assert_allclose(result["worker_not_student"], expected)
        # Empty status cells use the pooled distribution rather than holdout data.
        np.testing.assert_allclose(result["not_worker_student"], expected)

    def test_zero_coefficients_exactly_reproduce_reference(self):
        rows = [
            model_row(choice=0, cell="worker_not_student"),
            model_row(choice=2, cell="not_worker_student", features=None),
        ]
        reference = {
            cell: [0.51, 0.12, 0.31, 0.03, 0.03]
            for _worker, _student, cell in fit.STATUS_CELLS
        }
        coefficients = np.zeros(
            (len(protocol.ALTERNATIVES) - 1, len(protocol.PREDICTORS))
        )
        predicted = fit.probabilities(rows, reference, coefficients)
        np.testing.assert_allclose(predicted, [reference[row["cell"]] for row in rows])

    def test_invalid_predictor_row_is_reference_for_nonzero_candidate(self):
        rows = [model_row(choice=2, cell="not_worker_student", features=None)]
        # Explicit None differs from model_row's default sentinel behavior.
        rows[0]["features"] = None
        reference = {
            cell: [0.1, 0.1, 0.7, 0.05, 0.05]
            for _worker, _student, cell in fit.STATUS_CELLS
        }
        coefficients = np.full(
            (len(protocol.ALTERNATIVES) - 1, len(protocol.PREDICTORS)), 50.0
        )
        predicted = fit.probabilities(rows, reference, coefficients)
        np.testing.assert_allclose(predicted[0], reference["not_worker_student"])

    def test_analytic_gradient_matches_central_difference(self):
        rows = [
            model_row(choice=index % 5, weight=index + 1, features=[
                index / 10,
                (index / 10) ** 2,
                float(index % 2),
                float(index % 4),
                float(index % 3),
                float(index % 5),
                float(index % 5 == 0),
            ])
            for index in range(10)
        ]
        reference = fit.reference_probabilities(rows, alpha=0.5)
        beta = np.linspace(-0.2, 0.2, 28)
        _loss, analytic = fit.objective_and_gradient(beta, rows, reference, 0.03)
        numerical = np.zeros_like(beta)
        step = 1e-6
        for index in range(len(beta)):
            high = beta.copy()
            low = beta.copy()
            high[index] += step
            low[index] -= step
            high_loss = fit.objective_and_gradient(high, rows, reference, 0.03)[0]
            low_loss = fit.objective_and_gradient(low, rows, reference, 0.03)[0]
            numerical[index] = (high_loss - low_loss) / (2 * step)
        np.testing.assert_allclose(analytic, numerical, atol=2e-8, rtol=2e-6)

    def test_fit_model_converges_and_improves_the_locked_objective(self):
        rows = []
        for index in range(120):
            signal = -1.0 if index % 2 == 0 else 1.0
            choice = 0 if signal < 0 else 1
            # Keep every rare alternative in the reference support.
            if index in {2, 4, 6}:
                choice = index // 2 + 1
            rows.append(model_row(
                choice=choice,
                features=[signal, signal * signal, 0.0, 1.0, 1.0, 1.0, 0.0],
            ))
        reference = fit.reference_probabilities(rows, alpha=0.5)
        optimizer = {
            "method": "L-BFGS-B",
            "maximum_iterations": 5000,
            "ftol": 1e-12,
            "gtol": 1e-8,
        }
        initial = np.zeros(28)
        initial_objective = fit.objective_and_gradient(
            initial, rows, reference, 0.03
        )[0]
        coefficients, convergence = fit.fit_model(
            rows, reference, regularization=0.03, optimizer=optimizer
        )
        fitted_objective = fit.objective_and_gradient(
            coefficients.reshape(-1), rows, reference, 0.03
        )[0]
        self.assertTrue(convergence["converged"])
        self.assertLess(fitted_objective, initial_objective)
        self.assertGreater(float(np.max(np.abs(coefficients))), 0.01)

    def test_selection_uses_pooled_loss_and_locked_larger_lambda_tie_break(self):
        divisions = ["01", "02", "03", "04", "07", "09"]
        rows = [model_row(choice=0, division=division) for division in divisions]
        registry = {
            "development_selection": {
                "division_codes": divisions,
                "development_gate": {"minimum_division_log_loss_wins": 4},
            },
            "reference_model": {"additive_smoothing_alpha": 0.5},
            "estimation": {
                "lambda_grid": [0.01, 0.03, 0.1, 0.3],
                "optimizer": {},
            },
        }

        def evaluate(_train, validation, *, alpha, regularization, optimizer):
            del alpha, optimizer
            division = validation[0]["division"]
            losses = {0.01: 0.92, 0.03: 0.90, 0.1: 0.90000000005, 0.3: 0.93}
            return {
                "regularization": regularization,
                "convergence": {"converged": True},
                "validation_records": 1,
                "validation_weight": 2.0,
                "reference_log_loss": 1.0,
                "candidate_log_loss": losses[regularization]
                + (0.2 if division == "09" else 0.0),
            }

        with mock.patch.object(fit, "evaluate_fold", side_effect=evaluate):
            result = fit.select_regularization(rows, registry)
        self.assertEqual(result["selected_regularization"], 0.1)
        self.assertEqual(result["selected_division_log_loss_wins"], 5)
        self.assertFalse(result["selected_is_grid_boundary"])
        self.assertTrue(result["development_gate_passed"])

    def test_selection_refuses_a_grid_boundary_winner(self):
        divisions = ["01", "02", "03", "04", "07", "09"]
        rows = [model_row(choice=0, division=division) for division in divisions]
        registry = {
            "development_selection": {
                "division_codes": divisions,
                "development_gate": {"minimum_division_log_loss_wins": 4},
            },
            "reference_model": {"additive_smoothing_alpha": 0.5},
            "estimation": {
                "lambda_grid": [0.01, 0.03, 0.1],
                "optimizer": {},
            },
        }

        def evaluate(_train, validation, *, alpha, regularization, optimizer):
            del validation, alpha, optimizer
            return {
                "regularization": regularization,
                "convergence": {"converged": True},
                "validation_records": 1,
                "validation_weight": 1.0,
                "reference_log_loss": 1.0,
                "candidate_log_loss": {0.01: 0.7, 0.03: 0.8, 0.1: 0.9}[
                    regularization
                ],
            }

        with mock.patch.object(fit, "evaluate_fold", side_effect=evaluate):
            result = fit.select_regularization(rows, registry)
        self.assertEqual(result["selected_regularization"], 0.01)
        self.assertTrue(result["selected_is_grid_boundary"])
        self.assertFalse(result["development_gate_passed"])

    def test_load_refuses_forged_acceptance_rows(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = CandidateRegistryFixture(root)
            registry = protocol.build_registry(fixture.outcomes_dir, fixture.prereg_path)
            registry_path = root / "candidate.json"
            protocol.write_registry(registry, registry_path)
            fixture.rows.append(supported_row("05", "work1", 99))
            fixture.write_outcomes()
            registry["source"]["development_outcome_manifest_sha256"] = sha256(
                fixture.manifest_path
            )
            registry["source"]["development_person_days_sha256"] = sha256(
                fixture.person_days
            )
            registry_path.write_text(json.dumps(registry))
            with self.assertRaisesRegex(
                fit.MandatoryTourFitError,
                "locked acceptance divisions: 05",
            ):
                fit.load_inputs(fixture.outcomes_dir, registry_path)

    def test_package_contains_fixed_offsets_and_no_learned_intercept(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = CandidateRegistryFixture(root)
            registry = protocol.build_registry(fixture.outcomes_dir, fixture.prereg_path)
            registry_path = root / "candidate.json"
            protocol.write_registry(registry, registry_path)
            output = root / "fit"
            selection = {
                "selected_regularization": 0.03,
                "selected_is_grid_boundary": False,
                "selected_pooled_reference_log_loss": 0.5,
                "selected_pooled_candidate_log_loss": 0.4,
                "selected_division_log_loss_wins": 5,
                "development_gate_passed": True,
                "regularization_results": [],
            }
            convergence = {
                "converged": True,
                "status": 0,
                "message": "test convergence",
                "iterations": 2,
                "objective": 0.4,
                "gradient_max_absolute": 1e-9,
            }
            coefficients = np.full((4, len(protocol.PREDICTORS)), 0.02)
            with (
                mock.patch.object(fit, "select_regularization", return_value=selection),
                mock.patch.object(
                    fit, "fit_model", return_value=(coefficients, convergence)
                ),
            ):
                result = fit.fit_candidate(
                    fixture.outcomes_dir, registry_path, output
                )

            self.assertEqual(result["status"], "candidate_not_accepted_for_production")
            package = json.loads((output / fit.PACKAGE_MANIFEST_NAME).read_text())
            self.assertFalse(package["installation_authorized"])
            self.assertFalse(package["acceptance_outcomes_read"])
            for filename, expected in package["files_sha256"].items():
                self.assertEqual(sha256(output / filename), expected)
            with (output / fit.COEFFICIENTS_NAME).open() as handle:
                coefficients_rows = list(csv.DictReader(handle))
            fixed = [row for row in coefficients_rows if row["constrain"] == "T"]
            learned = [row for row in coefficients_rows if row["constrain"] == "F"]
            self.assertEqual(len(fixed), 4 * 5)
            self.assertEqual(len(learned), 4 * len(protocol.PREDICTORS))
            self.assertFalse(any("intercept" in row["coefficient_name"] for row in learned))
            with (output / fit.SPEC_NAME).open() as handle:
                spec = list(csv.DictReader(handle))
            self.assertTrue(any(row["Expression"] == "is_worker & is_student" for row in spec))
            self.assertEqual(
                [row["Expression"] for row in spec[-len(protocol.PREDICTORS):]],
                [row["runtime"] for row in protocol.PREDICTORS],
            )

    def test_failed_development_gate_writes_no_candidate_package(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = CandidateRegistryFixture(root)
            registry = protocol.build_registry(fixture.outcomes_dir, fixture.prereg_path)
            registry_path = root / "candidate.json"
            protocol.write_registry(registry, registry_path)
            output = root / "fit"
            selection = {
                "selected_regularization": 0.01,
                "selected_is_grid_boundary": True,
                "selected_pooled_reference_log_loss": 0.5,
                "selected_pooled_candidate_log_loss": 0.4,
                "selected_division_log_loss_wins": 6,
                "development_gate_passed": False,
                "regularization_results": [],
            }
            with mock.patch.object(
                fit, "select_regularization", return_value=selection
            ):
                result = fit.fit_candidate(
                    fixture.outcomes_dir, registry_path, output
                )
            self.assertEqual(
                result["status"], "development_gate_failed_no_candidate_package"
            )
            self.assertTrue((output / fit.FIT_MANIFEST_NAME).is_file())
            self.assertFalse((output / fit.PACKAGE_MANIFEST_NAME).exists())
            self.assertFalse((output / fit.COEFFICIENTS_NAME).exists())

    def test_output_is_immutable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = CandidateRegistryFixture(root)
            registry = protocol.build_registry(fixture.outcomes_dir, fixture.prereg_path)
            registry_path = root / "candidate.json"
            protocol.write_registry(registry, registry_path)
            output = root / "already-there"
            output.mkdir()
            with mock.patch.object(fit, "select_regularization") as select:
                with self.assertRaisesRegex(
                    fit.MandatoryTourFitError, "already exists"
                ):
                    fit.fit_candidate(fixture.outcomes_dir, registry_path, output)
            select.assert_not_called()

    def test_checked_in_fit_passed_development_without_opening_acceptance(self):
        directory = (
            REPO_ROOT / "data/modeling/activitysim-mandatory-tour-frequency-national-v1"
        )
        manifest = json.loads((directory / fit.FIT_MANIFEST_NAME).read_text())
        package = json.loads((directory / fit.PACKAGE_MANIFEST_NAME).read_text())
        selection = manifest["development_selection"]
        self.assertEqual(manifest["schema_version"], fit.SCHEMA_VERSION)
        self.assertEqual(manifest["status"], "candidate_not_accepted_for_production")
        self.assertFalse(manifest["acceptance_outcomes_read"])
        self.assertEqual(
            manifest["implementation_sha256"],
            sha256(SCRIPT_DIR / "fit_mandatory_tour_frequency_candidate.py"),
        )
        self.assertEqual(
            manifest["source"]["registry_sha256"],
            sha256(
                REPO_ROOT
                / "data/modeling/mandatory-tour-frequency-candidate-registry-2026-08-19.json"
            ),
        )
        self.assertTrue(selection["development_gate_passed"])
        self.assertEqual(selection["selected_regularization"], 0.03)
        self.assertEqual(selection["selected_division_log_loss_wins"], 5)
        self.assertLess(
            selection["selected_pooled_candidate_log_loss"],
            selection["selected_pooled_reference_log_loss"],
        )
        self.assertFalse(package["installation_authorized"])
        for filename, expected in package["files_sha256"].items():
            self.assertEqual(sha256(directory / filename), expected)
        self.assertEqual(
            manifest["candidate_package"]["manifest_sha256"],
            sha256(directory / fit.PACKAGE_MANIFEST_NAME),
        )

    def test_v2_chain_preserves_the_exact_frozen_candidate(self):
        v1 = REPO_ROOT / "data/modeling/activitysim-mandatory-tour-frequency-national-v1"
        v2 = REPO_ROOT / "data/modeling/activitysim-mandatory-tour-frequency-national-v2"
        v1_manifest = json.loads((v1 / fit.FIT_MANIFEST_NAME).read_text())
        v2_manifest = json.loads((v2 / fit.FIT_MANIFEST_NAME).read_text())
        v2_package = json.loads((v2 / fit.PACKAGE_MANIFEST_NAME).read_text())
        executable_hashes = {
            fit.SPEC_NAME: "72af7533346c4e5515d62337184a1994441123ac7da89b73ac09c162c385c854",
            fit.SETTINGS_NAME: "019d835f5fa6bc3512b90507c85ea69f4dc38761adcd14ef7ea9bda92dbfa829",
            fit.COEFFICIENTS_NAME: "0ad86d0f2f97a4cb0804de1f08740e45f1825ec77e7792450f8add1db8bf01e9",
            fit.MODEL_NAME: "570fe668ad67dcaa3d27bfb736315e5a6b01248cb6bc850c050d39b97ece026f",
        }
        for filename, expected_hash in executable_hashes.items():
            self.assertEqual((v2 / filename).read_bytes(), (v1 / filename).read_bytes())
            self.assertEqual(sha256(v2 / filename), expected_hash)
            self.assertEqual(v2_package["files_sha256"][filename], expected_hash)
        self.assertEqual(
            v2_manifest["development_selection"],
            v1_manifest["development_selection"],
        )
        self.assertEqual(
            v2_manifest["all_development_fit"],
            v1_manifest["all_development_fit"],
        )
        self.assertEqual(
            v2_manifest["source"]["development_person_days_sha256"],
            "338133f2f1a3db178f4eb4e45a6f2e4fa75c78ae56085e6d1b2ce75713106b50",
        )
        self.assertEqual(
            v2_manifest["source"]["registry_sha256"],
            sha256(
                REPO_ROOT
                / "data/modeling/mandatory-tour-frequency-candidate-registry-v2-2026-08-19.json"
            ),
        )
        self.assertEqual(
            v2_manifest["source"]["development_outcome_manifest_sha256"],
            sha256(
                REPO_ROOT
                / "data/modeling/mandatory-tour-frequency-development-outcomes-v2-2026-08-19.json"
            ),
        )
        self.assertEqual(v2_manifest["development_selection"]["selected_regularization"], 0.03)
        self.assertFalse(v2_package["installation_authorized"])
        self.assertFalse(v2_package["acceptance_outcomes_read"])
        self.assertEqual(
            v2_manifest["candidate_package"]["manifest_sha256"],
            sha256(v2 / fit.PACKAGE_MANIFEST_NAME),
        )

    def test_runtime_smoke_is_execution_evidence_not_acceptance(self):
        evidence = json.loads((
            REPO_ROOT
            / "data/modeling/mandatory-tour-frequency-runtime-smoke-2026-08-19.json"
        ).read_text())
        package = (
            REPO_ROOT
            / "data/modeling/activitysim-mandatory-tour-frequency-national-v1"
            / fit.PACKAGE_MANIFEST_NAME
        )
        self.assertEqual(evidence["status"], "candidate_executed_not_accepted")
        self.assertFalse(evidence["acceptance_outcomes_read"])
        self.assertFalse(evidence["candidate"]["installation_authorized"])
        self.assertEqual(
            evidence["candidate"]["coefficient_package_sha256"], sha256(package)
        )
        self.assertEqual(
            set(evidence["output"]["mandatory_tour_frequency_choices"]),
            set(protocol.ALTERNATIVES),
        )
        self.assertEqual(
            sum(evidence["output"]["mandatory_tour_frequency_choices"].values()),
            20107,
        )
        self.assertEqual(
            evidence["output"]["work_tours"] + evidence["output"]["school_tours"],
            evidence["output"]["mandatory_tours"],
        )

    def test_v2_runtime_smoke_locks_the_actual_execution_outputs(self):
        evidence_path = (
            REPO_ROOT
            / "data/modeling/mandatory-tour-frequency-runtime-smoke-v2-2026-08-20.json"
        )
        evidence = json.loads(evidence_path.read_text())
        package = (
            REPO_ROOT
            / "data/modeling/activitysim-mandatory-tour-frequency-national-v2"
            / fit.PACKAGE_MANIFEST_NAME
        )
        self.assertEqual(
            evidence["schema_version"],
            "openplan.activitysim-mandatory-tour-frequency-runtime-smoke.v2",
        )
        self.assertEqual(evidence["status"], "candidate_executed_not_accepted")
        self.assertFalse(evidence["acceptance_outcomes_read"])
        self.assertFalse(evidence["candidate"]["installation_authorized"])
        self.assertEqual(
            evidence["candidate"]["coefficient_package_sha256"], sha256(package)
        )
        self.assertEqual(
            evidence["supersedes"]["runtime_smoke_sha256"],
            sha256(
                REPO_ROOT
                / "data/modeling/mandatory-tour-frequency-runtime-smoke-2026-08-19.json"
            ),
        )
        self.assertEqual(
            evidence["output"]["files_sha256"],
            {
                "final_households.csv": "c611db1470e46e5fec792a20676c51e906deb6b2b9b8e2437aefa031d8bc7ab0",
                "final_persons.csv": "0a08d5aa871bf95d90d438c80ef9b5f93ccb57afb040f17b3d754153ea3b2b47",
                "final_tours.csv": "dbafdade6cdef9b98d769d07b59dd25eaadc5673324049efc94b751e5be69028",
            },
        )
        self.assertEqual(
            evidence["output"]["mandatory_tour_frequency_choices"],
            {
                "work1": 11633,
                "work2": 429,
                "school1": 7792,
                "school2": 182,
                "work_and_school": 71,
            },
        )
        self.assertEqual(evidence["output"]["mandatory_tours"], 20789)
        self.assertEqual(evidence["output"]["work_tours"], 12562)
        self.assertEqual(evidence["output"]["school_tours"], 8227)

    def test_candidate_is_not_in_the_production_component_registry(self):
        accepted = json.loads((
            REPO_ROOT / "data/modeling/activitysim-accepted-components.json"
        ).read_text())
        self.assertNotIn(
            "mandatory_tour_frequency",
            {
                row["component"]
                for row in accepted["components"]
                if row["status"] == "accepted_for_production"
            },
        )


if __name__ == "__main__":
    unittest.main()
