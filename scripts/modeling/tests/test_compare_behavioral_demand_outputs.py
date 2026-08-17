from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from compare_behavioral_demand_outputs import (
    compare_behavioral_demand_outputs,
    compare_link_volume_runs,
    read_link_names,
)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


class CompareBehavioralDemandOutputsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_compares_successful_outputs_and_reports_mismatched_coverage(self) -> None:
        current_path = self.root / "current.json"
        baseline_path = self.root / "baseline.json"
        write_json(
            current_path,
            {
                "summary_type": "activitysim_behavioral_kpi_summary",
                "source": {"runtime_mode": "activitysim_cli", "runtime_status": "succeeded"},
                "availability": {"status": "behavioral_kpis_available", "reasons": []},
                "totals": {"trips": 120},
                "trip_volumes_by_purpose": {
                    "values": [
                        {"label": "work", "count": 80, "share": 0.666667},
                        {"label": "school", "count": 40, "share": 0.333333},
                    ]
                },
                "mode_shares": {"values": []},
                "segment_summaries": [],
                "caveats": ["Current prototype only."],
            },
        )
        write_json(
            baseline_path,
            {
                "summary_type": "activitysim_behavioral_kpi_summary",
                "source": {"runtime_mode": "activitysim_cli", "runtime_status": "succeeded"},
                "availability": {"status": "behavioral_kpis_available", "reasons": []},
                "totals": {"trips": 100},
                "trip_volumes_by_purpose": {"values": [{"label": "work", "count": 100, "share": 1.0}]},
                "mode_shares": {"values": []},
                "segment_summaries": [],
                "caveats": [],
            },
        )

        result = compare_behavioral_demand_outputs(current=str(current_path), baseline=str(baseline_path))

        comparison = json.loads(Path(result["json_path"]).read_text())
        self.assertEqual(comparison["support"]["status"], "behavioral_comparison_available")
        self.assertEqual(comparison["coverage"]["comparable_kpi_count"], 3)
        self.assertEqual(comparison["coverage"]["current_only_count"], 2)
        self.assertIn("Current run has 2 behavioral KPI rows", " ".join(comparison["exclusions"]))

    def test_blocks_preflight_only_comparison(self) -> None:
        current_path = self.root / "current-preflight.json"
        baseline_path = self.root / "baseline-preflight.json"
        payload = {
            "summary_type": "activitysim_behavioral_kpi_summary",
            "source": {"runtime_mode": "preflight_only", "runtime_status": "blocked"},
            "availability": {"status": "not_enough_behavioral_outputs", "reasons": ["preflight"]},
            "totals": {},
            "trip_volumes_by_purpose": {"values": []},
            "mode_shares": {"values": []},
            "segment_summaries": [],
            "caveats": ["Preflight only."],
        }
        write_json(current_path, payload)
        write_json(baseline_path, payload)

        result = compare_behavioral_demand_outputs(current=str(current_path), baseline=str(baseline_path))

        comparison = json.loads(Path(result["json_path"]).read_text())
        self.assertFalse(comparison["support"]["supportable"])
        self.assertEqual(comparison["support"]["status"], "behavioral_comparison_blocked")
        self.assertEqual(comparison["comparison"]["rows"], [])

    def test_marks_failed_or_partial_outputs_as_partial_only_comparison(self) -> None:
        current_path = self.root / "current-partial.json"
        baseline_path = self.root / "baseline-packet.json"
        write_json(
            current_path,
            {
                "summary_type": "activitysim_behavioral_kpi_summary",
                "source": {"runtime_mode": "activitysim_cli", "runtime_status": "failed"},
                "availability": {"status": "partial_behavioral_outputs", "reasons": ["partial"]},
                "totals": {"trips": 40},
                "trip_volumes_by_purpose": {"values": [{"label": "work", "count": 40, "share": 1.0}]},
                "mode_shares": {"values": []},
                "segment_summaries": [],
                "caveats": ["Partial only."],
            },
        )
        write_json(
            baseline_path,
            {
                "packet_type": "behavioral_demand_evidence_packet",
                "source": {"behavioral_manifest_path": "/tmp/baseline/behavioral_demand_prototype_manifest.json"},
                "prototype_chain": {
                    "runtime": {"mode": "activitysim_cli", "status": "succeeded"},
                    "behavioral_kpis": {
                        "availability_status": "behavioral_kpis_available",
                        "totals": {"trips": 20},
                        "trip_volumes_by_purpose": {"values": [{"label": "work", "count": 20, "share": 1.0}]},
                        "mode_shares": {"values": []},
                        "segment_summaries": [],
                    },
                },
                "caveats": ["Baseline packet."],
            },
        )

        result = compare_behavioral_demand_outputs(current=str(current_path), baseline=str(baseline_path))

        comparison = json.loads(Path(result["json_path"]).read_text())
        self.assertTrue(comparison["support"]["supportable"])
        self.assertTrue(comparison["support"]["partial"])
        self.assertEqual(comparison["support"]["status"], "behavioral_comparison_partial_only")
        self.assertEqual(len(comparison["comparison"]["rows"]), 3)


