#!/usr/bin/env python3
"""The seam between the gateway-count module and a run.

`gateway_counts.py` was written, tested, and called by NOTHING for as long as it
existed — a complete capability no run could reach, which is the defect class
this repository has recorded eleven times. Its own tests still pass with the
module unreachable, so they cannot cover this. These do.
"""
from __future__ import annotations

import csv
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import screening_runtime as sr

COUNT_FIELDS = [
    "station_id", "label", "facility_name", "count_type", "direction", "observed_volume",
    "source_agency", "source_description", "candidate_model_names", "candidate_link_types",
    "bbox_min_lon", "bbox_min_lat", "bbox_max_lon", "bbox_max_lat", "station_role", "notes",
]


def write_counts(path: Path, rows: list[dict]) -> Path:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COUNT_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in COUNT_FIELDS})
    return path


def count_row(station_id: str, name: str, volume: float, lon: float, lat: float) -> dict:
    return {
        "station_id": station_id, "label": name, "facility_name": name,
        "count_type": "AADT", "direction": "two_way", "observed_volume": str(volume),
        "source_agency": "DOT", "source_description": "MAINLINE",
        "candidate_model_names": name, "candidate_link_types": "motorway",
        "bbox_min_lon": lon - 0.001, "bbox_min_lat": lat - 0.001,
        "bbox_max_lon": lon + 0.001, "bbox_max_lat": lat + 0.001,
        "station_role": "mainline",
    }


def gateway(label: str, name: str, lon: float, lat: float, daily: float = 15000.0) -> dict:
    return {
        "label": label, "link_type": "motorway", "link_id": 1, "name": name,
        "direction": 0,
        "daily_in": daily, "daily_out": daily,
        "boundary_lon": lon, "boundary_lat": lat,
    }


