from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from compare_behavioral_demand_outputs import compare_behavioral_demand_outputs


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


if __name__ == "__main__":
    unittest.main()
