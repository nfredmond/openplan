#!/usr/bin/env python3
"""Checks for the pure calibration engine.

Stdlib-only (count_validation is stdlib):

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_calibration.py

Load-bearing invariants: the holdout is deterministic and never fits itself; a
class the model under-assigns gets factor > 1 and vice versa; and the overfit
guard rejects any step that degrades the out-of-sample holdout.
"""
import sys
import ast
from pathlib import Path

import calibration as cal
import count_validation as cv


def _st(sid, route, obs, mod, lt="motorway"):
    return {"station_id": sid, "facility_name": route, "observed_volume": obs,
            "modeled_daily_pce": mod, "matched_link_type": lt}


def test_holdout_deterministic_and_disjoint():
    sts = [_st(f"S{i}", "SR 20" if i % 2 else "SR 49", 10000 + i, 9000 + i) for i in range(10)]
    fit1, hold1 = cal.split_holdout(sts, holdout_frac=0.3, seed=42)
    fit2, hold2 = cal.split_holdout(sts, holdout_frac=0.3, seed=42)
    ids = lambda xs: sorted(x["station_id"] for x in xs)
    assert ids(fit1) == ids(fit2) and ids(hold1) == ids(hold2), "must be seed-deterministic"
    assert set(ids(fit1)).isdisjoint(ids(hold1)), "fit/holdout must be disjoint"
    assert len(fit1) + len(hold1) == 10
    assert 1 <= len(hold1) <= 5, ("~30% held out", len(hold1))


def test_holdout_stratified_never_empties_a_route():
    # SR 174 has 2 stations — at most 1 may be held out (>=1 stays in fit).
    sts = [_st("A", "SR 20", 1, 1), _st("B", "SR 20", 1, 1), _st("C", "SR 20", 1, 1),
           _st("D", "SR 174", 1, 1), _st("E", "SR 174", 1, 1)]
    fit, hold = cal.split_holdout(sts, holdout_frac=0.5, seed=7)
    fit_routes = {s["facility_name"] for s in fit}
    assert "SR 174" in fit_routes and "SR 20" in fit_routes


def test_holdout_empty_input():
    assert cal.split_holdout([]) == ([], [])


def test_holdout_never_empty_when_all_routes_distinct():
    # Every station a distinct facility_name = all singleton strata. The
    # stratified pass would hold out nothing; the global fallback must still
    # yield a real holdout, or a 'calibrated' claim would have no out-of-sample
    # validation behind it.
    sts = [_st(f"S{i}", f"Route {i}", 10000, 9000) for i in range(6)]
    fit, hold = cal.split_holdout(sts, holdout_frac=0.30)
    assert len(hold) >= 1 and len(fit) >= 1 and len(fit) + len(hold) == 6
    # single station genuinely cannot support a holdout
    assert cal.split_holdout([_st("only", "R", 1, 1)]) == ([_st("only", "R", 1, 1)], [])


def test_holdout_independent_of_input_order():
    sts = [_st(f"S{i}", "SR 20" if i % 2 else "SR 49", 10000 + i, 9000 + i) for i in range(10)]
    _, hold_fwd = cal.split_holdout(sts, seed=99)
    _, hold_rev = cal.split_holdout(list(reversed(sts)), seed=99)
    ids = lambda xs: sorted(x["station_id"] for x in xs)
    assert ids(hold_fwd) == ids(hold_rev), "split must not depend on arrival order"


def test_geh_on_average_hourly_basis():
    # geh_mean must match count_validation's daily/24 basis, not raw daily GEH
    # (~4.9x larger). Uniform 10% error at AADT 24000.
    ev = cal.evaluate([_st("s", "SR 20", 24000, 26400)])
    ref = cv.geh_statistic(24000 / 24.0, 26400 / 24.0)
    assert abs(ev["geh_mean"] - round(ref, 2)) < 0.02, (ev["geh_mean"], ref)
    assert ev["geh_mean"] < 5.0, "10% error at 24k AADT is GEH~3 (hourly), not ~15 (daily)"


