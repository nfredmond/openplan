#!/usr/bin/env python3
from __future__ import annotations

import csv
import gzip
import hashlib
import json
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WORKER = ROOT / "workers" / "aequilibrae_worker"
MODELING = ROOT / "scripts" / "modeling"
for directory in (WORKER, MODELING):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

import model_structural_input_audit as audit
import model_validation_structural_diagnosis_v3 as diagnosis
import run_structural_demand_diagnosis as runner


NOW = "2026-08-28T20:00:00Z"
HASH = hashlib.sha256(b"fixture").hexdigest()
REGISTRY = ROOT / "scripts/modeling/development/california_structural_demand_study.v4.json"


def _write_matrix(path: Path, ids: list[int], values: list[list[float]]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["origin_zone", *ids])
        for identifier, row in zip(ids, values):
            writer.writerow([identifier, *row])


def test_sparse_imbalanced_intrazonal_and_rounding_matrix_facts_are_retained():
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "od.csv"
        _write_matrix(path, [1, 2, 3], [[1.11, 0, 2.22], [0, 0, 0], [4.44, 0, 3.33]])
        ids, matrix = audit._read_matrix(path)
        productions = [sum(row) for row in matrix]
        attractions = [sum(matrix[i][j] for i in range(3)) for j in range(3)]
        assert ids == [1, 2, 3]
        assert productions != attractions
        assert sum(productions) == sum(attractions)
        assert sum(matrix[i][i] for i in range(3)) == 4.44


def test_negative_demand_and_changed_zone_ids_are_refused():
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "od.csv"
        _write_matrix(path, [1, 2], [[1, -1], [0, 1]])
        try:
            audit._read_matrix(path)
        except audit.StructuralAuditRefused as exc:
            assert "negative" in str(exc)
        else:
            raise AssertionError("negative OD demand was accepted")
        path.write_text("origin_zone,1,2\n1,1,0\n3,0,1\n")
        try:
            audit._read_matrix(path)
        except audit.StructuralAuditRefused as exc:
            assert "identical ordered zone ids" in str(exc)
        else:
            raise AssertionError("changed zone ids were accepted")


def test_output_derived_fields_are_refused_before_assignment_output():
    for key in ("modeled_volume", "residual", "model_output_sha256"):
        try:
            audit._assert_assignment_blind({"nested": {key: 1}})
        except audit.StructuralAuditRefused as exc:
            assert "output-derived" in str(exc)
        else:
            raise AssertionError(f"pre-output audit accepted {key}")
    try:
        runner.require_all_audits_before_output(13, 14)
    except runner.StudyRefused as exc:
        assert "before output access" in str(exc)
    else:
        raise AssertionError("assignment output opened before every input audit")


def test_disconnected_components_one_way_and_minor_roads_remain_visible():
    links = [
        {"a_node": 1, "b_node": 2, "direction": 1, "link_type": "residential"},
        {"a_node": 2, "b_node": 3, "direction": 0, "link_type": "service"},
        {"a_node": 10, "b_node": 11, "direction": -1, "link_type": "primary"},
    ]
    components, sizes = audit._components(links)
    assert len(sizes) == 2
    assert components[1] == components[3]
    assert components[1] != components[10]
    assert sum(item["direction"] != 0 for item in links) == 2
    assert {item["link_type"] for item in links} >= {"residential", "service"}


def test_registry_is_adapter_driven_and_keeps_unknown_lodes_and_separate_methods():
    registry = runner.verify_registry(REGISTRY)
    assert registry["methods"] == ["aequilibrae", "activitysim"]
    assert len(registry["geographies"]) == 7
    assert all(item["country"] in registry["adapters"] for item in registry["geographies"])
    for geography in registry["geographies"]:
        assert set(geography["methods"]) == {"aequilibrae", "activitysim"}
        assert geography["methods"]["aequilibrae"]["person_to_vehicle_conversion"] == "not_activitysim"
        assert geography["methods"]["activitysim"]["person_to_vehicle_conversion"]["producer_record"]["occupancy_applied"]
        for method in diagnosis.METHODS:
            lodes = geography["methods"][method]["source_vintages"]["lodes"]
            assert lodes["vintage"] == "unknown"
            assert lodes["seed_coverage"] == "unknown"
            assert "home-to-work" in lodes["limitation"]
            assert geography["methods"][method]["source_vintages"]["non_work_through_travel"] == "unsupported"


