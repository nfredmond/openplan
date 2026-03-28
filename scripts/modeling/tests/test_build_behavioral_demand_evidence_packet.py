from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_behavioral_demand_evidence_packet import build_behavioral_demand_evidence_packet


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def write_markdown(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)


def build_screening_run(root: Path) -> Path:
    run_dir = root / "screening-run"
    write_json(
        run_dir / "run_summary.json",
        {
            "zones": {"count": 26, "population_total": 102345, "jobs_total": 45678},
            "assignment": {"loaded_links": 3174, "convergence": {"final_gap": 0.0091}},
            "demand": {"total_trips": 231828.75},
            "validation": {"status_label": "bounded screening-ready"},
        },
    )
    write_json(
        run_dir / "bundle_manifest.json",
        {
            "run_name": "Nevada County Screening Prototype",
            "screening_grade": True,
            "validation": {"status_label": "bounded screening-ready"},
            "demand": {"total_trips": 231828.75},
            "zones": {"zones": 26},
        },
    )
    return run_dir


def build_behavioral_chain(
    root: Path,
    screening_run_dir: Path,
    *,
    runtime_mode: str,
    runtime_status: str,
    kpi_status: str,
) -> Path:
    behavioral_root = root / "behavioral_demand_prototype"
    bundle_manifest_path = behavioral_root / "activitysim_bundle" / "manifest.json"
    runtime_manifest_path = behavioral_root / "runtime" / "runtime_manifest.json"
    runtime_summary_path = behavioral_root / "runtime" / "runtime_summary.json"
    ingestion_summary_path = behavioral_root / "ingestion" / "activitysim_output_ingestion_summary.json"
    kpi_summary_path = behavioral_root / "kpis" / "activitysim_behavioral_kpi_summary.json"
    kpi_packet_path = behavioral_root / "kpis" / "activitysim_behavioral_kpi_packet.md"

    write_json(
        bundle_manifest_path,
        {
            "schema_version": "openplan.activitysim_input_bundle.v0",
            "bundle_type": "activitysim_input_bundle",
            "source_screening_run": {
                "run_dir": str(screening_run_dir),
                "run_name": "Nevada County Screening Prototype",
                "screening_grade": True,
            },
            "land_use": {"rows": 26, "total_population": 102345, "total_employment": 45678},
            "synthetic_population": {
                "status": "prototype_scaffold",
                "calibration_status": "not_calibrated",
                "households": 41415,
                "persons": 102322,
            },
            "skims": {"artifact": {"mode": "copy"}},
            "caveats": [
                "Prototype synthetic population only; this bundle does not contain a calibrated IPF or PopulationSim population."
            ],
        },
    )

    runtime_stages = [
        {"stage_key": "validate_inputs", "status": "succeeded", "notes": [], "errors": []},
        {"stage_key": "prepare_activitysim_inputs", "status": "succeeded", "notes": [], "errors": []},
        {
            "stage_key": "run_activitysim",
            "status": "blocked" if runtime_status == "blocked" else ("failed" if runtime_status == "failed" else "succeeded"),
            "notes": ["ActivitySim CLI is not installed or not on PATH"] if runtime_status == "blocked" else [],
            "errors": [{"kind": "CalledProcessError", "message": "CLI failed late"}] if runtime_status == "failed" else [],
        },
        {"stage_key": "collect_outputs", "status": "succeeded", "notes": [], "errors": []},
    ]
    write_json(
        runtime_manifest_path,
        {
            "schema_version": "openplan.activitysim_runtime.v0",
            "runtime_type": "activitysim_worker_runtime",
            "bundle": {"bundle_dir": str(bundle_manifest_path.parent), "manifest_path": str(bundle_manifest_path)},
            "runtime_dir": str(runtime_manifest_path.parent),
            "mode": runtime_mode,
            "status": runtime_status,
            "caveats": ["ActivitySim CLI is not installed or not on PATH"] if runtime_status == "blocked" else [],
            "errors": [{"kind": "CalledProcessError", "message": "CLI failed late"}] if runtime_status == "failed" else [],
            "artifacts": {"collected_outputs": [] if runtime_status == "blocked" else ["output/final_trips.csv"]},
            "stages": runtime_stages,
        },
    )
    write_json(
        runtime_summary_path,
        {
            "runtime_dir": str(runtime_manifest_path.parent),
            "runtime_manifest_path": str(runtime_manifest_path),
            "runtime_summary_path": str(runtime_summary_path),
            "mode": runtime_mode,
            "status": runtime_status,
            "stage_statuses": {item["stage_key"]: item["status"] for item in runtime_stages},
        },
    )

    common_tables = {
        "households": None,
        "persons": None,
        "tours": None,
        "trips": None,
    }
    output_inventory = []
    output_tables = []
    if runtime_status != "blocked":
        common_tables["trips"] = {"row_count": 2, "relative_path": "output/final_trips.csv"}
        output_inventory = [{"relative_path": "output/final_trips.csv"}]
        output_tables = [{"table_name": "final_trips", "row_count": 2, "relative_path": "output/final_trips.csv"}]

    write_json(
        ingestion_summary_path,
        {
            "schema_version": "openplan.activitysim_output_ingestion.v0",
            "runtime": {
                "mode": runtime_mode,
                "status": runtime_status,
            },
            "output_inventory": output_inventory,
            "output_tables": output_tables,
            "common_tables": common_tables,
            "caveats": (
                ["No files were discovered under output/; ingestion does not claim behavioral tables or KPI-ready outputs."]
                if runtime_status == "blocked"
                else ["Runtime status is failed; discovered output files are ingested as partial artifacts only."]
            ),
        },
    )

    write_json(
        kpi_summary_path,
        {
            "schema_version": "openplan.activitysim_behavioral_kpis.v0",
            "availability": {
                "status": kpi_status,
                "reasons": (
                    ["Runtime mode is preflight_only; behavioral outputs are not available."]
                    if kpi_status == "not_enough_behavioral_outputs"
                    else ["Runtime failed after partial outputs were collected; summaries reflect partial outputs only."]
                ),
            },
            "coverage": {
                "totals": [] if kpi_status == "not_enough_behavioral_outputs" else ["trips"],
                "trip_volumes_by_purpose": kpi_status != "not_enough_behavioral_outputs",
                "mode_shares": False,
                "segment_summaries": [],
            },
            "totals": {
                "households": None,
                "persons": None,
                "tours": None,
                "trips": None if kpi_status == "not_enough_behavioral_outputs" else 2,
            },
            "trip_volumes_by_purpose": {
                "available": kpi_status != "not_enough_behavioral_outputs",
                "source_column": "purpose" if kpi_status != "not_enough_behavioral_outputs" else None,
                "total_records_summarized": 2 if kpi_status != "not_enough_behavioral_outputs" else 0,
                "values": [{"label": "work", "count": 2, "share": 1.0}] if kpi_status != "not_enough_behavioral_outputs" else [],
            },
            "mode_shares": {
                "available": False,
                "source_column": None,
                "total_records_summarized": 0,
                "values": [],
            },
            "segment_summaries": [],
            "caveats": (
                ["Behavioral KPI extraction was not supportable from the discovered outputs."]
                if kpi_status == "not_enough_behavioral_outputs"
                else ["Behavioral KPI extraction reflects partial output coverage only."]
            ),
        },
    )
    write_markdown(kpi_packet_path, "# KPI Packet\n")

    write_json(
        behavioral_root / "behavioral_demand_prototype_manifest.json",
        {
            "schema_version": "openplan.behavioral_demand_prototype.v0",
            "source": {"screening_run_dir": str(screening_run_dir)},
            "output_root": str(behavioral_root),
            "pipeline_status": "prototype_preflight_complete" if runtime_status == "blocked" else "behavioral_runtime_failed",
            "behavioral_runtime_status": "behavioral_runtime_blocked" if runtime_status == "blocked" else "behavioral_runtime_failed",
            "runtime_mode": runtime_mode,
            "artifacts": {
                "pipeline_manifest_path": str(behavioral_root / "behavioral_demand_prototype_manifest.json"),
                "bundle_manifest_path": str(bundle_manifest_path),
                "runtime_manifest_path": str(runtime_manifest_path),
                "runtime_summary_path": str(runtime_summary_path),
                "ingestion_summary_path": str(ingestion_summary_path),
                "kpi_summary_path": str(kpi_summary_path),
                "kpi_packet_path": str(kpi_packet_path),
            },
            "steps": {
                "build_activitysim_input_bundle": {
                    "status": "succeeded",
                    "metadata": {"land_use_rows": 26, "households": 41415, "persons": 102322, "skim_mode": "copy"},
                }
            },
            "caveats": ["Prototype chain only; not a production ActivitySim claim."],
        },
    )
    return behavioral_root


class BuildBehavioralDemandEvidencePacketTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_builds_from_county_onramp_manifest_and_preserves_preflight_limits(self) -> None:
        screening_run_dir = build_screening_run(self.root)
        behavioral_root = build_behavioral_chain(
            self.root,
            screening_run_dir,
            runtime_mode="preflight_only",
            runtime_status="blocked",
            kpi_status="not_enough_behavioral_outputs",
        )
        county_manifest_path = self.root / "county_onramp_manifest.json"
        write_json(
            county_manifest_path,
            {
                "schema_version": "openplan.county_onramp_manifest.v1",
                "generated_at": "2026-03-27T00:00:00+00:00",
                "name": "nevada-county-prototype",
                "county_prefix": "NEVADA",
                "run_dir": str(screening_run_dir),
                "mode": "existing-run",
                "stage": "validated-screening",
                "artifacts": {
                    "behavioral_prototype_manifest_json": str(
                        behavioral_root / "behavioral_demand_prototype_manifest.json"
                    )
                },
                "runtime": {},
                "summary": {
                    "validation": {"screening_gate": {"status_label": "bounded screening-ready"}},
                    "behavioral_prototype": {"output_root": str(behavioral_root)},
                },
            },
        )

        result = build_behavioral_demand_evidence_packet(county_onramp_manifest=str(county_manifest_path))

        packet = json.loads(Path(result["json_packet_path"]).read_text())
        self.assertEqual(packet["source"]["source_type"], "county_onramp_manifest")
        self.assertEqual(packet["prototype_chain"]["runtime"]["mode"], "preflight_only")
        self.assertEqual(packet["prototype_chain"]["behavioral_kpis"]["availability_status"], "not_enough_behavioral_outputs")
        self.assertEqual(packet["validation_posture"]["internal_status_label"], "internal prototype only")
        self.assertIn("preflight depth only", packet["validation_posture"]["coverage_statement"])
        self.assertIn(
            "Runtime only reached preflight depth or was blocked",
            " ".join(packet["caveats"]),
        )

        markdown = Path(result["markdown_packet_path"]).read_text()
        self.assertIn("not ready for outward modeling claims", markdown)
        self.assertIn("preflight_only", markdown)

    def test_builds_from_runtime_dir_and_marks_partial_outputs_honestly(self) -> None:
        screening_run_dir = build_screening_run(self.root)
        behavioral_root = build_behavioral_chain(
            self.root,
            screening_run_dir,
            runtime_mode="activitysim_cli",
            runtime_status="failed",
            kpi_status="partial_behavioral_outputs",
        )

        result = build_behavioral_demand_evidence_packet(runtime_dir=str(behavioral_root / "runtime"))

        packet = json.loads(Path(result["json_packet_path"]).read_text())
        self.assertEqual(packet["source"]["source_type"], "runtime_dir")
        self.assertEqual(packet["prototype_chain"]["runtime"]["status"], "failed")
        self.assertEqual(packet["prototype_chain"]["behavioral_kpis"]["availability_status"], "partial_behavioral_outputs")
        self.assertIn("partial behavioral prototype attempt", packet["validation_posture"]["coverage_statement"])
        self.assertIn("partial-output coverage only", " ".join(packet["caveats"]))

        artifact_keys = {item["artifact_key"] for item in packet["artifact_inventory"] if item["exists"]}
        self.assertIn("runtime_manifest", artifact_keys)
        self.assertIn("kpi_summary", artifact_keys)

        markdown = Path(result["markdown_packet_path"]).read_text()
        self.assertIn("partial_behavioral_outputs", markdown)
        self.assertIn("failed", markdown)


if __name__ == "__main__":
    unittest.main()