def test_class_factor_direction():
    # motorway under-assigned (obs>mod -> factor>1); secondary over-assigned (<1).
    matched = [
        _st("m1", "SR 20", 40000, 20000, "motorway"),   # ratio 2.0
        _st("m2", "SR 20", 30000, 15000, "motorway"),   # ratio 2.0
        _st("s1", "SR 174", 5000, 10000, "secondary"),  # ratio 0.5
    ]
    f = cal.class_adjustment_factors(matched, gamma=1.0)
    assert f["motorway"] > 1.0 and f["secondary"] < 1.0, f
    # damping: gamma=0.5 pulls factors toward 1 vs gamma=1.0
    fd = cal.class_adjustment_factors(matched, gamma=0.5)
    assert 1.0 < fd["motorway"] < f["motorway"], (fd, f)


def test_class_factor_clip_and_skip():
    matched = [_st("m1", "SR 20", 100000, 100, "motorway")]  # ratio 1000 -> clip to hi
    f = cal.class_adjustment_factors(matched, gamma=1.0, hi=2.0)
    assert f["motorway"] == 2.0, f
    # a class with no usable (obs>0,mod>0) station is absent
    bad = [{"observed_volume": 0, "modeled_daily_pce": 0, "matched_link_type": "primary"}]
    assert "primary" not in cal.class_adjustment_factors(bad)


def test_compose_factors_accumulates_and_clips():
    base = {"motorway": 1.5}
    out = cal.compose_factors(base, {"motorway": 1.5, "secondary": 0.8})
    assert abs(out["motorway"] - 2.25) < 1e-9 and abs(out["secondary"] - 0.8) < 1e-9, out
    # total clip
    capped = cal.compose_factors({"motorway": 4.0}, {"motorway": 4.0}, hi=5.0)
    assert capped["motorway"] == 5.0


def test_objective_lower_is_better():
    good = cal.calibration_objective([(10000, 10200), (5000, 4900)])
    bad = cal.calibration_objective([(10000, 30000), (5000, 500)])
    assert good < bad, (good, bad)
    assert cal.calibration_objective([]) is None


def test_evaluate_matches_known_ape():
    # single station 20% over -> median APE 20
    ev = cal.evaluate([_st("s", "SR 20", 10000, 12000)])
    assert ev["n"] == 1 and abs(ev["median_ape"] - 20.0) < 1e-6, ev


def test_calibration_step_acceptance_contract():
    previous = {"median_ape": 40.0}
    improved = {"median_ape": 39.0}
    verdict = cal.evaluate_calibration_step(0.5007, 0.4016, previous, improved, 0.0001)
    assert verdict == {"accepted": True, "reason": "accepted"}, verdict

    assert cal.evaluate_calibration_step(0.40, 0.40, previous, previous, 0.0) == {
        "accepted": False,
        "reason": "objective_not_improved",
    }
    assert cal.evaluate_calibration_step(0.40, 0.39995, previous, improved, 0.0001) == {
        "accepted": False,
        "reason": "objective_not_improved",
    }


def test_blended_improvement_cannot_hide_worse_median_ape():
    # The measured probe: the blend looks materially better, but the metric the
    # screening claim is graded on worsens by four percentage points.
    verdict = cal.evaluate_calibration_step(
        0.5007,
        0.4016,
        {"median_ape": 40.0},
        {"median_ape": 44.0},
        0.0001,
    )
    assert verdict == {"accepted": False, "reason": "gate_metric_worsened"}, verdict


def test_calibration_step_fails_closed_when_evidence_is_missing():
    cases = (
        (None, 0.3, {"median_ape": 40.0}, {"median_ape": 35.0}),
        (0.4, None, {"median_ape": 40.0}, {"median_ape": 35.0}),
        (0.4, 0.3, {"median_ape": None}, {"median_ape": 35.0}),
        (0.4, 0.3, {"median_ape": 40.0}, {"median_ape": None}),
    )
    for previous, trial, previous_metrics, trial_metrics in cases:
        assert cal.evaluate_calibration_step(
            previous, trial, previous_metrics, trial_metrics, 0.0001
        ) == {"accepted": False, "reason": "unmeasurable"}