def test_unsupported_country_and_mixed_vintage_cannot_sneak_into_registry():
    registry = json.loads(REGISTRY.read_text())
    registry["geographies"][0]["country"] = "unsupported-country"
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "registry.json"
        path.write_text(json.dumps(registry))
        try:
            runner.verify_registry(path)
        except runner.StudyRefused as exc:
            assert "unsupported" in str(exc)
        else:
            raise AssertionError("unsupported registry geography was accepted")
    registry = json.loads(REGISTRY.read_text())
    methods = registry["geographies"][1]["methods"]
    methods["aequilibrae"]["source_vintages"]["lodes"]["vintage"] = "2021"
    methods["activitysim"]["source_vintages"]["lodes"]["vintage"] = "2022"
    assert methods["aequilibrae"]["source_vintages"] != methods["activitysim"]["source_vintages"]
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "invented.json"
        path.write_text(json.dumps(registry))
        try:
            runner.verify_registry(path)
        except runner.StudyRefused as exc:
            assert "LODES" in str(exc)
        else:
            raise AssertionError("invented mixed LODES vintages were accepted")


def test_audit_validation_rejects_invented_through_share_dropped_crossings_and_swallowed_unreachable():
    registry = runner.verify_registry(REGISTRY)
    geography = registry["geographies"][0]
    method_record = geography["methods"]["aequilibrae"]
    artifacts = method_record["artifacts"]
    value = audit.build_structural_input_audit(
        repo_root=ROOT, audit_id="mutation-fixture", geography={key: geography[key] for key in ("geography_id", "name", "country", "subdivision", "county")}, method="aequilibrae",
        registry_path=REGISTRY, predecessor_registry_path=runner.stored_path(registry["predecessor"]),
        observation_package_path=runner.stored_path(artifacts["observation_package_v2"]), match_audit_path=runner.stored_path(artifacts["pre_volume_match_audit_v2"]),
        network_path=runner.stored_path(artifacts["network"]), boundary_path=runner.stored_path(artifacts["boundary"]), zone_attributes_path=runner.stored_path(artifacts["zone_attributes"]),
        od_matrix_path=runner.stored_path(artifacts["od_matrix"]), demand_layers_path=runner.stored_path(artifacts["demand_layers"]), assignment_profile_path=runner.stored_path(artifacts["assignment_profile"]),
        network_setup_summary_path=runner.stored_path(artifacts["network_setup_summary"]), source_vintages=method_record["source_vintages"], person_to_vehicle_conversion=method_record["person_to_vehicle_conversion"], created_at=NOW, release={"version": "0.43.0", "sha": HASH},
    )
    for mutate, expected in (
        (lambda item: item["external_and_through_travel"].__setitem__("through_share_evidence", "plausible"), "invented"),
        (lambda item: item["external_and_through_travel"].__setitem__("dropped_crossings", []), "crossings"),
        (lambda item: item["network_loading_readiness"].__setitem__("demand_removed_as_unreachable", item["demand_distribution"]["unreachable_od_trips"] + 1), "Unreachable"),
        (lambda item: item["network_loading_readiness"].__setitem__("loadable_roadway_links", 0), "non-centroid"),
    ):
        changed = json.loads(json.dumps(value))
        mutate(changed)
        try:
            audit.validate_structural_input_audit(changed)
        except audit.StructuralAuditRefused as exc:
            assert expected.lower() in str(exc).lower()
        else:
            raise AssertionError(f"structural mutation survived: {expected}")


