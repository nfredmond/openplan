from __future__ import annotations

import csv
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MODELING = ROOT / "scripts" / "modeling"
if str(MODELING) not in sys.path:
    sys.path.insert(0, str(MODELING))

import validation_instrument as instrument
import development_validation_sources as development_sources
import prepare_development_validation_instruments as prepare_instruments


NOW = "2026-08-28T12:00:00+00:00"


def observation(observation_id: str, *, lon: float = -121.0, lat: float = 39.0, **overrides):
    base = {
        "schema": "openplan.observed-traffic-observation.v1",
        "observation_id": observation_id,
        "source": {
            "dataset_id": "fixture", "publisher": "Fixture agency", "source_url": "https://example.test/source",
            "downloaded_at": NOW, "artifact_sha256": "a" * 64, "member_path": "row", "member_sha256": "a" * 64,
        },
        "route_lrs": {
            "label": "Route 1", "facility_name": "Route 1", "description": "fixture",
            "candidate_names": ["Route 1"], "candidate_facility_classes": ["primary"],
            "route_id": "1", "section_start": "unknown", "section_end": "unknown",
        },
        "geometry": {"type": "Point", "coordinates": [lon, lat], "crs": "EPSG:4326"},
        "direction_lane_carriageway": {"basis": "two_way", "direction": "two_way", "lane": "unknown", "carriageway": "unknown"},
        "vehicle_basis": {"unit": "vehicles", "vehicle_definition": "published AADT", "conversion": "unknown"},
        "time_basis": {
            "year": 2024, "start_date": "unknown", "end_date": "unknown", "day_basis": "annual_average_daily_traffic",
            "observation_period": {"label": "daily", "hours": list(range(24))}, "frozen_year_adjustment": "unknown",
        },
        "measurement": {"method": "source_derived", "duration": {"start": "unknown", "end": "unknown", "complete_hours": "unknown"}, "factors": "unknown"},
        "qa": {"status": "unknown", "flags": "unknown", "source_fields": "unknown"},
        "estimate": {"center": 1000, "source_supported_bounds": "unknown"},
        "evidence_grade": "C",
        "match_audit": {
            "status": "unresolved", "frozen_at": "unknown", "frozen_before_model_volume": "unknown",
            "geometry": "unknown", "route": "unknown", "direction": "unknown", "facility": "unknown",
            "candidate_link_ids": "unknown", "selected_link_id": "unknown", "reason": "not matched",
        },
        "duplicate_lineage": {
            "lineage_id": observation_id, "canonical_observation_id": observation_id,
            "duplicate_of": "unknown", "resolution": "unique",
        },
    }
    for key, value in overrides.items():
        base[key] = value
    return base


def write_boundary(path: Path):
    path.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature", "properties": {},
            "geometry": {"type": "Polygon", "coordinates": [[[-122, 38], [-120, 38], [-120, 40], [-122, 40], [-122, 38]]]},
        }],
    }))


def write_network(path: Path, links):
    connection = sqlite3.connect(path)
    connection.enable_load_extension(True)
    connection.load_extension("/usr/lib/x86_64-linux-gnu/mod_spatialite.so")
    connection.execute("SELECT InitSpatialMetadata(1)")
    connection.execute(
        "CREATE TABLE links (link_id INTEGER PRIMARY KEY, name TEXT, link_type TEXT, direction INTEGER)"
    )
    connection.execute("SELECT AddGeometryColumn('links', 'geometry', 4326, 'LINESTRING', 'XY')")
    for link_id, name, link_type, direction, coords in links:
        wkt = "LINESTRING(" + ",".join(f"{lon} {lat}" for lon, lat in coords) + ")"
        connection.execute(
            "INSERT INTO links(link_id,name,link_type,direction,geometry) VALUES(?,?,?,?,GeomFromText(?,4326))",
            (link_id, name, link_type, direction, wkt),
        )
    connection.commit()
    connection.close()


