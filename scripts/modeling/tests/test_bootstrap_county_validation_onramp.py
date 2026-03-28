from __future__ import annotations

import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import bootstrap_county_validation_onramp as county_onramp


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def build_run_dir(root: Path) -> Path:
    run_dir = root / "screening-run"
    write_json(
        run_dir / "run_summary.json",
        {
            "zones": {"count": 26, "population_total": 102345, "jobs_total": 45678},
            "assignment": {"loaded_links": 3174, "convergence": {"final_gap": 0.0091}},
            "demand": {"total_trips": 231828.75},
        },
    )
    write_json(
        run_dir / "validation" / "validation_summary.json",
        {
            "screening_gate": {"status_label": "bounded screening-ready"},
            "metrics": {"median_absolute_percent_error": 16.01},
        },
    )
    write_json(
        run_dir / "bundle_manifest.json",
        {
            "validation": {
                "status_label": "bounded screening-ready",
            }
        },
    )
    return run_dir


class BootstrapCountyValidationOnrampTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.run_dir = build_run_dir(self.root)
        self.output_manifest = self.root / "county-onramp-manifest.json"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _args(self, *, force: bool = False) -> Namespace:
        return Namespace(
            name="nevada-county-runtime-test",
            county_fips=None,
            county_prefix="NEVADA",
            existing_run_dir=str(self.run_dir),
            python_bin=None,
            output_csv=str(self.root / "validation_scaffold.csv"),
            output_md=str(self.root / "review_packet.md"),
            output_manifest=str(self.output_manifest),
            limit=8,
            bbox_padding_deg=0.006,
            source_agency="TBD",
            keep_project=False,
            force=force,
            overall_demand_scalar=None,
            external_demand_scalar=None,
            hbw_scalar=None,
            hbo_scalar=None,
            nhb_scalar=None,
        )

    def test_main_runs_behavioral_orchestrator_and_records_preflight_status(self) -> None:
        behavioral_manifest = self.run_dir / "behavioral_demand_prototype" / county_onramp.PIPELINE_MANIFEST_NAME

        def fake_run_behavioral_demand_prototype(**_: str) -> dict:
            write_json(
                behavioral_manifest,
                {
                    "pipeline_status": "prototype_preflight_complete",
                    "behavioral_runtime_status": "behavioral_runtime_blocked",
                    "runtime_mode": "preflight_only",
                    "output_root": str(behavioral_manifest.parent),
                    "artifacts": {
                        "pipeline_manifest_path": str(behavioral_manifest),
                        "bundle_manifest_path": str(behavioral_manifest.parent / "activitysim_bundle" / "bundle_manifest.json"),
                        "runtime_manifest_path": str(behavioral_manifest.parent / "runtime" / "activitysim_runtime_manifest.json"),
                        "runtime_summary_path": str(behavioral_manifest.parent / "runtime" / "activitysim_runtime_summary.json"),
                        "ingestion_summary_path": str(behavioral_manifest.parent / "ingestion" / "activitysim_ingestion_summary.json"),
                        "kpi_summary_path": str(behavioral_manifest.parent / "kpis" / "activitysim_behavioral_kpi_summary.json"),
                        "kpi_packet_path": str(behavioral_manifest.parent / "kpis" / "activitysim_behavioral_kpi_packet.md"),
                    },
                    "steps": {
                        "build_activitysim_input_bundle": {
                            "status": "succeeded",
                            "artifacts": {
                                "bundle_dir": str(behavioral_manifest.parent / "activitysim_bundle"),
                                "bundle_manifest_path": str(
                                    behavioral_manifest.parent / "activitysim_bundle" / "bundle_manifest.json"
                                ),
                            },
                            "metadata": {
                                "land_use_rows": 26,
                                "households": 41415,
                                "persons": 102322,
                                "skim_mode": "copy",
                            },
                        }
                    },
                    "caveats": ["ActivitySim CLI is not installed or not on PATH"],
                    "errors": [],
                },
            )
            return {
                "output_root": str(behavioral_manifest.parent),
                "manifest_path": str(behavioral_manifest),
                "pipeline_status": "prototype_preflight_complete",
                "behavioral_runtime_status": "behavioral_runtime_blocked",
                "runtime_mode": "preflight_only",
                "bundle_manifest_path": str(behavioral_manifest.parent / "activitysim_bundle" / "bundle_manifest.json"),
                "runtime_manifest_path": str(behavioral_manifest.parent / "runtime" / "activitysim_runtime_manifest.json"),
                "runtime_summary_path": str(behavioral_manifest.parent / "runtime" / "activitysim_runtime_summary.json"),
                "ingestion_summary_path": str(behavioral_manifest.parent / "ingestion" / "activitysim_ingestion_summary.json"),
                "kpi_summary_path": str(behavioral_manifest.parent / "kpis" / "activitysim_behavioral_kpi_summary.json"),
                "kpi_packet_path": str(behavioral_manifest.parent / "kpis" / "activitysim_behavioral_kpi_packet.md"),
                "caveats": ["ActivitySim CLI is not installed or not on PATH"],
            }

        with (
            patch.object(county_onramp, "parse_args", return_value=self._args()),
            patch.object(county_onramp, "run_cmd"),
            patch.object(county_onramp, "run_behavioral_demand_prototype", side_effect=fake_run_behavioral_demand_prototype) as mocked,
        ):
            exit_code = county_onramp.main()

        self.assertEqual(exit_code, 0)
        self.assertEqual(mocked.call_count, 1)

        manifest = json.loads(self.output_manifest.read_text())
        self.assertEqual(manifest["summary"]["behavioral_prototype"]["pipeline_status"], "prototype_preflight_complete")
        self.assertEqual(manifest["summary"]["behavioral_prototype"]["runtime_status"], "behavioral_runtime_blocked")
        self.assertEqual(manifest["summary"]["behavioral_prototype"]["runtime_mode"], "preflight_only")
        self.assertEqual(
            manifest["artifacts"]["behavioral_prototype_manifest_json"],
            str(behavioral_manifest),
        )
        self.assertEqual(
            manifest["artifacts"]["activitysim_bundle_manifest_json"],
            str(behavioral_manifest.parent / "activitysim_bundle" / "bundle_manifest.json"),
        )

    def test_reuses_existing_behavioral_manifest_when_not_forced(self) -> None:
        behavioral_manifest = self.run_dir / "behavioral_demand_prototype" / county_onramp.PIPELINE_MANIFEST_NAME
        write_json(
            behavioral_manifest,
            {
                "pipeline_status": "behavioral_runtime_succeeded",
                "behavioral_runtime_status": "behavioral_runtime_succeeded",
                "runtime_mode": "activitysim_cli",
                "output_root": str(behavioral_manifest.parent),
                "artifacts": {
                    "pipeline_manifest_path": str(behavioral_manifest),
                    "bundle_manifest_path": str(behavioral_manifest.parent / "activitysim_bundle" / "bundle_manifest.json"),
                    "runtime_manifest_path": str(behavioral_manifest.parent / "runtime" / "activitysim_runtime_manifest.json"),
                    "runtime_summary_path": str(behavioral_manifest.parent / "runtime" / "activitysim_runtime_summary.json"),
                    "ingestion_summary_path": str(behavioral_manifest.parent / "ingestion" / "activitysim_ingestion_summary.json"),
                    "kpi_summary_path": str(behavioral_manifest.parent / "kpis" / "activitysim_behavioral_kpi_summary.json"),
                    "kpi_packet_path": str(behavioral_manifest.parent / "kpis" / "activitysim_behavioral_kpi_packet.md"),
                },
                "steps": {
                    "build_activitysim_input_bundle": {
                        "status": "succeeded",
                        "artifacts": {
                            "bundle_dir": str(behavioral_manifest.parent / "activitysim_bundle"),
                            "bundle_manifest_path": str(
                                behavioral_manifest.parent / "activitysim_bundle" / "bundle_manifest.json"
                            ),
                        },
                        "metadata": {
                            "land_use_rows": 26,
                            "households": 41415,
                            "persons": 102322,
                            "skim_mode": "copy",
                        },
                    }
                },
                "caveats": [],
                "errors": [],
            },
        )

        with patch.object(county_onramp, "run_behavioral_demand_prototype") as mocked:
            summary, manifest = county_onramp.run_or_reuse_behavioral_prototype(self.run_dir, force=False)

        self.assertIsNotNone(manifest)
        self.assertEqual(summary["pipeline_status"], "behavioral_runtime_succeeded")
        self.assertEqual(summary["runtime_mode"], "activitysim_cli")
        mocked.assert_not_called()


if __name__ == "__main__":
    unittest.main()
