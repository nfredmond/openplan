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


class AReusedNetworkMustStillKnowItsRoads(unittest.TestCase):
    """The failure that made pass-through look like it did not matter.

    A run reusing another run's network adopts that run's gateway records, and
    every run made before 2026-08-18 recorded no road name on them. Route
    pairing then matches nothing, so a reused network quietly produces a model
    in which no vehicle can cross the study area — with the same gateway count
    and the same volumes as a fresh run.

    The first pass-through measurement came back at +0.3% because of this. That
    reads as "pass-through barely matters"; the truth was "pass-through never
    ran".
    """

    def setUp(self) -> None:
        import sqlite3
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.project = Path(self.tmp.name)
        connection = sqlite3.connect(self.project / "project_database.sqlite")
        connection.execute("CREATE TABLE links (link_id INTEGER, name TEXT)")
        connection.executemany(
            "INSERT INTO links VALUES (?, ?)",
            [(6382, "South Valley Freeway"), (77, "Pacheco Pass Highway"), (99, "")],
        )
        connection.commit()
        connection.close()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_a_name_is_recovered_from_the_network_it_came_from(self) -> None:
        summary = {"gateways": [{"link_id": 6382, "zone_id": 13}, {"link_id": 77, "zone_id": 14}]}
        filled = sr.backfill_gateway_names_from_project(summary, self.project)
        self.assertEqual(filled, 2)
        self.assertEqual(summary["gateways"][0]["name"], "South Valley Freeway")

    def test_a_gateway_that_already_has_a_name_is_left_alone(self) -> None:
        summary = {"gateways": [{"link_id": 6382, "zone_id": 13, "name": "Something Else"}]}
        self.assertEqual(sr.backfill_gateway_names_from_project(summary, self.project), 0)
        self.assertEqual(summary["gateways"][0]["name"], "Something Else")

    def test_a_link_with_no_name_stays_unnamed_rather_than_inventing_one(self) -> None:
        # An unnamed road is a real thing, and pairing two of them would route
        # traffic between unrelated crossings.
        summary = {"gateways": [{"link_id": 99, "zone_id": 15}]}
        self.assertEqual(sr.backfill_gateway_names_from_project(summary, self.project), 0)
        self.assertNotIn("name", summary["gateways"][0])

    def test_recovered_names_are_enough_to_pair_a_route(self) -> None:
        # End to end: the whole point is that pairing works afterwards.
        from gateways import pair_passthrough_cordons

        summary = {"gateways": [
            {"link_id": 77, "zone_id": 100}, {"link_id": 77, "zone_id": 101},
        ]}
        sr.backfill_gateway_names_from_project(summary, self.project)
        partners = pair_passthrough_cordons(summary["gateways"], zone_id_field="zone_id")
        self.assertEqual(sorted(partners), [100, 101])


class TheReusePathActuallyCallsTheBackfill(unittest.TestCase):
    """Because removing the CALL passed every test of the function itself.

    That is the same trap four other fixes hit today: the logic was correct,
    tested, and not reached. This drives `reuse_network_from_run` end to end
    against a minimal source run and checks the gateways that come out.
    """

    def setUp(self) -> None:
        import json
        import shutil
        import sqlite3
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.source = root / "source-run"
        (self.source / "work" / "aeq_project").mkdir(parents=True)
        (self.source / "package").mkdir(parents=True)
        (self.source / "boundary").mkdir(parents=True)
        self.bundle = root / "new-run"
        self.bundle.mkdir()

        connection = sqlite3.connect(self.source / "work" / "aeq_project" / "project_database.sqlite")
        connection.execute("CREATE TABLE links (link_id INTEGER, name TEXT)")
        connection.executemany("INSERT INTO links VALUES (?, ?)", [(77, "Pacheco Pass Highway")])
        connection.commit()
        connection.close()

        # A gateway record as every run before 2026-08-18 wrote it: no name.
        (self.source / "work" / "network_setup_summary.json").write_text(json.dumps({
            "project_dir": str(self.source / "work" / "aeq_project"),
            "centroid_map": {},
            "gateways": [
                {"link_id": 77, "zone_id": 100, "link_type": "trunk",
                 "daily_in": 9000.0, "daily_out": 9000.0,
                 "boundary_lon": -121.0, "boundary_lat": 36.9, "label": "trunk-gateway-01"},
            ],
        }))

        self.geometry = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {}, "geometry": {
                "type": "Polygon",
                "coordinates": [[[-121.5, 36.5], [-120.5, 36.5], [-120.5, 37.5], [-121.5, 37.5], [-121.5, 36.5]]],
            }}],
        }
        (self.source / "boundary" / "analysis_boundary.geojson").write_text(json.dumps(self.geometry))

        columns = list(sr.EXTERNAL_ZONE_COLUMNS)
        internal = {c: 0.0 for c in columns}
        internal.update({"GEOID": "06069000100", "NAMELSAD": "Tract 1", "zone_id": 1,
                         "centroid_lon": -121.0, "centroid_lat": 37.0, "zone_kind": "internal"})
        external = {c: 0.0 for c in columns}
        external.update({"GEOID": "EXT0100", "NAMELSAD": "External gateway: trunk-gateway-01",
                         "zone_id": 100, "centroid_lon": -121.0, "centroid_lat": 36.9,
                         "zone_kind": "external"})
        pd.DataFrame([internal, external], columns=columns).to_csv(
            self.source / "package" / "zone_attributes.csv", index=False
        )
        self.zones_in = pd.DataFrame([internal], columns=columns)
        self.shutil = shutil

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_gateways_come_back_named_so_routes_can_pair(self) -> None:
        from shapely.geometry import shape

        summary, combined = sr.reuse_network_from_run(
            self.bundle, shape(self.geometry["features"][0]["geometry"]), self.zones_in, self.source
        )
        names = [g.get("name") for g in summary["gateways"]]
        self.assertEqual(names, ["Pacheco Pass Highway"])
        self.assertEqual(summary["network_reused_from"]["gateway_names_recovered"], 1)
        self.assertIn(100, set(combined["zone_id"].astype(int)))


if __name__ == "__main__":
    unittest.main(verbosity=1)
