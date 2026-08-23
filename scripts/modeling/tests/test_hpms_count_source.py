#!/usr/bin/env python3
"""Offline contract tests for the nationwide HPMS observed-count adapter."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import count_sources  # noqa: E402
import hpms_count_source as hpms  # noqa: E402
from build_expanded_aadt_counts import load_points  # noqa: E402


def feature(**overrides):
    properties = {
        "aadt": "12000",
        "aadt_d": "2022-01-01T00:00:00.000",
        "stateid": "6",
        "county_id": "57",
        "f_system": "3",
        "facility_type": "2",
        "is_restricted": False,
        "route_id": "CA0000200000",
        "route_number": "20",
        "route_signing": "2",
        "routename": "State Route 20",
        "begin_point": "10.0",
        "end_point": "12.0",
        "year_record": "2024",
        "shapeid": "12345",
    }
    properties.update(overrides)
    return {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": [[-121.2, 39.0], [-121.1, 39.0], [-120.9, 39.0]],
        },
        "properties": properties,
    }


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    def raise_for_status(self):
        if self.status >= 400:
            raise RuntimeError(f"HTTP {self.status}")

    def json(self):
        return self.payload


class FakeSocrata:
    def __init__(self, pages=None, *, metadata=None):
        self.pages = list(pages or [[]])
        self.metadata = metadata or {"rowsUpdatedAt": 1762967831}
        self.calls = []

    def __call__(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if "/api/views/" in url:
            return FakeResponse(self.metadata)
        return FakeResponse({"type": "FeatureCollection", "features": self.pages.pop(0)})


class DescriptorTests(unittest.TestCase):
    def test_hpms_is_a_us_adapter_behind_the_shared_registry(self):
        descriptor = count_sources.observed_count_source_descriptor(count_sources.HPMS_SOURCE_ID)
        self.assertEqual(descriptor["adapter"], "us-fhwa-hpms-socrata")
        self.assertEqual(descriptor["country"], "US")
        self.assertEqual(descriptor["dataset_id"], "42um-tgh5")
        self.assertEqual(descriptor["vintage"], "2024")
        self.assertIn("missing section value is unknown", descriptor["coverage_statement"])
        self.assertGreater(
            count_sources.observed_count_source_descriptor("us-state-ca")["priority"],
            descriptor["priority"],
        )

    def test_state_sources_precede_one_national_fallback(self):
        selected = count_sources.observed_count_sources_for_regions(["WA", "CA", "WA", "ZZ"])
        self.assertEqual([source_id for source_id, _ in selected][-1], count_sources.HPMS_SOURCE_ID)
        self.assertEqual(
            {source_id for source_id, _ in selected[:-1]},
            {"us-state-ca", "us-state-wa"},
        )


class GeographyTests(unittest.TestCase):
    def test_normal_and_antimeridian_bounds(self):
        self.assertEqual(
            hpms.split_spatial_bounds((-123, 37, -121, 39)),
            [(-123.0, 37.0, -121.0, 39.0)],
        )
        self.assertEqual(
            hpms.split_spatial_bounds((179, 51, -179, 53)),
            [(179.0, 51.0, 180.0, 53.0), (-180.0, 51.0, -179.0, 53.0)],
        )

    def test_alaska_hawaii_and_antimeridian_are_supported(self):
        self.assertTrue(hpms.geography_supported((-150, 60, -149, 61)))
        self.assertTrue(hpms.geography_supported((-158.5, 20.5, -157.5, 21.5)))
        self.assertTrue(hpms.geography_supported((179, 51, -179, 53)))
        self.assertFalse(hpms.geography_supported((2.0, 48.0, 3.0, 49.0)))

    def test_unsupported_geography_is_not_reported_as_no_traffic(self):
        with tempfile.TemporaryDirectory() as cache:
            result = hpms.fetch_hpms_records((2.0, 48.0, 3.0, 49.0), cache, request_get=FakeSocrata())
        self.assertEqual(result["status"], "geography_unsupported")
        self.assertEqual(result["records"], [])


class NormalizationTests(unittest.TestCase):
    def normalize(self, **overrides):
        return hpms.normalize_hpms_feature(
            feature(**overrides), source_update_timestamp="1762967831"
        )

    def test_midpoint_and_provenance(self):
        record = self.normalize()
        self.assertAlmostEqual(record["longitude"], -121.05)
        self.assertAlmostEqual(record["latitude"], 39.0)
        self.assertEqual(record["section_id"], "hpms:2024:06:CA0000200000:10.0:12.0:12345")
        self.assertEqual(record["source_state"], "06")
        self.assertEqual(record["source_county"], "057")
        self.assertEqual(record["directionality"], "two_way")
        self.assertEqual(record["facility_class"], "principal_arterial_other")
        self.assertEqual(record["exclusion_status"], "eligible")
        self.assertEqual(record["measurement_date"], "2022-01-01T00:00:00.000")
        self.assertEqual(record["provenance"]["source_year"], "2024")
        self.assertEqual(record["provenance"]["source_update_timestamp"], "1762967831")

    def test_direction_handling(self):
        self.assertEqual(self.normalize(facility_type="1")["directionality"], "one_way")
        self.assertEqual(
            self.normalize(facility_type="6")["exclusion_reason"],
            "non_inventory_direction",
        )

    def test_restricted_ramps_and_non_mainline_are_retained_as_exclusions(self):
        cases = (
            ({"is_restricted": True}, "public_travel_restricted"),
            ({"facility_type": "4"}, "ramp_not_represented_by_retained_network"),
            ({"facility_type": "5"}, "non_mainline_not_represented_by_retained_network"),
        )
        for overrides, reason in cases:
            with self.subTest(reason=reason):
                record = self.normalize(**overrides)
                self.assertEqual(record["exclusion_status"], "excluded")
                self.assertEqual(record["exclusion_reason"], reason)

    def test_absent_aadt_is_unknown_not_zero(self):
        record = self.normalize(aadt=None, f_system="6")
        self.assertIsNone(record["observed_volume"])
        self.assertEqual(record["exclusion_reason"], "aadt_unavailable_for_section")
        self.assertIn("unknown, not zero", record["provenance"]["coverage_statement"])

    def test_unknown_functional_class_is_excluded_not_treated_as_zero(self):
        record = self.normalize(f_system="99")
        self.assertEqual(record["exclusion_reason"], "facility_class_unavailable")
        self.assertEqual(record["observed_volume"], 12000.0)

    def test_schema_drift_names_the_missing_field(self):
        broken = feature()
        del broken["properties"]["aadt_d"]
        with self.assertRaisesRegex(hpms.HPMSSchemaDriftError, "aadt_d"):
            hpms.normalize_hpms_feature(broken, source_update_timestamp="1")


class FetchTests(unittest.TestCase):
    def test_pagination_selects_only_pinned_fields_and_caches_by_update_and_bounds(self):
        first = feature(shapeid="1")
        second = feature(shapeid="2", begin_point="12.0", end_point="13.0")
        fake = FakeSocrata([[first], [second], []])
        with tempfile.TemporaryDirectory() as cache:
            result = hpms.fetch_hpms_records(
                (-122, 38, -120, 40), cache, request_get=fake, page_size=1
            )
            cache_files = list(Path(cache).glob("hpms-*.json"))
            cached_fake = FakeSocrata([[feature(shapeid="unexpected")]])
            cached = hpms.fetch_hpms_records(
                (-122, 38, -120, 40), cache, request_get=cached_fake, page_size=1
            )

        self.assertEqual(result["status"], "available")
        self.assertEqual(len(result["records"]), 2)
        self.assertEqual(len(cache_files), 1)
        data_calls = [call for call in fake.calls if "/resource/" in call[0]]
        self.assertEqual([call[1]["params"]["$offset"] for call in data_calls], [0, 1, 2])
        selected = data_calls[0][1]["params"]["$select"].split(",")
        descriptor = count_sources.observed_count_source_descriptor(count_sources.HPMS_SOURCE_ID)
        self.assertEqual(set(selected), {descriptor["geometry_field"], *descriptor["field_map"].values()})
        self.assertIn("intersects(line, 'POLYGON", data_calls[0][1]["params"]["$where"])
        self.assertEqual(len(cached["records"]), 2)
        self.assertEqual(len(cached_fake.calls), 1, "cache hit should make only the update check")

    def test_antimeridian_fetches_both_halves(self):
        fake = FakeSocrata([[], []])
        with tempfile.TemporaryDirectory() as cache:
            result = hpms.fetch_hpms_records((179, 51, -179, 53), cache, request_get=fake)
        data_calls = [call for call in fake.calls if "/resource/" in call[0]]
        self.assertEqual(len(data_calls), 2)
        self.assertEqual(len(result["query_bounds"]), 2)

    def test_cache_key_changes_with_source_update_or_bounds(self):
        descriptor = count_sources.observed_count_source_descriptor(count_sources.HPMS_SOURCE_ID)
        base = hpms._cache_path(Path("cache"), descriptor, "100", (-122, 38, -120, 40))
        changed_update = hpms._cache_path(Path("cache"), descriptor, "101", (-122, 38, -120, 40))
        changed_bounds = hpms._cache_path(Path("cache"), descriptor, "100", (-123, 38, -120, 40))
        self.assertEqual(len({base, changed_update, changed_bounds}), 3)

    def test_multi_state_rows_retain_source_state(self):
        rows = [feature(stateid="6", shapeid="1"), feature(stateid="41", shapeid="2")]
        fake = FakeSocrata([rows])
        with tempfile.TemporaryDirectory() as cache:
            result = hpms.fetch_hpms_records((-124, 32, -116, 46), cache, request_get=fake)
        self.assertEqual({record["source_state"] for record in result["records"]}, {"06", "41"})

    def test_duplicates_are_not_merged_into_one_apparent_count(self):
        duplicate = feature()
        fake = FakeSocrata([[duplicate, json.loads(json.dumps(duplicate))]])
        with tempfile.TemporaryDirectory() as cache:
            result = hpms.fetch_hpms_records((-122, 38, -120, 40), cache, request_get=fake)
        self.assertEqual(len(result["records"]), 2)
        self.assertEqual(result["records"][1]["exclusion_reason"], "duplicate_source_section")
        self.assertEqual(result["excluded_rows"], 1)

    def test_existing_network_matcher_receives_only_eligible_rows_with_extended_provenance(self):
        eligible = hpms.normalize_hpms_feature(feature(shapeid="1"), source_update_timestamp="1")
        excluded = hpms.normalize_hpms_feature(
            feature(shapeid="2", facility_type="4"), source_update_timestamp="1"
        )
        result = {
            "status": "available",
            "records": [eligible, excluded],
            "source": {},
            "query_bounds": [],
            "excluded_rows": 1,
            "error": None,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "counts.geojson"
            path.write_text(json.dumps(hpms.records_geojson(result)))
            points = load_points(path)
        self.assertEqual(len(points), 1)
        self.assertEqual(points[0]["source_section_id"], eligible["section_id"])
        self.assertEqual(points[0]["source_dataset_id"], "42um-tgh5")

    def test_source_failure_is_distinct_from_an_empty_query(self):
        failing = FakeSocrata(metadata={"unexpected": "shape"})
        with tempfile.TemporaryDirectory() as cache:
            with self.assertRaisesRegex(hpms.HPMSSchemaDriftError, "rowsUpdatedAt"):
                hpms.fetch_hpms_records((-122, 38, -120, 40), cache, request_get=failing)

        unavailable = FakeSocrata()
        unavailable.pages = []

        def fail_data(url, **kwargs):
            if "/api/views/" in url:
                return FakeResponse({"rowsUpdatedAt": 1})
            return FakeResponse({}, status=503)

        with tempfile.TemporaryDirectory() as cache:
            result = hpms.fetch_hpms_records((-122, 38, -120, 40), cache, request_get=fail_data)
        self.assertEqual(result["status"], "source_unavailable")
        self.assertIsNotNone(result["error"])


class PrecedenceTests(unittest.TestCase):
    def test_state_rows_replace_hpms_for_that_state_without_merging(self):
        hpms_record = hpms.normalize_hpms_feature(feature(), source_update_timestamp="1")
        state_record = dict(hpms_record)
        state_record["source_dataset_id"] = "us-ca-ct-aadt"
        selection = hpms.choose_preferred_records(
            {
                count_sources.HPMS_SOURCE_ID: [hpms_record],
                "us-state-ca": [state_record],
            }
        )
        self.assertEqual(selection["sources_by_state"], {"06": "us-state-ca"})
        self.assertEqual(selection["records"], [state_record])


if __name__ == "__main__":
    unittest.main()
