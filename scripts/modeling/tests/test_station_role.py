#!/usr/bin/env python3
"""Ramp and connector counts, and why they must not reach the accuracy figure.

A ramp count is real data about a real road. The screening network has no ramp
link, so the matcher pairs it with the mainline it leaves and reports an error
of tens of times — the pairing being wrong, not the model. Measured in Cowlitz
County WA: three ramp stations of 410/510/530 vehicles a day all matched to the
mainline carrying 29,040.

These tests hold the two properties that keep the fix honest: the rule is the
FEED's, declared per source and never inferred from a place; and an excluded
station is counted and named, never silently absent.
"""
from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import count_sources as cs


class TheRuleBelongsToTheFeed(unittest.TestCase):
    def test_a_source_that_declares_nothing_calls_everything_mainline(self) -> None:
        """The behaviour before this existed, preserved exactly — including for
        a hand-supplied count set and for any country added later."""
        provenance = {"agency": "Nowhere DOT"}
        role, reason = cs.station_role(provenance, "SOMETHING RAMP SOMETHING")
        self.assertEqual(role, cs.MAINLINE_ROLE)
        self.assertEqual(reason, "")

    def test_the_declared_pattern_is_what_decides(self) -> None:
        provenance = {"agency": "Test DOT", "non_mainline_patterns": (r"\bspur\b",)}
        self.assertEqual(cs.station_role(provenance, "NORTH SPUR")[0], cs.NOT_MAINLINE_ROLE)
        # …and a word this feed did NOT declare is left alone, even though other
        # feeds treat it as non-mainline.
        self.assertEqual(cs.station_role(provenance, "OFF RAMP")[0], cs.MAINLINE_ROLE)

    def test_the_reason_names_the_publisher_and_says_why(self) -> None:
        provenance = {"agency": "WSDOT", "non_mainline_patterns": (r"\bramps?\b",)}
        role, reason = cs.station_role(provenance, "TODD RD ON RAMP")
        self.assertEqual(role, cs.NOT_MAINLINE_ROLE)
        self.assertIn("WSDOT", reason)
        self.assertIn("no such link", reason)

    def test_an_empty_or_missing_description_is_mainline(self) -> None:
        provenance = {"agency": "WSDOT", "non_mainline_patterns": (r"\bramps?\b",)}
        self.assertEqual(cs.station_role(provenance, "")[0], cs.MAINLINE_ROLE)
        self.assertEqual(cs.station_role(provenance, None)[0], cs.MAINLINE_ROLE)


