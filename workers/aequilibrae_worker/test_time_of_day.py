#!/usr/bin/env python3
"""Dependency-free checks for the diurnal factors.

Run: python3 workers/aequilibrae_worker/test_time_of_day.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import time_of_day as tod  # noqa: E402


def test_peak_hour_volume_uses_k_factor():
    assert tod.peak_hour_volume(10000) == 900.0            # default K = 0.09
    assert tod.peak_hour_volume(10000, 0.10) == 1000.0
    assert tod.peak_hour_volume(0) == 0.0


def test_period_shares_sum_to_one():
    assert abs(sum(tod.PERIOD_SHARES.values()) - 1.0) < 1e-9


def test_period_volumes_split_the_daily_total():
    v = tod.period_volumes(10000)
    assert v["am_peak"] == 1300.0
    assert v["pm_peak"] == 1800.0
    assert abs(sum(v.values()) - 10000.0) < 1e-6


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} time-of-day checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
