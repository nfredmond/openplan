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
