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

from run_behavioral_demand_prototype import behavioral_runtime_status, run_behavioral_demand_prototype


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def build_screening_run(root: Path) -> Path:
    screening_run_dir = root / "screening-run"
    (screening_run_dir / "package").mkdir(parents=True)
    (screening_run_dir / "run_output").mkdir(parents=True)
    write_json(
        screening_run_dir / "bundle_manifest.json",
        {
            "run_name": "Nevada County Screening Prototype",
            "screening_grade": True,
            "artifacts": {
                "zone_attributes": "package/zone_attributes.csv",
                "skim_omx": "run_output/travel_time_skims.omx",
            },
            "skims": {"avg_time_min": 14.2, "total_pairs": 4},
            "zones": {"zones": 2, "zone_type": "census-tract-fragments"},
            "demand": {"total_trips": 2000},
        },
    )
    write_csv(
        screening_run_dir / "package" / "zone_attributes.csv",
        [
            {
                "GEOID": "06057000100",
                "NAMELSAD": "Census Tract 0001",
                "zone_id": 1,
                "centroid_lon": -121.01,
                "centroid_lat": 39.26,
                "area_sq_mi": 1.25,
                "total_jobs": 45.2,
                "retail_jobs": 8,
                "health_jobs": 4,
                "education_jobs": 5,
                "accommodation_jobs": 2,
                "govt_jobs": 3,
                "est_population": 22.4,
                "households": 9.6,
                "worker_residents": 11.1,
                "area_share": 1.0,
            },
            {
                "GEOID": "06057000200",
                "NAMELSAD": "Census Tract 0002",
                "zone_id": 2,
                "centroid_lon": -121.10,
                "centroid_lat": 39.30,
                "area_sq_mi": 2.0,
                "total_jobs": 20.8,
                "retail_jobs": 3,
                "health_jobs": 2,
                "education_jobs": 2,
                "accommodation_jobs": 1,
                "govt_jobs": 1,
                "est_population": 8.3,
                "households": 0.4,
                "worker_residents": 3.7,
                "area_share": 0.42,
            },
        ],
    )
    (screening_run_dir / "run_output" / "travel_time_skims.omx").write_bytes(b"omx-test")
    return screening_run_dir


class RunBehavioralDemandPrototypeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.screening_run_dir = build_screening_run(self.root)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_completes_honest_preflight_when_activitysim_is_unavailable(self) -> None:
        output_root = self.root / "behavioral-demand"

        result = run_behavioral_demand_prototype(
            screening_run_dir=str(self.screening_run_dir),
            output_root=str(output_root),
        )

        self.assertEqual(result["pipeline_status"], "prototype_preflight_complete")
        self.assertEqual(result["behavioral_runtime_status"], "behavioral_runtime_blocked")

        manifest = json.loads(Path(result["manifest_path"]).read_text())
        self.assertEqual(manifest["pipeline_status"], "prototype_preflight_complete")
        self.assertEqual(manifest["behavioral_runtime_status"], "behavioral_runtime_blocked")
        self.assertEqual(manifest["steps"]["run_activitysim_runtime"]["status"], "blocked")
        self.assertEqual(manifest["steps"]["ingest_activitysim_runtime_outputs"]["status"], "succeeded")
        self.assertEqual(manifest["steps"]["extract_activitysim_behavioral_kpis"]["status"], "succeeded")
        self.assertIn("ActivitySim CLI is not installed or not on PATH", " ".join(manifest["caveats"]))

        kpi_summary = json.loads(Path(result["kpi_summary_path"]).read_text())
        self.assertEqual(kpi_summary["availability"]["status"], "not_enough_behavioral_outputs")

    def test_recognizes_container_cli_runtime_as_behavioral_success(self) -> None:
        self.assertEqual(
            behavioral_runtime_status({"mode": "activitysim_container_cli", "status": "succeeded"}),
            "behavioral_runtime_succeeded",
        )

    def test_marks_pipeline_as_behavioral_runtime_succeeded_when_fake_cli_outputs_tables(self) -> None:
        output_root = self.root / "behavioral-demand-success"
        config_dir = self.root / "activitysim-config"
        config_dir.mkdir(parents=True, exist_ok=True)
        (config_dir / "settings.yaml").write_text("models: []\n")

        fake_cli = self.root / "fake_activitysim.py"
        fake_cli.write_text(
            "\n".join(
                [
                    "#!/usr/bin/env python3",
                    "import csv",
                    "import sys",
                    "from pathlib import Path",
                    "",
                    "output_dir = Path(sys.argv[1])",
                    "output_dir.mkdir(parents=True, exist_ok=True)",
                    "",
                    "def write_csv(name, rows):",
                    "    path = output_dir / name",
                    "    with path.open('w', newline='') as handle:",
                    "        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))",
                    "        writer.writeheader()",
                    "        writer.writerows(rows)",
                    "",
                    "write_csv('final_households.csv', [",
                    "    {'household_id': 1, 'income': 55000, 'household_type': 'family'},",
                    "    {'household_id': 2, 'income': 120000, 'household_type': 'nonfamily'},",
                    "])",
                    "write_csv('final_persons.csv', [",
                    "    {'person_id': 1, 'household_id': 1, 'person_type': 'worker'},",
                    "    {'person_id': 2, 'household_id': 1, 'person_type': 'student'},",
                    "    {'person_id': 3, 'household_id': 2, 'person_type': 'worker'},",
                    "])",
                    "write_csv('final_tours.csv', [",
                    "    {'tour_id': 1, 'person_id': 1, 'household_id': 1},",
                    "    {'tour_id': 2, 'person_id': 2, 'household_id': 1},",
                    "    {'tour_id': 3, 'person_id': 3, 'household_id': 2},",
                    "])",
                    "write_csv('final_trips.csv', [",
                    "    {'trip_id': 1, 'person_id': 1, 'household_id': 1, 'purpose': 'work', 'trip_mode': 'drive'},",
                    "    {'trip_id': 2, 'person_id': 1, 'household_id': 1, 'purpose': 'work', 'trip_mode': 'drive'},",
                    "    {'trip_id': 3, 'person_id': 2, 'household_id': 1, 'purpose': 'school', 'trip_mode': 'walk'},",
                    "    {'trip_id': 4, 'person_id': 3, 'household_id': 2, 'purpose': 'shopping', 'trip_mode': 'transit'},",
                    "])",
                ]
            )
            + "\n"
        )
        fake_cli.chmod(0o755)

        result = run_behavioral_demand_prototype(
            screening_run_dir=str(self.screening_run_dir),
            output_root=str(output_root),
            config_dir=str(config_dir),
            activitysim_cli_template=f"{sys.executable} {fake_cli} {{output_dir}}",
        )

        self.assertEqual(result["pipeline_status"], "behavioral_runtime_succeeded")
        self.assertEqual(result["behavioral_runtime_status"], "behavioral_runtime_succeeded")

        manifest = json.loads(Path(result["manifest_path"]).read_text())
        self.assertEqual(manifest["runtime_mode"], "activitysim_cli")
        self.assertEqual(manifest["steps"]["run_activitysim_runtime"]["status"], "succeeded")

        ingestion_summary = json.loads(Path(result["ingestion_summary_path"]).read_text())
        self.assertEqual(ingestion_summary["common_tables"]["trips"]["row_count"], 4)

        kpi_summary = json.loads(Path(result["kpi_summary_path"]).read_text())
        self.assertEqual(kpi_summary["availability"]["status"], "behavioral_kpis_available")
        self.assertEqual(kpi_summary["totals"]["trips"], 4)
        self.assertEqual(kpi_summary["trip_volumes_by_purpose"]["values"][0]["label"], "work")


if __name__ == "__main__":
    unittest.main()
