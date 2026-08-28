#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT_DIR = ROOT / "scripts" / "modeling"
WORKER_DIR = ROOT / "workers" / "aequilibrae_worker"
for directory in (SCRIPT_DIR, WORKER_DIR):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

import model_validation_core_v5 as core
import validation_instrument_v2 as matcher


HASH = hashlib.sha256(b"fixture").hexdigest()


def observation(identifier="series-1", *, geometry=None, center=100.0, direction="one_direction"):
    return {
        "schema": matcher.OBSERVATION_SCHEMA,
        "observation_id": identifier,
        "site_id": "site-1",
        "series_id": identifier,
        "source_kind": "point" if (geometry or {}).get("type", "Point") == "Point" else "section",
        "observation_status": "eligible",
        "source": {},
        "route_lrs": {"route_id": "SR 20", "route_number": "20", "route_name": "SR 20"},
        "geometry": geometry or {"type": "Point", "coordinates": [-121.0, 39.0], "crs": "EPSG:4326"},
        "direction_lane_carriageway": {"basis": direction, "direction": "east"},
        "facility": {"class": "principal_arterial_other"},
        "vehicle_basis": {"unit": "vehicles"},
        "time_basis": {"year": 2024, "day_basis": "annual_average_daily_traffic", "period": "daily"},
        "measurements": [{
            "measurement_id": f"{identifier}:measurement",
            "source_member_path": "member",
            "source_member_sha256": HASH,
            "period": {"start": "2024", "end": "2024"},
            "value": center,
            "unit": "vehicles",
            "complete": True,
            "exact_record_sha256": HASH,
        }],
        "estimate": {"center": center, "source_supported_bounds": "unknown"},
        "evidence_grade": "C",
        "duplicate_lineage": {"lineage_id": identifier, "canonical_observation_id": identifier, "duplicate_of": "unknown", "resolution": "unique"},
    }


def link(identifier, coordinates, *, name="SR 20", direction=1, link_type="primary"):
    return {"link_id": identifier, "name": name, "link_type": link_type, "direction": direction, "geometry": {"type": "LineString", "coordinates": coordinates}}


def audit(item, match):
    return {
        "schema": matcher.MATCH_AUDIT_SCHEMA,
        "frozen_before_model_volume": True,
        "model_output_bytes_read": False,
        "observation_package_sha256": HASH,
        "network_sha256": HASH,
        "matches": [match],
    }


def basis(item, method="aequilibrae"):
    return {
        "schema": core.COMPARISON_BASIS_SCHEMA,
        "basis_id": "basis",
        "model_run_id": "run",
        "method": method,
        "model_output_artifact": {"sha256": HASH},
        "model_base_year": 2024,
        "modeled_quantity": {"name": "synthetic_expanded_daily_traffic", "expansion_chain": {"peak_hour_factor": 0.10, "run_summary_sha256": HASH, "conservation_sha256": HASH}},
        "assignment_period": {"name": "representative_peak_hour"},
        "vehicle_basis": {"unit": "vehicles", "vehicle_pce_equivalence": {"class_pce": 1, "assignment_profile_sha256": HASH}},
        "observation_facts": {item["observation_id"]: {"day_basis": "annual_average_daily_traffic", "observed_direction_basis": item["direction_lane_carriageway"]["basis"], "modeled_direction_basis": item["direction_lane_carriageway"]["basis"], "modeled_vehicle_unit": "vehicles", "synthetic_expanded_daily_traffic": True}},
        "assignment_settings": {"sha256": HASH},
        "coefficient_package": {"sha256": HASH},
        "network_state_hashes": {"network": HASH},
        "acceptance_rule": "unknown",
        "frozen_at": "2026-08-28T00:00:00Z",
    }


def test_long_link_and_multiline_section_use_full_geometry_not_centroids():
    point = observation(geometry={"type": "Point", "coordinates": [-9.9, 0.0], "crs": "EPSG:4326"})
    long = link("long", [[-10.0, 0.0], [10.0, 0.0]])
    relationship = matcher.full_geometry_relationship(point["geometry"], long["geometry"])
    assert relationship["distance_meters"] == 0
    section = observation(geometry={"type": "MultiLineString", "coordinates": [[[0, 0], [0, 1]], [[0, 2], [0, 3]]], "crs": "EPSG:4326"})
    relationship = matcher.full_geometry_relationship(section["geometry"], link("cross", [[-1, 2.5], [1, 2.5]])["geometry"])
    assert relationship["overlap_meters"] == 0
    assert relationship["distance_meters"] == 0


