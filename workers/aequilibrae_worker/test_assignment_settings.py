#!/usr/bin/env python3
"""The measured assignment profile reaches every worker equilibrium run."""
from __future__ import annotations

import ast
import hashlib
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

WORKER_DIR = Path(__file__).resolve().parent
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

import assignment_settings as assignment_settings_module  # noqa: E402
from assignment_settings import (  # noqa: E402
    AssignmentSettingsError,
    DEFENSIBLE_MAX_ITERATIONS,
    DEFENSIBLE_TARGET_GAP,
    assignment_convergence_record,
    assignment_iteration_count,
    assignment_profile_payload_json,
    assignment_profile_digest,
    build_traffic_assignment,
    canonical_assignment_profile,
    canonical_convergence_record,
    require_matching_assignment_profiles,
    resolve_assignment_profile,
)


class FakeTrafficClass:
    def __init__(self) -> None:
        self.pce = None

    def set_pce(self, value):
        self.pce = value


class FakeAssignment:
    def __init__(self) -> None:
        self.classes = []

    def add_class(self, traffic_class):
        self.classes.append(traffic_class)

    def set_cores(self, value):
        self.cores = value

    def set_vdf(self, value):
        self.vdf = value

    def set_vdf_parameters(self, value):
        self.vdf_parameters = value

    def set_capacity_field(self, value):
        self.capacity_field = value

    def set_time_field(self, value):
        self.time_field = value

    def set_algorithm(self, value):
        self.algorithm = value


class ClampedCoreAssignment(FakeAssignment):
    def set_cores(self, _value):
        self.cores = 1


class AssignmentProfileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine_version = (
            assignment_settings_module.installed_assignment_engine_version()
            or "test-only-aequilibrae"
        )
        self.version_patch = mock.patch.object(
            assignment_settings_module,
            "installed_assignment_engine_version",
            return_value=self.engine_version,
        )
        self.version_patch.start()

    def tearDown(self) -> None:
        self.version_patch.stop()

    def test_default_is_the_measured_tight_profile(self) -> None:
        profile = resolve_assignment_profile({})
        self.assertEqual(profile["target_gap"], 0.0005)
        self.assertEqual(profile["max_iterations"], 3000)
        self.assertEqual(profile["cores"], 1)
        self.assertEqual(profile["algorithm"], "bfw")
        self.assertEqual(profile["vdf"], "BPR")
        self.assertEqual(profile["engine"], "aequilibrae")
        self.assertEqual(profile["engine_version"], self.engine_version)
        self.assertIs(type(profile["vdf_parameters"]["beta"]), int)
        self.assertIs(type(profile["class_pce"]), int)

    def test_environment_may_only_tighten(self) -> None:
        profile = resolve_assignment_profile(
            {
                "OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.0002",
                "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS": "5000",
                "AEQ_CORES": "4",
            }
        )
        self.assertEqual(profile["target_gap"], 0.0002)
        self.assertEqual(profile["max_iterations"], 5000)
        self.assertEqual(profile["cores"], 4)

        for env in (
            {"OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.01"},
            {"OPENPLAN_ASSIGNMENT_MAX_ITERATIONS": "2999"},
            {"AEQ_CORES": "0"},
            {"AEQ_CORES": "not-an-integer"},
        ):
            with self.subTest(env=env), self.assertRaises(AssignmentSettingsError):
                resolve_assignment_profile(env)

    def test_builder_applies_the_whole_profile(self) -> None:
        profile = resolve_assignment_profile({})
        classes = [FakeTrafficClass(), FakeTrafficClass()]
        assignment = build_traffic_assignment(
            FakeAssignment,
            classes,
            profile={**profile, "cores": 4},
        )
        self.assertEqual(assignment.classes, classes)
        self.assertEqual([traffic_class.pce for traffic_class in classes], [1.0, 1.0])
        self.assertEqual(assignment.cores, 4)
        self.assertEqual(assignment.vdf, "BPR")
        self.assertEqual(assignment.vdf_parameters, {"alpha": 0.15, "beta": 4.0})
        self.assertEqual(assignment.capacity_field, "capacity")
        self.assertEqual(assignment.time_field, "travel_time")
        self.assertEqual(assignment.max_iter, 3000)
        self.assertEqual(assignment.rgap_target, 0.0005)
        self.assertEqual(assignment.algorithm, "bfw")

    def test_builder_refuses_an_unknown_or_different_local_engine(self) -> None:
        profile = resolve_assignment_profile({})
        for local_version in (None, "different-version"):
            with (
                self.subTest(local_version=local_version),
                mock.patch.object(
                    assignment_settings_module,
                    "installed_assignment_engine_version",
                    return_value=local_version,
                ),
                self.assertRaises(AssignmentSettingsError),
            ):
                build_traffic_assignment(FakeAssignment, [FakeTrafficClass()], profile=profile)

    def test_builder_refuses_when_the_engine_clamps_the_core_count(self) -> None:
        profile = {**resolve_assignment_profile({}), "cores": 4}
        with self.assertRaisesRegex(AssignmentSettingsError, "effective 1"):
            build_traffic_assignment(
                ClampedCoreAssignment,
                [FakeTrafficClass()],
                profile=profile,
            )

    def test_iteration_reader_prefers_iter_then_uses_legacy_iteration(self) -> None:
        self.assertEqual(
            assignment_iteration_count(SimpleNamespace(iter=23, iteration=99)),
            23,
        )
        self.assertEqual(assignment_iteration_count(SimpleNamespace(iteration=41)), 41)
        self.assertIsNone(assignment_iteration_count(SimpleNamespace()))

    def test_convergence_record_carries_verified_profile(self) -> None:
        profile = resolve_assignment_profile({})
        record = assignment_convergence_record(0.0004, 2875, profile)
        self.assertTrue(record["converged"])
        self.assertEqual(record["target_gap"], DEFENSIBLE_TARGET_GAP)
        self.assertEqual(record["max_iterations"], DEFENSIBLE_MAX_ITERATIONS)
        self.assertEqual(record["algorithm"], "bfw")
        self.assertEqual(record["assignment_profile"], profile)
        self.assertEqual(
            record["assignment_profile_payload_json"],
            assignment_profile_payload_json(profile),
        )
        self.assertEqual(record["assignment_profile_digest"], assignment_profile_digest(profile))

        invalid = assignment_convergence_record(-0.1, 100, profile)
        self.assertIsNone(invalid["final_gap"])
        self.assertFalse(invalid["converged"])
        unknown_iterations = assignment_convergence_record(0.0004, None, profile)
        self.assertIsNone(unknown_iterations["iterations"])

    def test_profile_handoff_refuses_missing_tampered_or_different_records(self) -> None:
        profile = resolve_assignment_profile({})
        first = assignment_convergence_record(0.0004, 2000, profile)
        second = assignment_convergence_record(0.0003, 1800, profile)
        _, payload, digest = require_matching_assignment_profiles(first, second, "test")
        self.assertEqual(payload, assignment_profile_payload_json(profile))
        self.assertEqual(digest, assignment_profile_digest(profile))

        with self.assertRaises(AssignmentSettingsError):
            require_matching_assignment_profiles(first, None, "test")

        tampered = {**second, "target_gap": 0.0004}
        with self.assertRaises(AssignmentSettingsError):
            require_matching_assignment_profiles(first, tampered, "test")

        stricter_profile = resolve_assignment_profile(
            {
                "OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.0002",
                "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS": "5000",
            }
        )
        different = assignment_convergence_record(0.0001, 4000, stricter_profile)
        with self.assertRaises(AssignmentSettingsError):
            require_matching_assignment_profiles(first, different, "test")

        different_cores = assignment_convergence_record(
            0.0003,
            1800,
            {**profile, "cores": 2},
        )
        with self.assertRaises(AssignmentSettingsError):
            require_matching_assignment_profiles(first, different_cores, "test")

    def test_payload_is_authoritative_and_booleans_are_not_numeric_settings(self) -> None:
        profile = resolve_assignment_profile({})
        record = assignment_convergence_record(0.0004, 2, profile)
        noncanonical = {
            **record,
            "assignment_profile_payload_json": json.dumps(profile, sort_keys=True),
        }
        noncanonical["assignment_profile_digest"] = hashlib.sha256(
            noncanonical["assignment_profile_payload_json"].encode("utf-8")
        ).hexdigest()
        with self.assertRaisesRegex(AssignmentSettingsError, "noncanonical"):
            require_matching_assignment_profiles(record, noncanonical, "test")

        for key, value in (
            ("class_pce", True),
            ("target_gap", True),
            ("max_iterations", True),
            ("cores", True),
        ):
            with self.subTest(key=key), self.assertRaises(AssignmentSettingsError):
                canonical_assignment_profile({**profile, key: value})

        for final_gap, iterations in ((True, 2), (0.0004, True)):
            invalid = assignment_convergence_record(final_gap, iterations, profile)
            if isinstance(final_gap, bool):
                self.assertIsNone(invalid["final_gap"])
            if isinstance(iterations, bool):
                self.assertIsNone(invalid["iterations"])
            canonical_convergence_record(invalid, "test")


