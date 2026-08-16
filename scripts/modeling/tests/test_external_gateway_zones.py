#!/usr/bin/env python3
"""External gateway zones: traffic entering the study area is loaded AT the cordon.

WHY THESE TESTS EXIST (2026-08-15)
==================================
`detect_external_gateways` found where each highway crossed the study-area
boundary, stored the coordinates, and then attached the gateway's traffic to the
nearest RESIDENT ZONE CENTROID instead. On the measured county that centroid sat
in 513 square miles of national forest, ~30 km from the interstate, and its
connector met an unpaved forest road — which then carried 113,410 vehicles a day
at 14x capacity, ranked above every real arterial in the county.

The same defect distorted the headline number: because those tracts were doing
double duty as gateway proxies, the resident-VMT estimator excluded them to keep
through traffic out, dropping 17% of the population's travel from the numerator
while their population stayed in the denominator.

Both failures were invisible from any single value. Nothing crashed, no total
looked wrong, and the county figure looked plausible. So these assert the
STRUCTURE that makes them impossible rather than any particular number.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
from shapely.geometry import Point

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from screening_runtime import (  # noqa: E402
    ZONE_ATTRIBUTE_COLUMNS,
    build_external_gateway_matrix,
    build_external_zone_rows,
    external_zone_ids,
    keep_corridor_endpoints,
    write_zone_package_files,
)


def internal_zone(zone_id: int, *, population: float, jobs: float, lon: float, lat: float) -> dict:
    return {
        "GEOID": f"0600100{zone_id:04d}",
        "NAMELSAD": f"Census Tract {zone_id}",
        "zone_id": zone_id,
        "centroid_lon": lon,
        "centroid_lat": lat,
        "area_sq_mi": 10.0,
        "total_jobs": jobs,
        "retail_jobs": jobs * 0.15,
        "health_jobs": jobs * 0.09,
        "education_jobs": jobs * 0.10,
        "accommodation_jobs": jobs * 0.04,
        "govt_jobs": jobs * 0.07,
        "est_population": population,
        "households": population / 2.4,
        "worker_residents": population * 0.45,
        "area_share": 1.0,
        "zone_kind": "internal",
    }


def gateway(label: str, lon: float, lat: float, daily: float) -> dict:
    return {
        "label": label,
        "link_type": "motorway",
        "link_id": 1234,
        "daily_in": daily,
        "daily_out": daily,
        "boundary_lon": lon,
        "boundary_lat": lat,
    }


class ExternalZoneRowTests(unittest.TestCase):
    def test_rows_carry_the_crossing_point_and_no_land_use(self) -> None:
        rows = build_external_zone_rows(
            [gateway("motorway-i-80", -120.10, 39.32, 30000.0)], first_zone_id=27
        )

        self.assertEqual(list(rows.columns), list(ZONE_ATTRIBUTE_COLUMNS))
        self.assertEqual(int(rows.iloc[0]["zone_id"]), 27)
        self.assertEqual(rows.iloc[0]["zone_kind"], "external")
        # The centroid IS the boundary crossing. This is the whole fix: any
        # other coordinate here puts a highway's traffic somewhere it does not
        # arrive.
        self.assertAlmostEqual(float(rows.iloc[0]["centroid_lon"]), -120.10)
        self.assertAlmostEqual(float(rows.iloc[0]["centroid_lat"]), 39.32)
        # Nobody lives or works at a cordon point, and it has no land area.
        for column in ("est_population", "households", "worker_residents", "total_jobs", "area_sq_mi"):
            self.assertEqual(float(rows.iloc[0][column]), 0.0, column)

    def test_ids_continue_the_internal_sequence_without_colliding(self) -> None:
        rows = build_external_zone_rows(
            [gateway("a", -120.1, 39.3, 1.0), gateway("b", -121.2, 39.1, 1.0)], first_zone_id=27
        )
        self.assertEqual([int(z) for z in rows["zone_id"]], [27, 28])

    def test_no_gateways_yields_an_empty_table_with_the_right_shape(self) -> None:
        rows = build_external_zone_rows([], first_zone_id=27)
        self.assertTrue(rows.empty)
        # A closed study area must still concatenate cleanly onto the zone table.
        self.assertEqual(list(rows.columns), list(ZONE_ATTRIBUTE_COLUMNS))


class ExternalZoneIdentificationTests(unittest.TestCase):
    def test_reads_the_recorded_kind(self) -> None:
        zones = pd.DataFrame(
            [
                internal_zone(1, population=7117, jobs=3345, lon=-121.05, lat=39.12),
                internal_zone(2, population=3360, jobs=1579, lon=-121.06, lat=39.15),
            ]
        )
        zones = pd.concat(
            [zones, build_external_zone_rows([gateway("i-80", -120.1, 39.32, 30000.0)], 3)],
            ignore_index=True,
        )
        self.assertEqual(external_zone_ids(zones), [3])

    def test_a_real_tract_with_no_residents_is_not_a_cordon(self) -> None:
        """The distinction is recorded, never inferred from a zero.

        Tracts with no measured population exist — industrial land, a park, an
        airport. Inferring "external" from zero population would drop such a
        tract's travel out of the VMT numerator, which is precisely the class of
        silent exclusion this whole change removes.
        """
        zones = pd.DataFrame(
            [
                internal_zone(1, population=0.0, jobs=900, lon=-121.05, lat=39.12),
                internal_zone(2, population=3360, jobs=1579, lon=-121.06, lat=39.15),
            ]
        )
        self.assertEqual(external_zone_ids(zones), [])

    def test_a_zone_table_without_the_column_reports_no_cordons(self) -> None:
        # An older run's zone table read back off disk must not throw.
        zones = pd.DataFrame([internal_zone(1, population=10.0, jobs=5.0, lon=-121.0, lat=39.1)])
        self.assertEqual(external_zone_ids(zones.drop(columns=["zone_kind"])), [])


class GatewayLoadingTests(unittest.TestCase):
    """Where the traffic lands — the assertion the old code would fail."""

    def setUp(self) -> None:
        internals = pd.DataFrame(
            [
                internal_zone(1, population=7117, jobs=3345, lon=-121.05, lat=39.12),
                internal_zone(2, population=3360, jobs=1579, lon=-121.06, lat=39.15),
                # The big empty tract that used to be borrowed as a gateway.
                internal_zone(3, population=3765, jobs=1770, lon=-120.59, lat=39.38),
            ]
        )
        self.gateway = gateway("motorway-i-80", -120.10, 39.32, 30000.0)
        self.zones = pd.concat(
            [internals, build_external_zone_rows([self.gateway], 4)], ignore_index=True
        )
        self.gateway["zone_id"] = external_zone_ids(self.zones)[0]
        self.matrix = build_external_gateway_matrix([self.gateway], self.zones)
        self.index = {int(z): i for i, z in enumerate(self.zones["zone_id"])}

    def test_the_cordon_carries_the_arriving_traffic(self) -> None:
        external_row = self.matrix[self.index[4], :].sum()
        external_col = self.matrix[:, self.index[4]].sum()
        self.assertAlmostEqual(external_row, 30000.0, places=3)
        self.assertAlmostEqual(external_col, 30000.0, places=3)

    def test_external_travel_never_becomes_a_trip_between_two_local_places(self) -> None:
        """THE REGRESSION, stated precisely.

        Residents DO legitimately drive out through a cordon, so an internal
        zone's row is not empty — it holds that zone's trips to the gateway.
        What must never appear is an internal-to-internal entry: that is what
        the old code produced when it seeded the gateway at a resident tract,
        and it is what put a whole county's through traffic on the local road
        that tract's connector happened to meet.
        """
        for origin in (1, 2, 3):
            for destination in (1, 2, 3):
                self.assertAlmostEqual(
                    self.matrix[self.index[origin], self.index[destination]],
                    0.0,
                    places=6,
                    msg=f"external demand created a local trip from zone {origin} to zone {destination}",
                )

    def test_every_external_trip_end_touches_the_cordon(self) -> None:
        # The complement of the check above: the matrix's whole mass sits in the
        # cordon's row and column, so the total is exactly in + out.
        self.assertAlmostEqual(self.matrix.sum(), 60000.0, places=3)

    def test_arriving_traffic_reaches_real_places_and_not_other_cordons(self) -> None:
        # Destinations are employment-weighted and a cordon has no jobs, so a
        # gateway can never send trips to another gateway. Cordon-to-cordon
        # movement is real pass-through travel and is a separate, later step.
        self.assertAlmostEqual(self.matrix[self.index[4], self.index[4]], 0.0, places=6)
        self.assertGreater(self.matrix[self.index[4], self.index[1]], 0.0)

    def test_two_gateways_load_independently(self) -> None:
        internals = pd.DataFrame(
            [internal_zone(1, population=7117, jobs=3345, lon=-121.05, lat=39.12)]
        )
        west = gateway("trunk-sr-20", -121.30, 39.10, 9000.0)
        east = gateway("motorway-i-80", -120.10, 39.32, 30000.0)
        zones = pd.concat([internals, build_external_zone_rows([west, east], 2)], ignore_index=True)
        west["zone_id"], east["zone_id"] = external_zone_ids(zones)

        matrix = build_external_gateway_matrix([west, east], zones)
        index = {int(z): i for i, z in enumerate(zones["zone_id"])}
        # Each cordon carries its own volume — not a pooled or averaged one.
        self.assertAlmostEqual(matrix[index[west["zone_id"]], :].sum(), 9000.0, places=3)
        self.assertAlmostEqual(matrix[index[east["zone_id"]], :].sum(), 30000.0, places=3)

    def test_the_matrix_is_square_over_the_whole_zone_system(self) -> None:
        # The assignment step indexes this against the same zone list the
        # connectors were built for; a matrix sized to internal zones only would
        # silently misalign every row.
        self.assertEqual(self.matrix.shape, (len(self.zones), len(self.zones)))
        self.assertTrue(np.isfinite(self.matrix).all())


def crossing(name: str, lon: float, lat: float, daily: float = 20000.0) -> dict:
    return {
        "link_id": abs(hash((name, lon, lat))) % 100000,
        "link_type": "motorway",
        "name": name,
        "point": Point(lon, lat),
        "daily": daily,
    }


class CorridorEndpointTests(unittest.TestCase):
    """One highway is one corridor, however many times it crosses the line.

    A study-area boundary is a legal line, not a geographic one. I-80 crosses
    the measured county's southern boundary four times, 5.9 to 54.7 km apart —
    far beyond the 2.2 km proximity clustering — and each crossing was injecting
    a full interstate's worth of daily traffic. Roughly 160,000 vehicles where
    about 40,000 belongs.
    """

    def test_a_weaving_highway_keeps_only_its_entry_and_exit(self) -> None:
        # The real I-80 longitudes from the measured run, same latitude band.
        crossings = [
            crossing("Alan S. Hart Freeway", -120.6249, 39.3154),
            crossing("Alan S. Hart Freeway", -120.4355, 39.3162),
            crossing("Alan S. Hart Freeway", -120.5566, 39.3156),
            crossing("Alan S. Hart Freeway", -120.0104, 39.4451),
        ]
        kept, notes = keep_corridor_endpoints(crossings)

        self.assertEqual(len(kept), 2)
        # The two farthest apart: the westernmost and the easternmost.
        longitudes = sorted(round(k["point"].x, 4) for k in kept)
        self.assertEqual(longitudes, [-120.6249, -120.0104])
        # And it must SAY what it dropped rather than quietly trimming.
        self.assertEqual(len(notes), 1)
        self.assertIn("4 boundary crossings", notes[0])
        self.assertIn("dropped 2", notes[0])

    def test_a_route_entering_at_opposite_ends_keeps_both(self) -> None:
        """The honest two-gateway case, which must survive untouched: a state
        highway entering the north of a county and leaving the south."""
        crossings = [
            crossing("State Route 49", -121.05, 39.60),
            crossing("State Route 49", -121.02, 39.05),
        ]
        kept, notes = keep_corridor_endpoints(crossings)
        self.assertEqual(len(kept), 2)
        self.assertEqual(notes, [])

    def test_different_roads_are_never_merged(self) -> None:
        crossings = [
            crossing("Alan S. Hart Freeway", -120.62, 39.31),
            crossing("State Route 20", -121.28, 39.20),
            crossing("State Route 49", -121.10, 39.01),
        ]
        kept, notes = keep_corridor_endpoints(crossings)
        self.assertEqual(len(kept), 3)
        self.assertEqual(notes, [])

    def test_unnamed_crossings_are_never_grouped_together(self) -> None:
        """An empty OSM name is an absence, not an identity. Grouping on it
        would fold unrelated roads into one imaginary corridor — and unnamed
        crossings are common: three of the eight in the measured county had no
        name at all."""
        crossings = [
            crossing("", -120.62, 39.31),
            crossing("", -121.28, 39.20),
            crossing("", -121.10, 39.01),
            crossing("   ", -120.20, 39.31),
        ]
        kept, notes = keep_corridor_endpoints(crossings)
        self.assertEqual(len(kept), 4)
        self.assertEqual(notes, [])

    def test_names_are_matched_regardless_of_case_and_padding(self) -> None:
        crossings = [
            crossing("Alan S. Hart Freeway", -120.62, 39.31),
            crossing("alan s. hart freeway", -120.44, 39.32),
            crossing("  ALAN S. HART FREEWAY  ", -120.01, 39.45),
        ]
        kept, _ = keep_corridor_endpoints(crossings)
        self.assertEqual(len(kept), 2)

    def test_nothing_is_invented_when_there_is_nothing_to_group(self) -> None:
        kept, notes = keep_corridor_endpoints([])
        self.assertEqual(kept, [])
        self.assertEqual(notes, [])


class ZonePackageRepublishTests(unittest.TestCase):
    """What the rest of the world reads once cordon zones exist."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.package_dir = Path(self.tmp.name)
        internals = pd.DataFrame(
            [
                internal_zone(1, population=7117, jobs=3345, lon=-121.05, lat=39.12),
                internal_zone(2, population=3360, jobs=1579, lon=-121.06, lat=39.15),
            ]
        )
        self.zones = pd.concat(
            [
                internals,
                build_external_zone_rows(
                    [gateway("i-80", -120.10, 39.32, 30000.0), gateway("sr-20", -121.30, 39.10, 9000.0)],
                    3,
                ),
            ],
            ignore_index=True,
        )
        self.meta = write_zone_package_files(
            self.zones, self.package_dir, {"zones": 2, "zone_type": "census-tract-fragments"}
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_zone_count_still_means_places(self) -> None:
        """`zones` becomes `zone_count` in the run summary, which the app turns
        into "N% of trips begin and end in the same zone across 26 zones" — a
        sentence about how finely the study area is divided into PLACES. Cordon
        points counted there would inflate it and weaken a caveat about the
        model's own resolution."""
        self.assertEqual(self.meta["zones"], 2)
        self.assertEqual(self.meta["internal_zones"], 2)
        self.assertEqual(self.meta["external_zones"], 2)
        self.assertEqual(self.meta["zones_including_external_cordons"], 4)

    def test_the_republished_table_holds_every_zone_the_matrix_has(self) -> None:
        # The OD matrix is square over the WHOLE zone system. A zone table on
        # disk that listed only tracts would misalign every row for anyone
        # reading the run back.
        written = pd.read_csv(self.package_dir / "zone_attributes.csv")
        self.assertEqual(len(written), 4)
        self.assertEqual(sorted(written["zone_kind"].unique()), ["external", "internal"])

    def test_centroids_carry_their_kind_for_anything_drawing_them(self) -> None:
        centroids = json.loads((self.package_dir / "zone_centroids.geojson").read_text())
        kinds = [f["properties"]["zone_kind"] for f in centroids["features"]]
        self.assertEqual(kinds.count("external"), 2)
        # A cordon drawn as though it were a neighbourhood is a map that lies.
        self.assertEqual(kinds.count("internal"), 2)

    def test_the_manifest_says_the_polygons_do_not_cover_the_cordons(self) -> None:
        manifest = json.loads((self.package_dir / "package_manifest.json").read_text())
        self.assertIn("internal zones only", manifest["zones_geojson_covers"])
        self.assertEqual(manifest["zone_type"], "census-tract-fragments-plus-external-cordons")


if __name__ == "__main__":
    unittest.main()
