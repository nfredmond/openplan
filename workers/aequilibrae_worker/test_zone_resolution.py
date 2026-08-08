#!/usr/bin/env python3
"""How much of a run's travel never reaches a link.

Stdlib only — run with the worker venv anyway, for consistency with the rest:

    workers/aequilibrae_worker/.venv311/bin/python workers/aequilibrae_worker/test_zone_resolution.py

WHY THIS NUMBER EXISTS. A trip on the OD matrix DIAGONAL begins and ends in the
same zone. It carries VMT — `intrazonal_miles` gives it a real distance — and it
carries NO link volume, because at this resolution there are no streets inside a
zone. So a comparison of modelled link volumes to traffic counts cannot see it.

OpenPlan's own county validation ran a 26-zone system, produced 36% intrazonal
trips, and link-level AADT comparison failed. The demand was not the reason.
Until this share was measured, nothing in the product could say so, and the only
conclusion available to a planner was that the model had failed.

The BANDING and the wording live in the app (`src/lib/models/zone-resolution.ts`)
on purpose: two definitions of one judgement are free to drift, and the app is
where a planner reads it.
"""
import sys

from resident_vmt import compute_internal_resident_vmt


def _args(od, zone_ids, gateways=()):
    """Geometry that keeps the arithmetic legible: 1 sq mi zones in a line."""
    n = len(zone_ids)
    return dict(
        od_matrix=od,
        zone_ids=zone_ids,
        centroid_lon=[-121.0 - 0.1 * i for i in range(n)],
        centroid_lat=[38.0] * n,
        area_sq_mi=[1.0] * n,
        est_population=[1000.0] * n,
        gateway_zone_ids=gateways,
    )


def test_counts_the_diagonal_and_nothing_else():
    # 10 intrazonal (the diagonal), 30 interzonal → 25%.
    od = [
        [5.0, 10.0],
        [20.0, 5.0],
    ]
    out = compute_internal_resident_vmt(**_args(od, [1, 2]))

    assert out["intrazonal_trips"] == 10.0, out["intrazonal_trips"]
    assert out["internal_trips"] == 40.0, out["internal_trips"]
    assert abs(out["intrazonal_share"] - 0.25) < 1e-9, out["intrazonal_share"]


def test_share_is_of_internal_trips_only():
    """Gateway zones leave BOTH halves of the ratio.

    The denominator has to be the resident travel this study area is modelling.
    Counting through-traffic in it would shrink the share and understate how
    much of the agency's own travel is invisible to the network — the error
    would point the reassuring way.
    """
    od = [
        [10.0, 10.0, 100.0],
        [10.0, 10.0, 100.0],
        [100.0, 100.0, 500.0],
    ]
    out = compute_internal_resident_vmt(**_args(od, [1, 2, 3], gateways=[3]))

    # Zone 3 is a gateway: its row, its column and its own diagonal are all out.
    assert out["internal_trips"] == 40.0, out["internal_trips"]
    assert out["intrazonal_trips"] == 20.0, out["intrazonal_trips"]
    assert abs(out["intrazonal_share"] - 0.5) < 1e-9, out["intrazonal_share"]


def test_a_matrix_with_no_internal_trips_reports_zero_not_a_crash():
    """No internal travel is not a fine-grained zone system.

    `0/0` must not raise, and the app treats 0.0 here together with a zero trip
    count as nothing measured rather than as a perfect score — which is why the
    trip counts travel alongside the share.
    """
    out = compute_internal_resident_vmt(**_args([[0.0, 0.0], [0.0, 0.0]], [1, 2]))

    assert out["internal_trips"] == 0.0
    assert out["intrazonal_trips"] == 0.0
    assert out["intrazonal_share"] == 0.0


def test_the_measured_precedent():
    """26 zones, 36% intrazonal — the case where link-level AADT failed."""
    n = 26
    od = [[0.0] * n for _ in range(n)]
    for i in range(n):
        od[i][i] = 36.0
        od[i][(i + 1) % n] = 64.0
    out = compute_internal_resident_vmt(**_args(od, list(range(1, n + 1))))

    assert abs(out["intrazonal_share"] - 0.36) < 1e-9, out["intrazonal_share"]
    # And the VMT it feeds still counts those trips — they are real travel, just
    # invisible to every link.
    assert out["daily_vmt"] > 0


def test_negative_and_non_finite_cells_are_skipped_by_both_counters():
    """A junk cell must not enter one counter and skip the other.

    The share is a ratio of two sums over the same loop; a cell admitted to one
    and refused by the other would silently bias it.
    """
    od = [
        [10.0, float("nan")],
        [-5.0, 10.0],
    ]
    out = compute_internal_resident_vmt(**_args(od, [1, 2]))

    assert out["internal_trips"] == 20.0, out["internal_trips"]
    assert out["intrazonal_trips"] == 20.0, out["intrazonal_trips"]
    assert out["intrazonal_share"] == 1.0, out["intrazonal_share"]


if __name__ == "__main__":
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} zone-resolution checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
