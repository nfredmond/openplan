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


class BuildMtcConfigPackageTests(unittest.TestCase):
    """End-to-end MTC bundle build over a real (tiny) OMX and a fake stock example."""

    def setUp(self) -> None:
        import numpy as np
        import openmatrix as omx

        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.screening_run_dir = self.root / "screening-run"
        (self.screening_run_dir / "package").mkdir(parents=True)
        (self.screening_run_dir / "run_output").mkdir(parents=True)
        (self.screening_run_dir / "work").mkdir(parents=True)

        (self.screening_run_dir / "bundle_manifest.json").write_text(
            json.dumps(
                {
                    "run_name": "MTC package test run",
                    "screening_grade": True,
                    "artifacts": {},
                    "skims": {},
                    "zones": {"zones": 2},
                    "demand": {},
                }
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
                    "area_share": 0.6,
                    "zone_kind": "internal",
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
                    "area_share": 0.4,
                    "zone_kind": "internal",
                },
            ],
        )
        # A real OMX with node ids that do NOT sort in zone order.
        with omx.open_file(str(self.screening_run_dir / "run_output" / "travel_time_skims.omx"), "w") as handle:
            handle["travel_time"] = np.array([[0.0, 12.0], [13.0, 0.0]])
            handle["distance"] = np.array([[0.0, 16093.4], [17000.0, 0.0]])
            handle.create_mapping("main_index", [502, 501])
        (self.screening_run_dir / "work" / "network_setup_summary.json").write_text(
            json.dumps({"centroid_map": {"1": 501, "2": 502}})
        )

        # A fake stock prototype_mtc example.
        self.stock_root = self.root / "stock"
        configs = self.stock_root / "configs"
        configs.mkdir(parents=True)
        (configs / "settings.yaml").write_text("models: []\n")
        (configs / "spec.csv").write_text(
            "Label,Expression\na,odt_skims['SOV_TIME']\nb,od_skims['DIST']\n"
        )
        data = self.stock_root / "data"
        data.mkdir()
        with omx.open_file(str(data / "skims.omx"), "w") as handle:
            tiny = np.zeros((2, 2))
            handle["DIST"] = tiny
            for period in ("EA", "AM", "MD", "PM", "EV"):
                handle[f"SOV_TIME__{period}"] = tiny
                handle[f"WLK_LOC_WLK_TOTIVT__{period}"] = tiny

        self.fitted = {
            "households": [
                {
                    "household_id": 1,
                    "home_zone_id": 1,
                    "persons": 2,
                    "workers": 1,
                    "autos": 1,
                    "income": 90000,
                    "hht": 1,
                    "seed_household_id": "2022HU01",
                    "source_geoid": "06057000100",
                    "synthesis_method": "acs_pums_seed_iterative_proportional_updating",
                },
                {
                    "household_id": 2,
                    "home_zone_id": 2,
                    "persons": 1,
                    "workers": 0,
                    "autos": 0,
                    "income": 20000,
                    "hht": 4,
                    "seed_household_id": "2022HU02",
                    "source_geoid": "06057000200",
                    "synthesis_method": "acs_pums_seed_iterative_proportional_updating",
                },
            ],
            "persons": [
                {
                    "person_id": 1,
                    "household_id": 1,
                    "person_num": 1,
                    "home_zone_id": 1,
                    "age": 41,
                    "sex": 1,
                    "is_worker": 1,
                    "is_student": 0,
                    "esr": "1",
                    "schg": "",
                    "wkhp": "40",
                    "seed_household_id": "2022HU01",
                    "source_geoid": "06057000100",
                    "synthesis_method": "acs_pums_seed_iterative_proportional_updating",
                },
                {
                    "person_id": 2,
                    "household_id": 1,
                    "person_num": 2,
                    "home_zone_id": 1,
                    "age": 12,
                    "sex": 2,
                    "is_worker": 0,
                    "is_student": 1,
                    "esr": "",
                    "schg": "8",
                    "wkhp": "",
                    "seed_household_id": "2022HU01",
                    "source_geoid": "06057000100",
                    "synthesis_method": "acs_pums_seed_iterative_proportional_updating",
                },
                {
                    "person_id": 3,
                    "household_id": 2,
                    "person_num": 1,
                    "home_zone_id": 2,
                    "age": 70,
                    "sex": 2,
                    "is_worker": 0,
                    "is_student": 0,
                    "esr": "6",
                    "schg": "",
                    "wkhp": "",
                    "seed_household_id": "2022HU02",
                    "source_geoid": "06057000200",
                    "synthesis_method": "acs_pums_seed_iterative_proportional_updating",
                },
            ],
            "summary": {
                "households": 2,
                "persons": 3,
                "workers": 1,
                "zones_with_households": 2,
                "zone_geography": "tract",
            },
            "fit_quality": {"zones_fitted": 2},
            "fit_grading_note": "graded against margins",
            "dropped_controls": {},
            "provenance": {"note": "seed drawn from real PUMS records"},
            "method": "acs_pums_seed_iterative_proportional_updating",
        }

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def build(self, output_dir: Path):
        from unittest import mock

        import census_pums
        import synthetic_population as sp

        enrollment = {
            "06057000100": {"high_school": 25.0, "college": 10.0},
            "06057000200": {"high_school": 5.0, "college": 2.0},
        }
        with mock.patch.dict("os.environ", {"CENSUS_API_KEY": "test-key"}):
            with mock.patch.object(sp, "synthesize_study_area", return_value=self.fitted):
                with mock.patch.object(census_pums, "fetch_acs_school_enrollment", return_value=enrollment):
                    return build_activitysim_input_bundle(
                        screening_run_dir=str(self.screening_run_dir),
                        output_dir=str(output_dir),
                        population_source="census",
                        config_package="mtc",
                        stock_configs_dir=str(self.stock_root),
                    )

    def test_the_mtc_bundle_is_runnable_shaped_end_to_end(self) -> None:
        import openmatrix as omx

        output_dir = self.root / "mtc-bundle"
        summary = self.build(output_dir)

        self.assertEqual(summary["config_package"]["name"], "mtc")
        self.assertEqual(summary["config_package"]["status"], "runnable_config_package")
        self.assertTrue(summary["config_package"]["runnable"])

        # No constants.yaml: it would shadow the stock one wholesale.
        self.assertFalse((output_dir / "configs" / "constants.yaml").exists())

        manifest = json.loads((output_dir / "manifest.json").read_text())
        self.assertEqual(manifest["files"]["skim_omx"], "skims/mtc_skims.omx")
        self.assertEqual(manifest["files"]["source_skim_omx"], "skims/travel_time_skims.omx")
        self.assertNotIn("config_constants", manifest["files"])
        self.assertEqual(manifest["config_package"]["package_status"], "runnable_config_package")
        layered = manifest["config_package"]["layered_stock_configs"]
        self.assertEqual(layered["path"], str(self.stock_root / "configs"))
        import activitysim_mtc_inputs as mtc

        self.assertEqual(layered["specs_sha256"], mtc.stock_configs_digest(self.stock_root / "configs"))
        self.assertEqual(manifest["land_use"]["total_households"], 2)
        self.assertEqual(manifest["land_use"]["total_population"], 3)
        joined_caveats = " ".join(manifest["caveats"])
        self.assertIn("San Francisco Bay Area", joined_caveats)
        # The census population's own caveats survive alongside the MTC ones.
        self.assertIn("seed drawn from real PUMS records", joined_caveats)

        # The expanded OMX mirrors the fake stock inventory, in zone order.
        with omx.open_file(str(output_dir / "skims" / "mtc_skims.omx"), "r") as handle:
            names = {str(n) for n in handle.list_matrices()}
            import numpy as np

            sov = np.array(handle["SOV_TIME__AM"])
        self.assertIn("WLK_LOC_WLK_TOTIVT__EV", names)
        # Source node order was [501, 502] = [zone 1, zone 2]; travel_time in
        # node-sorted order [501, 502] puts zone1->zone2 at [0][1]... but the
        # written matrix was stored with mapping [502, 501], i.e. REVERSED, so
        # the correct zone-order value at [0][1] is the source's [1][0] = 13.0.
        self.assertAlmostEqual(sov[0][1], 13.0)

        with (output_dir / "households.csv").open(newline="") as handle:
            households = list(csv.DictReader(handle))
        self.assertEqual(households[0]["HHT"], "1")
        self.assertEqual(int(households[0]["income"]), round(90000 * 172.2 / 292.655))

        with (output_dir / "persons.csv").open(newline="") as handle:
            persons = list(csv.DictReader(handle))
        self.assertEqual(persons[0]["ptype"], "1")  # full-time worker
        self.assertEqual(persons[1]["ptype"], "7")  # 12-year-old in grade school
        self.assertEqual(persons[2]["ptype"], "5")  # retired

        settings_text = (output_dir / "configs" / "settings.yaml").read_text()
        self.assertIn("inherit_settings: True", settings_text)
        self.assertNotIn("write_trip_matrices", settings_text)
        network_los_text = (output_dir / "configs" / "network_los.yaml").read_text()
        self.assertIn("taz_skims: skims/mtc_skims.omx", network_los_text)

    def test_mtc_with_a_scaffold_population_is_refused(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            build_activitysim_input_bundle(
                screening_run_dir=str(self.screening_run_dir),
                output_dir=str(self.root / "refused"),
                population_source="scaffold",
                config_package="mtc",
                stock_configs_dir=str(self.stock_root),
            )
        self.assertIn("--population census", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