class ComparingTwoDemandModelsOnOneNetwork(unittest.TestCase):
    """The method-versus-method mode, added to THIS comparator on purpose.

    A second script comparing two runs is how two ways of answering one question
    drift apart, so the link-volume comparison lives behind the same entry point
    as the KPI comparison rather than beside it.
    """

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _links_csv(self, name: str, volumes: dict[int, float]) -> Path:
        path = self.root / name
        lines = ["link_id,PCE_tot"] + [f"{k},{v}" for k, v in volumes.items()]
        path.write_text("\n".join(lines) + "\n")
        return path

    def test_it_writes_an_agreement_map_for_two_runs(self) -> None:
        first = self._links_csv("a.csv", {1: 20_000, 2: 500})
        second = self._links_csv("b.csv", {1: 20_100, 2: 4_000})

        result = compare_link_volume_runs(
            first_csv=str(first),
            second_csv=str(second),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
        )

        payload = json.loads(Path(result["json_path"]).read_text())
        self.assertEqual(payload["methods"]["second"], "activity-based")
        self.assertEqual(result["summary"]["links_carrying_meaningful_traffic"], 2)
        self.assertIn("never averaged", " ".join(payload["what_this_is_not"]))
        self.assertIn("Where the two demand models agree", Path(result["markdown_path"]).read_text())

    def test_road_names_turn_links_into_corridors(self) -> None:
        first = self._links_csv("a.csv", {1: 20_000, 2: 20_000})
        second = self._links_csv("b.csv", {1: 30_000, 2: 30_000})
        geojson = self.root / "loaded.geojson"
        geojson.write_text(json.dumps({"features": [
            {"properties": {"link_id": 1, "name": "SR 49", "link_type": "trunk"}},
            {"properties": {"link_id": 2, "name": "SR 49", "link_type": "trunk"}},
        ]}))

        result = compare_link_volume_runs(
            first_csv=str(first), second_csv=str(second),
            first_label="a", second_label="b",
            output_dir=str(self.root / "out"),
            loaded_links_geojson=str(geojson),
        )
        payload = json.loads(Path(result["json_path"]).read_text())
        self.assertEqual(result["corridors"], 1)
        self.assertEqual(payload["corridors"][0]["corridor"], "SR 49")
        self.assertEqual(payload["corridors"][0]["links"], 2)

    def test_without_road_names_it_still_compares_but_names_no_corridor(self) -> None:
        # Saying "these links could not be grouped" is better than inventing a
        # grouping, which would put every unnamed road into one phantom corridor.
        first = self._links_csv("a.csv", {1: 20_000})
        second = self._links_csv("b.csv", {1: 30_000})
        result = compare_link_volume_runs(
            first_csv=str(first), second_csv=str(second),
            first_label="a", second_label="b", output_dir=str(self.root / "out"),
        )
        self.assertEqual(result["corridors"], 0)
        self.assertEqual(result["summary"]["links_compared"], 1)

    def test_a_link_with_an_unreadable_id_is_skipped_not_crashed_on(self) -> None:
        geojson = self.root / "loaded.geojson"
        geojson.write_text(json.dumps({"features": [
            {"properties": {"link_id": None, "name": "Nowhere"}},
            {"properties": {"link_id": 3, "name": "SR 20"}},
        ]}))
        self.assertEqual(read_link_names(geojson), {3: {"name": "SR 20", "link_type": ""}})

    def test_a_missing_link_table_says_which_one(self) -> None:
        first = self._links_csv("a.csv", {1: 20_000})
        with self.assertRaises(RuntimeError) as caught:
            compare_link_volume_runs(
                first_csv=str(first), second_csv=str(self.root / "absent.csv"),
                first_label="a", second_label="b", output_dir=str(self.root / "out"),
            )
        self.assertIn("absent.csv", str(caught.exception))


