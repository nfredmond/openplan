#!/usr/bin/env python3
"""Dependency-free checks for the screening CO2e estimator.

Run: python3 workers/aequilibrae_worker/test_emissions.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import emissions as em  # noqa: E402


def test_rate_interpolates_and_clamps():
    assert em.co2e_rate_g_per_mile(2025) == 355.0            # anchor
    assert em.co2e_rate_g_per_mile(2010) == 410.0            # clamp low
    assert em.co2e_rate_g_per_mile(2060) == 120.0            # clamp high
    mid = em.co2e_rate_g_per_mile(2027)                      # between 2025 (355) and 2030 (300)
    assert 300.0 < mid < 355.0 and abs(mid - 333.0) < 1.0    # 355 - 0.4*55 = 333


def test_estimate_scales_with_vmt_and_annualizes():
    r = em.estimate_screening_emissions(1_000_000.0, population=100_000.0, analysis_year=2025)
    assert r is not None
    # 1e6 mi × 355 g/mi = 3.55e8 g = 355,000 kg/day
    assert abs(r["co2e_kg_day"] - 355_000.0) < 1.0
    # ×365 / 1000 = 129,575 metric tons/year
    assert abs(r["co2e_metric_tons_year"] - 129_575.0) < 5.0
    # per capita = 355000 / 100000 = 3.55 kg/person/day
    assert abs(r["co2e_kg_per_capita_day"] - 3.55) < 0.01
    assert r["analysis_year"] == 2025
    assert "not an EMFAC run" in r["method"].lower() or "not an emfac" in r["method"].lower()


def test_missing_or_zero_vmt_returns_none():
    assert em.estimate_screening_emissions(None) is None
    assert em.estimate_screening_emissions(0.0) is None
    assert em.estimate_screening_emissions(-5.0) is None


def test_population_optional():
    r = em.estimate_screening_emissions(500_000.0, population=None, analysis_year=2030)
    assert r is not None and r["co2e_kg_per_capita_day"] is None
    assert r["co2e_g_per_mile"] == 300.0


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} emissions checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
