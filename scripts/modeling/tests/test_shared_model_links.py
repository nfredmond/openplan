#!/usr/bin/env python3
"""Several count stations, one model link — and why that cannot grade anything.

A model link holds one volume. Two stations matched to it are two observations
of that one number: if they agree, comparing twice weights the link twice; if
they disagree, at most one of them belongs there and nothing in the data says
which.

Measured across the 24 study counties AFTER ramp counts were already excluded:
33% of matched stations sit on a shared link, and only 166 of 404 groups have
counts that agree. The worst pair is 2 vehicles a day against 33,723.
"""
from __future__ import annotations

import csv
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from validate_screening_observed_counts import DEFAULT_READY_MEDIAN_APE, resolve_shared_links


def station(station_id: str, link_id: str, observed: float, modeled: float = 10000.0) -> dict:
    error = abs(modeled - observed)
    return {
        "station_id": station_id,
        "label": f"station {station_id}",
        "match_status": "matched",
        "model_link_id": link_id,
        "observed_volume": observed,
        "modeled_daily_pce": modeled,
        "absolute_difference": error,
        "absolute_percent_error": round(100.0 * error / observed, 2) if observed else "",
        "volume_ratio_model_obs": round(modeled / observed, 4) if observed else "",
        "notes": "",
    }


def by_id(rows):
    return {row["station_id"]: row for row in rows}


class AStationAloneOnItsLinkIsUntouched(unittest.TestCase):
    def test_the_ordinary_case_is_left_exactly_as_it_was(self) -> None:
        rows = [station("A", "1", 9000), station("B", "2", 11000)]
        before = [dict(row) for row in rows]
        record = resolve_shared_links(rows)
        self.assertEqual(rows, before)
        self.assertEqual(record["links_shared_by_several_stations"], 0)
        self.assertEqual(record["groups_merged_as_consistent"], 0)
        self.assertEqual(record["groups_excluded_as_ambiguous"], 0)


class StationsThatAgreeAreComparedOnce(unittest.TestCase):
    def test_the_group_collapses_to_one_comparison_at_the_median(self) -> None:
        rows = [
            station("A", "7", 9000, modeled=10000),
            station("B", "7", 10000, modeled=10000),
            station("C", "7", 11000, modeled=10000),
        ]
        record = resolve_shared_links(rows)
        kept = [row for row in rows if row["match_status"] == "matched"]
        merged = [row for row in rows if row["match_status"] == "merged_into_shared_link"]

        self.assertEqual(len(kept), 1)
        self.assertEqual(len(merged), 2)
        # Median of 9000/10000/11000 is 10000, and the model holds 10000.
        self.assertEqual(kept[0]["observed_volume"], 10000)
        self.assertEqual(kept[0]["absolute_percent_error"], 0.0)
        self.assertEqual(record["groups_merged_as_consistent"], 1)
        self.assertEqual(record["stations_merged_away"], 2)

    def test_a_merged_station_carries_no_error_of_its_own(self) -> None:
        """Left in place it would be counted a second time by anything reading
        the results by row."""
        rows = [station("A", "7", 9500), station("B", "7", 10500)]
        resolve_shared_links(rows)
        merged = [row for row in rows if row["match_status"] == "merged_into_shared_link"][0]
        self.assertEqual(merged["absolute_percent_error"], "")
        self.assertEqual(merged["volume_ratio_model_obs"], "")
        self.assertIn("merged into station", merged["notes"])

    def test_the_kept_station_says_it_speaks_for_several(self) -> None:
        rows = [station("A", "7", 9500), station("B", "7", 10500)]
        resolve_shared_links(rows)
        kept = [row for row in rows if row["match_status"] == "matched"][0]
        self.assertIn("2 stations matched this link", kept["notes"])
        self.assertIn("median", kept["notes"])