class TheMeasuredNoiseFloor(unittest.TestCase):
    """A comparison that cannot say what the assignment alone does invites its
    reader to attribute that to the demand model."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _links_csv(self, name: str, volumes: dict[int, float]) -> Path:
        path = self.root / name
        path.write_text("\n".join(["link_id,PCE_tot"] + [f"{k},{v}" for k, v in volumes.items()]) + "\n")
        return path

    def _round_trip_floor(self) -> str:
        """A real round-trip comparison: the same demand assigned twice."""
        first = self._links_csv("rt_a.csv", {1: 20_000, 2: 9_000, 3: 4_000})
        second = self._links_csv("rt_b.csv", {1: 20_050, 2: 9_400, 3: 4_010})
        result = compare_link_volume_runs(
            first_csv=str(first),
            second_csv=str(second),
            first_label="same demand, run 1",
            second_label="same demand, run 2",
            output_dir=str(self.root / "floor"),
        )
        return result["json_path"]

    def test_without_the_flag_the_report_says_it_is_unmeasured(self) -> None:
        result = compare_link_volume_runs(
            first_csv=str(self._links_csv("a.csv", {1: 20_000, 2: 9_000})),
            second_csv=str(self._links_csv("b.csv", {1: 12_000, 2: 3_000})),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
        )
        self.assertFalse(result["assignment_noise_floor"]["measured"])
        self.assertIn("HAS NOT BEEN MEASURED", result["assignment_noise_floor"]["note"])

    def test_the_measured_floor_reaches_the_report(self) -> None:
        floor_json = self._round_trip_floor()
        result = compare_link_volume_runs(
            first_csv=str(self._links_csv("a.csv", {1: 20_000, 2: 9_000})),
            second_csv=str(self._links_csv("b.csv", {1: 12_000, 2: 3_000})),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
            noise_floor_json=floor_json,
        )
        noise = result["assignment_noise_floor"]
        self.assertTrue(noise["measured"])
        self.assertIn("re-assigning one model's own demand", noise["note"])
        self.assertNotIn("HAS NOT BEEN MEASURED", noise["note"])
        # The measurement itself travels, not just the sentence about it.
        self.assertEqual(
            noise["measurement"]["measured_from"], str(Path(floor_json).resolve())
        )
        self.assertIn("diverge_share_meaningful_links", noise["measurement"])

    def test_the_markdown_carries_the_floor_a_reader_will_see(self) -> None:
        result = compare_link_volume_runs(
            first_csv=str(self._links_csv("a.csv", {1: 20_000, 2: 9_000})),
            second_csv=str(self._links_csv("b.csv", {1: 12_000, 2: 3_000})),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
            noise_floor_json=self._round_trip_floor(),
        )
        text = Path(result["markdown_path"]).read_text()
        self.assertIn("re-assigning one model's own demand", text)

    def test_a_file_that_is_not_an_agreement_map_is_refused(self) -> None:
        bogus = self.root / "bogus.json"
        bogus.write_text(json.dumps({"summary": {"something_else": 1}}))
        with self.assertRaises(RuntimeError) as ctx:
            compare_link_volume_runs(
                first_csv=str(self._links_csv("a.csv", {1: 20_000})),
                second_csv=str(self._links_csv("b.csv", {1: 12_000})),
                first_label="trip-based",
                second_label="activity-based",
                output_dir=str(self.root / "out"),
                noise_floor_json=str(bogus),
            )
        self.assertIn("not a corridor-agreement comparison", str(ctx.exception))

    def test_a_missing_floor_file_is_named(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            compare_link_volume_runs(
                first_csv=str(self._links_csv("a.csv", {1: 20_000})),
                second_csv=str(self._links_csv("b.csv", {1: 12_000})),
                first_label="trip-based",
                second_label="activity-based",
                output_dir=str(self.root / "out"),
                noise_floor_json=str(self.root / "nowhere.json"),
            )
        self.assertIn("nowhere.json", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