def test_both_drivers_route_every_acceptance_site_through_the_shared_verdict():
    """The drivers may differ in assignment plumbing, never in acceptance."""
    repo = Path(__file__).resolve().parents[2]
    expected = {
        repo / "scripts/modeling/calibrate_to_counts.py": {"calibrate": 3},
        repo / "workers/aequilibrae_worker/main.py": {
            "_run_calibration": 1,
            "_run_demand_nudge": 1,
        },
    }
    for path, function_counts in expected.items():
        tree = ast.parse(path.read_text())
        functions = {
            node.name: node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        for function_name, expected_count in function_counts.items():
            calls = [
                node
                for node in ast.walk(functions[function_name])
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "calibration"
                and node.func.attr == "evaluate_calibration_step"
            ]
            assert len(calls) == expected_count, (path.name, function_name, len(calls))
            assert all(len(call.args) == 5 and not call.keywords for call in calls)


def test_demand_nudge_direction_and_weighting():
    import numpy as np
    n = 3
    # link A (under-counted, ratio 1.5) fed by cell (0,1); link B (over-counted,
    # ratio 0.5) fed by cell (0,2). Cell (1,2) feeds neither -> stays 1.0.
    slA = np.zeros((n, n)); slA[0, 1] = 100.0
    slB = np.zeros((n, n)); slB[0, 2] = 100.0
    mult = cal.demand_nudge_multipliers({"A": slA, "B": slB}, {"A": 1.5, "B": 0.5}, n, gamma=1.0)
    assert abs(mult[0, 1] - 1.5) < 1e-9, mult          # under-counted -> boosted
    assert abs(mult[0, 2] - 0.5) < 1e-9, mult          # over-counted -> shed
    assert mult[1, 2] == 1.0 and mult[2, 0] == 1.0      # no counted link -> prior


def test_demand_nudge_flow_weighted_average():
    import numpy as np
    n = 2
    # cell (0,1) feeds link A (ratio 2.0) with flow 75 and link B (ratio 1.0)
    # with flow 25 -> weighted ratio = (75*2 + 25*1)/100 = 1.75.
    slA = np.zeros((n, n)); slA[0, 1] = 75.0
    slB = np.zeros((n, n)); slB[0, 1] = 25.0
    mult = cal.demand_nudge_multipliers({"A": slA, "B": slB}, {"A": 2.0, "B": 1.0}, n, gamma=1.0)
    assert abs(mult[0, 1] - 1.75) < 1e-9, mult


def test_demand_nudge_damping_and_clip():
    import numpy as np
    n = 2
    sl = np.zeros((n, n)); sl[0, 1] = 10.0
    # ratio 4.0, gamma 0.5 -> 2.0, then clip hi=1.5 -> 1.5
    mult = cal.demand_nudge_multipliers({"A": sl}, {"A": 4.0}, n, gamma=0.5, hi=1.5)
    assert abs(mult[0, 1] - 1.5) < 1e-9, mult
    # gamma 0.5 damps a ratio of 4 to 2 before the (higher) clip
    mult2 = cal.demand_nudge_multipliers({"A": sl}, {"A": 4.0}, n, gamma=0.5, hi=3.0)
    assert abs(mult2[0, 1] - 2.0) < 1e-9, mult2


def test_demand_nudge_ignores_bad_inputs():
    import numpy as np
    n = 2
    sl = np.zeros((n, n)); sl[0, 1] = 10.0
    # missing/zero ratio -> that link contributes nothing; result all 1.0
    mult = cal.demand_nudge_multipliers({"A": sl}, {"A": 0.0}, n)
    assert np.all(mult == 1.0), mult
    # wrong-shape SL matrix skipped without crashing
    mult2 = cal.demand_nudge_multipliers({"A": np.zeros((3, 3))}, {"A": 2.0}, n)
    assert np.all(mult2 == 1.0), mult2


if __name__ == "__main__":
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} calibration checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
