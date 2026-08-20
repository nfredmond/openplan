#!/usr/bin/env python3
"""Every CLI assignment uses the measured tight profile and records it.

WHAT THIS GUARDS, AND WHY IT IS NOT A PREFERENCE
================================================
Measured on 2026-08-16: two screening runs whose demand differed by 0.001% were
compared link by link on the same 28,670-link network.

    total network vehicle-miles ......... matched to 0.047%
    links carrying real traffic ......... 3,891
    of those, diverging by GEH >= 10 .... 507  (13%)
    those 507 split ..................... 318 up, 189 down

Total flow preserved, individual links moving in both directions: that is flow
redistributing between near-equal-cost parallel routes, not a demand difference.
Both loose runs had stopped at a relative gap of about 0.0092. At a measured
gap of 0.00046, no busy link crossed GEH 10.

This matters because the dual-model comparison attributes a link's divergence to
the demand model. Ordinary runs publish the same link volumes, so they need the
same target. Environment settings may make the method stricter, never looser.
"""
from __future__ import annotations

import ast
import importlib
import inspect
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


def import_worker_main():
    """The worker entry point, imported the way CI can actually import it.

    Both obstacles — Supabase credentials required at import, and the
    AequilibraE engine that neither python CI job installs — are handled in one
    place, `workers/aequilibrae_worker/worker_import_for_tests.py`, because they
    used to live inside `test_activitysim_assignment_handoff.py` and this suite
    reimplemented half of them and went red in CI on the other half.
    """
    worker_dir = SCRIPT_DIR.parents[1] / "workers" / "aequilibrae_worker"
    if str(worker_dir) not in sys.path:
        sys.path.insert(0, str(worker_dir))
    from worker_import_for_tests import import_worker_main as _import  # noqa: PLC0415

    return _import()


def reload_runtime(env: dict[str, str]):
    with mock.patch.dict(os.environ, env, clear=False):
        import screening_runtime
        runtime = importlib.reload(screening_runtime)
        if runtime.installed_assignment_engine_version() is None:
            runtime.installed_assignment_engine_version = lambda: "test-only-aequilibrae"
        return runtime