class StationsThatDisagreeGradeNothing(unittest.TestCase):
    def test_the_whole_group_is_excluded_not_arbitrated(self) -> None:
        # The real worst case: 2 vehicles a day and 33,723 on one link.
        rows = [station("A", "9", 2, modeled=72220), station("B", "9", 33723, modeled=72220)]
        record = resolve_shared_links(rows)
        self.assertTrue(all(row["match_status"] == "excluded_ambiguous_link" for row in rows))
        self.assertEqual(record["groups_excluded_as_ambiguous"], 1)
        self.assertEqual(record["stations_excluded_as_ambiguous"], 2)

    def test_the_reason_quotes_the_range_that_made_it_ambiguous(self) -> None:
        rows = [station("A", "9", 2, modeled=72220), station("B", "9", 33723, modeled=72220)]
        resolve_shared_links(rows)
        self.assertIn("2 to 33,723", rows[0]["notes"])
        self.assertIn("nothing in the data says which station belongs", rows[0]["notes"])

    def test_no_excluded_station_keeps_a_percent_error(self) -> None:
        """A three-million-percent error left on the row would be picked up by
        anything reading the CSV for accuracy."""
        rows = [station("A", "9", 2, modeled=72220), station("B", "9", 33723, modeled=72220)]
        resolve_shared_links(rows)
        for row in rows:
            self.assertEqual(row["absolute_percent_error"], "")

    def test_a_zero_count_can_never_be_called_consistent(self) -> None:
        # A ratio against zero is undefined; treating it as agreement would
        # merge a station reporting nothing into a live corridor.
        rows = [station("A", "9", 0, modeled=5000), station("B", "9", 5000, modeled=5000)]
        resolve_shared_links(rows)
        self.assertTrue(all(row["match_status"] == "excluded_ambiguous_link" for row in rows))


class TheThresholdIsTheGatesOwn(unittest.TestCase):
    def test_agreement_uses_the_screening_gate_band_rather_than_a_new_number(self) -> None:
        record = resolve_shared_links([])
        self.assertAlmostEqual(record["consistency_ratio"], 1.0 + DEFAULT_READY_MEDIAN_APE / 100.0)

    def test_just_inside_the_band_merges_and_just_outside_excludes(self) -> None:
        inside = [station("A", "7", 10000), station("B", "7", 12999)]  # ratio 1.2999
        resolve_shared_links(inside)
        self.assertEqual(sum(1 for r in inside if r["match_status"] == "matched"), 1)

        outside = [station("A", "7", 10000), station("B", "7", 13001)]  # ratio 1.3001
        resolve_shared_links(outside)
        self.assertTrue(all(r["match_status"] == "excluded_ambiguous_link" for r in outside))


class TheRecordTravels(unittest.TestCase):
    def test_it_reports_what_it_did_rather_than_leaving_stations_missing(self) -> None:
        rows = [
            station("A", "7", 10000), station("B", "7", 10500),          # merged
            station("C", "9", 2, modeled=72220), station("D", "9", 33723, modeled=72220),  # ambiguous
            station("E", "3", 8000),                                      # untouched
        ]
        record = resolve_shared_links(rows)
        self.assertEqual(record["links_shared_by_several_stations"], 2)
        self.assertEqual(record["groups_merged_as_consistent"], 1)
        self.assertEqual(record["groups_excluded_as_ambiguous"], 1)
        self.assertEqual(record["stations_merged_away"], 1)
        self.assertEqual(record["stations_excluded_as_ambiguous"], 2)
        self.assertIn("network resolution", record["note"])


