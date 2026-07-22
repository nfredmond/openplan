#!/usr/bin/env python3
"""Checks for the pure calibration engine.

Stdlib-only (count_validation is stdlib):

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_calibration.py

Load-bearing invariants: the holdout is deterministic and never fits itself; a
class the model under-assigns gets factor > 1 and vice versa; and the overfit
guard rejects any step that degrades the out-of-sample holdout.
"""
import sys

import calibration as cal


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


def test_accept_step_overfit_guard():
    assert cal.accept_step(0.40, 0.35) is True          # holdout improved
    assert cal.accept_step(0.40, 0.45) is False         # holdout degraded -> reject
    assert cal.accept_step(0.40, 0.40) is True          # equal (tol 0) accepted
    assert cal.accept_step(None, 0.40) is True          # first measured step
    assert cal.accept_step(0.40, None) is False         # can't validate -> reject


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
