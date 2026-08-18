#!/usr/bin/env python3
"""The arithmetic that grades a trip-length fit.

Every figure this produces could decide whether OpenPlan changes what every
run tells a planner, so each is checked against a hand-worked value rather than
against the code's own answer.

The property that matters most: the multiplier is chosen on PUBLISHED VMT per
capita, and the count figures ride alongside as an independent check. A file
that let the counts choose would be fitting and grading on the same data — the
trap this lane has already documented twice.
"""
from __future__ import annotations

import csv
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import gamma_fit_analysis as gfa

METERS_PER_MILE = 1609.34


def build_run(root: Path, name: str, *, links, volumes, population, stations=()) -> Path:
    run = root / name
    (run / "work" / "aeq_project").mkdir(parents=True)
    (run / "run_output").mkdir(parents=True)
    (run / "package").mkdir(parents=True)
    (run / "validation").mkdir(parents=True)

    connection = sqlite3.connect(run / "work" / "aeq_project" / "project_database.sqlite")
    connection.execute("CREATE TABLE links (link_id INTEGER, link_type TEXT, distance REAL)")
    connection.executemany("INSERT INTO links VALUES (?,?,?)", links)
    connection.commit()
    connection.close()

    with (run / "run_output" / "link_volumes.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["link_id", "PCE_tot"])
        writer.writerows(volumes)

    with (run / "package" / "zone_attributes.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["zone_id", "est_population", "zone_kind"])
        writer.writerow([1, population, "internal"])

    if stations:
        fields = ["station_id", "match_status", "model_link_type", "absolute_percent_error", "volume_ratio_model_obs"]
        with (run / "validation" / "validation_results.csv").open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for station in stations:
                writer.writerow(station)
    return run


class NetworkVmt(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_it_is_volume_times_length_in_miles(self) -> None:
        run = build_run(
            self.root, "study-06047",
            links=[(1, "primary", METERS_PER_MILE * 2)],
            volumes=[(1, 1000)], population=100,
        )
        self.assertAlmostEqual(gfa.network_vmt(run), 2000.0, places=3)

    def test_centroid_connectors_contribute_nothing(self) -> None:
        # They carried 8.3% of modelled vehicle-miles in the study counties —
        # enough to move every figure this file produces.
        run = build_run(
            self.root, "study-06047",
            links=[(1, "primary", METERS_PER_MILE), (2, "centroid_connector", METERS_PER_MILE * 50)],
            volumes=[(1, 100), (2, 100)], population=100,
        )
        self.assertAlmostEqual(gfa.network_vmt(run), 100.0, places=3)

    def test_a_run_without_a_retained_project_is_refused_by_name(self) -> None:
        run = build_run(self.root, "study-06047", links=[(1, "primary", 100)], volumes=[(1, 1)], population=1)
        (run / "work" / "aeq_project" / "project_database.sqlite").unlink()
        with self.assertRaises(gfa.GammaFitError) as ctx:
            gfa.network_vmt(run)
        self.assertIn("study-06047", str(ctx.exception))


class GradingOneRun(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_the_ratio_is_model_over_published(self) -> None:
        # 2,210,000 vehicle-miles over 50,000 people = 44.2 per capita, and
        # California's published figure is 22.1 — exactly 2.0x.
        run = build_run(
            self.root, "study-06047",
            links=[(1, "primary", METERS_PER_MILE)],
            volumes=[(1, 2_210_000)], population=50_000,
        )
        graded = gfa.grade_run(run, "06047")
        self.assertAlmostEqual(graded["model_vmt_per_capita"], 44.2, places=1)
        self.assertAlmostEqual(graded["vmt_ratio"], 2.0, places=2)

    def test_a_state_with_no_published_figure_is_refused_rather_than_assumed(self) -> None:
        run = build_run(self.root, "study-48001", links=[(1, "primary", 100)], volumes=[(1, 10)], population=10)
        with self.assertRaises(gfa.GammaFitError) as ctx:
            gfa.grade_run(run, "48001")
        self.assertIn("48", str(ctx.exception))

    def test_count_accuracy_is_reported_when_present_and_empty_when_not(self) -> None:
        run = build_run(
            self.root, "study-06047",
            links=[(1, "primary", METERS_PER_MILE)], volumes=[(1, 1000)], population=100,
            stations=[
                {"station_id": "A", "match_status": "matched", "model_link_type": "motorway", "absolute_percent_error": "20", "volume_ratio_model_obs": "1.2"},
                {"station_id": "B", "match_status": "matched", "model_link_type": "motorway", "absolute_percent_error": "40", "volume_ratio_model_obs": "1.4"},
                {"station_id": "C", "match_status": "unmatched", "model_link_type": "", "absolute_percent_error": "", "volume_ratio_model_obs": ""},
            ],
        )
        counts = gfa.grade_run(run, "06047")["counts"]
        self.assertEqual(counts["stations"], 2)
        self.assertEqual(counts["median_ape"], 30.0)
        self.assertEqual(counts["by_road_class"]["motorway"]["stations"], 2)

        bare = build_run(self.root, "study-06069", links=[(1, "primary", 100)], volumes=[(1, 1)], population=1)
        self.assertEqual(gfa.grade_run(bare, "06069")["counts"]["stations"], 0)


class SummarizingAnArm(unittest.TestCase):
    def arm(self, ratios, apes):
        return [
            {
                "county_fips": f"0604{i}",
                "vmt_ratio": ratio,
                "counts": {
                    "stations": 10,
                    "median_ape": ape,
                    "bias": 1.0,
                    "by_road_class": {"motorway": {"stations": 10, "median_ape": ape}},
                },
            }
            for i, (ratio, ape) in enumerate(zip(ratios, apes))
        ]

    def test_it_medians_across_counties(self) -> None:
        summary = gfa.summarize_arm(self.arm([1.0, 2.0, 3.0], [50.0, 60.0, 70.0]))
        self.assertEqual(summary["median_vmt_ratio"], 2.0)
        self.assertEqual(summary["median_count_ape"], 60.0)
        self.assertEqual(summary["counties"], 3)
        self.assertEqual(summary["stations"], 30)

    def test_it_keeps_the_road_class_breakdown_the_rule_needs(self) -> None:
        # The pre-registered rule refuses a fit that makes any well-sampled
        # road class materially worse, so the breakdown has to survive.
        summary = gfa.summarize_arm(self.arm([1.0, 1.1], [50.0, 70.0]))
        self.assertEqual(summary["median_ape_by_road_class"]["motorway"], 60.0)

    def test_an_empty_arm_reports_nothing_rather_than_zero(self) -> None:
        self.assertEqual(gfa.summarize_arm([]), {"counties": 0})


class WhatItRefusesToConflate(unittest.TestCase):
    def test_it_states_that_counts_must_not_choose_the_multiplier(self) -> None:
        # The whole discipline of this experiment in one assertion.
        import io
        from contextlib import redirect_stdout

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.json"
            sys.argv = ["gamma_fit_analysis.py", "--runs-root", tmp, "--prefix", "gam1.5", "--output", str(output)]
            with redirect_stdout(io.StringIO()):
                gfa.main()
            payload = json.loads(output.read_text())
        joined = " ".join(payload["what_this_is_not"])
        self.assertIn("must not be used to choose", joined)
        self.assertIn("right total is not a right distribution", joined)




class BothArmsMustBeGradedOnTheSameStations(unittest.TestCase):
    """CAUGHT MID-EXPERIMENT, 2026-08-17.

    The baseline runs predate the ramp-count and shared-link exclusions, so
    they match 102 stations where a current run matches 75. Graded as-is, a
    gamma change would have been credited with a station-set change — the
    comparison would have measured my own earlier fixes.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_the_baseline_can_be_graded_from_a_re_validated_directory(self) -> None:
        run = build_run(
            self.root, "study-06047",
            links=[(1, "primary", METERS_PER_MILE)], volumes=[(1, 1000)], population=100,
            stations=[
                {"station_id": "A", "match_status": "matched", "model_link_type": "motorway", "absolute_percent_error": "200", "volume_ratio_model_obs": "3"},
            ],
        )
        # The re-validated directory: the same run, current exclusions applied.
        current = run / "validation_v3"
        current.mkdir()
        fields = ["station_id", "match_status", "model_link_type", "absolute_percent_error", "volume_ratio_model_obs"]
        with (current / "validation_results.csv").open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerow({"station_id": "A", "match_status": "excluded_ambiguous_link", "model_link_type": "motorway", "absolute_percent_error": "", "volume_ratio_model_obs": ""})

        stale = gfa.grade_run(run, "06047")
        fresh = gfa.grade_run(run, "06047", "validation_v3")
        self.assertEqual(stale["counts"]["stations"], 1)
        self.assertEqual(fresh["counts"]["stations"], 0)
        # And the record says which directory each figure came from, so a
        # reader can tell whether two arms were comparable.
        self.assertEqual(fresh["validation_read_from"], "validation_v3")

    def test_the_default_is_the_ordinary_directory(self) -> None:
        run = build_run(self.root, "study-06047", links=[(1, "primary", 100)], volumes=[(1, 1)], population=1)
        self.assertEqual(gfa.grade_run(run, "06047")["validation_read_from"], "validation")

if __name__ == "__main__":
    unittest.main()