class TheWholeValidationRunAppliesIt(unittest.TestCase):
    """Because a mutation removing the CALL survived every test above.

    Testing the function alone proves the arithmetic and nothing about whether
    the validator ever reaches it.
    """

    def setUp(self) -> None:
        import csv
        import json
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.run_output = self.root / "run_output"
        self.run_output.mkdir(parents=True)
        (self.run_output / "link_volumes.csv").write_text("link_id,PCE_tot\n4242,20000\n")
        (self.run_output / "evidence_packet.json").write_text(json.dumps({"engine": "aequilibrae"}))
        (self.run_output / "loaded_links.geojson").write_text(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "geometry": {"type": "LineString", "coordinates": [[-121.0, 39.2], [-120.99, 39.21]]},
                            "properties": {"link_id": 4242, "name": "Main Street", "link_type": "primary"},
                        }
                    ],
                }
            )
        )
        self.csv = csv

    def counts(self, stations: list[tuple[str, float]]) -> Path:
        fields = [
            "station_id", "label", "facility_name", "count_type", "direction", "observed_volume",
            "source_agency", "source_description", "candidate_model_names", "candidate_link_types",
            "bbox_min_lon", "bbox_min_lat", "bbox_max_lon", "bbox_max_lat", "notes",
        ]
        path = self.root / "counts.csv"
        with path.open("w", newline="") as handle:
            writer = self.csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for station_id, observed in stations:
                writer.writerow({
                    "station_id": station_id, "label": f"Main Street at {station_id}",
                    "facility_name": "Main Street", "count_type": "AADT", "direction": "two_way",
                    "observed_volume": observed, "source_agency": "Caltrans",
                    "source_description": f"MAIN STREET {station_id}",
                    "candidate_model_names": "Main Street", "candidate_link_types": "primary",
                    "bbox_min_lon": "-121.05", "bbox_min_lat": "39.15",
                    "bbox_max_lon": "-120.95", "bbox_max_lat": "39.25", "notes": "",
                })
        return path

    def validate(self, stations):
        from validate_screening_observed_counts import run_validation_bundle

        return run_validation_bundle(
            run_output_dir=self.run_output,
            counts_csv=self.counts(stations),
            output_dir=self.root / "validation",
            required_matches=1,
        )

    def results(self):
        with (self.root / "validation" / "validation_results.csv").open(newline="") as handle:
            return {row["station_id"]: row for row in self.csv.DictReader(handle)}

    def test_two_disagreeing_stations_on_one_link_grade_nothing(self) -> None:
        summary = self.validate([("A", 2), ("B", 33723)])
        rows = self.results()
        self.assertEqual(rows["A"]["match_status"], "excluded_ambiguous_link")
        self.assertEqual(rows["B"]["match_status"], "excluded_ambiguous_link")
        self.assertEqual(summary["stations_matched"], 0)
        self.assertEqual(summary["shared_model_links"]["groups_excluded_as_ambiguous"], 1)

    def test_two_agreeing_stations_are_compared_once(self) -> None:
        summary = self.validate([("A", 19000), ("B", 21000)])
        statuses = sorted(row["match_status"] for row in self.results().values())
        self.assertEqual(statuses, ["matched", "merged_into_shared_link"])
        self.assertEqual(summary["stations_matched"], 1)
        self.assertEqual(summary["shared_model_links"]["groups_merged_as_consistent"], 1)

    def test_the_summary_carries_the_record(self) -> None:
        summary = self.validate([("A", 19000), ("B", 21000)])
        self.assertIn("shared_model_links", summary)
        self.assertIn("network resolution", summary["shared_model_links"]["note"])

    def tearDown(self) -> None:
        self.tmp.cleanup()


