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
import statistics
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

class TheFourPreRegisteredCriteria(unittest.TestCase):
    """The rules from TRIP_LENGTH_CALIBRATION_2026-08-17.md, applied as arithmetic.

    They are code because the alternative is someone reading a table of numbers
    and deciding how they feel about it — which is exactly what pre-registering
    them was meant to prevent. Each test states the rule it is checking.
    """

    def arms(self, *, ratio, ape_before=100.0, ape_after=60.0, classes_before=None, classes_after=None):
        baseline = {
            "median_vmt_ratio": 2.29,
            "median_count_ape": ape_before,
            "median_ape_by_road_class": classes_before or {"motorway": 60.0, "primary": 200.0},
        }
        candidate = {
            "median_vmt_ratio": ratio,
            "median_count_ape": ape_after,
            "median_ape_by_road_class": classes_after or {"motorway": 40.0, "primary": 120.0},
        }
        return baseline, candidate

    def runs(self, **stations):
        counts = stations or {"motorway": 30, "primary": 50}
        return [{"counts": {"by_road_class": {n: {"stations": c, "median_ape": 1.0} for n, c in counts.items()}}}]

    def grade(self, multiplier=2.0, **kwargs):
        from gamma_fit_analysis import grade_against_preregistered_criteria

        runs = kwargs.pop("runs", None) or self.runs()
        baseline, candidate = self.arms(**kwargs)
        return grade_against_preregistered_criteria(
            multiplier=multiplier, baseline_arm=baseline,
            candidate_arm=candidate, candidate_runs=runs,
        )

    def criterion(self, result, number):
        return next(c for c in result["criteria"] if c["criterion"] == number)

    def test_everything_passing_is_adoptable(self) -> None:
        result = self.grade(ratio=1.0)
        self.assertTrue(result["adoptable"])
        self.assertEqual(result["failed_criteria"], [])

    def test_criterion_1_is_a_band_around_one_not_an_improvement(self) -> None:
        # 1.52 is a huge improvement on 2.29 and still fails. That is the point:
        # the rule asks whether the model is right, not whether it moved.
        self.assertFalse(self.criterion(self.grade(ratio=1.52), 1)["passes"])
        self.assertTrue(self.criterion(self.grade(ratio=1.35), 1)["passes"])
        self.assertFalse(self.criterion(self.grade(ratio=1.36), 1)["passes"])
        self.assertTrue(self.criterion(self.grade(ratio=0.65), 1)["passes"])
        self.assertFalse(self.criterion(self.grade(ratio=0.64), 1)["passes"])

    def test_criterion_2_needs_twenty_points_of_count_error(self) -> None:
        self.assertTrue(self.criterion(self.grade(ratio=1.0, ape_after=80.0), 2)["passes"])
        self.assertFalse(self.criterion(self.grade(ratio=1.0, ape_after=80.01), 2)["passes"])

    def test_criterion_3_ignores_a_class_below_the_station_floor(self) -> None:
        # Tertiary got worse by 30 points on 10 stations. The rule says 20, so
        # this must not sink an arm — a median over 10 stations is noise.
        result = self.grade(
            ratio=1.0,
            classes_before={"motorway": 60.0, "tertiary": 60.0},
            classes_after={"motorway": 40.0, "tertiary": 90.0},
            runs=self.runs(motorway=30, tertiary=10),
        )
        self.assertTrue(self.criterion(result, 3)["passes"])
        self.assertIn("tertiary", self.criterion(result, 3)["classes_below_the_station_floor"])

    def test_criterion_3_catches_a_well_sampled_class_getting_worse(self) -> None:
        result = self.grade(
            ratio=1.0,
            classes_before={"motorway": 30.0, "primary": 200.0},
            classes_after={"motorway": 47.0, "primary": 120.0},
            runs=self.runs(motorway=66, primary=50),
        )
        self.assertFalse(self.criterion(result, 3)["passes"])
        self.assertFalse(result["adoptable"])
        self.assertEqual(self.criterion(result, 3)["value"][0]["road_class"], "motorway")
        self.assertEqual(self.criterion(result, 3)["value"][0]["worse_by_points"], 17.0)

    def test_criterion_3_tolerates_ten_points_and_not_eleven(self) -> None:
        for worse_by, expected in ((10.0, True), (10.5, False)):
            result = self.grade(
                ratio=1.0,
                classes_before={"motorway": 30.0},
                classes_after={"motorway": 30.0 + worse_by},
                runs=self.runs(motorway=25),
            )
            self.assertEqual(self.criterion(result, 3)["passes"], expected, f"worse by {worse_by}")

    def test_criterion_4_rejects_a_multiplier_outside_the_band(self) -> None:
        self.assertTrue(self.criterion(self.grade(ratio=1.0, multiplier=3.0), 4)["passes"])
        self.assertFalse(self.criterion(self.grade(ratio=1.0, multiplier=4.0), 4)["passes"])
        self.assertFalse(self.criterion(self.grade(ratio=1.0, multiplier=0.4), 4)["passes"])

    def test_one_failure_is_enough_to_block_adoption(self) -> None:
        result = self.grade(ratio=1.52)
        self.assertFalse(result["adoptable"])
        self.assertEqual(result["failed_criteria"], [1])
        self.assertIn("criterion 1", result["verdict"])
        self.assertIn("defaults stay", result["verdict"])


class ArmsWithDifferentCountiesAreNotComparable(unittest.TestCase):
    """The failure that made a monotone curve look like it reversed.

    A x4.0 arm lost one county to an unfinished run. Its median VMT ratio came
    out at 1.51 against 1.38 for x3.0, which reads as the parameter turning
    around. Every county had actually fallen monotonically; the difference was
    the missing county. The tool DID name the ungraded run in a field — and the
    medians were what got read.
    """

    def test_an_arm_summary_names_the_counties_it_covers(self) -> None:
        runs = [
            {"county_fips": "06047", "vmt_ratio": 1.7,
             "counts": {"median_ape": 80.0, "stations": 10, "by_road_class": {}}},
            {"county_fips": "06069", "vmt_ratio": 2.4,
             "counts": {"median_ape": 90.0, "stations": 10, "by_road_class": {}}},
        ]
        summary = gfa.summarize_arm(runs)
        self.assertEqual(summary["county_fips"], ["06047", "06069"])
        self.assertEqual(summary["counties"], 2)

    def test_a_median_over_a_different_county_set_is_a_different_median(self) -> None:
        # The arithmetic behind the false reversal, stated plainly: dropping one
        # county moves the median more than the parameter did.
        five = [1.68, 2.44, 1.03, 1.19, 1.34]
        four = [1.68, 2.44, 1.19, 1.34]
        self.assertAlmostEqual(statistics.median(five), 1.34)
        self.assertAlmostEqual(statistics.median(four), 1.51)


if __name__ == "__main__":
    unittest.main()
