"""Supplied synthetic fixtures, not Census origin or scientific acceptance.

Prepared mutation anchors are named in the private handoff. Execution belongs
to the root lane; these tests do not claim live data or installed-engine proof.
"""
from __future__ import annotations

import copy
import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import census_pums as cp
import common_population as common
from build_activitysim_input_bundle import build_activitysim_input_bundle


def write_csv(path, rows):
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


class CommonPopulationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run = self.root / "run"
        (self.run / "package").mkdir(parents=True)
        (self.run / "run_output").mkdir()
        self.source = self.run / "bundle_manifest.json"
        self.source.write_text(json.dumps({"run_name": "Supplied fixture", "screening_grade": True}))
        self.zone_file = self.run / "package" / "zone_attributes.csv"
        self.zones = []
        for zone_id, geoid in ((7, "01001000100"), (9, "01001000200")):
            self.zones.append({"zone_id": zone_id, "GEOID": geoid, "zone_kind": "internal",
                               "NAMELSAD": "Supplied zone", "centroid_lon": -87.0, "centroid_lat": 32.0,
                               "area_sq_mi": 1.0, "total_jobs": 5, "retail_jobs": 1, "health_jobs": 1,
                               "education_jobs": 1, "accommodation_jobs": 1, "govt_jobs": 1,
                               "est_population": 100, "households": 50, "worker_residents": 30, "area_share": 1.0})
        write_csv(self.zone_file, self.zones)
        (self.run / "run_output" / "travel_time_skims.omx").write_bytes(b"supplied-skim-fixture")
        self.profile = common.census_source_profile("https://api.census.gov/data/2023/acs/acs5", "https://api.census.gov/data/2023/acs/acs5/pums")
        self.household = {"household_id": 4, "home_zone_id": 7, "persons": 1, "workers": 1, "autos": 1,
                          "income": 90000, "hht": 1, "seed_household_id": "fixture-H", "source_geoid": "01001000100",
                          "synthesis_method": common.SYNTHESIS_METHOD}
        self.person = {"person_id": 8, "household_id": 4, "person_num": 1, "home_zone_id": 7, "age": 40,
                       "sex": 1, "is_worker": 1, "is_student": 0, "esr": "1", "schg": "", "wkhp": "40",
                       "seed_household_id": "fixture-H", "source_geoid": "01001000100", "synthesis_method": common.SYNTHESIS_METHOD}
        self.result = {"households": [self.household], "persons": [self.person],
                       "provenance": {"endpoint": self.profile["pums_endpoint"],
                                      "acs_summary_endpoint": self.profile["acs_summary_endpoint"],
                                      "acs_sample_years": [2019, 2023], "income_dollar_year": 2023,
                                      "puma_fields": {"2020": "PUMA"}, "note": "Supplied fixture; origin unassessed."},
                       "source_controls": {"raw_by_geoid": {"01001000100": {"B01003_001E": "100", "B09019_002E": "1", "missing_cell": None},
                                                               "01001000200": {"B01003_001E": "0", "B09019_002E": "0"}},
                                           "inherited_approximations": ["Supplied fixture, no fit claim."]},
                       "fit_quality": {"zones_fitted": 2}, "fit_grading_note": "Unassessed supplied fixture",
                       "dropped_controls": {"example": "Unavailable control"}, "zone_fits": [], "method": common.SYNTHESIS_METHOD}
        self.directory = self.root / "retained"

    def retain(self, result=None):
        return common.retain_population(self.directory, self.zones, result or self.result,
                                        source_manifest_path=self.source, zone_attributes_path=self.zone_file,
                                        source_profile=self.profile)

    def read(self, descriptor, zones=None):
        return common.read_common_population(self.directory, expected_manifest=descriptor, zone_rows=self.zones if zones is None else zones)

    def rewrite_manifest(self, update):
        path = self.directory / common.MANIFEST_NAME
        basis = json.loads(path.read_text())
        update(basis)
        path.write_text(json.dumps(basis))
        return common.file_descriptor(path)

    def test_exact_raw_realization_separates_published_all_people_and_zero_zone(self):
        descriptor = self.retain()
        loaded = self.read(descriptor)
        self.assertEqual(loaded["households"][0]["household_id"], 4)
        self.assertIsInstance(loaded["persons"][0]["person_id"], int)
        self.assertEqual(common.aequilibrae_zone_totals(loaded), {
            7: {"households": 1, "est_population": 1, "worker_residents": 1},
            9: {"households": 0, "est_population": 0, "worker_residents": 0}})
        self.assertEqual(loaded["basis"]["published_all_person_totals"]["01001000100"], "100")
        self.assertIsNone(loaded["diagnostics"]["source_controls"]["raw_by_geoid"]["01001000100"]["missing_cell"])
        self.assertEqual(loaded["basis"]["exclusions"]["group_quarters"], "excluded_unassessed")
        self.assertEqual(loaded["basis"]["custody"], "supplied_artifacts_not_producer_authenticated")

    def test_harmless_source_metadata_and_zone_order_survive(self):
        # Harmless mutation anchor: add an unrelated source field. Compare actual
        # counts, not manifest hashes, since the source identity must change.
        self.source.write_text(json.dumps({"run_name": "Supplied fixture", "note": "Unrelated metadata"}))
        descriptor = self.retain()
        loaded = self.read(descriptor, list(reversed(self.zones)))
        self.assertEqual(loaded["realized_zone_counts"][0]["persons"], 1)

    def test_expected_manifest_hash_and_byte_length_are_both_required(self):
        descriptor = self.retain()
        for key, value in (("sha256", "0" * 64), ("bytes", descriptor["bytes"] + 1)):
            with self.subTest(key=key), self.assertRaisesRegex(common.CommonPopulationError, "identity mismatch"):
                self.read({**descriptor, key: value})

    def test_raw_rows_are_pinned_before_csv_parsing(self):
        descriptor = self.retain()
        path = self.directory / "persons.csv"
        path.write_bytes(path.read_bytes() + b"changed\n")
        with self.assertRaisesRegex(common.CommonPopulationError, "identity mismatch: persons.csv"):
            self.read(descriptor)

    def test_changed_diagnostics_metadata_is_pinned(self):
        descriptor = self.retain()
        path = self.directory / "diagnostics.json"
        value = json.loads(path.read_text())
        value["fit_quality"]["zones_fitted"] = 999
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(common.CommonPopulationError, "identity mismatch: diagnostics.json"):
            self.read(descriptor)

    def test_wrong_actual_counts_fail_even_with_new_manifest_hash(self):
        self.retain()
        descriptor = self.rewrite_manifest(lambda b: b["realized_zone_counts"][0].update(persons=100))
        with self.assertRaisesRegex(common.CommonPopulationError, "actual realized rosters"):
            self.read(descriptor)

    def test_declared_counts_reject_bool_and_fractional_metadata(self):
        self.retain()
        for value in (True, -1, 1.5, 2**53):
            descriptor = self.rewrite_manifest(lambda b: b["realized_zone_counts"][0].update(persons=value))
            with self.subTest(value=value), self.assertRaises(common.CommonPopulationError):
                self.read(descriptor)

    def test_wrong_selected_zone_or_extra_missing_zone_refuses(self):
        descriptor = self.retain()
        changed = copy.deepcopy(self.zones)
        changed[0]["GEOID"] = "01001000300"
        for rows in (changed, self.zones[:1], [*self.zones, {**self.zones[0], "zone_id": 10, "GEOID": "01001000400"}]):
            with self.subTest(rows=len(rows)), self.assertRaisesRegex(common.CommonPopulationError, "Selected-zone map"):
                self.read(descriptor, rows)

    def test_zone_duplicate_unsafe_and_unknown_geographies_refuse(self):
        for changes in ({"zone_id": True}, {"zone_id": -1}, {"zone_id": 2**53}, {"GEOID": "unknown"}, {"zone_kind": "unknown"}):
            with self.subTest(changes=changes), self.assertRaises(common.CommonPopulationError):
                common.selected_zone_map([{**self.zones[0], **changes}])
        with self.assertRaisesRegex(common.CommonPopulationError, "Duplicate"):
            common.selected_zone_map([self.zones[0], self.zones[0]])

    def test_roster_identity_count_and_exact_join_faults_refuse(self):
        faults = [("households", "household_id", True), ("persons", "person_id", "1.0"),
                  ("persons", "person_id", 2**53), ("persons", "household_id", 99),
                  ("persons", "home_zone_id", 9), ("persons", "source_geoid", "01001000200"),
                  ("persons", "seed_household_id", "different-seed"), ("persons", "person_num", 2),
                  ("persons", "esr", "6"), ("persons", "schg", "1"),
                  ("households", "persons", 2), ("households", "workers", 0),
                  ("persons", "is_worker", -1), ("persons", "age", float("nan")),
                  ("households", "income", float("inf"))]
        for role, field, value in faults:
            result = copy.deepcopy(self.result)
            result[role][0][field] = value
            with self.subTest(role=role, field=field, value=value), self.assertRaises(common.CommonPopulationError):
                common.realized_zone_counts(result["households"], result["persons"], common.selected_zone_map(self.zones))
        for role in ("households", "persons"):
            result = copy.deepcopy(self.result)
            result[role].append(copy.deepcopy(result[role][0]))
            with self.subTest(role=role), self.assertRaisesRegex(common.CommonPopulationError, "Duplicate"):
                common.realized_zone_counts(result["households"], result["persons"], common.selected_zone_map(self.zones))

    def test_unknown_csv_columns_and_row_lengths_refuse(self):
        descriptor = self.retain()
        path = self.directory / "persons.csv"
        original = path.read_text()
        for content in (original.replace("age,", "unknown,"), original + "1,2\n"):
            path.write_text(content)
            # Update file and manifest pins deliberately. This isolates the row
            # schema guard from the byte/hash guard.
            descriptor = self.rewrite_manifest(lambda b: b["files"].update(persons=common.file_descriptor(path)))
            with self.subTest(content=content[-8:]), self.assertRaisesRegex(common.CommonPopulationError, "schema|row length"):
                self.read(descriptor)

    def test_duplicate_csv_header_refuses_even_when_collapsed_row_is_valid(self):
        self.retain()
        path = self.directory / 'persons.csv'
        lines = path.read_text().splitlines()
        lines[0] += ',age'
        lines[1] += ',40'
        path.write_text('\n'.join(lines) + '\n')
        descriptor = self.rewrite_manifest(lambda b: b['files'].update(persons=common.file_descriptor(path)))
        with self.assertRaisesRegex(common.CommonPopulationError, 'schema'):
            self.read(descriptor)

    def test_traversal_symlink_missing_and_extra_file_roles_refuse(self):
        self.retain()
        for path in ("../persons.csv", "/persons.csv", "sub/../persons.csv"):
            descriptor = self.rewrite_manifest(lambda b: b["files"]["persons"].update(path=path))
            with self.subTest(path=path), self.assertRaisesRegex(common.CommonPopulationError, "descriptor"):
                self.read(descriptor)
        descriptor = self.rewrite_manifest(lambda b: b["files"].pop("persons"))
        with self.assertRaisesRegex(common.CommonPopulationError, "file roles"):
            self.read(descriptor)
        descriptor = self.rewrite_manifest(lambda b: b["files"].update(
            persons=common.file_descriptor(self.directory / "persons.csv"),
            extra={"path": "extra.csv", "sha256": "0" * 64, "bytes": 0}))
        with self.assertRaisesRegex(common.CommonPopulationError, "file roles"):
            self.read(descriptor)
        # Fresh directory isolates the symlink guard from manifest faults.
        self.directory = self.root / "symlink-trial"
        descriptor = self.retain()
        path = self.directory / "persons.csv"
        saved = self.root / "saved-persons.csv"
        path.rename(saved)
        path.symlink_to(saved)
        with self.assertRaisesRegex(common.CommonPopulationError, "symlink"):
            self.read(descriptor)

    def test_expected_original_source_identities_refuse_unrelated_input(self):
        descriptor = self.retain()
        with self.assertRaisesRegex(common.CommonPopulationError, "original source identity"):
            common.read_common_population(self.directory, expected_manifest=descriptor, zone_rows=self.zones,
                expected_source_manifest={"path": "source_manifest.json", "sha256": "0" * 64, "bytes": 1})

    def test_profile_provenance_missing_controls_and_credentials_refuse_before_materialization(self):
        for kind in ("profile", "controls", "credentials"):
            result = copy.deepcopy(self.result)
            if kind == "profile":
                result["provenance"]["income_dollar_year"] = 2022
            elif kind == "controls":
                del result["source_controls"]["raw_by_geoid"]["01001000200"]
            else:
                result["provenance"]["api_key"] = "fixture-never-a-real-key"
            with self.subTest(kind=kind), self.assertRaises(common.CommonPopulationError):
                self.retain(result)
            self.assertFalse(self.directory.exists())

    def test_explicit_source_profile_rejects_mixed_unknown_or_missing_product(self):
        for profile in ({**self.profile, "adapter": "unknown"}, {**self.profile, "pums_endpoint": None},
                        {**self.profile, "sample_years": [2018, 2022]},
                        {**self.profile, "pums_endpoint": "https://api.census.gov/data/2022/acs/acs5/pums"}):
            with self.subTest(profile=profile), self.assertRaises((common.CommonPopulationError, cp.CensusPumsError)):
                common.validate_source_profile(profile)

    def test_real_builder_bypasses_synthesis_and_keeps_exact_raw_basis(self):
        descriptor = self.retain()
        output = self.root / "activitysim"
        # The subject remains the actual builder and reader. Only the unwanted
        # fetch/fit path is replaced by a failure if it is reached.
        with mock.patch("synthetic_population.synthesize_study_area", side_effect=AssertionError("unexpected refit")) as fit:
            summary = build_activitysim_input_bundle(screening_run_dir=str(self.run), output_dir=str(output),
                population_source="census", retained_population={"directory": str(self.directory), "manifest": descriptor})
        fit.assert_not_called()
        self.assertEqual((summary["households"], summary["persons"]), (1, 1))
        self.assertEqual(summary["population"]["common_population"]["manifest"], descriptor)
        copied = output / "metadata" / "common_population"
        for path in (common.MANIFEST_NAME, *common.ROLES.values()):
            self.assertEqual((copied / path).read_bytes(), (self.directory / path).read_bytes())
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["land_use"]["total_population"], 1)
        self.assertEqual(manifest["synthetic_population"]["common_population"]["basis"]["universe"], "household_residents")

    def test_fit_once_with_supplied_fetches_threads_profile_and_retains_actual_controls(self):
        from synthetic_population import synthesize_study_area

        calls = []
        microdata = [{"SERIALNO": "2023HU_FIXTURE", "SPORDER": "1", "AGEP": "40", "SEX": "1", "ESR": "1",
                      "SCHG": "", "WKHP": "40", "WGTP": "1", "PWGTP": "5", "NP": "1", "HHT": "1",
                      "HINCP": "90000", "ADJINC": "1000000", "VEH": "1"}]
        controls, _dropped = cp.controls_for_geography("tract")
        raw = {zone["GEOID"]: {cell: "0" for cell in cp.acs_variables_for(controls)} for zone in self.zones}
        populated = raw["01001000100"]
        for name, category in (("size", "1"), ("income", "75_to_150k"), ("vehicles", "1"), ("workers", "1")):
            # Deliberate fractional supplied targets expose integerization;
            # this is an arithmetic fixture, not a claimed Census response.
            populated[cp.CONTROL_CELLS[name][category][0]] = "1.4"
        populated[cp.CONTROL_CELLS["age"]["adult"][0]] = "100"
        populated[cp.HOUSEHOLD_POPULATION_CELL] = "1.4"
        populated[cp.TOTAL_POPULATION_CELL] = "100"

        def resolve(bbox, **profile):
            calls.append(("resolve", profile))
            return [{"vintage": "2020", "state_fips": "01", "puma": "00100", "name": "Supplied PUMA"}]

        def fetch_pums(pumas, key, **profile):
            calls.append(("pums", profile))
            return microdata, {"person_records": 1, "sources": []}

        def fetch_controls(geoids, requested_controls, key, **profile):
            calls.append(("controls", profile))
            self.assertEqual(set(geoids), set(raw))
            return raw

        # Mutable defaults deliberately differ from the requested profile.
        with mock.patch.object(cp, "ACS_5_URL", "https://api.census.gov/data/2022/acs/acs5"), mock.patch.object(cp, "PUMS_URL", "https://api.census.gov/data/2022/acs/acs5/pums"):
            result = synthesize_study_area(self.zones, census_api_key="fixture-key", source_profile=self.profile,
                                          resolve_pumas=resolve, fetch_pums_person_rows=fetch_pums,
                                          fetch_acs_zone_controls=fetch_controls)
            self.assertEqual(cp.ACS_5_URL, "https://api.census.gov/data/2022/acs/acs5")
        expected_pair = {"acs5_url": self.profile["acs_summary_endpoint"], "pums_url": self.profile["pums_endpoint"]}
        self.assertEqual(calls, [(name, expected_pair) for name in ("resolve", "pums", "controls")])
        self.assertEqual(result["source_controls"]["raw_by_geoid"], raw)
        self.assertEqual(result["provenance"]["acs_sample_years"], [2019, 2023])
        self.assertEqual(result["summary"]["persons"], 1)
        self.assertEqual(result["zone_fits"][0]["control_differences"]["size"]["1"]["realized"], 1)
        self.assertAlmostEqual(result["zone_fits"][0]["control_differences"]["size"]["1"]["realized_minus_target"], -0.4)
        self.assertAlmostEqual(result["zone_fits"][0]["integerization_household_difference"], -0.4)
        descriptor = self.retain(result)
        output = self.root / "from-fit"
        with mock.patch("synthetic_population.synthesize_study_area", side_effect=AssertionError("second fit")) as refit:
            summary = build_activitysim_input_bundle(screening_run_dir=str(self.run), output_dir=str(output), population_source="census",
                retained_population={"directory": str(self.directory), "manifest": descriptor})
        refit.assert_not_called()
        self.assertEqual(summary["persons"], 1)
        self.assertEqual(self.read(descriptor)["basis"]["published_all_person_totals"]["01001000100"], "100")

    def test_invalid_profile_is_rejected_before_any_supplied_fetch(self):
        from synthetic_population import synthesize_study_area

        fetch = mock.Mock(side_effect=AssertionError("fetch before profile check"))
        with self.assertRaisesRegex(common.CommonPopulationError, "window/schema"):
            synthesize_study_area(self.zones, census_api_key="fixture-key", source_profile={**self.profile, "income_dollar_year": 2022},
                resolve_pumas=fetch, fetch_pums_person_rows=fetch, fetch_acs_zone_controls=fetch)
        fetch.assert_not_called()

    def test_real_census_adapter_fetches_use_explicit_pair_with_different_defaults(self):
        pair = {"acs5_url": self.profile["acs_summary_endpoint"], "pums_url": self.profile["pums_endpoint"]}
        puma = {"vintage": "2020", "state_fips": "01", "puma": "00100", "name": "Supplied PUMA"}
        requests = []

        def supplied_response(url, params, label):
            requests.append((url, params))
            variables = params["get"].split(",")
            if url.endswith("/pums"):
                # An unrelated complete column and reordered named headings
                # must survive the real adapter schema check.
                header = ["UNRELATED", *reversed(variables)]
                return [header, ["fixture" if field == "UNRELATED" else "00100" if field == "PUMA" else "1" for field in header]]
            return [[*variables, "state", "county", "tract"], ["1"] * len(variables) + ["01", "001", "000100"]]

        with mock.patch.object(cp, "ACS_5_URL", "https://api.census.gov/data/2022/acs/acs5"), \
                mock.patch.object(cp, "PUMS_URL", "https://api.census.gov/data/2022/acs/acs5/pums"), \
                mock.patch.object(cp, "_get_json", side_effect=supplied_response):
            rows, _summary = cp.fetch_pums_person_rows([puma], "fixture-key", **pair)
            control_rows = cp.fetch_acs_zone_controls(["01001000100"], [cp.SIZE_CONTROL], "fixture-key", **pair)
            school = cp.fetch_acs_school_enrollment(["01001000100"], "fixture-key", include_source_rows=True, **pair)
        self.assertEqual(rows[0]["PUMA"], "00100")
        self.assertEqual(set(control_rows), {"01001000100"})
        self.assertEqual(school["enrollment"]["01001000100"], {"high_school": 1.0, "college": 2.0})
        self.assertEqual(school["raw_by_geoid"]["01001000100"]["B14001_009E"], "1")
        self.assertTrue(all(url in (self.profile["acs_summary_endpoint"], self.profile["pums_endpoint"]) for url, _params in requests))
        self.assertEqual(requests[0][1]["PUMA"], "00100")
        self.assertNotIn("PUMA20", requests[0][1])

    def test_explicit_profile_resolver_uses_only_its_supported_puma_vintage(self):
        pair = {"acs5_url": self.profile["acs_summary_endpoint"], "pums_url": self.profile["pums_endpoint"]}
        payload = {"features": [{"attributes": {"PUMA": "00100", "STATE": "01", "NAME": "Supplied PUMA"}}]}
        with mock.patch.object(cp, "_get_json", return_value=payload) as fetch:
            pumas = cp.resolve_pumas((-88, 31, -86, 33), **pair)
        self.assertEqual([p["vintage"] for p in pumas], ["2020"])
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(fetch.call_args.args[0], cp.PUMA_LAYERS["2020"])

    def test_retained_school_records_do_not_become_school_seats_or_missing_zeroes(self):
        raw = {zone["GEOID"]: {"B14001_007E": "2", "B14001_008E": "3", "B14001_009E": "4"} for zone in self.zones}
        self.result["school_inputs"] = {"raw_by_geoid": raw,
            "enrollment": {geoid: {"high_school": 2.0, "college": 7.0} for geoid in raw},
            "missing_cells_by_geoid": {geoid: [] for geoid in raw},
            "basis": "ACS B14001 enrolled residents; not school seats or measured full-time college enrollment"}
        descriptor = self.retain()
        loaded = self.read(descriptor)
        self.assertEqual(common.retained_school_enrollment(loaded)["01001000100"], {"high_school": 2.0, "college": 7.0})
        loaded["diagnostics"]["school_inputs"]["raw_by_geoid"]["01001000100"]["B14001_007E"] = None
        with self.assertRaisesRegex(common.CommonPopulationError, "missing/suppressed/invalid"):
            common.retained_school_enrollment(loaded)

    def test_missing_retained_school_records_refuse_before_bundle_output(self):
        descriptor = self.retain()
        output = self.root / "mtc-refused"
        with self.assertRaisesRegex(common.CommonPopulationError, "requires retained school input"):
            build_activitysim_input_bundle(screening_run_dir=str(self.run), output_dir=str(output),
                population_source="census", config_package="mtc", retained_population={"directory": str(self.directory), "manifest": descriptor})
        self.assertFalse(output.exists())

    def test_bad_retained_identity_refuses_before_force_replacement(self):
        descriptor = self.retain()
        output = self.root / "existing"
        output.mkdir()
        sentinel = output / "preserve.txt"
        sentinel.write_text("preserve")
        with self.assertRaisesRegex(common.CommonPopulationError, "identity mismatch"):
            build_activitysim_input_bundle(screening_run_dir=str(self.run), output_dir=str(output), force=True,
                population_source="census", retained_population={"directory": str(self.directory), "manifest": {**descriptor, "sha256": "0" * 64}})
        self.assertEqual(sentinel.read_text(), "preserve")


if __name__ == "__main__":
    unittest.main()