class DividedHighwaysAreComparedWhole(unittest.TestCase):
    """A count station measures the road; OSM maps a divided one as halves.

    Measured across 24 counties: 99% of motorway links are one-way
    carriageways, and a two-way link reads 2.09-2.14x higher than a one-way
    link of the same class. Freeways read 0.78 of observed for this reason
    alone.

    THIS TEST EXISTS BECAUSE THE FIRST WIRING SILENTLY DID NOTHING. The
    candidate dict rebuilds selected fields rather than copying the feature, so
    `is_one_way` was dropped on the way in and every divided highway was
    compared against a single carriageway — with the correction code present,
    tested, and never firing.
    """

    def setUp(self) -> None:
        import json
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.out = self.root / "run_output"
        self.out.mkdir(parents=True)
        (self.out / "link_volumes.csv").write_text("link_id,PCE_tot\n1,20000\n2,18000\n")
        (self.out / "evidence_packet.json").write_text(json.dumps({"engine": "aequilibrae"}))
        self.json = json

    def geojson(self, one_way: bool, include_property: bool = True) -> None:
        def feature(link_id, lon, offset):
            properties = {"link_id": link_id, "name": "Golden State Highway", "link_type": "motorway"}
            if include_property:
                properties["is_one_way"] = one_way
            return {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[lon, 39.2], [lon, 39.21]]},
                "properties": properties,
            }

        (self.out / "loaded_links.geojson").write_text(
            self.json.dumps({"type": "FeatureCollection", "features": [feature(1, -121.0, 0), feature(2, -121.0008, 1)]})
        )

    def counts(self) -> Path:
        path = self.root / "counts.csv"
        fields = [
            "station_id", "label", "facility_name", "count_type", "direction", "observed_volume",
            "source_agency", "source_description", "candidate_model_names", "candidate_link_types",
            "bbox_min_lon", "bbox_min_lat", "bbox_max_lon", "bbox_max_lat", "notes",
        ]
        with path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerow({
                "station_id": "S1", "label": "SR 99", "facility_name": "SR 99", "count_type": "AADT",
                "direction": "two_way", "observed_volume": "38000", "source_agency": "Caltrans",
                "source_description": "MAINLINE", "candidate_model_names": "Golden State Highway",
                "candidate_link_types": "motorway", "bbox_min_lon": -121.1, "bbox_min_lat": 39.1,
                "bbox_max_lon": -120.9, "bbox_max_lat": 39.3, "notes": "",
            })
        return path

    def run_it(self):
        from validate_screening_observed_counts import run_validation_bundle

        return run_validation_bundle(
            run_output_dir=self.out, counts_csv=self.counts(),
            output_dir=self.root / "validation", required_matches=1,
        )

    def results(self):
        with (self.root / "validation" / "validation_results.csv").open(newline="") as handle:
            return list(csv.DictReader(handle))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_both_carriageways_are_compared_against_the_station(self) -> None:
        self.geojson(one_way=True)
        summary = self.run_it()
        row = self.results()[0]
        self.assertEqual(row["carriageways_summed"], "2")
        self.assertEqual(float(row["modeled_daily_pce"]), 38000.0)
        self.assertEqual(float(row["absolute_percent_error"]), 0.0)
        self.assertTrue(summary["divided_highways"]["direction_known"])

    def test_a_two_way_road_is_left_alone(self) -> None:
        self.geojson(one_way=False)
        self.run_it()
        row = self.results()[0]
        self.assertEqual(row["carriageways_summed"], "1")
        self.assertEqual(float(row["modeled_daily_pce"]), 20000.0)

    def project_db(self, direction: int) -> None:
        import sqlite3

        db_dir = self.out.parent / "work" / "aeq_project"
        db_dir.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(db_dir / "project_database.sqlite")
        conn.execute("CREATE TABLE links (link_id INTEGER, direction INTEGER)")
        conn.executemany("INSERT INTO links VALUES (?, ?)", [(1, direction), (2, direction)])
        conn.commit()
        conn.close()

    def test_direction_is_recovered_from_the_project_database_when_geometry_lacks_it(self) -> None:
        """Every run made before the property existed is otherwise ungradable.

        The AequilibraE database the run was assigned on records the same fact
        (`direction` 0 = two-way), so those runs can be compared correctly
        without re-running them -- and the summary says where the fact came
        from rather than implying the geometry carried it.
        """
        self.geojson(one_way=True, include_property=False)
        self.project_db(direction=1)

        summary = self.run_it()
        row = self.results()[0]
        self.assertEqual(row["carriageways_summed"], "2")
        self.assertEqual(float(row["modeled_daily_pce"]), 38000.0)
        self.assertTrue(summary["divided_highways"]["direction_known"])
        self.assertEqual(summary["divided_highways"]["direction_source"], "project_database")
        self.assertIn("project database", summary["divided_highways"]["note"])

    def test_a_two_way_road_in_the_project_database_is_not_doubled(self) -> None:
        """The negative control. Without it, a backfill that marked EVERY link
        one-way passes every other test here and doubles half the network."""
        self.geojson(one_way=True, include_property=False)
        self.project_db(direction=0)

        self.run_it()
        row = self.results()[0]
        self.assertEqual(row["carriageways_summed"], "1")
        self.assertEqual(float(row["modeled_daily_pce"]), 20000.0)

    def test_a_run_without_the_direction_property_says_so_instead_of_silently_halving(self) -> None:
        # Runs made before the property existed cannot be corrected, and a
        # comparison that quietly skipped the correction is indistinguishable
        # from one that did not need it.
        self.geojson(one_way=True, include_property=False)
        summary = self.run_it()
        self.assertFalse(summary["divided_highways"]["direction_known"])
        self.assertIn("predates the carriageway-direction property", summary["divided_highways"]["note"])
        self.assertIn("roughly half", summary["divided_highways"]["note"])