class ConstructorCensusTests(unittest.TestCase):
    def test_every_worker_assignment_uses_the_central_builder(self) -> None:
        production_files = sorted(
            path for path in WORKER_DIR.glob("*.py") if not path.name.startswith("test_")
        )
        direct_constructors = []
        direct_setting_writes = []
        for path in production_files:
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "TrafficAssignment"
                ):
                    direct_constructors.append((path.name, node.lineno))
                if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                    for target in targets:
                        if isinstance(target, ast.Attribute) and target.attr in {
                            "max_iter",
                            "rgap_target",
                        }:
                            direct_setting_writes.append((path.name, node.lineno, target.attr))

        self.assertEqual(
            direct_constructors,
            [],
            "TrafficAssignment must be created through build_traffic_assignment",
        )
        self.assertEqual(
            {item[0] for item in direct_setting_writes},
            {"assignment_settings.py"},
            f"assignment settings written outside their owner: {direct_setting_writes}",
        )

        main_tree = ast.parse((WORKER_DIR / "main.py").read_text())
        functions = {
            node.name: node
            for node in ast.walk(main_tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        for function_name in ("stage_assignment", "_run_calibration"):
            calls = [
                node
                for node in ast.walk(functions[function_name])
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "build_traffic_assignment"
            ]
            self.assertEqual(
                len(calls),
                1,
                f"{function_name} must construct its assignment through the central builder",
            )
            profile_keywords = [
                keyword.value
                for keyword in calls[0].keywords
                if keyword.arg == "profile"
            ]
            self.assertEqual(len(profile_keywords), 1)
            self.assertIsInstance(profile_keywords[0], ast.Name)
            self.assertEqual(
                profile_keywords[0].id,
                "assignment_profile",
                f"{function_name} must use the run's one persisted profile",
            )
            self.assertFalse(
                any(keyword.arg == "cores" for keyword in calls[0].keywords),
                f"{function_name} must take cores from the persisted profile",
            )

        for function_name in ("stage_assignment", "_run_calibration"):
            iteration_reads = [
                node
                for node in ast.walk(functions[function_name])
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "assignment_iteration_count"
            ]
            self.assertEqual(
                len(iteration_reads),
                1,
                f"{function_name} must record the engine's actual iteration counter",
            )

        stage_network_settings_calls = [
            node
            for node in ast.walk(functions["stage_assignment"])
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "assignment_network_settings"
        ]
        self.assertEqual(len(stage_network_settings_calls), 1)
        self.assertEqual(stage_network_settings_calls[0].args, [])
        stage_network_digest_calls = [
            node
            for node in ast.walk(functions["stage_assignment"])
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "network_settings_digest"
        ]
        self.assertEqual(len(stage_network_digest_calls), 1)
        self.assertIsInstance(stage_network_digest_calls[0].args[0], ast.Name)
        self.assertEqual(stage_network_digest_calls[0].args[0].id, "applied_network_settings")

        calibration_network_settings_calls = [
            node
            for node in ast.walk(functions["_run_calibration"])
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "assignment_network_settings"
        ]
        self.assertEqual(len(calibration_network_settings_calls), 3)
        call_arguments = [
            call.args[0].id
            if len(call.args) == 1 and isinstance(call.args[0], ast.Name)
            else None
            for call in calibration_network_settings_calls
        ]
        self.assertEqual(call_arguments.count("cum"), 2)
        self.assertEqual(call_arguments.count(None), 1)

        stage_returns = [
            node.value
            for node in ast.walk(functions["stage_assignment"])
            if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict)
        ]
        assignment_returns = []
        for returned in stage_returns:
            keys = {
                key.value
                for key in returned.keys
                if isinstance(key, ast.Constant) and isinstance(key.value, str)
            }
            if {"convergence", "network", "log"}.issubset(keys):
                assignment_returns.append(keys)
        self.assertEqual(len(assignment_returns), 1)
        self.assertIn("network_settings", assignment_returns[0])
        self.assertIn("network_settings_payload_json", assignment_returns[0])
        self.assertIn("network_settings_digest", assignment_returns[0])
        self.assertIn("network_state_record", assignment_returns[0])
        self.assertIn("network_state_digest", assignment_returns[0])


if __name__ == "__main__":
    unittest.main()
