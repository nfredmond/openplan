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

from ingest_activitysim_runtime_outputs import ingest_activitysim_runtime_outputs


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def build_runtime(
    root: Path,
    *,
    mode: str,
    status: str,
    caveats: list[str] | None = None,
    errors: list[dict[str, str]] | None = None,
    output_rows: dict[str, list[dict[str, object]]] | None = None,
) -> Path:
    runtime_dir = root / "runtime"
    (runtime_dir / "logs").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "stages" / "010-validate-inputs").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "stages" / "020-prepare-activitysim-inputs").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "stages" / "030-run-activitysim").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "stages" / "040-collect-outputs").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "logs" / "runtime.log").write_text("runtime log\n")

    collected_outputs: list[str] = []
    if output_rows:
        for relative_name, rows in output_rows.items():
            path = runtime_dir / "output" / relative_name
            write_csv(path, rows)
            collected_outputs.append(str(path.relative_to(runtime_dir)))

    manifest = {
        "schema_version": "openplan.activitysim_runtime.v0",
        "runtime_type": "activitysim_worker_runtime",
        "created_at_utc": "2026-03-27T00:00:00+00:00",
        "bundle": {
            "bundle_dir": str(root / "bundle"),
            "manifest_path": str(root / "bundle" / "manifest.json"),
        },
        "runtime_dir": str(runtime_dir),
        "mode": mode,
        "status": status,
        "caveats": caveats or [],
        "errors": errors or [],
        "artifacts": {
            "runtime_log": "logs/runtime.log",
            "collected_outputs": collected_outputs,
        },
        "stages": [
            {"stage_key": "validate_inputs", "status": "succeeded"},
            {"stage_key": "prepare_activitysim_inputs", "status": "succeeded"},
            {"stage_key": "run_activitysim", "status": "blocked" if status == "blocked" else "succeeded"},
            {"stage_key": "collect_outputs", "status": "succeeded"},
        ],
    }
    write_json(runtime_dir / "runtime_manifest.json", manifest)
    write_json(
        runtime_dir / "runtime_summary.json",
        {
            "runtime_dir": str(runtime_dir),
            "runtime_manifest_path": str(runtime_dir / "runtime_manifest.json"),
            "mode": mode,
            "status": status,
        },
    )
    return runtime_dir


class IngestActivitySimRuntimeOutputsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_ingests_preflight_only_runtime_without_behavioral_outputs(self) -> None:
        runtime_dir = build_runtime(
            self.root,
            mode="preflight_only",
            status="blocked",
            caveats=["ActivitySim CLI is not installed or not on PATH"],
        )

        result = ingest_activitysim_runtime_outputs(runtime_dir=str(runtime_dir))

        self.assertEqual(result["mode"], "preflight_only")
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["output_file_count"], 0)
        self.assertEqual(result["output_table_count"], 0)

        summary = json.loads(Path(result["summary_path"]).read_text())
        self.assertEqual(summary["runtime"]["status"], "blocked")
        self.assertEqual(summary["common_tables"]["trips"], None)
        self.assertIn("No files were discovered under output/", " ".join(summary["caveats"]))

        artifact_metadata = json.loads(Path(result["artifact_metadata_path"]).read_text())
        bundle_artifact = next(
            artifact for artifact in artifact_metadata["artifacts"] if artifact["artifact_type"] == "activitysim_output_bundle"
        )
        self.assertEqual(bundle_artifact["metadata_json"]["tripCount"], 0)
        self.assertEqual(bundle_artifact["metadata_json"]["outputFileCount"], 0)

    def test_ingests_real_output_tables_and_derives_bundle_metadata(self) -> None:
        runtime_dir = build_runtime(
            self.root,
            mode="activitysim_cli",
            status="succeeded",
            output_rows={
                "final_households.csv": [
                    {"household_id": 1, "income": 50000},
                    {"household_id": 2, "income": 80000},
                ],
                "final_persons.csv": [
                    {"person_id": 1, "household_id": 1, "person_type": "worker"},
                    {"person_id": 2, "household_id": 1, "person_type": "student"},
                    {"person_id": 3, "household_id": 2, "person_type": "worker"},
                ],
                "final_tours.csv": [
                    {"tour_id": 1, "household_id": 1},
                    {"tour_id": 2, "household_id": 1},
                ],
                "final_trips.csv": [
                    {"trip_id": 1, "tour_id": 1},
                    {"trip_id": 2, "tour_id": 1},
                    {"trip_id": 3, "tour_id": 2},
                ],
            },
        )

        result = ingest_activitysim_runtime_outputs(runtime_manifest=str(runtime_dir / "runtime_manifest.json"))

        self.assertEqual(result["mode"], "activitysim_cli")
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["output_table_count"], 4)

        summary = json.loads(Path(result["summary_path"]).read_text())
        self.assertEqual(summary["common_tables"]["households"]["row_count"], 2)
        self.assertEqual(summary["common_tables"]["persons"]["row_count"], 3)
        self.assertEqual(summary["common_tables"]["tours"]["row_count"], 2)
        self.assertEqual(summary["common_tables"]["trips"]["row_count"], 3)

        artifact_metadata = json.loads(Path(result["artifact_metadata_path"]).read_text())
        bundle_artifact = next(
            artifact for artifact in artifact_metadata["artifacts"] if artifact["artifact_type"] == "activitysim_output_bundle"
        )
        self.assertEqual(bundle_artifact["metadata_json"]["householdCount"], 2)
        self.assertEqual(bundle_artifact["metadata_json"]["personCount"], 3)
        self.assertEqual(bundle_artifact["metadata_json"]["tourCount"], 2)
        self.assertEqual(bundle_artifact["metadata_json"]["tripCount"], 3)
        self.assertEqual(bundle_artifact["metadata_json"]["segments"], ["income", "person_type"])

    def test_preserves_failed_runtime_status_when_partial_outputs_exist(self) -> None:
        runtime_dir = build_runtime(
            self.root,
            mode="activitysim_cli",
            status="failed",
            errors=[{"kind": "CalledProcessError", "message": "CLI failed late"}],
            output_rows={
                "final_trips.csv": [
                    {"trip_id": 1, "tour_id": 1},
                    {"trip_id": 2, "tour_id": 1},
                ]
            },
        )

        result = ingest_activitysim_runtime_outputs(runtime_dir=str(runtime_dir))

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["output_table_count"], 1)

        summary = json.loads(Path(result["summary_path"]).read_text())
        self.assertEqual(summary["runtime"]["errors"][0]["message"], "CLI failed late")
        self.assertEqual(summary["common_tables"]["trips"]["row_count"], 2)
        self.assertIn("partial artifacts only", " ".join(summary["caveats"]))


if __name__ == "__main__":
    unittest.main()
