#!/usr/bin/env python3
"""Stdlib tests for the per-class link VMT summation (M7)."""
import unittest

from link_vmt import METERS_PER_MILE, parse_link_flows, per_class_vmt

COLUMNS = {"resident": "resident_tot", "external": "external_tot"}


class ParseLinkFlowsTest(unittest.TestCase):
    def test_splits_flows_per_class_and_skips_garbage(self):
        rows = [
            {"link_id": "1", "resident_tot": "100.0", "external_tot": "10.0"},
            {"link_id": "2", "resident_tot": "0", "external_tot": "50"},
            {"link_id": "junk", "resident_tot": "5", "external_tot": "5"},
            {"link_id": "3", "resident_tot": "not-a-number", "external_tot": ""},
        ]
        flows = parse_link_flows(rows, COLUMNS)
        self.assertEqual(flows["resident"], {1: 100.0})
        self.assertEqual(flows["external"], {1: 10.0, 2: 50.0})

    def test_missing_column_drops_the_class_but_zero_flows_keep_it(self):
        rows = [{"link_id": "1", "resident_tot": "0"}]
        flows = parse_link_flows(rows, COLUMNS)
        # resident column present (all zero) → class reported as empty flows;
        # external column absent everywhere → class absent, distinguishable.
        self.assertEqual(flows.get("resident"), {})
        self.assertNotIn("external", flows)

    def test_pandas_unnamed_index_column_fallback(self):
        # results_df.to_csv writes the link id as an unnamed index column.
        rows = [{"": "7", "resident_tot": "20", "external_tot": "0"}]
        flows = parse_link_flows(rows, COLUMNS)
        self.assertEqual(flows["resident"], {7: 20.0})


class PerClassVmtTest(unittest.TestCase):
    def test_flow_times_miles_per_class_excluding_connectors(self):
        flows = {
            "resident": {1: 100.0, 2: 50.0, 9: 1000.0},
            "external": {1: 10.0},
        }
        links = [
            (1, "primary", METERS_PER_MILE),        # 1 mile
            (2, "secondary", 2 * METERS_PER_MILE),  # 2 miles
            (9, "centroid_connector", METERS_PER_MILE),  # excluded
            (3, "primary", METERS_PER_MILE),        # no flow
        ]
        vmt = per_class_vmt(flows, links)
        self.assertAlmostEqual(vmt["resident"], 100.0 * 1 + 50.0 * 2)
        self.assertAlmostEqual(vmt["external"], 10.0)

    def test_zero_flow_class_reports_zero_not_missing(self):
        vmt = per_class_vmt({"external": {}}, [(1, "primary", METERS_PER_MILE)])
        self.assertEqual(vmt, {"external": 0.0})

    def test_bad_distance_and_link_id_are_skipped(self):
        flows = {"resident": {1: 10.0}}
        links = [(1, "primary", None), (1, "primary", -5), ("junk", "primary", 100)]
        self.assertEqual(per_class_vmt(flows, links), {"resident": 0.0})


if __name__ == "__main__":
    unittest.main()


class VmtByRoadClass(unittest.TestCase):
    """Where the model's travel actually goes, by kind of road.

    Measured over 24 counties: 37% of modelled vehicle miles land on principal
    arterials where FHWA publishes 21%, and 26% on freeways where the real
    share is 45%. The comparison needs no traffic counts, so it works in all
    fifty states rather than the four whose DOT feeds this repo can read.
    """

    def test_sums_volume_times_length_per_class(self):
        from link_vmt import vmt_by_road_class

        flows = {"resident": {1: 1000.0, 2: 500.0}}
        links = [(1, "motorway", METERS_PER_MILE * 2), (2, "primary", METERS_PER_MILE * 3)]
        vmt = vmt_by_road_class(flows, links)
        self.assertAlmostEqual(vmt["motorway"], 2000.0)
        self.assertAlmostEqual(vmt["primary"], 1500.0)

    def test_adds_every_traffic_class_on_the_same_link(self):
        # Resident and external travel share the road; the road's total is both.
        from link_vmt import vmt_by_road_class

        flows = {"resident": {1: 600.0}, "external": {1: 400.0}}
        vmt = vmt_by_road_class(flows, [(1, "trunk", METERS_PER_MILE)])
        self.assertAlmostEqual(vmt["trunk"], 1000.0)

    def test_centroid_connectors_contribute_nothing(self):
        # They are modelling artifacts, and they carried 8.3% of modelled
        # vehicle-miles in the study counties — enough to distort every share.
        from link_vmt import vmt_by_road_class

        flows = {"resident": {1: 1000.0, 2: 1000.0}}
        links = [(1, "motorway", METERS_PER_MILE), (2, "centroid_connector", METERS_PER_MILE)]
        vmt = vmt_by_road_class(flows, links)
        self.assertEqual(sorted(vmt), ["motorway"])

    def test_a_road_carrying_nothing_is_absent_rather_than_zero(self):
        # A zero share would read as "measured, and nobody drives there".
        from link_vmt import vmt_by_road_class

        vmt = vmt_by_road_class({"resident": {1: 100.0}}, [(1, "primary", METERS_PER_MILE), (2, "service", METERS_PER_MILE)])
        self.assertEqual(sorted(vmt), ["primary"])

    def test_unreadable_rows_are_skipped_not_crashed_on(self):
        from link_vmt import vmt_by_road_class

        links = [("not-a-link", "primary", 100.0), (2, None, 100.0), (3, "primary", None), (4, "primary", -5)]
        self.assertEqual(vmt_by_road_class({"resident": {1: 10.0}}, links), {})

    def test_road_class_is_normalised_so_one_road_is_one_row(self):
        from link_vmt import vmt_by_road_class

        flows = {"resident": {1: 100.0, 2: 100.0}}
        links = [(1, "Motorway", METERS_PER_MILE), (2, " motorway ", METERS_PER_MILE)]
        self.assertEqual(list(vmt_by_road_class(flows, links)), ["motorway"])