def test_real_frozen_audit_covers_crossings_caps_pairing_connectors_and_conservation():
    registry = runner.verify_registry(REGISTRY)
    geography = registry["geographies"][0]
    method = "aequilibrae"
    method_record = geography["methods"][method]
    artifacts = method_record["artifacts"]
    value = audit.build_structural_input_audit(
        repo_root=ROOT, audit_id="fixture", geography={key: geography[key] for key in ("geography_id", "name", "country", "subdivision", "county")}, method=method,
        registry_path=REGISTRY, predecessor_registry_path=runner.stored_path(registry["predecessor"]),
        observation_package_path=runner.stored_path(artifacts["observation_package_v2"]), match_audit_path=runner.stored_path(artifacts["pre_volume_match_audit_v2"]),
        network_path=runner.stored_path(artifacts["network"]), boundary_path=runner.stored_path(artifacts["boundary"]),
        zone_attributes_path=runner.stored_path(artifacts["zone_attributes"]), od_matrix_path=runner.stored_path(artifacts["od_matrix"]),
        demand_layers_path=runner.stored_path(artifacts["demand_layers"]), assignment_profile_path=runner.stored_path(artifacts["assignment_profile"]),
        network_setup_summary_path=runner.stored_path(artifacts["network_setup_summary"]), source_vintages=method_record["source_vintages"], person_to_vehicle_conversion=method_record["person_to_vehicle_conversion"], created_at=NOW,
        release={"version": "0.43.0", "sha": HASH},
    )
    external = value["external_and_through_travel"]
    loading = value["network_loading_readiness"]
    distribution = value["demand_distribution"]
    assert distribution["fallback_use"] == "unknown"
    assert distribution["assumed_commute_share"] == "unknown"
    assert len(external["detected_crossings_before_caps"]) >= len(external["retained_crossings"])
    assert len(external["retained_crossings"]) <= external["registered_gateway_cap"]
    assert external["dropped_crossings"]
    assert any(item["pairing_state"] == "blank_route_name" for item in external["route_pairing"])
    assert len(external["route_pairing"]) == len(external["detected_crossings_before_caps"])
    assert {item["retention_state"] for item in external["route_pairing"]} == {"retained", "dropped"}
    assert external["through_share_evidence"] == "unknown"
    assert external["non_work_through_travel"] == "unsupported"
    assert abs(external["conservation_difference"]) < 1e-6
    assert loading["connected_components"] > 1
    assert loading["connector_count"] == len(loading["zone_connectors"])
    assert all({"length_meters", "attachment_node", "zone_kind"} <= set(item) for item in loading["zone_connectors"])
    assert loading["directional_restrictions"]["one_way"] > 0
    assert loading["facility_coverage"]["residential"] > 0
    assert loading["structurally_unreachable_roadway_links"] > 0
    assert loading["boundary_crossing_link_count"] == len(external["detected_crossings_before_caps"])
    assert loading["assignment_readiness"]["algorithm"] == "bfw"
    assert loading["assignment_readiness"]["target_gap"] == 0.0005
    assert loading["assignment_readiness"]["convergence_evidence"] == "unavailable_in_bound_pre_output_inputs"
    assert loading["assignment_readiness"]["stability_evidence"] == "unavailable_in_bound_pre_output_inputs"
    assert loading["assignment_readiness"]["parameters_changed_by_diagnosis"] is False
    with tempfile.TemporaryDirectory() as temporary:
        arbitrary_output = Path(temporary) / "output.csv"
        arbitrary_output.write_bytes(b"first output")
        before = audit.canonical_json(value)
        arbitrary_output.write_bytes(b"completely different output bytes")
        after = audit.canonical_json(value)
        assert before == after


def _observation(identifier: str) -> dict:
    return {"observation_id": identifier, "facility": {"class": "minor"}}


def test_v3_retains_loaded_unloaded_unreachable_excluded_ambiguous_unsupported_and_missing():
    matches = [
        {"observation_id": "loaded", "status": "matched", "selected_link_ids": ["1"], "direction_aggregation": "one_direction"},
        {"observation_id": "unloaded", "status": "matched", "selected_link_ids": ["2"]},
        {"observation_id": "missing", "status": "matched", "selected_link_ids": ["3"]},
        {"observation_id": "unreachable", "status": "genuine_network_absence"},
        {"observation_id": "excluded", "status": "excluded"},
        {"observation_id": "ambiguous", "status": "ambiguous"},
        {"observation_id": "unsupported", "status": "unsupported"},
    ]
    volumes = {"1": 5.0, "2": 0.0}
    classes = [diagnosis._classification(item, volumes)[0] for item in matches]
    assert classes == ["loaded", "unloaded", "missing_output", "unreachable", "excluded", "ambiguous", "unsupported"]


