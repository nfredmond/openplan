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

from build_activitysim_input_bundle import build_activitysim_input_bundle


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


class BuildActivitySimInputBundleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.screening_run_dir = self.root / "screening-run"
        (self.screening_run_dir / "package").mkdir(parents=True)
        (self.screening_run_dir / "run_output").mkdir(parents=True)

        (self.screening_run_dir / "bundle_manifest.json").write_text(
            json.dumps(
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
                indent=2,
            )
        )
        write_csv(
            self.screening_run_dir / "package" / "zone_attributes.csv",
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
        (self.screening_run_dir / "run_output" / "travel_time_skims.omx").write_bytes(b"omx-test")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_builds_bundle_from_screening_run_dir(self) -> None:
        output_dir = self.root / "activitysim-bundle"
        summary = build_activitysim_input_bundle(
            screening_run_dir=str(self.screening_run_dir),
            output_dir=str(output_dir),
        )

        self.assertEqual(summary["skim_mode"], "copy")
        self.assertTrue((output_dir / "manifest.json").exists())
        self.assertTrue((output_dir / "land_use.csv").exists())
        self.assertTrue((output_dir / "households.csv").exists())
        self.assertTrue((output_dir / "persons.csv").exists())
        self.assertTrue((output_dir / "README.md").exists())
        self.assertTrue((output_dir / "configs" / "README.md").exists())
        self.assertTrue((output_dir / "configs" / "settings.yaml").exists())
        self.assertTrue((output_dir / "configs" / "constants.yaml").exists())
        self.assertTrue((output_dir / "configs" / "network_los.yaml").exists())
        self.assertTrue((output_dir / "configs" / "openplan_config_package.json").exists())
        self.assertTrue((output_dir / "metadata" / "source_screening_bundle_manifest.json").exists())
        self.assertTrue((output_dir / "skims" / "travel_time_skims.omx").exists())

        manifest = json.loads((output_dir / "manifest.json").read_text())
        self.assertEqual(manifest["bundle_type"], "activitysim_input_bundle")
        self.assertEqual(manifest["synthetic_population"]["status"], "prototype_scaffold")
        self.assertEqual(manifest["config_package"]["package_status"], "starter_executable_kit")
        self.assertEqual(manifest["config_package"]["starter_version"], "v0")
        self.assertEqual(manifest["skims"]["artifact"]["mode"], "copy")
        self.assertIn("not contain a calibrated IPF", " ".join(manifest["caveats"]))
        self.assertEqual(manifest["land_use"]["rows"], 2)
        self.assertGreater(manifest["synthetic_population"]["households"], 0)
        self.assertGreater(manifest["synthetic_population"]["persons"], 0)
        self.assertEqual(manifest["files"]["config_settings"], "configs/settings.yaml")
        self.assertEqual(manifest["files"]["config_constants"], "configs/constants.yaml")
        self.assertEqual(manifest["files"]["config_network_los"], "configs/network_los.yaml")

        with (output_dir / "households.csv").open(newline="") as handle:
            households = list(csv.DictReader(handle))
        with (output_dir / "persons.csv").open(newline="") as handle:
            persons = list(csv.DictReader(handle))
        self.assertEqual(len(households), manifest["synthetic_population"]["households"])
        self.assertEqual(len(persons), manifest["synthetic_population"]["persons"])

        settings_text = (output_dir / "configs" / "settings.yaml").read_text()
        self.assertIn("models: []", settings_text)
        self.assertIn("input_table_list:", settings_text)
        self.assertIn("tablename: land_use", settings_text)
        self.assertIn("tablename: households", settings_text)
        self.assertIn("tablename: persons", settings_text)

        network_los_text = (output_dir / "configs" / "network_los.yaml").read_text()
        self.assertIn("zone_system: 1", network_los_text)
        self.assertIn("taz_skims: skims/travel_time_skims.omx", network_los_text)
        self.assertIn("skim_time_periods:", network_los_text)

    def test_builds_bundle_from_manifest_and_can_symlink_skim(self) -> None:
        output_dir = self.root / "activitysim-bundle-symlink"
        summary = build_activitysim_input_bundle(
            screening_manifest=str(self.screening_run_dir / "bundle_manifest.json"),
            output_dir=str(output_dir),
            skim_mode="symlink",
        )

        self.assertEqual(summary["skim_mode"], "symlink")
        skim_path = output_dir / "skims" / "travel_time_skims.omx"
        self.assertTrue(skim_path.is_symlink())

        manifest = json.loads((output_dir / "manifest.json").read_text())
        self.assertEqual(
            manifest["source_screening_run"]["manifest_path"],
            str(self.screening_run_dir / "bundle_manifest.json"),
        )
        self.assertEqual(manifest["skims"]["artifact"]["mode"], "symlink")


if __name__ == "__main__":
    unittest.main()