class TheProjectDatabaseCandidatePathCarriesDirection(unittest.TestCase):
    """A candidate winning from the project database must know if it is one-way.

    This is a SECOND inert-correction bug of the same shape as the first, found
    only by measuring: with `--project-db` supplied, the winning candidate comes
    from `query_project_db_candidates`, which builds its own dicts. It did not
    select `direction`, so on the national 24-county grading only 9 of 239
    motorway stations were summed -- against 22 of 25 in the same county when
    the flag was omitted. The correction was installed, tested, and silent.

    It runs against a real spatialite database because the query uses
    `X(Centroid(geometry))`; a stub would test the stub.
    """

    def setUp(self) -> None:
        import sqlite3
        import tempfile

        from validate_screening_observed_counts import find_spatialite_path

        if not find_spatialite_path():
            self.skipTest("mod_spatialite not installed")
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "project_database.sqlite"
        conn = sqlite3.connect(self.db)
        conn.enable_load_extension(True)
        conn.load_extension(find_spatialite_path())
        conn.execute("SELECT InitSpatialMetaData(1)")
        conn.execute("CREATE TABLE links (link_id INTEGER, name TEXT, link_type TEXT, direction INTEGER)")
        conn.execute("SELECT AddGeometryColumn('links', 'geometry', 4326, 'LINESTRING', 'XY')")
        conn.execute(
            "INSERT INTO links VALUES (1, 'Golden State Highway', 'motorway', 1, "
            "GeomFromText('LINESTRING(-121.0 39.2, -121.0 39.21)', 4326))"
        )
        conn.execute(
            "INSERT INTO links VALUES (2, 'Ridge Road', 'secondary', 0, "
            "GeomFromText('LINESTRING(-121.01 39.2, -121.01 39.21)', 4326))"
        )
        conn.commit()
        conn.close()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def candidates(self):
        from validate_screening_observed_counts import query_project_db_candidates

        station = {
            "candidate_model_names": "Golden State Highway|Ridge Road",
            "bbox_min_lon": -121.1, "bbox_min_lat": 39.1,
            "bbox_max_lon": -120.9, "bbox_max_lat": 39.3,
        }
        rows = query_project_db_candidates(self.db, station, {1: {"v": "20000"}, 2: {"v": "5000"}}, "v")
        return {row["link_id"]: row for row in rows}

    def test_a_one_way_link_arrives_marked_one_way(self) -> None:
        found = self.candidates()
        self.assertTrue(found[1]["is_one_way"])
        self.assertTrue(found[1]["direction_recorded"])

    def test_a_two_way_link_arrives_marked_two_way(self) -> None:
        # The negative control: reporting every candidate one-way would double
        # half the network and pass the test above.
        self.assertFalse(self.candidates()[2]["is_one_way"])