def test_v3_validation_rejects_discarded_unloaded_records_and_links():
    value = {
        "schema": diagnosis.DIAGNOSIS_SCHEMA,
        "method": "aequilibrae",
        "scientific_outcome": "inconclusive",
        "records": [{"observation_id": "zero", "classification": "unloaded"}],
        "record_coverage": {key: int(key == "unloaded") for key in ("loaded", "unloaded", "unreachable", "excluded", "ambiguous", "unsupported", "missing_output")},
        "network_loading": {"output_link_records": 2, "loaded_links": 1, "unloaded_links": 1},
    }
    diagnosis.validate_structural_diagnosis(value)
    for key, expected in (("unloaded", "discarded"), ("unloaded_links", "unloaded output links")):
        changed = json.loads(json.dumps(value))
        if key == "unloaded":
            changed["record_coverage"][key] = 0
        else:
            changed["network_loading"][key] = 0
        try:
            diagnosis.validate_structural_diagnosis(changed)
        except diagnosis.StructuralDiagnosisRefused as exc:
            assert expected in str(exc)
        else:
            raise AssertionError(f"discarded {key} mutation survived")


def test_method_comparison_keeps_values_differences_and_ratios_without_average():
    left = {"method": "aequilibrae", "records": [{"observation_id": "x", "modeled_value": 10}]}
    right = {"method": "activitysim", "records": [{"observation_id": "x", "modeled_value": 15}]}
    result = diagnosis.compare_methods(left, right)[0]
    assert result["aequilibrae"] == 10
    assert result["activitysim"] == 15
    assert result["difference_activitysim_minus_aequilibrae"] == 5
    assert result["ratio_activitysim_to_aequilibrae"] == 1.5
    assert "average" not in result


def test_published_smoke_proves_all_audits_precede_output_and_hashes_are_exact():
    with tempfile.TemporaryDirectory() as temporary:
        output = Path(temporary) / "study"
        original_audit = runner.structural_audit.build_structural_input_audit
        original_diagnosis = runner.diagnosis_v3.build_structural_diagnosis
        completed_audits = 0
        def counted_audit(**kwargs):
            nonlocal completed_audits
            value = original_audit(**kwargs)
            completed_audits += 1
            return value
        def guarded_diagnosis(**kwargs):
            assert completed_audits == 14, "model output opened before every input audit passed"
            return original_diagnosis(**kwargs)
        runner.structural_audit.build_structural_input_audit = counted_audit
        runner.diagnosis_v3.build_structural_diagnosis = guarded_diagnosis
        try:
            result = runner.run_study(REGISTRY, output, created_at=NOW, release_sha=HASH, app_version="0.43.0")
        finally:
            runner.structural_audit.build_structural_input_audit = original_audit
            runner.diagnosis_v3.build_structural_diagnosis = original_diagnosis
        assert result["method_records"] == 14
        assert result["method_aggregation"] == "separate"
        assert result["scientific_outcome"] == "inconclusive"
        assert all(not value for key, value in result["claims"].items() if key not in {"california", "nationwide"})
        for county in result["counties"]:
            for method in diagnosis.METHODS:
                record = county["methods"][method]
                audit_path = Path(record["input_audit_path"])
                assert hashlib.sha256(audit_path.read_bytes()).hexdigest() == record["input_audit_sha256"]
                exact = gzip.decompress(Path(record["diagnosis_stored_path"]).read_bytes())
                assert hashlib.sha256(exact).hexdigest() == record["diagnosis_sha256"]
        first = result["counties"][0]["methods"]["activitysim"]
        assert first["record_coverage"]["unloaded"] > 0


def test_changed_registered_output_bytes_are_refused_as_custody_failure():
    registry = json.loads(REGISTRY.read_text())
    with tempfile.TemporaryDirectory() as temporary:
        changed = Path(temporary) / "link_volumes.csv"
        changed.write_text("link_id,PCE_tot\n1,999\n")
        record = registry["geographies"][0]["methods"]["aequilibrae"]["artifacts"]["model_output"]
        record["stored_path"] = str(changed)
        path = Path(temporary) / "registry.json"
        path.write_text(json.dumps(registry))
        try:
            runner.verify_registry(path)
        except runner.StudyRefused as exc:
            assert "changed" in str(exc)
        else:
            raise AssertionError("changed output custody was swallowed")


if __name__ == "__main__":
    for name, value in sorted(globals().items()):
        if name.startswith("test_") and callable(value):
            value()
    print("model structural input audit and v3 diagnosis: all tests passed")