class TheRegisteredFeedsMatchTheirOwnData(unittest.TestCase):
    """Spellings taken verbatim from the feeds' own descriptions, 2026-08-17."""

    def role(self, region: str, description: str) -> str:
        return cs.station_role(cs.source_provenance(region), description)[0]

    def test_wsdot_ramp_spellings(self) -> None:
        for description in (
            "SOUTHEAST OF MILEPOST 62.21: OFF RAMP WYE CONNECTION",
            "NORTHWEST OF MILEPOST 28.22: TODD RD ON RAMP",
            "NORTHWEST OF MILEPOST 37.48: SR 432 WB*TALLEY WAY OFF RAMP",
        ):
            self.assertEqual(self.role("WA", description), cs.NOT_MAINLINE_ROLE, description)

    def test_a_wsdot_mainline_station_survives(self) -> None:
        self.assertEqual(
            self.role("WA", "At Milepost 9.58: Cowlitz River Bridge"), cs.MAINLINE_ROLE
        )

    def test_odot_ramp_and_connection_spellings(self) -> None:
        for description in (
            "STAFFORD RD. CONN. NO. 1,  SB I-5 off-ramp,",
            "NYBERG RD. CONN. NO. 2,  NB I5 offramp (001RK) [0.03 miles]",
            "HAINES RD. CONN. NO. 3,  HAINES ROAD CONN. 3, on Haines Street",
            "TUALATIN VALLEY CONN NO 1, West of SE 10th Avenue [0.01 miles]",
        ):
            self.assertEqual(self.role("OR", description), cs.NOT_MAINLINE_ROLE, description)

    def test_an_odot_mainline_station_survives(self) -> None:
        self.assertEqual(self.role("OR", "North of OR8 [0.11 miles]"), cs.MAINLINE_ROLE)

    def test_an_odot_frontage_road_count_is_not_the_highway_beside_it(self) -> None:
        """ODOT files a frontage-road count under the parallel highway's own
        route number and milepost, so the matcher pairs it with the mainline.
        Measured 2026-08-20: "Biddle Frontage Road", 450 vehicles a day, graded
        against Crater Lake Highway's 69,385."""
        for description in (
            "US97 Frontage Rd., South of Nels Anderson Place [0.05 miles]",
            "EDY RD. FRONTAGE RD., Nw of PACIFIC HIGHWAY WEST NO. 91 (OR99W)",
            "BIDDLE FRONTAGE ROAD, North of Crater Lake Highway",
            "WAKEFIELD FRONT. RD. CONN., Corvallis Newport Highway",
        ):
            self.assertEqual(self.role("OR", description), cs.NOT_MAINLINE_ROLE, description)

    def test_an_odot_highway_located_BY_a_ramp_or_frontage_road_survives(self) -> None:
        """The counted facility is the clause before the first comma; the rest
        says where it is. Six mainline stations were being discarded for a word
        in their POSITION, including the largest count in the whole set."""
        for description in (
            "BEAVERTON-TIGARD HIGHWAY NO. 144, Nw of southbound Pacific Highway (I5) ramps",
            "CLACKAMAS HIGHWAY NO. 171, West of southbound ramps to Cascade Highway North",
            "CORVALLIS-NEWPORT HIGHWAY NO. 33, West of Toledo Frontage Road (West Jct.)",
            "LAKE OF THE WOODS HIGHWAY NO. 270, Nw of Dean Creek Frontage Road",
        ):
            self.assertEqual(self.role("OR", description), cs.MAINLINE_ROLE, description)

    def test_odot_connection_abbreviations_the_numbered_pattern_missed(self) -> None:
        for description in (
            "REDLAND RD. CONN.,  CASCADE HIGHWAY SOUTH NO. 160 Redland Dr. Conn.",
            "LAKE RD. INTCHGE. CONN., North of the interchange",
            "LOWER BOONES FERRY RD CN 2, EAst of NB I5 ramps [0.05 miles]",
            "OTIS CONNECTION NO. 2,  WB Salmon River Hwy",
        ):
            self.assertEqual(self.role("OR", description), cs.NOT_MAINLINE_ROLE, description)

    def test_an_unnumbered_spelled_out_connection_is_left_alone(self) -> None:
        """Deliberately not excluded: "DEPOT ST. CONNECTION" matched a link
        actually named Depot Street. Excluding a fair comparison because it
        reads badly is how a model gets flattered by its own validator."""
        self.assertEqual(
            self.role("OR", "DEPOT ST. CONNECTION, North of Main"), cs.MAINLINE_ROLE
        )

    def test_wsdot_reads_the_whole_description_because_its_convention_differs(self) -> None:
        """WSDOT writes "<direction> OF MILEPOST x: <what is there>" — the
        counted facility is the route and the text is a landmark. Three true
        WSDOT mainline stations carrying 20,000-37,000 vehicles a day sit at a
        frontage-road intersection; ODOT's rule applied here would delete them."""
        self.assertEqual(cs.source_provenance("WA")["facility_clause_pattern"], "")
        for description in (
            "EAST OF MILEPOST 281.64: SUNSET FRONTAGE RD INTERSECTION",
            "NORTHWEST OF MILEPOST 0.17: FRONTAGE RD INTERSECTION",
        ):
            self.assertEqual(self.role("WA", description), cs.MAINLINE_ROLE, description)
        # …while the ramp spelling it DID declare still fires, from a position
        # ODOT's clause rule would never have looked at.
        self.assertEqual(
            self.role("WA", "NORTH OF MILEPOST 41.13: FRONTAGE RD ON RAMP"),
            cs.NOT_MAINLINE_ROLE,
        )

    def test_the_reason_quotes_the_text_that_decided_it(self) -> None:
        _, reason = cs.station_role(
            cs.source_provenance("OR"), "US97 Frontage Rd., South of Nels Anderson Place"
        )
        self.assertIn("Frontage Rd", reason)
        self.assertIn("ODOT", reason)

    def test_caltrans_and_cdot_declare_none_because_their_feeds_publish_none(self) -> None:
        # Measured: zero stations in either feed's descriptions mention a ramp
        # across the study counties. Declaring a pattern they do not need would
        # be inventing a rule for a feed nobody has checked.
        for region in ("CA", "CO"):
            self.assertEqual(cs.source_provenance(region)["non_mainline_patterns"], ())
        self.assertEqual(self.role("CA", "GRASS VALLEY, IDAHO/MARYLAND ROAD"), cs.MAINLINE_ROLE)