class AnInertCorrectionIsDetected(unittest.TestCase):
    """The check that would have caught both wiring bugs, from output already written.

    Twice the carriageway correction was present, tested, and never reached with
    the data it needs. Both times the summary said "0 summed" and nobody read
    it. Nearly every US freeway is divided, so motorway stations matched with
    none summed is a defect signature, not a geography.
    """

    def setUp(self) -> None:
        import json
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.out = self.root / "run_output"
        self.out.mkdir(parents=True)
        (self.out / "evidence_packet.json").write_text(json.dumps({"engine": "aequilibrae"}))
        self.json = json

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def build(self, count: int, one_way: bool, paired: bool = False) -> dict:
        """`count` freeway stations, each on its own freeway far from the others.

        `paired` gives each freeway a second carriageway alongside it, which is
        what a real divided highway looks like. Without it nothing can pair, so
        the correction has nothing to do -- useful for exercising the detector,
        useless for proving it stays quiet when the wiring is sound.
        """
        volumes = ["link_id,PCE_tot"]
        features = []
        rows = []
        for i in range(count):
            lat = 39.0 + i * 0.1
            link_id = i * 2
            volumes.append(f"{link_id},20000")
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[-121.0, lat], [-121.0, lat + 0.01]]},
                "properties": {"link_id": link_id, "name": f"Freeway {i}", "link_type": "motorway", "is_one_way": one_way},
            })
            if paired:
                volumes.append(f"{link_id + 1},18000")
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-121.0008, lat], [-121.0008, lat + 0.01]]},
                    "properties": {"link_id": link_id + 1, "name": f"Freeway {i}", "link_type": "motorway", "is_one_way": one_way},
                })
            rows.append((f"S{i}", f"Freeway {i}", lat))
        (self.out / "link_volumes.csv").write_text("\n".join(volumes) + "\n")
        (self.out / "loaded_links.geojson").write_text(
            self.json.dumps({"type": "FeatureCollection", "features": features})
        )

        counts = self.root / "counts.csv"
        fields = [
            "station_id", "label", "facility_name", "count_type", "direction", "observed_volume",
            "source_agency", "source_description", "candidate_model_names", "candidate_link_types",
            "bbox_min_lon", "bbox_min_lat", "bbox_max_lon", "bbox_max_lat", "notes",
        ]
        with counts.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for station_id, name, lat in rows:
                writer.writerow({
                    "station_id": station_id, "label": name, "facility_name": name,
                    "count_type": "AADT", "direction": "two_way", "observed_volume": "38000",
                    "source_agency": "DOT", "source_description": "MAINLINE",
                    "candidate_model_names": name, "candidate_link_types": "motorway",
                    "bbox_min_lon": -121.05, "bbox_min_lat": lat - 0.02,
                    "bbox_max_lon": -120.95, "bbox_max_lat": lat + 0.03, "notes": "",
                })

        from validate_screening_observed_counts import run_validation_bundle

        return run_validation_bundle(
            run_output_dir=self.out, counts_csv=counts,
            output_dir=self.root / "validation", required_matches=1,
        )["divided_highways"]

    def test_ten_freeway_stations_and_none_summed_is_flagged(self) -> None:
        # One link per station, so nothing can pair: the exact shape of an
        # inert correction, with direction present and recorded.
        block = self.build(count=12, one_way=True)
        self.assertEqual(block["motorway_stations_matched"], 12)
        self.assertEqual(block["motorway_stations_summed"], 0)
        self.assertTrue(block["looks_like_the_correction_never_fired"])
        self.assertIn("WARNING", block["note"])

    def test_an_undivided_network_is_not_flagged(self) -> None:
        # Direction IS recorded and says two-way. Nothing should be summed and
        # nothing is wrong -- flagging here would train everyone to ignore it.
        block = self.build(count=12, one_way=False)
        self.assertEqual(block["motorway_stations_summed"], 0)
        self.assertFalse(block["looks_like_the_correction_never_fired"])
        self.assertNotIn("WARNING", block["note"])

    def test_a_correctly_wired_network_of_divided_freeways_is_not_flagged(self) -> None:
        """The decisive case. Twelve real divided freeways, each with both
        carriageways present and pairing normally -- the detector must stay
        quiet, or it says nothing about whether the wiring works."""
        block = self.build(count=12, one_way=True, paired=True)
        self.assertEqual(block["motorway_stations_matched"], 12)
        self.assertEqual(block["motorway_stations_summed"], 12)
        self.assertFalse(block["looks_like_the_correction_never_fired"])
        self.assertNotIn("WARNING", block["note"])

    def test_too_few_freeway_stations_to_conclude_anything(self) -> None:
        block = self.build(count=4, one_way=True)
        self.assertFalse(block["looks_like_the_correction_never_fired"])


if __name__ == "__main__":
    unittest.main()