class TheConvergenceSettingsStayDefensible(unittest.TestCase):
    @classmethod
    def tearDownClass(cls) -> None:
        # Leave the module as the rest of the suite expects to find it.
        for name in (
            "OPENPLAN_ASSIGNMENT_RGAP_TARGET",
            "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS",
            "AEQ_CORES",
        ):
            os.environ.pop(name, None)
        import screening_runtime

        importlib.reload(screening_runtime)

    def test_the_defaults_are_the_documented_ones(self) -> None:
        for name in (
            "OPENPLAN_ASSIGNMENT_RGAP_TARGET",
            "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS",
            "AEQ_CORES",
        ):
            os.environ.pop(name, None)
        runtime = reload_runtime({})
        self.assertEqual(runtime.ASSIGNMENT_RGAP_TARGET, 0.0005)
        self.assertEqual(runtime.ASSIGNMENT_MAX_ITERATIONS, 3000)
        self.assertEqual(runtime.ASSIGNMENT_CORES, 1)

    def test_an_operator_can_only_tighten_the_profile(self) -> None:
        runtime = reload_runtime(
            {
                "OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.0002",
                "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS": "5000",
                "AEQ_CORES": "4",
            }
        )
        self.assertEqual(runtime.ASSIGNMENT_RGAP_TARGET, 0.0002)
        self.assertEqual(runtime.ASSIGNMENT_MAX_ITERATIONS, 5000)
        self.assertEqual(runtime.ASSIGNMENT_CORES, 4)

        for env in (
            {"OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.01"},
            {"OPENPLAN_ASSIGNMENT_MAX_ITERATIONS": "2999"},
            {"AEQ_CORES": "0"},
            {"AEQ_CORES": "not-an-integer"},
        ):
            with self.subTest(env=env), self.assertRaises(ValueError):
                reload_runtime(env)
        runtime = reload_runtime({})
        self.assertEqual(runtime.ASSIGNMENT_RGAP_TARGET, 0.0005)

    def test_the_gap_a_run_reports_is_the_one_it_was_asked_for(self) -> None:
        # The recorded target must follow the setting. A run tightened to 0.0005
        # that still reports 0.01 as its target would be graded against the loose
        # threshold and called converged when it is not.
        runtime = reload_runtime({})
        verdict = runtime.assignment_convergence(0.004, 900, 3000)
        self.assertEqual(verdict["target_gap"], 0.0005)
        self.assertFalse(verdict["converged"])
        self.assertEqual(verdict["algorithm"], "bfw")
        self.assertEqual(verdict["assignment_profile"]["max_iterations"], 3000)
        self.assertEqual(verdict["assignment_profile"]["engine"], "aequilibrae")
        self.assertEqual(
            verdict["assignment_profile"]["engine_version"],
            runtime.installed_assignment_engine_version(),
        )
        self.assertIs(type(verdict["assignment_profile"]["vdf_parameters"]["beta"]), int)
        self.assertIs(type(verdict["assignment_profile"]["class_pce"]), int)
        self.assertEqual(len(verdict["assignment_profile_digest"]), 64)

    def test_a_gap_inside_the_tightened_target_is_converged(self) -> None:
        runtime = reload_runtime({})
        verdict = runtime.assignment_convergence(0.0004, 900, 3000)
        self.assertTrue(verdict["converged"])

    def test_engine_core_and_iteration_runtime_guards(self) -> None:
        runtime = reload_runtime({})
        profile = runtime.assignment_profile()
        runtime.require_local_assignment_engine(profile)
        with (
            mock.patch.object(
                runtime,
                "installed_assignment_engine_version",
                return_value="different-version",
            ),
            self.assertRaisesRegex(RuntimeError, "Refusing assignment profile"),
        ):
            runtime.require_local_assignment_engine(profile)
        with self.assertRaisesRegex(RuntimeError, "effective 1"):
            runtime.require_effective_assignment_cores(SimpleNamespace(cores=1), 4)

        self.assertEqual(
            runtime.assignment_iteration_count(SimpleNamespace(iter=17, iteration=99)),
            17,
        )
        self.assertEqual(
            runtime.assignment_iteration_count(SimpleNamespace(iteration=29)),
            29,
        )
        self.assertIsNone(runtime.assignment_iteration_count(SimpleNamespace()))

    def test_network_settings_identity_distinguishes_baseline_from_calibration(self) -> None:
        runtime = reload_runtime({})
        baseline = runtime.assignment_network_settings()
        calibrated = runtime.assignment_network_settings({"primary": 1.125})
        self.assertEqual(baseline["road_class_factors"], {})
        self.assertEqual(
            baseline["application"],
            {
                "travel_time": "baseline_travel_time / factor",
                "capacity": "baseline_capacity * factor",
            },
        )
        self.assertEqual(baseline["excludes"], ["trip_based_od_adjustments"])
        self.assertNotEqual(
            runtime.network_settings_digest(baseline),
            runtime.network_settings_digest(calibrated),
        )
        self.assertEqual(
            runtime.network_settings_payload_json(baseline),
            '{"application":{"capacity":"baseline_capacity * factor","travel_time":"baseline_travel_time / factor"},"excludes":["trip_based_od_adjustments"],"road_class_factors":{},"schema_version":"openplan.network-calibration.v1"}',
        )
        for factor in (True, False):
            with self.subTest(factor=factor), self.assertRaises(ValueError):
                runtime.assignment_network_settings({"primary": factor})

        tree = ast.parse(inspect.getsource(runtime.run_assignment))
        settings_calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "assignment_network_settings"
        ]
        self.assertEqual(len(settings_calls), 1)
        self.assertEqual(len(settings_calls[0].args), 1)
        self.assertIsInstance(settings_calls[0].args[0], ast.Name)
        self.assertEqual(settings_calls[0].args[0].id, "class_factors")
        called_names = {
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        self.assertIn("require_local_assignment_engine", called_names)
        self.assertIn("require_effective_assignment_cores", called_names)
        self.assertIn("assignment_iteration_count", called_names)
        self.assertIn("assignment_network_state", called_names)
        state_call = inspect.getsource(runtime.run_assignment)
        self.assertLess(
            state_call.index("assignment_network_state("),
            state_call.index("assignment.execute()"),
        )
        self.assertIn("export_retained_network_geojson", called_names)

    def test_worker_cli_and_comparator_policies_are_compatible_not_conflated(self) -> None:
        runtime = reload_runtime({})
        from corridor_agreement import COMPARISON_MAX_RELATIVE_GAP
        from run_agreement_study import CONVERGENCE_ENV

        worker_dir = SCRIPT_DIR.parents[1] / "workers" / "aequilibrae_worker"
        if str(worker_dir) not in sys.path:
            sys.path.insert(0, str(worker_dir))
        import assignment_settings as worker_settings

        cli_profile = runtime.assignment_profile()
        with mock.patch.object(
            worker_settings,
            "installed_assignment_engine_version",
            return_value=cli_profile["engine_version"],
        ):
            worker_profile = worker_settings.resolve_assignment_profile({})
        self.assertEqual(cli_profile, worker_profile)
        self.assertEqual(
            runtime.assignment_profile_digest(cli_profile),
            worker_settings.assignment_profile_digest(worker_profile),
        )
        self.assertEqual(
            runtime.assignment_profile_payload_json(cli_profile),
            worker_settings.assignment_profile_payload_json(worker_profile),
        )
        cli_settings = runtime.assignment_network_settings({"primary": 1.125})
        worker_settings_object = {
            "schema_version": "openplan.network-calibration.v1",
            "road_class_factors": {"primary": 1.125},
            "application": {
                "travel_time": "baseline_travel_time / factor",
                "capacity": "baseline_capacity * factor",
            },
            "excludes": ["trip_based_od_adjustments"],
        }
        self.assertEqual(cli_settings, worker_settings_object)
        self.assertEqual(
            runtime.network_settings_payload_json(cli_settings),
            json.dumps(
                worker_settings_object,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ),
        )
        self.assertEqual(runtime.ASSIGNMENT_RGAP_TARGET, worker_profile["target_gap"])
        self.assertEqual(runtime.ASSIGNMENT_MAX_ITERATIONS, worker_profile["max_iterations"])
        self.assertEqual(
            float(CONVERGENCE_ENV["OPENPLAN_ASSIGNMENT_RGAP_TARGET"]),
            worker_profile["target_gap"],
        )
        self.assertEqual(
            int(CONVERGENCE_ENV["OPENPLAN_ASSIGNMENT_MAX_ITERATIONS"]),
            worker_profile["max_iterations"],
        )
        # Requested target and acceptable final gap are different policies.
        # The target has margin inside the measured attribution ceiling.
        self.assertLess(worker_profile["target_gap"], COMPARISON_MAX_RELATIVE_GAP)

    def test_worker_and_cli_manifest_and_state_schemas_are_identical(self) -> None:
        runtime = reload_runtime({})
        worker_main = import_worker_main()

        cli_tree = ast.parse(inspect.getsource(runtime.assignment_network_state))
        record_keys = None
        for node in ast.walk(cli_tree):
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "record"
                for target in node.targets
            ) and isinstance(node.value, ast.Dict):
                record_keys = {
                    key.value
                    for key in node.value.keys
                    if isinstance(key, ast.Constant) and isinstance(key.value, str)
                }
        self.assertEqual(record_keys, set(worker_main._NETWORK_STATE_KEYS))

        with tempfile.TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            connection = sqlite3.connect(project_dir / "project_database.sqlite")
            connection.execute("CREATE TABLE links (link_id INTEGER, link_type TEXT)")
            connection.executemany(
                "INSERT INTO links VALUES (?, ?)",
                [(1, "primary"), (2, "centroid_connector")],
            )
            connection.commit()
            connection.close()
            self.assertEqual(
                runtime.retained_network_manifest(project_dir),
                worker_main.retained_network_manifest(str(project_dir)),
            )


if __name__ == "__main__":
    unittest.main()
