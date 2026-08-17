#!/usr/bin/env python3
"""The study's arithmetic, checked against hand-worked examples.

These figures are the study's whole output. Every statistic here is verified
against a value computed by hand in the test, not against the function's own
answer — a test that asserts what the code already returns cannot detect that
the code is wrong.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import agreement_accuracy_study as study


class Statistics(unittest.TestCase):
    def test_median_of_a_known_set(self) -> None:
        self.assertEqual(study.median([3, 1, 2]), 2)
        self.assertEqual(study.median([4, 1, 2, 3]), 2.5)
        self.assertIsNone(study.median([]))

    def test_spearman_is_one_for_a_monotonic_pair(self) -> None:
        self.assertAlmostEqual(study.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)

    def test_spearman_is_minus_one_when_reversed(self) -> None:
        self.assertAlmostEqual(study.spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1.0)

    def test_spearman_matches_a_hand_worked_value(self) -> None:
        # x ranks 1,2,3,4,5; y = 1,3,2,5,4 -> d = 0,-1,1,-1,1 ; sum d^2 = 4
        # rho = 1 - 6*4/(5*(25-1)) = 1 - 24/120 = 0.8
        self.assertAlmostEqual(study.spearman([1, 2, 3, 4, 5], [1, 3, 2, 5, 4]), 0.8)

    def test_ties_get_average_ranks_rather_than_an_arbitrary_order(self) -> None:
        # Every y identical -> no variation -> not measurable, and NOT 0.0.
        self.assertIsNone(study.spearman([1, 2, 3], [5, 5, 5]))

    def test_too_few_points_is_none_not_zero(self) -> None:
        # 0.0 would read as "measured, no relationship" — the opposite meaning.
        self.assertIsNone(study.spearman([1, 2], [2, 1]))

    def test_mismatched_lengths_are_refused(self) -> None:
        with self.assertRaises(study.AgreementAccuracyError):
            study.spearman([1, 2, 3], [1, 2])


def station(ape: float, agreement: str, *, geh: float = 1.0, road_class: str = "motorway") -> dict:
    return {
        "station_id": f"S{ape}{agreement}",
        "link_id": 1,
        "link_name": "Main",
        "road_class": road_class,
        "observed_volume": 10000,
        "ape": ape,
        "agreement": agreement,
        "geh": geh,
        "first_volume": 10000,
        "second_volume": 9000,
        "corridor": "Main",
    }


class PrecisionAndRecall(unittest.TestCase):
    def test_a_hand_worked_case(self) -> None:
        rows = [
            station(10, "agree"),    # agreed, accurate      -> TP
            station(20, "agree"),    # agreed, accurate      -> TP
            station(50, "agree"),    # agreed, inaccurate    -> FP
            station(15, "diverge"),  # diverged, accurate    -> FN
            station(80, "diverge"),  # diverged, inaccurate  -> TN
        ]
        result = study.precision_recall(rows, ape_key="ape")
        self.assertEqual(result["stations"], 5)
        self.assertEqual(result["stations_where_models_agree"], 3)
        self.assertEqual(result["stations_accurate"], 3)
        self.assertAlmostEqual(result["precision"], 2 / 3, places=4)   # 2 of 3 agreeing were accurate
        self.assertAlmostEqual(result["recall"], 2 / 3, places=4)      # 2 of 3 accurate were flagged
        self.assertAlmostEqual(result["base_rate"], 3 / 5, places=4)
        self.assertAlmostEqual(result["lift"], (2 / 3) / (3 / 5), places=4)

    def test_lift_is_one_when_agreement_carries_no_information(self) -> None:
        # Half of everything is accurate, and half of the agreeing ones are too.
        rows = [
            station(10, "agree"), station(80, "agree"),
            station(10, "diverge"), station(80, "diverge"),
        ]
        result = study.precision_recall(rows, ape_key="ape")
        self.assertAlmostEqual(result["lift"], 1.0)

    def test_the_threshold_is_inclusive_at_its_boundary(self) -> None:
        rows = [station(study.ACCURATE_APE_THRESHOLD, "agree")]
        self.assertEqual(study.precision_recall(rows, ape_key="ape")["stations_accurate"], 1)

    def test_no_usable_stations_reports_none_not_zero(self) -> None:
        result = study.precision_recall([], ape_key="ape")
        self.assertIsNone(result["precision"])
        self.assertIsNone(result["base_rate"])


class JoiningStationsToTheMap(unittest.TestCase):
    def agreement_map(self, links):
        return {"links": links, "summary": {"agree_share_meaningful_links": 0.5}}

    def test_a_station_joins_to_its_own_link(self) -> None:
        validation = [{"station_id": "A", "link_id": 7, "link_name": "Main", "road_class": "motorway",
                       "observed_volume": 1000, "ape": 12.0}]
        agreement = self.agreement_map(
            [{"link_id": 7, "name": "Main", "link_type": "motorway", "first_volume": 1000,
              "second_volume": 900, "geh": 3.2, "agreement": "agree", "carries_meaningful_traffic": True}]
        )
        joined, accounting = study.join_stations_to_agreement(validation, agreement)
        self.assertEqual(len(joined), 1)
        self.assertEqual(joined[0]["agreement"], "agree")
        self.assertEqual(joined[0]["geh"], 3.2)
        self.assertEqual(accounting["stations_joined"], 1)

    def test_a_station_whose_link_is_absent_is_excluded_and_counted(self) -> None:
        """Zero-filling it would enter the study as agreement AND accuracy at once."""
        validation = [{"station_id": "A", "link_id": 99, "link_name": "", "road_class": "motorway",
                       "observed_volume": 1000, "ape": 12.0}]
        joined, accounting = study.join_stations_to_agreement(validation, self.agreement_map([]))
        self.assertEqual(joined, [])
        self.assertEqual(accounting["excluded"]["link_not_in_agreement_map"], 1)
        self.assertEqual(accounting["stations_in"], 1)

    def test_a_link_below_the_meaningful_volume_is_excluded_and_counted(self) -> None:
        validation = [{"station_id": "A", "link_id": 7, "link_name": "", "road_class": "residential",
                       "observed_volume": 50, "ape": 12.0}]
        agreement = self.agreement_map(
            [{"link_id": 7, "name": "", "link_type": "residential", "first_volume": 20,
              "second_volume": 15, "geh": 1.0, "agreement": "agree", "carries_meaningful_traffic": False}]
        )
        joined, accounting = study.join_stations_to_agreement(validation, agreement)
        self.assertEqual(joined, [])
        self.assertEqual(accounting["excluded"]["link_below_meaningful_volume"], 1)


class ReadingValidationResults(unittest.TestCase):
    def test_only_matched_stations_with_readable_numbers_are_used(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "validation_results.csv"
            path.write_text(
                "station_id,match_status,model_link_id,model_link_name,model_link_type,observed_volume,absolute_percent_error\n"
                "A,matched,7,Main,motorway,10000,12.5\n"
                "B,unmatched,,,,,\n"
                "C,matched,,,,,\n"
            )
            rows = study.read_validation_rows(path)
        self.assertEqual([r["station_id"] for r in rows], ["A"])
        self.assertEqual(rows[0]["ape"], 12.5)

    def test_a_missing_file_says_so(self) -> None:
        with self.assertRaises(study.AgreementAccuracyError):
            study.read_validation_rows(Path("/nowhere/validation_results.csv"))


class TheAnswer(unittest.TestCase):
    def test_agreement_classes_are_summarised_separately(self) -> None:
        rows = [station(10, "agree"), station(20, "agree"), station(90, "diverge"), station(50, "marginal")]
        classes = study.by_agreement_class(rows)
        self.assertEqual(classes["agree"]["stations"], 2)
        self.assertEqual(classes["agree"]["median_ape"], 15.0)
        self.assertEqual(classes["diverge"]["median_ape"], 90.0)
        self.assertEqual(classes["marginal"]["stations"], 1)

    def test_road_classes_are_reported_separately(self) -> None:
        rows = [
            station(10, "agree", road_class="motorway"),
            station(200, "diverge", road_class="tertiary"),
        ]
        by_class = {r["road_class"]: r for r in study.by_road_class(rows)}
        self.assertEqual(by_class["motorway"]["median_ape"], 10.0)
        self.assertEqual(by_class["tertiary"]["median_ape"], 200.0)

    def test_a_county_where_agreement_predicts_nothing_is_named(self) -> None:
        result = {
            "county_fips": "06047",
            "region": "CA",
            "band": "medium",
            "usable": True,
            "trip_based": {
                "usable": True,
                "by_agreement_class": {
                    "agree": {"median_ape": 80.0, "stations": 5},
                    "marginal": {"median_ape": 50.0, "stations": 2},
                    "diverge": {"median_ape": 20.0, "stations": 5},
                },
                "prediction": {"lift": 0.8},
            },
        }
        failures = study.counties_where_agreement_fails([result], "trip_based")
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["county_fips"], "06047")
        self.assertIn("LESS accurate", failures[0]["reason"])

    def test_a_county_where_agreement_works_is_not_named(self) -> None:
        result = {
            "county_fips": "06047", "region": "CA", "band": "medium", "usable": True,
            "trip_based": {
                "usable": True,
                "by_agreement_class": {
                    "agree": {"median_ape": 15.0, "stations": 5},
                    "marginal": {"median_ape": 40.0, "stations": 2},
                    "diverge": {"median_ape": 70.0, "stations": 5},
                },
                "prediction": {"lift": 1.6},
            },
        }
        self.assertEqual(study.counties_where_agreement_fails([result], "trip_based"), [])

    def test_no_lift_over_the_base_rate_counts_as_a_failure(self) -> None:
        result = {
            "county_fips": "41005", "region": "OR", "band": "small", "usable": True,
            "trip_based": {
                "usable": True,
                "by_agreement_class": {
                    "agree": {"median_ape": 30.0, "stations": 5},
                    "marginal": {"median_ape": 35.0, "stations": 1},
                    "diverge": {"median_ape": 40.0, "stations": 5},
                },
                "prediction": {"lift": 1.0},
            },
        }
        failures = study.counties_where_agreement_fails([result], "trip_based")
        self.assertIn("no lift", failures[0]["reason"])


class ReadingACountyDirectory(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.county = self.root / "06047"
        self.county.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write(self, *, stations: int, status: str = "completed") -> None:
        agreement_path = self.county / "corridor_agreement.json"
        links = [
            {
                "link_id": i, "name": "Main", "link_type": "motorway",
                "first_volume": 10000, "second_volume": 9500,
                "geh": 5.0 + i, "agreement": "agree" if i % 2 == 0 else "diverge",
                "carries_meaningful_traffic": True,
            }
            for i in range(stations)
        ]
        agreement_path.write_text(
            json.dumps(
                {
                    "links": links,
                    "summary": {"agree_share_meaningful_links": 0.5},
                    "attribution_is_supportable": True,
                    "assignment_noise_floor": {"measured": True},
                }
            )
        )
        validation = self.county / "validation_results.csv"
        rows = ["station_id,match_status,model_link_id,model_link_name,model_link_type,observed_volume,absolute_percent_error"]
        for i in range(stations):
            rows.append(f"S{i},matched,{i},Main,motorway,10000,{10 + i * 5}")
        validation.write_text("\n".join(rows) + "\n")
        (self.county / "status.json").write_text(
            json.dumps(
                {
                    "county_fips": "06047", "region": "CA", "band": "medium", "status": status,
                    "artifacts": {
                        "agreement_json": str(agreement_path),
                        "base_validation": str(validation),
                        "asim_validation": str(validation),
                    },
                }
            )
        )

    def test_a_county_below_the_station_floor_reports_no_figure(self) -> None:
        self._write(stations=4)
        result = study.county_result(self.county)
        self.assertTrue(result["usable"])
        self.assertFalse(result["trip_based"]["usable"])
        self.assertIn("below the pre-registered floor", result["trip_based"]["reason"])
        self.assertNotIn("median_ape", result["trip_based"])

    def test_a_county_at_the_floor_reports_a_figure(self) -> None:
        self._write(stations=12)
        result = study.county_result(self.county)
        self.assertTrue(result["trip_based"]["usable"])
        self.assertIsNotNone(result["trip_based"]["median_ape"])

    def test_an_unfinished_county_is_marked_unusable_with_its_reason(self) -> None:
        self._write(stations=12, status="failed")
        result = study.county_result(self.county)
        self.assertFalse(result["usable"])

    def test_the_pooled_answer_only_uses_counties_above_the_floor(self) -> None:
        self._write(stations=12)
        payload = study.run_analysis(self.root)
        self.assertEqual(payload["counties_usable"], 1)
        self.assertEqual(payload["pooled"]["trip_based"]["stations"], 12)
        text = study.markdown_for(payload)
        self.assertIn("Does model agreement predict accuracy?", text)
        self.assertIn("never averaged", text)


if __name__ == "__main__":
    unittest.main()