class InstrumentFixture(unittest.TestCase):
    def make_package(self, root: Path, observations=None, attempts=None, subdivisions=None):
        boundary = root / "boundary.geojson"
        write_boundary(boundary)
        package_dir = root / "package"
        package_dir.mkdir()
        source = package_dir / "sources" / "fixture.bin"
        source.parent.mkdir()
        source.write_bytes(b"exact downloaded bytes")
        source_record = instrument.artifact_record(source, relative_to=package_dir)
        attempts = attempts or [{
            "source_id": "fixture", "adapter": "fixture", "status": "available", "attempted_at": NOW,
            "source_url": "https://example.test/source", "artifacts": [source_record], "record_count": 1,
            "reason": "Exact response was available.",
        }]
        package = instrument.build_observation_package(
            package_dir,
            geography_id="fixture-geography",
            boundary_path=boundary,
            subdivisions=subdivisions or [{"country": "US", "subdivision": "AA"}],
            source_attempts=attempts,
            observations=observations or [observation("one")],
            created_at=NOW,
        )
        return package_dir / "observation-package.json", package


class PackageContractTests(InstrumentFixture):
    def test_state_source_reuses_frozen_response_without_network_access(self):
        with tempfile.TemporaryDirectory() as temporary:
            package_dir = Path(temporary)
            response_path = package_dir / "sources" / "us-state-ca" / "01-geojson.response"
            response_path.parent.mkdir(parents=True)
            response_path.write_text(json.dumps({
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "properties": {
                        "Route": "32", "County": "BUT", "RouteSuff": "", "PM_Prefix": "",
                        "PM": 9.006, "PM_Suffix": "", "Description": "Ninth Street at Orange Street",
                        "Back_AADT": 9_100, "Ahead_AADT": 8_700,
                    },
                    "geometry": {"type": "Point", "coordinates": [-121.8423, 39.7206]},
                }],
            }))

            def no_network(*_args, **_kwargs):
                raise AssertionError("frozen state response should prevent a network request")

            attempt, rows = development_sources.fetch_state_source(
                "us-state-ca", [-122, 39, -121, 40], package_dir,
                attempted_at=NOW, get=no_network,
            )

            self.assertEqual(attempt["status"], "available")
            self.assertEqual(len(attempt["artifacts"]), 1)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["evidence_grade"], "D")

    def test_ambiguous_state_sections_without_one_observed_value_are_grade_d(self):
        row = development_sources._state_observation(
            {
                "attributes": {
                    "Route": "32",
                    "County": "BUT",
                    "RouteSuff": "",
                    "PM_Prefix": "",
                    "PM": 9.006,
                    "PM_Suffix": "",
                    "Description": "Ninth Street at Orange Street",
                    "Back_AADT": 9_100,
                    "Ahead_AADT": 8_700,
                },
                "geometry": {"x": -121.8423, "y": 39.7206},
            },
            index=0,
            region="CA",
            artifact_sha256="a" * 64,
            downloaded_at=NOW,
        )

        self.assertEqual(row["estimate"]["center"], "unknown")
        self.assertEqual(row["evidence_grade"], "D")

    def test_package_preserves_multisubdivision_polygon_sources_states_and_csv(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            unavailable = {
                "source_id": "state-b", "adapter": "registry", "status": "source_unavailable", "attempted_at": NOW,
                "source_url": "https://example.test/b", "artifacts": [], "record_count": 0, "reason": "HTTP failure preserved.",
            }
            empty = {
                "source_id": "national", "adapter": "registry", "status": "supported_but_empty", "attempted_at": NOW,
                "source_url": "https://example.test/national", "artifacts": [], "record_count": 0, "reason": "Successful empty response.",
            }
            package_path, package = self.make_package(
                root,
                attempts=[unavailable, empty],
                subdivisions=[{"country": "US", "subdivision": "AA"}, {"country": "US", "subdivision": "BB"}],
            )
            schema = json.loads((ROOT / "schemas" / "validation-observation-package-v1.schema.json").read_text())
            self.assertEqual(schema["$id"], package["schema"])
            self.assertEqual(len(package["intersected_subdivisions"]), 2)
            self.assertEqual(package["state_counts"]["source_unavailable"], 1)
            self.assertEqual(package["state_counts"]["supported_but_empty"], 1)
            self.assertTrue((package_path.parent / package["compatibility_csv"]["path"]).is_file())

    def test_unsupported_country_is_explicit_and_unresolved_subdivision_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            unsupported = {
                "source_id": "national", "adapter": "registry", "status": "geography_unsupported", "attempted_at": NOW,
                "source_url": "https://example.test/national", "artifacts": [], "record_count": 0,
                "reason": "Adapter does not cover this country.",
            }
            _path, package = self.make_package(
                root, attempts=[unsupported], subdivisions=[{"country": "ZZ", "subdivision": "01"}]
            )
            self.assertEqual(package["state_counts"]["geography_unsupported"], 1)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            boundary = root / "boundary.geojson"
            write_boundary(boundary)
            with self.assertRaisesRegex(instrument.InstrumentError, "no intersected subdivision"):
                instrument.build_observation_package(
                    root / "package", geography_id="x", boundary_path=boundary,
                    subdivisions=[], source_attempts=[], observations=[], created_at=NOW,
                )

    def test_changed_source_bytes_and_missing_available_artifact_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            package_path, package = self.make_package(Path(temporary))
            source_record = package["source_attempts"][0]["artifacts"][0]
            (package_path.parent / source_record["path"]).write_bytes(b"altered")
            with self.assertRaisesRegex(instrument.InstrumentError, "size changed|SHA-256 changed"):
                instrument.validate_observation_package(package_path)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            boundary = root / "boundary.geojson"
            write_boundary(boundary)
            bad = [{
                "source_id": "bad", "adapter": "fixture", "status": "available", "attempted_at": NOW,
                "source_url": "https://example.test", "artifacts": [], "record_count": 1, "reason": "bad",
            }]
            with self.assertRaisesRegex(instrument.InstrumentError, "no exact downloaded artifact"):
                instrument.build_observation_package(
                    root / "package", geography_id="x", boundary_path=boundary,
                    subdivisions=[{"country": "US", "subdivision": "AA"}],
                    source_attempts=bad, observations=[], created_at=NOW,
                )


class PreVolumeMatcherTests(InstrumentFixture):
    def test_route_geometry_facility_and_carriageway_freeze_without_volume_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package_path, _package = self.make_package(root)
            network = root / "network.sqlite"
            write_network(network, [
                (1, "Route 1", "primary", 1, [(-121.0005, 38.999), (-121.0005, 39.001)]),
                (2, "Route 1", "primary", -1, [(-120.9995, 38.999), (-120.9995, 39.001)]),
                (3, "Other Road", "primary", 0, [(-121.0002, 38.999), (-121.0002, 39.001)]),
            ])
            preregistration = root / "preregistration.json"
            preregistration.write_text("{}")
            audit_path = root / "audit.json"
            audit = instrument.build_pre_volume_match_audit(
                network, package_path, preregistration, audit_path, created_at=NOW
            )
            schema = json.loads((ROOT / "schemas" / "pre-volume-observation-match-audit-v1.schema.json").read_text())
            self.assertEqual(schema["$id"], audit["schema"])
            match = audit["matches"][0]
            self.assertEqual(match["status"], "matched")
            self.assertEqual(match["selected_link_id"], "1+2")
            self.assertEqual(match["carriageway"]["basis"], "two_way_sum")
            self.assertNotIn("modeled", json.dumps(audit).lower())

    def test_tied_candidates_duplicates_and_source_exclusions_are_frozen_not_residual_resolved(self):
        duplicate = observation("duplicate")
        duplicate["duplicate_lineage"] = {
            "lineage_id": "lineage", "canonical_observation_id": "one",
            "duplicate_of": "one", "resolution": "same source row",
        }
        excluded = observation("excluded")
        excluded["match_audit"] = {**excluded["match_audit"], "status": "excluded", "reason": "source facility excluded"}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package_path, _ = self.make_package(root, observations=[observation("tie"), duplicate, excluded])
            network = root / "network.sqlite"
            write_network(network, [
                (1, "Route 1", "primary", 0, [(-121.0001, 38.999), (-121.0001, 39.001)]),
                (2, "Route 1", "primary", 0, [(-120.9999, 38.999), (-120.9999, 39.001)]),
            ])
            preregistration = root / "preregistration.json"
            preregistration.write_text("{}")
            audit = instrument.build_pre_volume_match_audit(
                network, package_path, preregistration, root / "audit.json", created_at=NOW
            )
            self.assertEqual([item["status"] for item in audit["matches"]], ["ambiguous", "duplicate", "excluded"])

    def test_audit_rejects_modeled_volume_fields_and_wrong_package_hash(self):
        with self.assertRaisesRegex(instrument.InstrumentError, "modeled-volume"):
            instrument.assert_assignment_blind({"matches": [{"modeled_volume": 1}]})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package_path, _ = self.make_package(root)
            network = root / "network.sqlite"
            write_network(network, [(1, "Route 1", "primary", 0, [(-121, 38.999), (-121, 39.001)])])
            preregistration = root / "preregistration.json"
            preregistration.write_text("{}")
            audit_path = root / "audit.json"
            instrument.build_pre_volume_match_audit(network, package_path, preregistration, audit_path, created_at=NOW)
            payload = json.loads(audit_path.read_text())
            payload["observation_package_sha256"] = "0" * 64
            audit_path.write_text(json.dumps(payload))
            with self.assertRaisesRegex(instrument.InstrumentError, "observation_package_sha256"):
                instrument.validate_match_audit(audit_path, network, package_path, preregistration)

    def test_output_bytes_are_not_an_input_to_matching(self):
        source = Path(instrument.__file__).read_text()
        self.assertNotIn("link_volumes.csv", source)
        self.assertNotIn("model_output", source)


class RegistryTests(unittest.TestCase):
    def test_v1_registry_and_nationwide_preregistration_remain_byte_frozen(self):
        registry = json.loads((ROOT / "scripts/modeling/development/california_validation_instrument_study.v2.json").read_text())
        for key in ("v1_readiness_registry", "nationwide_preregistration"):
            path = ROOT / registry["frozen_protocol"][key]
            self.assertEqual(
                instrument.sha256_file(path), registry["frozen_protocol"][key + "_sha256"]
            )

    def test_geography_identifiers_live_in_registry_not_in_core(self):
        registry_text = (ROOT / "scripts/modeling/development/california_validation_instrument_study.v2.json").read_text()
        core_text = (ROOT / "scripts/modeling/validation_instrument.py").read_text()
        ids = [item["geography_id"] for item in json.loads(registry_text)["counties"]]
        self.assertEqual(len(ids), 7)
        for geography_id in ids:
            self.assertNotIn(geography_id, core_text)

    def test_hpms_cache_reuse_keeps_exact_data_response_in_source_custody(self):
        with tempfile.TemporaryDirectory() as temporary:
            package_dir = Path(temporary)
            response = package_dir / "sources" / "us-fhwa-hpms-2024" / "002-data.response"
            response.parent.mkdir(parents=True)
            response.write_bytes(b"exact cached HTTP body")
            recorder = development_sources.RecordingGet(package_dir, "us-fhwa-hpms-2024")
        self.assertEqual(len(recorder.data_artifacts), 1)
        self.assertEqual(recorder.data_artifacts[0]["sha256"], instrument.sha256_bytes(b"exact cached HTTP body"))

    def test_normalized_records_are_clipped_to_exact_polygon_and_unlocatable_county_evidence_remains(self):
        from shapely.geometry import Polygon

        inside = observation("inside", lon=-121.0, lat=39.0)
        outside = observation("outside", lon=-119.0, lat=39.0)
        unlocated = observation("unlocated")
        unlocated["geometry"] = {"type": "source_coordinate", "longitude_hemisphere": "unknown"}
        unlocated["route_lrs"]["source_geography"] = {"state_code": "06", "county_code": "007"}
        polygon = Polygon([(-122, 38), (-120, 38), (-120, 40), (-122, 40), (-122, 38)])
        clipped = prepare_instruments._clip_to_resolved_polygon([inside, outside, unlocated], polygon)
        self.assertEqual([item["observation_id"] for item in clipped], ["inside", "unlocated"])


if __name__ == "__main__":
    unittest.main()