class TheValidatorSetsThemAsideAndSaysSo(unittest.TestCase):
    """The end of the chain: an excluded station must be counted and named."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def build_summary(self, results):
        from validate_screening_observed_counts import build_summary

        return build_summary(
            evidence={"engine": "test"},
            counts_csv=self.root / "counts.csv",
            geometry_path=self.root / "links.geojson",
            project_db=None,
            volume_field="PCE_tot",
            results=results,
            ready_median_ape=30.0,
            ready_critical_ape=50.0,
            required_matches=3,
        )

    def row(self, status, ape=None):
        return {
            "match_status": status,
            "station_id": "S1",
            "label": "SR 432 at Milepost 9.58",
            "absolute_percent_error": ape,
            "observed_volume": 1000,
            "modeled_daily_pce": 1200,
            "model_link_type": "primary",
            "source_agency": "WSDOT",
        }

    def test_excluded_stations_are_counted_separately_from_misses(self) -> None:
        results = [self.row("matched", 10.0), self.row("excluded_not_mainline"), self.row("model_miss")]
        summary = self.build_summary(results)
        self.assertEqual(summary["stations_matched"], 1)
        self.assertEqual(summary["stations_excluded_not_mainline"], 1)
        self.assertIn("ramp or connector", summary["stations_excluded_note"])

    def test_with_nothing_excluded_it_says_so_rather_than_going_quiet(self) -> None:
        summary = self.build_summary([self.row("matched", 10.0)])
        self.assertEqual(summary["stations_excluded_not_mainline"], 0)
        self.assertIn("No station was set aside", summary["stations_excluded_note"])

    def test_an_excluded_station_does_not_reach_the_accuracy_figure(self) -> None:
        """The whole point: a 5000% ramp mismatch must not move the median."""
        clean = [self.row("matched", 10.0), self.row("matched", 20.0), self.row("matched", 30.0)]
        with_ramp = clean + [self.row("excluded_not_mainline", 5000.0)]
        self.assertEqual(
            self.build_summary(clean)["metrics"]["median_absolute_percent_error"],
            self.build_summary(with_ramp)["metrics"]["median_absolute_percent_error"],
        )


class TheWholeValidationRunSetsThemAside(unittest.TestCase):
    """The test that matters, and the one I did not have first time.

    A mutation that removed the validator's skip entirely SURVIVED the rest of
    this file, because everything else feeds `build_summary` rows that were
    already labelled by hand. This drives the real entry point with a real count
    CSV, so the ramp row has to travel the whole path.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.run_output = self.root / "run_output"
        self.run_output.mkdir(parents=True)

        (self.run_output / "link_volumes.csv").write_text(
            "link_id,PCE_tot\n10805,29040\n5580,16527\n"
        )
        (self.run_output / "evidence_packet.json").write_text(json.dumps({"engine": "aequilibrae"}))
        (self.run_output / "loaded_links.geojson").write_text(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "geometry": {"type": "LineString", "coordinates": [[-122.9, 46.1], [-122.89, 46.11]]},
                            "properties": {"link_id": 10805, "name": "Tennant Way", "link_type": "primary"},
                        }
                    ],
                }
            )
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def counts_csv(self, rows: list[dict[str, str]]) -> Path:
        path = self.root / "published_counts.csv"
        fields = [
            "station_id", "label", "facility_name", "count_year", "count_type", "direction",
            "observed_volume", "source_agency", "source_description", "candidate_model_names",
            "candidate_link_types", "exclude_model_names", "bbox_min_lon", "bbox_min_lat",
            "bbox_max_lon", "bbox_max_lat", "station_role", "station_role_reason", "notes",
        ]
        with path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for row in rows:
                writer.writerow({field: row.get(field, "") for field in fields})
        return path

    def station(self, **overrides) -> dict[str, str]:
        base = {
            "station_id": "WSDOT_RTE432_PM9_580",
            "label": "SR 432 at Milepost 9.58",
            "facility_name": "SR 432",
            "count_type": "AADT",
            "direction": "two_way",
            "observed_volume": "37000",
            "source_agency": "WSDOT",
            "source_description": "At Milepost 9.58: Cowlitz River Bridge",
            "candidate_model_names": "Tennant Way",
            "candidate_link_types": "primary",
            "bbox_min_lon": "-122.95", "bbox_min_lat": "46.05",
            "bbox_max_lon": "-122.85", "bbox_max_lat": "46.15",
            "station_role": "mainline",
        }
        base.update(overrides)
        return base

    def validate(self, rows) -> dict:
        from validate_screening_observed_counts import run_validation_bundle

        return run_validation_bundle(
            run_output_dir=self.run_output,
            counts_csv=self.counts_csv(rows),
            output_dir=self.root / "validation",
            required_matches=1,
        )

    def _results(self):
        with (self.root / "validation" / "validation_results.csv").open(newline="") as handle:
            return list(csv.DictReader(handle))

    def test_a_ramp_station_never_becomes_a_match(self) -> None:
        ramp = self.station(
            station_id="WSDOT_RAMP_1",
            label="SR 432 at R1 Ramp",
            observed_volume="410",
            source_description="R1 RAMP (SR 432 WB TO DIKE RD)",
            station_role="not_mainline",
            station_role_reason="WSDOT publishes this as a ramp count",
        )
        summary = self.validate([self.station(), ramp])

        by_id = {row["station_id"]: row for row in self._results()}
        self.assertEqual(by_id["WSDOT_RTE432_PM9_580"]["match_status"], "matched")
        self.assertEqual(by_id["WSDOT_RAMP_1"]["match_status"], "excluded_not_mainline")
        # And it carries no fabricated comparison numbers.
        self.assertEqual(by_id["WSDOT_RAMP_1"]["absolute_percent_error"], "")
        self.assertEqual(by_id["WSDOT_RAMP_1"]["model_link_id"], "")
        self.assertEqual(summary["stations_matched"], 1)
        self.assertEqual(summary["stations_excluded_not_mainline"], 1)

    def test_the_ramp_does_not_move_the_accuracy_figure(self) -> None:
        """29,040 modelled against a 410-vehicle ramp is a 7,000% error. If the
        skip ever regresses, this median moves and this test says so."""
        without = self.validate([self.station()])["metrics"]["median_absolute_percent_error"]
        ramp = self.station(
            station_id="WSDOT_RAMP_1", observed_volume="410",
            source_description="R1 RAMP (SR 432 WB TO DIKE RD)",
            station_role="not_mainline", station_role_reason="ramp",
        )
        with_ramp = self.validate([self.station(), ramp])["metrics"]["median_absolute_percent_error"]
        self.assertEqual(without, with_ramp)

    def test_a_count_set_with_no_role_column_behaves_exactly_as_before(self) -> None:
        """A hand-supplied CSV, or one built before this existed, must not have
        its stations silently set aside."""
        legacy = self.station()
        legacy.pop("station_role")
        summary = self.validate([legacy])
        self.assertEqual(summary["stations_matched"], 1)
        self.assertEqual(summary["stations_excluded_not_mainline"], 0)


class TheCountBuilderStampsTheRole(unittest.TestCase):
    def test_a_row_carries_its_role_and_reason(self) -> None:
        from build_expanded_aadt_counts import station_row

        provenance = cs.source_provenance("WA")
        point = {"rte": "432", "pm": 9.58, "lon": -122.9, "lat": 46.1, "obs": 410,
                 "desc": "NORTHWEST OF MILEPOST 37.48: TALLEY WAY OFF RAMP"}
        row = station_row(point, provenance, "Tennant Way", "primary", "")
        self.assertEqual(row["station_role"], cs.NOT_MAINLINE_ROLE)
        self.assertIn("WSDOT", row["station_role_reason"])

        mainline = station_row(
            {**point, "desc": "At Milepost 9.58: Cowlitz River Bridge"},
            provenance, "Tennant Way", "primary", "",
        )
        self.assertEqual(mainline["station_role"], cs.MAINLINE_ROLE)
        self.assertEqual(mainline["station_role_reason"], "")


if __name__ == "__main__":
    unittest.main()