def test_tied_parallel_roads_remain_ambiguous_and_combined_pair_is_explicit():
    item = observation()
    tied = [
        link("a", [[-121.01, 39], [-120.99, 39]], direction=1),
        link("b", [[-121.01, 39.0001], [-120.99, 39.0001]], direction=1),
    ]
    result = matcher.match_observation(item, tied, search_distance_meters=2000)
    assert result["status"] == "ambiguous"
    combined = observation(direction="combined_directions")
    pair = [
        link("east", [[-121.01, 39], [-120.99, 39]], direction=1),
        link("west", [[-121.01, 39.0001], [-120.99, 39.0001]], direction=-1),
    ]
    result = matcher.match_observation(combined, pair, search_distance_meters=2000)
    assert result["status"] == "matched"
    assert result["direction_aggregation"] == "paired_carriageways"
    assert result["selected_link_ids"] == ["east", "west"]


def test_dateline_distance_and_spatial_index_find_nearby_geometry():
    geometry = {"type": "Point", "coordinates": [-179.99, 0], "crs": "EPSG:4326"}
    crossing = link("date", [[179.995, -1], [179.995, 1]])
    assert matcher.full_geometry_relationship(geometry, crossing["geometry"])["distance_meters"] < 2000
    assert matcher.LinkSpatialIndex([crossing]).query(geometry, 2000)[0]["link_id"] == "date"


def test_country_support_and_sources_come_only_from_registry():
    registry = {"adapters": {"US": {"source_ids": ["national", "state"], "module": "us.py"}}}
    assert matcher.registry_adapter_for_geography(registry, {"country": "US"})["source_ids"] == ["national", "state"]
    assert matcher.registry_adapter_for_geography(registry, {"country": "CA"}) == {
        "status": "unsupported", "country": "CA", "source_ids": [],
    }


def test_output_is_refused_until_all_frozen_inputs_pass():
    item = observation()
    match = {"observation_id": item["observation_id"], "status": "matched", "selected_link_ids": ["a"], "direction_aggregation": "one_direction"}
    premature = audit(item, match)
    premature["model_output_bytes_read"] = True
    try:
        core.assess_validation([item], premature, basis(item), {"a": 100}, assessment_id="assessment", input_bundle_sha256=HASH)
    except core.ContractError as exc:
        assert "before all readiness gates" in str(exc)
    else:
        raise AssertionError("premature model-output access was accepted")


def test_assignment_blind_guard_allows_custody_flags_but_rejects_values():
    matcher.assert_assignment_blind({
        "frozen_before_model_volume": True,
        "model_output_bytes_read": False,
    })
    try:
        matcher.assert_assignment_blind({"modeled_volume": 10})
    except matcher.InstrumentV2Error:
        pass
    else:
        raise AssertionError("modeled value leaked into assignment-blind artifact")


def test_rules_v5_retains_zero_negative_unloaded_and_missing_output_rows():
    for center, volumes, expected in ((0, {"a": 0}, "unloaded"), (-5, {"a": 1}, "matched"), (5, {}, "missing_output")):
        item = observation(center=center)
        match = {"observation_id": item["observation_id"], "status": "matched", "selected_link_ids": ["a"], "direction_aggregation": "one_direction"}
        result = core.assess_validation([item], audit(item, match), basis(item), volumes, assessment_id="assessment", input_bundle_sha256=HASH)
        assert len(result["observation_results"]) == 1
        assert result["observation_results"][0]["match_status"] == expected
        assert result["scientific_outcome"] == "inconclusive"


def test_invented_basis_and_collapsed_lineage_are_rejected():
    item = observation()
    match = {"observation_id": item["observation_id"], "status": "matched", "selected_link_ids": ["a"], "direction_aggregation": "one_direction"}
    invented = basis(item)
    invented["vehicle_basis"]["vehicle_pce_equivalence"]["class_pce"] = 0.9
    for broken in (invented, basis(item)):
        broken_item = copy.deepcopy(item)
        if broken is not invented:
            broken_item["measurements"].append(copy.deepcopy(broken_item["measurements"][0]))
        try:
            core.assess_validation([broken_item], audit(broken_item, match), broken, {"a": 1}, assessment_id="assessment", input_bundle_sha256=HASH)
        except core.ContractError:
            pass
        else:
            raise AssertionError("invented basis or collapsed lineage was accepted")


def test_method_comparison_never_averages_values():
    item = observation()
    match = {"observation_id": item["observation_id"], "status": "matched", "selected_link_ids": ["a"], "direction_aggregation": "one_direction"}
    first = core.assess_validation([item], audit(item, match), basis(item), {"a": 100}, assessment_id="a", input_bundle_sha256=HASH)
    second = core.assess_validation([item], audit(item, match), basis(item, "activitysim"), {"a": 120}, assessment_id="b", input_bundle_sha256=HASH)
    comparison = core.compare_methods([first, second])[0]
    assert comparison["aequilibrae"] == 100
    assert comparison["activitysim"] == 120
    assert comparison["difference_activitysim_minus_aequilibrae"] == 20
    assert "average" not in comparison


if __name__ == "__main__":
    for name, value in sorted(globals().items()):
        if name.startswith("test_") and callable(value):
            value()
    print("validation_instrument_v2: all tests passed")
