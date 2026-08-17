#!/usr/bin/env python3
"""The batch driver: what it refuses, and what it must never lose.

Every test here guards a way the batch could produce a study that looks
complete and is not — a calibrated run compared as though the network were
constant, a county graded on three stations, or a failure that leaves no trace
and turns "12 counties" into "9, silently".

The subprocesses are replaced with a recorder; what is under test is the
ordering, the refusals and the record, not aequilibrae.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import run_agreement_study as study

COUNTY = {"county_fips": "06047", "region": "CA", "band": "medium", "half": "dev", "tracts": 40}


class FakeRuns:
    """Stands in for every subprocess, writing the artifacts each step promises."""

    def __init__(self, root: Path, *, stations: int = 20, calibrated: str | None = None,
                 skip_trips: bool = False, fail_on: str | None = None):
        self.root = root
        self.stations = stations
        self.calibrated = calibrated
        self.skip_trips = skip_trips
        self.fail_on = fail_on
        self.commands: list[list[str]] = []

    def __call__(self, command, *, log_path, env=None):
        self.commands.append(list(command))
        script = Path(command[1]).name if len(command) > 1 else command[0]
        if self.fail_on and self.fail_on in " ".join(str(c) for c in command):
            raise study.AgreementStudyError(f"{script} exited 1. Last lines:\nboom")
        flags = {command[i]: command[i + 1] for i in range(len(command) - 1) if str(command[i]).startswith("--")}

        if script == "run_screening_model.py":
            run_dir = self.root / "runs" / flags["--name"]
            (run_dir / "run_output").mkdir(parents=True, exist_ok=True)
            (run_dir / "validation").mkdir(parents=True, exist_ok=True)
            (run_dir / "package").mkdir(parents=True, exist_ok=True)
            manifest = {"assignment": {"convergence": {"final_gap": 0.0004}}}
            if self.calibrated and self.calibrated in flags["--name"]:
                manifest["calibration"] = {"class_factors": {"motorway": 1.2}}
            (run_dir / "bundle_manifest.json").write_text(json.dumps(manifest))
            (run_dir / "validation" / "validation_summary.json").write_text(
                json.dumps({"stations_matched": self.stations})
            )
            (run_dir / "run_output" / "link_volumes.csv").write_text("link_id,PCE_tot\n1,5000\n")
            (run_dir / "run_output" / "loaded_links.geojson").write_text(
                json.dumps({"type": "FeatureCollection", "features": []})
            )
            (run_dir / "package" / "zone_attributes.csv").write_text("zone_id\n1\n")
        elif script == "build_activitysim_input_bundle.py":
            Path(flags["--output-dir"], "configs").mkdir(parents=True, exist_ok=True)
        elif script == "activitysim" or Path(command[0]).name == "activitysim":
            out = Path(flags["-o"]) if "-o" in flags else Path(command[command.index("-o") + 1])
            out.mkdir(parents=True, exist_ok=True)
            if not self.skip_trips:
                (out / "final_trips.csv").write_text("trip_mode,origin,destination\nDRIVEALONEFREE,1,1\n")
        elif script == "activitysim_demand_package.py":
            out = Path(flags["--output-dir"])
            out.mkdir(parents=True, exist_ok=True)
            (out / "manifest.json").write_text(
                json.dumps({"conversion": {"vehicle_trips": 1234.5, "unrecognised_modes": {}}})
            )
        elif script == "compare_behavioral_demand_outputs.py":
            out = Path(flags["--output-dir"])
            out.mkdir(parents=True, exist_ok=True)
            (out / "corridor_agreement.json").write_text(
                json.dumps(
                    {
                        "summary": {"agree_share_meaningful_links": 0.42, "diverge_share_meaningful_links": 0.1},
                        "attribution_is_supportable": True,
                    }
                )
            )
        return None


class RunningOneCounty(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.study_dir = self.root / "study"
        self.runs_root = self.root / "runs"
        self.patches = [
            mock.patch.object(study, "activitysim_executable", return_value="activitysim"),
            mock.patch.object(study, "stock_configs_dir", return_value=Path("/stock/configs")),
        ]
        for patch in self.patches:
            patch.start()

    def tearDown(self) -> None:
        for patch in self.patches:
            patch.stop()
        self.tmp.cleanup()

    def run_county(self, fake: FakeRuns, **kwargs):
        with mock.patch.object(study, "run_step", fake):
            return study.run_county(
                COUNTY, study_dir=self.study_dir, runs_root=self.runs_root,
                minimum_stations=kwargs.pop("minimum_stations", 8), **kwargs
            )

    def test_a_healthy_county_runs_every_step_in_order(self) -> None:
        fake = FakeRuns(self.root)
        status = self.run_county(fake)

        self.assertEqual(status["status"], "completed")
        scripts = [Path(c[1]).name if len(c) > 1 else c[0] for c in fake.commands]
        self.assertEqual(
            scripts,
            [
                "run_screening_model.py",          # base
                "build_activitysim_input_bundle.py",
                "run",                              # activitysim (argv[1] is the verb)
                "activitysim_demand_package.py",
                "run_screening_model.py",          # asim assignment
                "run_screening_model.py",          # noise-floor assignment
                "compare_behavioral_demand_outputs.py",  # floor
                "compare_behavioral_demand_outputs.py",  # agreement
            ],
        )
        self.assertEqual(status["steps"]["agreement"]["agree_share_meaningful_links"], 0.42)

    def test_both_assignments_reuse_the_base_network(self) -> None:
        """Without this the two sides are two different downloads of OSM and no
        difference between them is attributable to the demand."""
        fake = FakeRuns(self.root)
        self.run_county(fake)
        assignments = [c for c in fake.commands if Path(c[1]).name == "run_screening_model.py"][1:]
        self.assertEqual(len(assignments), 2)
        for command in assignments:
            self.assertIn("--reuse-network-from-run", command)
            self.assertIn(str(self.runs_root / "study-06047-base"), command)

    def test_the_agreement_map_is_given_the_measured_floor(self) -> None:
        fake = FakeRuns(self.root)
        self.run_county(fake)
        comparisons = [c for c in fake.commands if Path(c[1]).name == "compare_behavioral_demand_outputs.py"]
        self.assertNotIn("--noise-floor-json", comparisons[0])  # the floor measures itself
        self.assertIn("--noise-floor-json", comparisons[1])

    def test_a_calibrated_run_stops_the_county(self) -> None:
        fake = FakeRuns(self.root, calibrated="base")
        status = self.run_county(fake)
        self.assertEqual(status["status"], "failed")
        self.assertIn("calibration", status["error"]["message"])
        # And it stopped BEFORE spending an ActivitySim run on it.
        self.assertNotIn("build_activitysim_input_bundle.py", [Path(c[1]).name for c in fake.commands if len(c) > 1])

    def test_a_calibrated_assignment_is_caught_too(self) -> None:
        fake = FakeRuns(self.root, calibrated="asim")
        status = self.run_county(fake)
        self.assertEqual(status["status"], "failed")
        self.assertIn("calibration", status["error"]["message"])

    def test_too_few_stations_drops_the_county_with_the_number(self) -> None:
        fake = FakeRuns(self.root, stations=3)
        status = self.run_county(fake)
        self.assertEqual(status["status"], "dropped")
        self.assertIn("3 observed count stations", status["dropped_reason"])
        self.assertIn("floor is 8", status["dropped_reason"])
        # Dropped before the expensive half, and never silently.
        self.assertEqual(len(fake.commands), 1)

    def test_a_county_with_no_validation_at_all_is_dropped_not_assumed_fine(self) -> None:
        fake = FakeRuns(self.root)
        with mock.patch.object(study, "station_count", return_value=None):
            status = self.run_county(fake)
        self.assertEqual(status["status"], "dropped")
        self.assertIn("no observed count stations", status["dropped_reason"])

    def test_activitysim_finishing_without_a_trip_list_is_a_failure_not_a_pass(self) -> None:
        fake = FakeRuns(self.root, skip_trips=True)
        status = self.run_county(fake)
        self.assertEqual(status["status"], "failed")
        self.assertIn("final_trips.csv", status["error"]["message"])

    def test_a_failure_is_written_where_the_batch_can_find_it(self) -> None:
        fake = FakeRuns(self.root, fail_on="activitysim_demand_package.py")
        status = self.run_county(fake)
        self.assertEqual(status["status"], "failed")
        on_disk = json.loads((self.study_dir / "06047" / "status.json").read_text())
        self.assertEqual(on_disk["status"], "failed")
        self.assertIn("exited 1", on_disk["error"]["message"])
        self.assertIn("traceback", on_disk["error"])

    def test_a_finished_county_is_skipped_on_resume(self) -> None:
        fake = FakeRuns(self.root)
        self.run_county(fake)
        again = FakeRuns(self.root)
        status = self.run_county(again)
        self.assertTrue(status["resumed"])
        self.assertEqual(again.commands, [])

    def test_force_re_runs_a_finished_county(self) -> None:
        self.run_county(FakeRuns(self.root))
        again = FakeRuns(self.root)
        status = self.run_county(again, force=True)
        self.assertNotIn("resumed", status)
        self.assertTrue(again.commands)


class RunningABatch(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.registry_path = self.root / "registry.json"
        import agreement_study_registry as reg

        self.registry_path.write_text(
            json.dumps(
                {
                    "schema_version": reg.REGISTRY_SCHEMA_VERSION,
                    "pre_registered_rules": {"minimum_stations_per_county": 8},
                    "counties": {
                        "dev": [COUNTY, {**COUNTY, "county_fips": "06069"}],
                        "holdout": [{**COUNTY, "county_fips": "06007", "half": "holdout"}],
                    },
                }
            )
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_the_summary_names_every_county_that_did_not_complete(self) -> None:
        def fake_run_county(county, **kwargs):
            fips = county["county_fips"]
            if fips == "06069":
                return {"county_fips": fips, "status": "dropped", "dropped_reason": "only 2 stations"}
            return {"county_fips": fips, "status": "completed", "seconds": 1.0}

        with mock.patch.object(study, "run_county", side_effect=fake_run_county):
            summary = study.run_study(
                half="dev",
                registry_path=self.registry_path,
                study_root=self.root / "study",
                runs_root=self.root / "runs",
            )
        self.assertEqual(summary["completed"], ["06047"])
        self.assertEqual(summary["dropped"], [{"county_fips": "06069", "reason": "only 2 stations"}])
        self.assertEqual(summary["failed"], [])
        on_disk = json.loads((self.root / "study" / "dev" / "batch_summary.json").read_text())
        self.assertEqual(on_disk["dropped"][0]["county_fips"], "06069")

    def test_the_half_selects_which_counties_run(self) -> None:
        seen = []

        def fake_run_county(county, **kwargs):
            seen.append(county["county_fips"])
            return {"county_fips": county["county_fips"], "status": "completed", "seconds": 0.0}

        with mock.patch.object(study, "run_county", side_effect=fake_run_county):
            study.run_study(
                half="holdout",
                registry_path=self.registry_path,
                study_root=self.root / "study",
                runs_root=self.root / "runs",
            )
        self.assertEqual(seen, ["06007"])

    def test_the_minimum_station_floor_comes_from_the_registry(self) -> None:
        captured = {}

        def fake_run_county(county, **kwargs):
            captured.update(kwargs)
            return {"county_fips": county["county_fips"], "status": "completed", "seconds": 0.0}

        with mock.patch.object(study, "run_county", side_effect=fake_run_county):
            study.run_study(
                half="holdout",
                registry_path=self.registry_path,
                study_root=self.root / "study",
                runs_root=self.root / "runs",
            )
        self.assertEqual(captured["minimum_stations"], 8)


class RefusingCalibratedRuns(unittest.TestCase):
    def test_an_empty_calibration_key_is_not_treated_as_calibrated(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "m.json"
            path.write_text(json.dumps({"calibration": {}}))
            study.refuse_calibrated(path)  # must not raise

    def test_a_populated_calibration_is_refused_with_the_reason(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "m.json"
            path.write_text(json.dumps({"calibration": {"class_factors": {"motorway": 1.2}}}))
            with self.assertRaises(study.AgreementStudyError) as ctx:
                study.refuse_calibrated(path)
            self.assertIn("network is no longer held constant", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