class SeedingReachesTheGateways(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_a_measured_crossing_replaces_the_class_default(self) -> None:
        counts = write_counts(self.root / "c.csv", [count_row("S1", "Golden State Highway", 33000, -121.0, 39.2)])
        seeded, record = sr.seed_boundary_traffic_from_counts(
            [gateway("gw", "Golden State Highway", -121.0, 39.2)], counts
        )
        # 33,000 both ways becomes 16,500 in and 16,500 out — total crossings
        # equal the measurement, where the default injected 30,000.
        self.assertEqual(seeded[0]["daily_in"], 16500.0)
        self.assertEqual(seeded[0]["daily_out"], 16500.0)
        self.assertEqual(seeded[0]["daily_basis"], "published_count")
        self.assertIn("S1", record.get("stations_consumed") or [])

    def test_an_unmeasured_crossing_keeps_the_default_and_says_so(self) -> None:
        # The honest half: "6 of 8 measured" is worthless if the other two are
        # silent about it.
        counts = write_counts(self.root / "c.csv", [count_row("S1", "Some Other Road", 33000, -118.0, 34.0)])
        seeded, _ = sr.seed_boundary_traffic_from_counts(
            [gateway("gw", "Golden State Highway", -121.0, 39.2)], counts
        )
        self.assertEqual(seeded[0]["daily_basis"], "road_class_default")
        self.assertEqual(seeded[0]["daily_in"], 15000.0)
        self.assertIn("not a measurement", seeded[0]["daily_basis_note"])


class TheSeedingStationsCannotAlsoGradeTheRun(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.counts = write_counts(self.root / "counts.csv", [
            count_row("S1", "Golden State Highway", 33000, -121.0, 39.2),
            count_row("S2", "Ridge Road", 8000, -121.4, 39.4),
        ])

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_a_station_that_set_the_traffic_is_dropped_from_the_grading_set(self) -> None:
        result = sr.withhold_seeding_stations_from_grading(
            self.counts, self.root / "grading.csv", ["S1"]
        )
        self.assertEqual(result["stations_withheld"], 1)
        self.assertEqual(result["stations_remaining"], 1)
        with Path(result["counts_csv"]).open(newline="") as handle:
            remaining = [row["station_id"] for row in csv.DictReader(handle)]
        self.assertEqual(remaining, ["S2"])

    def test_nothing_is_withheld_when_nothing_was_seeded(self) -> None:
        # A run with no measured crossing must grade on its whole count set, not
        # on a needlessly shrunken one.
        result = sr.withhold_seeding_stations_from_grading(self.counts, self.root / "g.csv", [])
        self.assertEqual(result["stations_withheld"], 0)
        self.assertIsNone(result["counts_csv"])

    def test_the_withheld_count_travels_rather_than_the_set_quietly_shrinking(self) -> None:
        result = sr.withhold_seeding_stations_from_grading(self.counts, self.root / "g.csv", ["S1"])
        self.assertIn("cannot be graded on the numbers it was built from", result["note"])

    def test_the_grading_file_keeps_every_column_the_validator_reads(self) -> None:
        # The validator reads station_role, bboxes and candidate names off this
        # file. A filter that rewrote it with fewer columns would not fail here
        # — it would quietly change which stations match anything at all.
        result = sr.withhold_seeding_stations_from_grading(
            self.counts, self.root / "grading.csv", ["S1"]
        )
        with self.counts.open(newline="") as handle:
            original = csv.DictReader(handle).fieldnames
        with Path(result["counts_csv"]).open(newline="") as handle:
            written = csv.DictReader(handle).fieldnames
        self.assertEqual(written, original)

    def test_the_surviving_rows_keep_their_values(self) -> None:
        result = sr.withhold_seeding_stations_from_grading(
            self.counts, self.root / "grading.csv", ["S1"]
        )
        with Path(result["counts_csv"]).open(newline="") as handle:
            row = next(iter(csv.DictReader(handle)))
        self.assertEqual(row["observed_volume"], "8000")
        self.assertEqual(row["facility_name"], "Ridge Road")
        self.assertEqual(row["station_role"], "mainline")


class TheGatewayRecordMustCarryWhatMatchingNeeds(unittest.TestCase):
    """The bug that made the first seeded run report "no counts nearby".

    `detect_external_gateways` builds its final gateway records field by field
    rather than copying the candidate, and dropped `name`. `match_count_to_gateway`
    reads that field first and returned None for every crossing, so all eight
    fell back to the road-class default and the run said so in a sentence that
    read like a fact about San Benito County. It was a fact about the dict.

    Third instance in one day of the same shape — the other two were
    `is_one_way` in the count validator's candidates and `direction` in its
    project-database query.
    """

    def test_the_run_builds_gateways_that_carry_a_road_name(self) -> None:
        # Comments are STRIPPED before matching. The comment sitting on this
        # very field says the word "name", and a guard satisfied by the
        # explanation of why it exists is a guard that passes after the code is
        # deleted — five guards in this repo have been broken exactly that way.
        import inspect

        source = inspect.getsource(sr.detect_external_gateways)
        code_only = "\n".join(
            line for line in source.splitlines() if not line.lstrip().startswith("#")
        )
        built = code_only[code_only.index("gateways.append("):]
        self.assertIn('"name"', built, "the gateway record dropped `name`; seeding cannot match anything")

    def test_the_run_builds_gateways_that_carry_link_direction(self) -> None:
        import inspect

        source = inspect.getsource(sr.detect_external_gateways)
        code_only = "\n".join(
            line for line in source.splitlines() if not line.lstrip().startswith("#")
        )
        built = code_only[code_only.index("gateways.append("):]
        self.assertIn(
            '"direction"',
            built,
            "the gateway record dropped link direction; strict count matching would reject every crossing",
        )

    def test_a_nameless_crossing_is_refused_rather_than_read_as_unmatched(self) -> None:
        from gateway_counts import GatewayCountsError, match_count_to_gateway

        nameless = {"link_type": "motorway", "boundary_lon": -121.0, "boundary_lat": 39.2}
        with self.assertRaises(GatewayCountsError) as caught:
            match_count_to_gateway(nameless, [])
        self.assertIn("no `name`", str(caught.exception))

    def test_a_named_crossing_with_no_nearby_count_is_still_just_unmatched(self) -> None:
        # The refusal above must not swallow the ordinary case, which is most of
        # the country: a real road with no published count near the boundary.
        from gateway_counts import match_count_to_gateway

        named = {"name": "Some Road", "link_type": "motorway", "boundary_lon": -121.0, "boundary_lat": 39.2}
        self.assertIsNone(match_count_to_gateway(named, []))


class TheCountsStageMustPrecedeDemand(unittest.TestCase):
    """Seeding is only possible if the counts are fetched before demand is built.

    They used to be fetched AFTER the assignment, which was correct when their
    only job was grading it. Now they also set how much traffic enters the study
    area, and a refactor that moved them back would not break anything visibly —
    every crossing would quietly fall back to its road-class default and the run
    would report that as a fact about the county.

    Checked against a completed run's own recorded stage order, so it holds the
    real sequence rather than the shape of the source file. Skipped where no run
    is on disk, which keeps the file runnable anywhere.
    """

    def test_the_run_fetches_counts_before_it_builds_demand(self) -> None:
        # Asserted on the code, not on runs found on disk: this repository holds
        # a hundred runs made BEFORE the reorder whose stage order is correct
        # history, and grading them against today's invariant would fail for the
        # right reason at the wrong target.
        #
        # Comments stripped first — the comment explaining the ordering names
        # both stages, and a guard its own explanation satisfies survives the
        # deletion of what it guards.
        import inspect

        source = inspect.getsource(sr.run_screening_model)
        code_only = "\n".join(
            line for line in source.splitlines() if not line.lstrip().startswith("#")
        )
        counts_at = code_only.find('"counts",')
        demand_at = code_only.find('"demand",')
        self.assertNotEqual(counts_at, -1, "the run no longer has a counts stage")
        self.assertNotEqual(demand_at, -1, "the run no longer has a demand stage")
        self.assertLess(
            counts_at, demand_at,
            "demand is built before the counts are fetched, so no boundary crossing can be seeded "
            "from a measurement — every one would fall back to its road-class default and the run "
            "would report that as a fact about the county",
        )


if __name__ == "__main__":
    unittest.main(verbosity=1)
