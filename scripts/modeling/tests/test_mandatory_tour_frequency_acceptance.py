#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import inspect
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import fit_mandatory_tour_frequency_candidate as fit  # noqa: E402
import mandatory_tour_frequency_acceptance as acceptance  # noqa: E402
import mandatory_tour_frequency_acceptance_protocol as protocol_module  # noqa: E402
import mandatory_tour_frequency_candidate_registry as candidate_protocol  # noqa: E402


ROOT = SCRIPT_DIR.parents[1]
PROTOCOL_PATH = (
    ROOT / "data/modeling/mandatory-tour-frequency-acceptance-protocol-v2-2026-08-19.json"
)
MODEL_ALTERNATIVES = [
    "work1",
    "work2",
    "school1",
    "school2",
    "work_and_school",
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def model_fixture(reference=None, coefficient=0.0):
    probabilities = reference or [0.2] * 5
    cells = [name for _worker, _student, name in fit.STATUS_CELLS]
    predictors = [row["name"] for row in candidate_protocol.PREDICTORS]
    return {
        "alternatives": list(MODEL_ALTERNATIVES),
        "reference_alternative": "work1",
        "selected_regularization": 0.03,
        "reference_probabilities": {
            cell: dict(zip(MODEL_ALTERNATIVES, probabilities)) for cell in cells
        },
        "learned_coefficients": {
            alternative: {name: coefficient for name in predictors}
            for alternative in MODEL_ALTERNATIVES[1:]
        },
        "reference_alternative_learned_coefficients": {},
    }


def protocol_fixture():
    value = json.loads(PROTOCOL_PATH.read_text())
    value["acceptance_rules"]["stochastic_stability"]["alternatives"] = list(
        MODEL_ALTERNATIVES
    )
    return value


def synthetic_rows():
    rows = []
    person_number = 0
    for division in ("05", "06", "08"):
        for stratum in ("A", "B"):
            for household_number in (1, 2):
                household = f"{division}-{stratum}-{household_number}"
                for alternative_index, alternative in enumerate(MODEL_ALTERNATIVES):
                    person_number += 1
                    tours = {
                        "work1": (1, 0),
                        "work2": (2, 0),
                        "school1": (0, 1),
                        "school2": (0, 2),
                        "work_and_school": (1, 1),
                    }[alternative]
                    rows.append(
                        {
                            "household_id": household,
                            "person_id": f"person-{person_number:04d}",
                            "census_division_code": division,
                            "stratum_id": stratum,
                            "weekday_weight": 1.0,
                            "age": 30 + alternative_index,
                            "sex_code": "01" if alternative_index % 2 == 0 else "02",
                            "worker_code": "01",
                            "school_code": "02",
                            "household_size": 2,
                            "workers": 1,
                            "vehicles": 1,
                            "urban_rural_code": "01",
                            "work_tours": tours[0],
                            "school_tours": tours[1],
                            "alternative": alternative,
                            "outcome_status": "supported_alternative",
                            "exclusion_reason": "",
                        }
                    )
    return rows


def balanced_sampler(probabilities, seeds):
    choices = np.arange(len(probabilities), dtype=np.int64) % probabilities.shape[1]
    return {int(seed): choices.copy() for seed in seeds}


class FakeIndex:
    def __init__(self, values, *, name):
        self.values = np.asarray(values)
        self.name = name


class FakeFrame:
    def __init__(self, data=None, *, index):
        self.data = data
        self.index = index


class RecordingRandom:
    calls = []

    def set_base_seed(self, seed):
        self.calls.append(("set_base_seed", seed))

    def add_channel(self, name, frame):
        self.calls.append(("add_channel", name, frame.index.name, tuple(frame.index.values)))

    def begin_step(self, name):
        self.calls.append(("begin_step", name))

    def random_for_df(self, frame):
        self.calls.append(("random_for_df", frame.index.name, tuple(frame.index.values)))
        return np.full((len(frame.index.values), 1), 0.1, dtype=np.float64)

    def end_step(self, name):
        self.calls.append(("end_step", name))


def fake_environment(root: Path, *, recording=False):
    random_path = root / "random.py"
    choosing_path = root / "choosing.py"
    simulate_path = root / "simulate.py"
    logit_path = root / "logit.py"
    random_path.write_text("fake ActivitySim random implementation\n")
    choosing_path.write_text("fake ActivitySim choice implementation\n")
    simulate_path.write_text("fake ActivitySim simulation implementation\n")
    logit_path.write_text("fake ActivitySim logit implementation\n")

    def choice_maker(probabilities, random_points):
        if recording:
            RecordingRandom.calls.append(
                ("choice_maker", probabilities.shape, random_points.shape)
            )
        return np.zeros(len(probabilities), dtype=np.int64)

    return acceptance.ActivitySimEnvironment(
        activitysim_version="1.5.1",
        numpy_version="1.25.2",
        pandas_version="2.3.3",
        numba_version="0.66.0",
        scipy_version="1.16.3",
        python_version="3.11.15",
        random_path=random_path,
        choosing_path=choosing_path,
        simulate_path=simulate_path,
        logit_path=logit_path,
        random_class=RecordingRandom,
        choice_maker=choice_maker,
        dataframe_factory=FakeFrame,
        index_factory=FakeIndex,
    )


class MandatoryTourFrequencyAcceptanceMathTests(unittest.TestCase):
    def test_predictor_invalid_row_is_exact_reference_float64(self):
        rows = synthetic_rows()[:2]
        rows[1] = dict(rows[1], sex_code="unknown")
        candidate, reference = acceptance.model_probabilities(
            rows, model_fixture(coefficient=2.0)
        )
        self.assertEqual(candidate.dtype, np.float64)
        self.assertEqual(reference.dtype, np.float64)
        self.assertFalse(np.array_equal(candidate[0], reference[0]))
        np.testing.assert_array_equal(candidate[1], reference[1])

    def test_candidate_probability_rows_must_sum_to_one(self):
        rows = synthetic_rows()[:2]
        with mock.patch.object(
            acceptance,
            "_activitysim_production_probabilities",
            return_value=np.full((2, 5), 0.3, dtype=np.float64),
        ):
            with self.assertRaisesRegex(
                acceptance.MandatoryTourAcceptanceError, "sum to one"
            ):
                acceptance.model_probabilities(rows, model_fixture())

    @unittest.skipUnless(
        importlib.util.find_spec("activitysim") is not None,
        "the exact ActivitySim execution environment is not installed",
    )
    def test_locked_activitysim_execution_modules_are_exact(self):
        environment = acceptance.load_activitysim_environment()
        self.assertEqual(
            sha256(environment.simulate_path), acceptance.ACTIVITYSIM_SIMULATE_SHA256
        )
        self.assertEqual(
            sha256(environment.logit_path), acceptance.ACTIVITYSIM_LOGIT_SHA256
        )

    @unittest.skipUnless(
        importlib.util.find_spec("activitysim") is not None,
        "the exact ActivitySim execution environment is not installed",
    )
    def test_checked_package_probabilities_equal_activitysim_legacy_execution(self):
        import pandas as pd
        from activitysim.core import simulate, workflow

        package = acceptance.DEFAULT_CANDIDATE_PACKAGE
        model = acceptance.load_frozen_model(package / fit.MODEL_NAME)
        rows = [
            {
                "age": 18 + index * 7,
                "sex_code": "02" if index % 2 else "01",
                "worker_code": "01" if index % 3 else "02",
                "school_code": "01" if index % 4 < 2 else "02",
                "household_size": 1 + index % 6,
                "workers": index % 5,
                "vehicles": index % 6,
                "weekday_weight": 1.0,
            }
            for index in range(8)
        ]
        choosers = pd.DataFrame(
            {
                "age": [row["age"] for row in rows],
                "female": [row["sex_code"] == "02" for row in rows],
                "is_worker": [row["worker_code"] == "01" for row in rows],
                "is_student": [row["school_code"] == "01" for row in rows],
                "hhsize": [row["household_size"] for row in rows],
                "num_workers": [row["workers"] for row in rows],
                "auto_ownership": [row["vehicles"] for row in rows],
            },
            index=pd.Index(range(1, len(rows) + 1), name="person_id"),
        )
        captured = {}

        def capture_probabilities(state, probabilities, chooser_rows, spec, trace_label):
            captured["probabilities"] = probabilities.to_numpy(copy=True)
            return (
                pd.Series(np.zeros(len(probabilities), dtype=np.int64), index=probabilities.index),
                pd.Series(np.zeros(len(probabilities)), index=probabilities.index),
            )

        with tempfile.TemporaryDirectory() as tmp:
            state = (
                workflow.State()
                .initialize_filesystem(
                    working_dir=ROOT,
                    configs_dir=(package,),
                    data_dir=(package,),
                    output_dir=Path(tmp) / "output",
                )
                .default_settings()
            )
            state.settings.sharrow = False
            spec = state.filesystem.read_model_spec(fit.SPEC_NAME)
            coefficients = state.filesystem.read_model_coefficients(
                file_name=fit.COEFFICIENTS_NAME
            )
            executable_spec = simulate.eval_coefficients(
                state, spec, coefficients, None
            )
            simulate.simple_simulate(
                state,
                choosers,
                executable_spec,
                nest_spec=None,
                custom_chooser=capture_probabilities,
                trace_label="mandatory_tour_probability_equivalence",
            )

        scored, _reference = acceptance.model_probabilities(rows, model)
        np.testing.assert_array_equal(scored, captured["probabilities"])

    def test_transfer_family_alpha_must_come_from_the_preopen_protocol(self):
        value = protocol_fixture()
        del value["implementation_contract"]["transfer_cells"][
            "holm_family_alpha"
        ]
        with self.assertRaisesRegex(
            acceptance.MandatoryTourAcceptanceError,
            "does not record the transfer-cell Holm family alpha",
        ):
            acceptance.evaluate_acceptance_rows(
                synthetic_rows(),
                model_fixture(),
                value,
                sampler=balanced_sampler,
            )

    def test_taylor_ratio_keeps_zero_domain_psus_in_full_design(self):
        rows = [
            {
                "weekday_weight": 1,
                "census_division_code": "A",
                "stratum_id": "one",
                "household_id": household,
            }
            for household in ("h1", "h2", "h3")
        ]
        # Only h1 is in the domain. h2 and h3 must remain as zero-contribution PSUs.
        result = acceptance.taylor_ratio(rows, [2.0, 0.0, 0.0], [1.0, 0.0, 0.0])
        self.assertEqual(result.estimate, 2.0)
        self.assertEqual(result.degrees_of_freedom, 2)
        # All three linearized PSU contributions are zero for a one-record constant domain.
        self.assertEqual(result.variance, 0.0)

        varied = acceptance.taylor_ratio(rows, [2.0, 0.0, 0.0], [1.0, 1.0, 0.0])
        self.assertAlmostEqual(varied.estimate, 1.0)
        self.assertAlmostEqual(varied.variance, 0.75)

    def test_taylor_ratio_refuses_a_singleton_stratum(self):
        rows = [
            {
                "weekday_weight": 1,
                "census_division_code": "A",
                "stratum_id": "one",
                "household_id": "only-household",
            }
        ]
        with self.assertRaisesRegex(
            acceptance.MandatoryTourAcceptanceError, "singleton stratum"
        ):
            acceptance.taylor_ratio(rows, [1], [1])

    def test_coverage_denominator_is_supported_plus_out_of_support_only(self):
        rows = synthetic_rows()
        rows.extend(
            [
                {
                    **rows[0],
                    "person_id": "out-of-support",
                    "weekday_weight": 20.0,
                    "outcome_status": "out_of_support_mandatory_pattern",
                    "alternative": "",
                },
                {
                    **rows[1],
                    "person_id": "no-mandatory-pattern",
                    "weekday_weight": 1000.0,
                    "outcome_status": "no_observed_mandatory_pattern",
                    "alternative": "",
                },
            ]
        )
        result = acceptance.evaluate_acceptance_rows(
            rows, model_fixture(), protocol_fixture(), sampler=balanced_sampler
        )
        coverage = result["gates"]["outcome_coverage"]
        self.assertAlmostEqual(coverage["design_weighted_supported_share"], 60 / 80)
        self.assertNotAlmostEqual(
            coverage["design_weighted_supported_share"], 60 / 1080
        )
        self.assertEqual(
            coverage["exclusion_reasons_by_division"]["05"]["<none>"]["records"],
            2,
        )
        status_shares = coverage["statuses_by_division"]["05"]
        self.assertAlmostEqual(
            sum(value["positive_weekday_weight_share"] for value in status_shares.values()),
            1.0,
        )

    def test_total_variation_has_one_half_factor(self):
        self.assertAlmostEqual(
            acceptance._total_variation(
                np.asarray([0.6, 0.4]), np.asarray([0.5, 0.5])
            ),
            0.1,
        )

    def test_tour_gate_does_not_rescale_candidate_expectations(self):
        rows = synthetic_rows()
        model = model_fixture(reference=[0.01, 0.96, 0.01, 0.01, 0.01])
        result = acceptance.evaluate_acceptance_rows(
            rows, model, protocol_fixture(), sampler=balanced_sampler
        )
        tours = result["gates"]["tour_totals"]
        self.assertFalse(tours["rescaled"])
        self.assertAlmostEqual(
            tours["measures"]["work"]["pooled"]["candidate_expected"], 1.94
        )
        self.assertFalse(tours["measures"]["work"]["pooled"]["inside"])

    def test_holm_stops_after_the_first_nonsignificant_ordered_hypothesis(self):
        entries = [{"p_value": value} for value in (0.01, 0.06, 0.001)]
        acceptance._holm(entries, 0.05)
        self.assertTrue(entries[2]["significant_deterioration"])
        self.assertTrue(entries[0]["significant_deterioration"])
        self.assertFalse(entries[1]["significant_deterioration"])
        self.assertAlmostEqual(entries[0]["holm_threshold"], 0.025)

    def test_transfer_cells_publish_the_locked_diagnostics(self):
        rows = synthetic_rows()
        second = []
        for index, row in enumerate(rows):
            second.append(
                {
                    **row,
                    "person_id": f"copy-{index:04d}",
                    "household_id": f"copy-{row['household_id']}",
                }
            )
        result = acceptance.evaluate_acceptance_rows(
            rows + second,
            model_fixture(),
            protocol_fixture(),
            sampler=balanced_sampler,
        )
        transfer = result["gates"]["transfer_cells"]
        self.assertEqual(transfer["eligible_cells"], 1)
        cell = transfer["cells"][0]
        self.assertIn("candidate_log_loss", cell)
        self.assertIn("reference_log_loss", cell)
        self.assertEqual(
            set(cell["candidate_expected_minus_observed_shares"]),
            set(MODEL_ALTERNATIVES),
        )
        self.assertEqual(
            set(cell["reference_expected_minus_observed_shares"]),
            set(MODEL_ALTERNATIVES),
        )
        for measure in ("work", "school"):
            self.assertIn(f"candidate_{measure}_expected_minus_observed", cell)
            self.assertIn(f"reference_{measure}_expected_minus_observed", cell)

    def test_stability_refuses_a_missing_seed(self):
        rows = synthetic_rows()
        rule = protocol_fixture()["acceptance_rules"]["stochastic_stability"]
        weights = np.ones(len(rows), dtype=np.float64)
        probabilities = np.full((len(rows), 5), 0.2, dtype=np.float64)

        def missing_seed(probabilities, seeds):
            return balanced_sampler(probabilities, seeds[:-1])

        with self.assertRaisesRegex(
            acceptance.MandatoryTourAcceptanceError, "omitted or added a seed"
        ):
            acceptance._stability_check(
                rows,
                weights,
                probabilities,
                MODEL_ALTERNATIVES,
                rule,
                missing_seed,
                None,
            )

    def test_stability_interval_uses_squared_weights(self):
        rows = synthetic_rows()[:2]
        weights = np.asarray([1.0, 10.0])
        probabilities = np.full((2, 5), 0.2, dtype=np.float64)
        rule = protocol_fixture()["acceptance_rules"]["stochastic_stability"]
        result = acceptance._stability_check(
            rows,
            weights,
            probabilities,
            MODEL_ALTERNATIVES,
            rule,
            balanced_sampler,
            None,
        )
        first = result["comparisons"][0]
        measured_margin = first["upper"] - first["expected_weighted_share"]
        expected_margin = rule["normal_critical_value"] * math.sqrt(
            (1.0**2 + 10.0**2) * 0.2 * 0.8
        ) / 11.0
        self.assertAlmostEqual(measured_margin, expected_margin)

    def test_stability_requires_exact_model_order_and_bonferroni_critical(self):
        rows = synthetic_rows()
        weights = np.ones(len(rows), dtype=np.float64)
        probabilities = np.full((len(rows), 5), 0.2, dtype=np.float64)
        rule = copy.deepcopy(
            protocol_fixture()["acceptance_rules"]["stochastic_stability"]
        )
        rule["alternatives"] = list(reversed(rule["alternatives"]))
        with self.assertRaisesRegex(
            acceptance.MandatoryTourAcceptanceError, "alternative order"
        ):
            acceptance._stability_check(
                rows,
                weights,
                probabilities,
                MODEL_ALTERNATIVES,
                rule,
                balanced_sampler,
                None,
            )
        rule = copy.deepcopy(
            protocol_fixture()["acceptance_rules"]["stochastic_stability"]
        )
        rule["normal_critical_value"] = 1.96
        with self.assertRaisesRegex(
            acceptance.MandatoryTourAcceptanceError, "critical value"
        ):
            acceptance._stability_check(
                rows,
                weights,
                probabilities,
                MODEL_ALTERNATIVES,
                rule,
                balanced_sampler,
                None,
            )

    def test_scoring_requires_every_locked_acceptance_division(self):
        rows = [
            row for row in synthetic_rows() if row["census_division_code"] != "08"
        ]
        with self.assertRaisesRegex(
            acceptance.MandatoryTourAcceptanceError, "every locked acceptance division"
        ):
            acceptance.evaluate_acceptance_rows(
                rows,
                model_fixture(),
                protocol_fixture(),
                sampler=balanced_sampler,
                expected_divisions=["05", "06", "08"],
            )

    def test_scoring_requires_supported_rows_in_every_locked_division(self):
        rows = [
            (
                {
                    **row,
                    "outcome_status": "no_observed_mandatory_pattern",
                    "alternative": "",
                }
                if row["census_division_code"] == "08"
                else row
            )
            for row in synthetic_rows()
        ]
        with self.assertRaisesRegex(
            acceptance.MandatoryTourAcceptanceError,
            "Every locked acceptance division",
        ):
            acceptance.evaluate_acceptance_rows(
                rows,
                model_fixture(),
                protocol_fixture(),
                sampler=balanced_sampler,
                expected_divisions=["05", "06", "08"],
            )

    def test_every_named_gate_is_indispensable_to_acceptance(self):
        names = {
            "outcome_coverage",
            "primary_predictive_score",
            "choice_distribution",
            "tour_totals",
            "transfer_cells",
            "stochastic_stability",
        }
        for failed_name in sorted(names):
            with self.subTest(failed_name=failed_name):
                gates = {name: {"passed": name != failed_name} for name in names}
                self.assertFalse(acceptance._all_acceptance_gates_pass(gates))
        with self.assertRaisesRegex(
            acceptance.MandatoryTourAcceptanceError, "six-gate"
        ):
            acceptance._all_acceptance_gates_pass(
                {name: {"passed": True} for name in names - {"tour_totals"}}
            )

    def test_evaluator_uses_the_six_gate_aggregator(self):
        with mock.patch.object(
            acceptance, "_all_acceptance_gates_pass", return_value=False
        ) as aggregate:
            result = acceptance.evaluate_acceptance_rows(
                synthetic_rows(),
                model_fixture(),
                protocol_fixture(),
                sampler=balanced_sampler,
            )
        self.assertFalse(result["passed"])
        aggregate.assert_called_once()

    def test_activitysim_sampler_uses_frozen_channel_step_and_choice_maker(self):
        with tempfile.TemporaryDirectory() as tmp:
            RecordingRandom.calls = []
            environment = fake_environment(Path(tmp), recording=True)
            probabilities = np.full((2, 5), 0.2, dtype=np.float64)
            choices = acceptance._activitysim_choices(
                probabilities, [11], environment
            )
            np.testing.assert_array_equal(choices[11], [0, 0])
            self.assertEqual(
                RecordingRandom.calls,
                [
                    ("set_base_seed", 11),
                    ("add_channel", "persons", "person_id", (1, 2)),
                    ("begin_step", "mandatory_tour_frequency"),
                    ("random_for_df", "person_id", (1, 2)),
                    ("choice_maker", (2, 5), (2, 1)),
                    ("end_step", "mandatory_tour_frequency"),
                ],
            )


class LockedStudyFixture:
    def __init__(self, root: Path):
        self.root = root
        self.source = root / "nhts-source.zip"
        self.source.write_bytes(b"source archive bytes; tests never inspect members")
        self.preregistration = root / "preregistration.json"
        preregistration = json.loads(acceptance.DEFAULT_PREREGISTRATION.read_text())
        preregistration["source"] = {
            **preregistration["source"],
            "source_id": "synthetic-test-source",
            "archive_sha256": sha256(self.source),
            "archive_size_bytes": self.source.stat().st_size,
        }
        original_alternatives = preregistration["study_population"]["alternatives"]
        preregistration["study_population"]["alternatives"] = {
            name: original_alternatives[name] for name in MODEL_ALTERNATIVES
        }
        self.preregistration.write_text(json.dumps(preregistration))

        protocol = protocol_module.build_protocol(self.preregistration)
        self.protocol = root / "protocol.json"
        self.protocol.write_text(json.dumps(protocol))

        implementation = acceptance.outcomes._implementation_record()
        self.development_manifest = root / "development-manifest.json"
        development = {
            "schema_version": acceptance.outcomes.SCHEMA_VERSION,
            "status": "development_outcomes_only_acceptance_unopened",
            "partition_role": "development",
            "source": {
                "preregistration_sha256": sha256(self.preregistration),
                "opening_lock_sha256": None,
            },
            "implementation": implementation,
            "study_contract": {"acceptance_outcomes_read": False},
            "outputs": {"person_days_sha256": "d" * 64},
        }
        self.development_manifest.write_text(json.dumps(development))

        self.candidate_registry = root / "candidate-registry.json"
        registry = {
            "schema_version": candidate_protocol.SCHEMA_VERSION,
            "status": candidate_protocol.STATUS,
            "acceptance_outcomes_read": False,
            "source": {
                "preregistration_sha256": sha256(self.preregistration),
                "development_outcome_manifest_sha256": sha256(
                    self.development_manifest
                ),
                "outcome_reconstruction_closure_sha256": implementation[
                    "closure_sha256"
                ],
                "development_person_days_sha256": "d" * 64,
                "acceptance_division_codes_committed_but_not_read": [
                    "05",
                    "06",
                    "08",
                ],
            },
        }
        self.candidate_registry.write_text(json.dumps(registry))

        self.package = root / "candidate-package"
        self.package.mkdir()
        model = model_fixture()
        (self.package / fit.MODEL_NAME).write_text(json.dumps(model, sort_keys=True))
        fit._write_csv(
            self.package / fit.SPEC_NAME,
            fit._spec_rows(),
            ["Label", "Description", "Expression", *MODEL_ALTERNATIVES],
        )
        reference = {
            cell: [model["reference_probabilities"][cell][name] for name in MODEL_ALTERNATIVES]
            for _worker, _student, cell in fit.STATUS_CELLS
        }
        coefficient_matrix = np.asarray(
            [
                [
                    model["learned_coefficients"][alternative][predictor["name"]]
                    for predictor in candidate_protocol.PREDICTORS
                ]
                for alternative in MODEL_ALTERNATIVES[1:]
            ],
            dtype=np.float64,
        )
        fit._write_csv(
            self.package / fit.COEFFICIENTS_NAME,
            fit._coefficient_rows(reference, coefficient_matrix),
            ["coefficient_name", "value", "constrain"],
        )
        (self.package / fit.SETTINGS_NAME).write_text(
            f"SPEC: {fit.SPEC_NAME}\n"
            f"COEFFICIENTS: {fit.COEFFICIENTS_NAME}\n"
            "LOGIT_TYPE: MNL\n"
        )
        package_hashes = {
            name: sha256(self.package / name)
            for name in (
                fit.SETTINGS_NAME,
                fit.SPEC_NAME,
                fit.COEFFICIENTS_NAME,
                fit.MODEL_NAME,
            )
        }
        fit_hash = sha256(Path(fit.__file__))
        package_manifest = {
            "schema_version": fit.PACKAGE_SCHEMA_VERSION,
            "status": "candidate_not_accepted_for_production",
            "acceptance_outcomes_read": False,
            "installation_authorized": False,
            "candidate_registry_sha256": sha256(self.candidate_registry),
            "reference_model_implementation_sha256": fit_hash,
            "selected_regularization": 0.03,
            "all_data_convergence": {"converged": True},
            "files_sha256": package_hashes,
        }
        package_manifest_path = self.package / fit.PACKAGE_MANIFEST_NAME
        package_manifest_path.write_text(json.dumps(package_manifest))
        fit_manifest = {
            "schema_version": fit.SCHEMA_VERSION,
            "status": "candidate_not_accepted_for_production",
            "acceptance_outcomes_read": False,
            "implementation_sha256": fit_hash,
            "source": {
                "registry_sha256": sha256(self.candidate_registry),
                "development_outcome_manifest_sha256": sha256(
                    self.development_manifest
                ),
                "development_person_days_sha256": "d" * 64,
            },
            "development_selection": {"selected_regularization": 0.03},
            "all_development_fit": {"converged": True},
            "candidate_package": {
                "manifest_sha256": sha256(package_manifest_path),
                "files_sha256": package_hashes,
            },
        }
        (self.package / fit.FIT_MANIFEST_NAME).write_text(json.dumps(fit_manifest))
        self.receipt = root / "receipt.json"
        self.result = root / "result.json"
        self.opening_lock = root / "opening-lock.json"
        self.environment = fake_environment(root)
        lock = acceptance._build_opening_lock(
            self.source,
            preregistration_path=self.preregistration,
            protocol_path=self.protocol,
            development_manifest_path=self.development_manifest,
            candidate_registry_path=self.candidate_registry,
            candidate_package_dir=self.package,
            receipt_path=self.receipt,
            result_path=self.result,
            environment=self.environment,
        )
        acceptance.write_opening_lock(lock, self.opening_lock)

    def arguments(self):
        return {
            "preregistration_path": self.preregistration,
            "protocol_path": self.protocol,
            "development_manifest_path": self.development_manifest,
            "candidate_registry_path": self.candidate_registry,
            "candidate_package_dir": self.package,
            "receipt_path": self.receipt,
            "result_path": self.result,
        }

    def verification_arguments(self):
        return {**self.arguments(), "environment": self.environment}


class MandatoryTourFrequencyOpeningTests(unittest.TestCase):
    def test_checked_in_opening_lock_is_complete_and_still_unconsumed(self):
        lock_path = acceptance.DEFAULT_OPENING_LOCK
        lock = json.loads(lock_path.read_text())
        self.assertEqual(
            sha256(lock_path),
            "ed1a69d463aa70afa77418a5ed7b7e61cc4622fa32a31f318d42e76fcb540458",
        )
        self.assertEqual(lock["schema_version"], acceptance.OPENING_LOCK_SCHEMA_VERSION)
        self.assertEqual(lock["status"], acceptance.OPENING_LOCK_STATUS)
        self.assertEqual(lock["source"]["archive_sha256"], "64530c396d5f164d2259a22f7042f27bee5147babcd367568ddbfafe6c8bf34c")
        self.assertNotIn("archive_path", lock["source"])
        acceptance._verify_implementation_record(
            lock["evaluator"], "Checked-in evaluator"
        )
        acceptance._verify_implementation_record(
            lock["outcome_reconstruction"], "Checked-in reconstruction"
        )
        for key in (
            "preregistration_path",
        ):
            path = acceptance._resolve_recorded_path(lock["source"][key])
            self.assertEqual(sha256(path), lock["source"][key.replace("_path", "_sha256")])
        protocol_path = acceptance._resolve_recorded_path(lock["protocol"]["path"])
        self.assertEqual(sha256(protocol_path), lock["protocol"]["sha256"])
        for path_key, hash_key in (
            ("registry_path", "registry_sha256"),
            ("package_manifest_path", "package_manifest_sha256"),
            ("fit_manifest_path", "fit_manifest_sha256"),
        ):
            path = acceptance._resolve_recorded_path(lock["candidate"][path_key])
            self.assertEqual(sha256(path), lock["candidate"][hash_key])
        package_dir = acceptance._resolve_recorded_path(
            lock["candidate"]["package_manifest_path"]
        ).parent
        for filename, record in lock["candidate"]["package_files"].items():
            self.assertEqual(sha256(package_dir / filename), record["sha256"])
            self.assertEqual((package_dir / filename).stat().st_size, record["size_bytes"])
        acceptance._verify_executable_model_consistency(
            package_dir,
            json.loads((package_dir / fit.PACKAGE_MANIFEST_NAME).read_text()),
            json.loads((package_dir / fit.FIT_MANIFEST_NAME).read_text()),
        )
        self.assertEqual(
            lock["runtime"],
            {
                "activitysim_version": acceptance.ACTIVITYSIM_VERSION,
                "numpy_version": acceptance.NUMPY_VERSION,
                "pandas_version": acceptance.PANDAS_VERSION,
                "numba_version": acceptance.NUMBA_VERSION,
                "scipy_version": acceptance.SCIPY_VERSION,
                "python_version": acceptance.PYTHON_VERSION,
                "random_module": {
                    "filename": "random.py",
                    "sha256": acceptance.ACTIVITYSIM_RANDOM_SHA256,
                },
                "choosing_module": {
                    "filename": "choosing.py",
                    "sha256": acceptance.ACTIVITYSIM_CHOOSING_SHA256,
                },
                "simulate_module": {
                    "filename": "simulate.py",
                    "sha256": acceptance.ACTIVITYSIM_SIMULATE_SHA256,
                },
                "logit_module": {
                    "filename": "logit.py",
                    "sha256": acceptance.ACTIVITYSIM_LOGIT_SHA256,
                },
            },
        )
        self.assertEqual(
            lock["decision_contract"],
            {
                "result_schema_version": acceptance.RESULT_SCHEMA_VERSION,
                "evaluated_once_status": acceptance.EVALUATED_ONCE_STATUS,
                "accepted_status": acceptance.ACCEPTED_COMPONENT_STATUS,
                "rejected_status": acceptance.REJECTED_COMPONENT_STATUS,
                "scope": acceptance.COMPONENT_SCOPE,
                "candidate_package_evidence_key": (
                    "evidence_hashes.candidate_package_manifest_sha256"
                ),
            },
        )
        self.assertFalse(acceptance.DEFAULT_OPENING_RECEIPT.exists())
        self.assertFalse(acceptance.DEFAULT_ACCEPTANCE_RESULT.exists())

    def test_lock_binds_source_bytes_and_complete_numeric_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            study = LockedStudyFixture(Path(tmp))
            lock = json.loads(study.opening_lock.read_text())
            self.assertNotIn("archive_path", lock["source"])
            self.assertEqual(lock["source"]["archive_sha256"], sha256(study.source))
            self.assertEqual(
                {
                    "activitysim_version",
                    "numpy_version",
                    "pandas_version",
                    "numba_version",
                    "scipy_version",
                    "python_version",
                    "random_module",
                    "choosing_module",
                    "simulate_module",
                    "logit_module",
                },
                set(lock["runtime"]),
            )

    def test_opening_lock_refuses_one_changed_candidate_member(self):
        with tempfile.TemporaryDirectory() as tmp:
            study = LockedStudyFixture(Path(tmp))
            member = study.package / fit.SPEC_NAME
            original = member.read_text()
            member.write_text(original.replace("candidate_", "broken___", 1))
            self.assertNotEqual(member.read_text(), original)
            with self.assertRaisesRegex(
                acceptance.MandatoryTourAcceptanceError,
                "Candidate package member changed",
            ):
                acceptance._verify_opening_lock(
                    study.opening_lock,
                    study.source,
                    **study.verification_arguments(),
                )

    def test_lock_refuses_a_registry_for_another_development_person_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            study = LockedStudyFixture(Path(tmp))
            registry = json.loads(study.candidate_registry.read_text())
            registry["source"]["development_person_days_sha256"] = "e" * 64
            study.candidate_registry.write_text(json.dumps(registry))
            with self.assertRaisesRegex(
                acceptance.MandatoryTourAcceptanceError,
                "another development person-day table",
            ):
                acceptance._build_opening_lock(
                    study.source,
                    preregistration_path=study.preregistration,
                    protocol_path=study.protocol,
                    development_manifest_path=study.development_manifest,
                    candidate_registry_path=study.candidate_registry,
                    candidate_package_dir=study.package,
                    receipt_path=study.receipt,
                    result_path=study.result,
                    environment=study.environment,
                )

    def test_lock_refuses_a_scored_model_that_differs_from_activitysim_coefficients(self):
        with tempfile.TemporaryDirectory() as tmp:
            study = LockedStudyFixture(Path(tmp))
            model_path = study.package / fit.MODEL_NAME
            model = json.loads(model_path.read_text())
            model["learned_coefficients"]["work2"]["age_centered_decades"] = 0.75
            model_path.write_text(json.dumps(model, sort_keys=True))

            package_path = study.package / fit.PACKAGE_MANIFEST_NAME
            package = json.loads(package_path.read_text())
            package["files_sha256"][fit.MODEL_NAME] = sha256(model_path)
            package_path.write_text(json.dumps(package))
            fit_manifest_path = study.package / fit.FIT_MANIFEST_NAME
            fit_manifest = json.loads(fit_manifest_path.read_text())
            fit_manifest["candidate_package"]["files_sha256"] = package[
                "files_sha256"
            ]
            fit_manifest["candidate_package"]["manifest_sha256"] = sha256(
                package_path
            )
            fit_manifest_path.write_text(json.dumps(fit_manifest))

            with self.assertRaisesRegex(
                acceptance.MandatoryTourAcceptanceError,
                "coefficients differ from the scored model JSON",
            ):
                acceptance._build_opening_lock(
                    study.source,
                    preregistration_path=study.preregistration,
                    protocol_path=study.protocol,
                    development_manifest_path=study.development_manifest,
                    candidate_registry_path=study.candidate_registry,
                    candidate_package_dir=study.package,
                    receipt_path=study.receipt,
                    result_path=study.result,
                    environment=study.environment,
                )

    def test_official_evaluation_api_has_no_injected_data_or_sampler_seams(self):
        self.assertEqual(
            list(inspect.signature(acceptance.open_and_evaluate_acceptance).parameters),
            ["source_archive_path"],
        )
        self.assertEqual(
            list(inspect.signature(acceptance.build_opening_lock).parameters),
            ["source_archive_path"],
        )
        self.assertEqual(
            list(inspect.signature(acceptance.verify_opening_lock).parameters),
            ["lock_path", "source_archive_path"],
        )

    def test_one_shot_result_is_mechanically_installable_only_when_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            study = LockedStudyFixture(Path(tmp))
            study.receipt.write_text("synthetic consumed receipt\n")
            lock = json.loads(study.opening_lock.read_text())
            accepted = acceptance._result_artifact(
                lock,
                study.opening_lock,
                study.receipt,
                {"passed": True, "gates": {}},
            )
            self.assertEqual(accepted["status"], "accepted_component")
            self.assertEqual(accepted["scope"], acceptance.COMPONENT_SCOPE)
            self.assertEqual(
                accepted["evidence_hashes"][
                    "candidate_package_manifest_sha256"
                ],
                lock["candidate"]["package_manifest_sha256"],
            )
            self.assertEqual(
                accepted["evaluation_status"], acceptance.EVALUATED_ONCE_STATUS
            )
            rejected = acceptance._result_artifact(
                lock,
                study.opening_lock,
                study.receipt,
                {"passed": False, "gates": {}},
            )
            self.assertEqual(rejected["status"], "rejected_component")
            self.assertFalse(rejected["production_acceptance_passed"])

    def test_receipt_is_exclusive_precedes_source_read_and_result_is_aggregate_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            study = LockedStudyFixture(Path(tmp))
            temporary_parents = []

            def prepare_source(source, preregistration, output, **kwargs):
                self.assertTrue(study.receipt.is_file())
                self.assertFalse(study.result.exists())
                output = Path(output)
                temporary_parents.append(output.parent)
                output.mkdir()
                (output / "source-member-was-opened").write_text("after receipt")
                return {}

            def reconstruct(output, preregistration, **kwargs):
                self.assertTrue(study.receipt.is_file())
                return synthetic_rows(), {
                    "role": "acceptance",
                    "included_geography_codes": {"05", "06", "08"},
                }

            with (
                mock.patch.object(
                    acceptance,
                    "load_activitysim_environment",
                    return_value=study.environment,
                ),
                mock.patch.object(
                    acceptance.preparation,
                    "_build_partition_source",
                    side_effect=prepare_source,
                ),
                mock.patch.object(
                    acceptance.outcomes,
                    "_reconstruct_partition_outcomes",
                    side_effect=reconstruct,
                ),
                mock.patch.object(
                    acceptance,
                    "_activitysim_choices",
                    side_effect=lambda probabilities, seeds, _environment: balanced_sampler(
                        probabilities, seeds
                    ),
                ),
            ):
                result = acceptance._open_and_evaluate_acceptance(
                    study.source,
                    study.opening_lock,
                    **study.arguments(),
                )
                self.assertTrue(study.receipt.is_file())
                self.assertTrue(study.result.is_file())
                self.assertEqual(json.loads(study.result.read_text()), result)
                self.assertEqual(
                    result["evaluation_status"], acceptance.EVALUATED_ONCE_STATUS
                )
                self.assertEqual(result["scope"], acceptance.COMPONENT_SCOPE)
                rendered = study.result.read_text()
                self.assertNotIn("person_id", rendered)
                self.assertNotIn("household_id", rendered)
                self.assertTrue(temporary_parents)
                self.assertTrue(all(not path.exists() for path in temporary_parents))
                with self.assertRaisesRegex(
                    acceptance.MandatoryTourAcceptanceError, "result already exists"
                ):
                    acceptance._open_and_evaluate_acceptance(
                        study.source,
                        study.opening_lock,
                        **study.arguments(),
                    )

    def test_failure_after_receipt_consumes_the_opening(self):
        with tempfile.TemporaryDirectory() as tmp:
            study = LockedStudyFixture(Path(tmp))

            def fail_after_receipt(*args, **kwargs):
                self.assertTrue(study.receipt.is_file())
                raise RuntimeError("synthetic source failure")

            with (
                mock.patch.object(
                    acceptance,
                    "load_activitysim_environment",
                    return_value=study.environment,
                ),
                mock.patch.object(
                    acceptance.preparation,
                    "_build_partition_source",
                    side_effect=fail_after_receipt,
                ),
            ):
                with self.assertRaisesRegex(RuntimeError, "synthetic source failure"):
                    acceptance._open_and_evaluate_acceptance(
                        study.source,
                        study.opening_lock,
                        **study.arguments(),
                    )
            self.assertTrue(study.receipt.is_file())
            self.assertFalse(study.result.exists())
            with (
                mock.patch.object(
                    acceptance,
                    "load_activitysim_environment",
                    return_value=study.environment,
                ),
                mock.patch.object(
                    acceptance.preparation,
                    "_build_partition_source",
                    side_effect=fail_after_receipt,
                ),
            ):
                with self.assertRaisesRegex(
                    acceptance.MandatoryTourAcceptanceError,
                    "one-shot artifact cannot be replaced",
                ):
                    acceptance._open_and_evaluate_acceptance(
                        study.source,
                        study.opening_lock,
                        **study.arguments(),
                    )


if __name__ == "__main__":
    unittest.main()
