#!/usr/bin/env python3
"""A vehicle crossing the study area, which this lane could not represent.

Until 2026-08-18 `build_external_gateway_matrix` sent every boundary vehicle to
a destination INSIDE the study area and drew every departing one from inside it.
A car clipping a corner of a county on an interstate became a trip to the middle
of the county plus another one back. Measured consequence: total network VMT
tracked injected boundary crossings at +0.981, so making a crossing's volume
truer made the error proportionally bigger.

The worker lane had paired same-route cordons since it was written. The rules
and the share are imported from there rather than restated here.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parents[1]
WORKER_DIR = SCRIPT_DIR.parents[1] / "workers" / "aequilibrae_worker"
for path in (str(SCRIPT_DIR), str(WORKER_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)

import screening_runtime as sr
from gateways import GATEWAY_PASSTHROUGH_SHARE


def zones(internal: int = 2, external: int = 2) -> pd.DataFrame:
    rows = []
    for i in range(internal):
        rows.append({"zone_id": i + 1, "est_population": 1000.0, "total_jobs": 500.0})
    for j in range(external):
        rows.append({"zone_id": 100 + j, "est_population": 0.0, "total_jobs": 0.0})
    return pd.DataFrame(rows)


def gateway(zone_id: int, name: str, daily: float = 10000.0) -> dict:
    return {"zone_id": zone_id, "name": name, "daily_in": daily, "daily_out": daily}


class ARouteCrossingTwiceCarriesTrafficStraightThrough(unittest.TestCase):
    def matrix(self, gateways, **kwargs) -> np.ndarray:
        return sr.build_external_gateway_matrix(gateways, zones(**kwargs))

    def test_the_two_cordons_of_one_route_exchange_trips(self) -> None:
        gws = [gateway(100, "Interstate 25"), gateway(101, "Interstate 25")]
        matrix = self.matrix(gws)
        df = zones()
        idx = {z: i for i, z in enumerate(df["zone_id"].astype(int))}
        through = matrix[idx[100], idx[101]]
        self.assertAlmostEqual(through, 10000.0 * GATEWAY_PASSTHROUGH_SHARE, places=6)

    def test_a_route_crossing_once_keeps_every_trip_internal(self) -> None:
        # Most crossings. A road that enters and does not leave has no
        # pass-through to model, and inventing one would put traffic on a
        # corridor that does not carry it.
        gws = [gateway(100, "Interstate 25"), gateway(101, "State Route 96")]
        matrix = self.matrix(gws)
        df = zones()
        idx = {z: i for i, z in enumerate(df["zone_id"].astype(int))}
        self.assertEqual(matrix[idx[100], idx[101]], 0.0)
        self.assertEqual(matrix[idx[101], idx[100]], 0.0)

    def test_an_unnamed_crossing_is_never_paired(self) -> None:
        # Two blank names are not the same route. Pairing them would route
        # traffic between two unrelated roads.
        gws = [gateway(100, ""), gateway(101, "")]
        matrix = self.matrix(gws)
        df = zones()
        idx = {z: i for i, z in enumerate(df["zone_id"].astype(int))}
        self.assertEqual(matrix[idx[100], idx[101]], 0.0)

    def test_the_internal_share_is_reduced_by_exactly_what_passes_through(self) -> None:
        # The volume is redistributed, never created: a paired cordon sends less
        # into the study area by precisely what it sends across.
        paired = self.matrix([gateway(100, "Interstate 25"), gateway(101, "Interstate 25")])
        unpaired = self.matrix([gateway(100, "Interstate 25"), gateway(101, "State Route 96")])
        df = zones()
        idx = {z: i for i, z in enumerate(df["zone_id"].astype(int))}
        internal = [idx[1], idx[2]]
        self.assertAlmostEqual(
            paired[idx[100], internal].sum(),
            unpaired[idx[100], internal].sum() * (1.0 - GATEWAY_PASSTHROUGH_SHARE),
            places=6,
        )

    def test_total_boundary_volume_is_conserved(self) -> None:
        gws = [gateway(100, "Interstate 25"), gateway(101, "Interstate 25")]
        matrix = self.matrix(gws)
        # Every trip entering is still in the matrix once, wherever it ends.
        self.assertAlmostEqual(matrix.sum(), 2 * (10000.0 + 10000.0) - 2 * 10000.0 * GATEWAY_PASSTHROUGH_SHARE, places=4)


class TheSwitchExistsToReproduceOldMeasurements(unittest.TestCase):
    def test_turning_it_off_restores_the_pre_2026_08_18_behaviour(self) -> None:
        gws = [gateway(100, "Interstate 25"), gateway(101, "Interstate 25")]
        df = zones()
        idx = {z: i for i, z in enumerate(df["zone_id"].astype(int))}
        original = sr.EXTERNAL_PASSTHROUGH
        try:
            sr.EXTERNAL_PASSTHROUGH = False
            matrix = sr.build_external_gateway_matrix(gws, df)
        finally:
            sr.EXTERNAL_PASSTHROUGH = original
        self.assertEqual(matrix[idx[100], idx[101]], 0.0)

    def test_it_is_on_by_default_because_the_worker_lane_has_it(self) -> None:
        # The lanes disagreeing about whether a vehicle can cross a county is
        # the defect. Defaulting this off would preserve it.
        self.assertTrue(sr.EXTERNAL_PASSTHROUGH)


if __name__ == "__main__":
    unittest.main(verbosity=1)
