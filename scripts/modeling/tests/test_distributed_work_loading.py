from __future__ import annotations

import copy
import gzip
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from workers.aequilibrae_worker.distributed_work_loading import (
    AUDIT_SCHEMA,
    COMPARISON_SCHEMA,
    INPUT_SCHEMA,
    SOURCE_STATES,
    DistributedWorkLoadingRefused,
    aggregate_access_points,
    distribute_work_matrix,
    same_custody_by_method,
    validate_development_comparison,
    validate_loading_input,
    validate_pre_output_audit,
)
from scripts.modeling.us_lodes8_work_loading_adapter import read_county_od, read_crosswalk


def test_access_points_work_for_place_archetypes_without_jurisdiction_literals():
    blocks = [
        {"block_id": label, "resolution_state": state, "network_node_id": node, "source_weight": 1, "distance_to_node_meters": distance}
        for label, state, node, distance in (
            ("urban", "routable", 11, 20), ("rural", "routable", 12, 900),
            ("border", "routable", 13, 150), ("coastal", "routable", 14, 80),
            ("mountain", "routable", 12, 3400), ("zero-job", "routable", 15, 10),
            ("unavailable-source", "unavailable_source", None, None), ("non-domestic", "unroutable", 99, 70),
        )
    ]
    points = aggregate_access_points(blocks)
    shared = next(item for item in points if item["access_point_id"] == "node:12")
    assert shared["block_ids"] == ["mountain", "rural"]
    assert shared["distance_to_node_meters"] == 3400
    assert len([item for item in points if item["resolution_state"] != "routable"]) == 2


def test_us_adapter_retains_relationships_across_county_and_source_boundaries(tmp_path):
    od = tmp_path / "od.csv.gz"
    with gzip.open(od, "wt", newline="", encoding="utf-8") as handle:
        handle.write("w_geocode,h_geocode,S000\n")
        handle.write("060070001001001,060390001001001,5\n")
        handle.write("060070001001002,320010001001001,2\n")
        handle.write("061070001001001,060570001001001,11\n")
    rows, active = read_county_od([od], ["06007", "06039"])
    assert len(rows["06007"]) == 2
    assert len(rows["06039"]) == 1
    assert "320010001001001" in active["06007"]

    crosswalk = tmp_path / "xwalk.csv.gz"
    with gzip.open(crosswalk, "wt", newline="", encoding="utf-8") as handle:
        handle.write("tabblk2020,blklatdd,blklondd\n")
        handle.write("060070001001001,39.7,-121.8\n")
        handle.write("060070001001002,39.8,-121.7\n")
        handle.write("060390001001001,37.2,-120.1\n")
    mapped = read_crosswalk(crosswalk, active)
    assert "060070001001001" in mapped["06039"]
    assert "060390001001001" in mapped["06007"]
    assert "320010001001001" not in mapped["06007"]


def test_distribution_preserves_nonwork_and_retains_every_unloadable_work_share():
    result = distribute_work_matrix(
        base_matrix=[[10, 20], [30, 40]], work_matrix=[[4, 10], [0, 8]], zone_ids=[1, 2],
        access_point_ids=["node:11", "node:12"], access_point_index={"node:11": 0, "node:12": 1},
        source_pairs={
            (1, 1): [{"home_access_point_id": "node:11", "work_access_point_id": "node:12", "source_weight": 1, "source_state": "covered"}],
            (1, 2): [
                {"home_access_point_id": "node:11", "work_access_point_id": "node:12", "source_weight": 3, "source_state": "covered"},
                {"home_access_point_id": "block:missing", "work_access_point_id": "node:12", "source_weight": 1, "source_state": "covered"},
            ],
            (2, 2): [{"home_access_point_id": "node:12", "work_access_point_id": "node:12", "source_weight": 0, "source_state": "explicit_zero"}],
        },
    )
    accounting = result["accounting"]
    assert accounting["original_total"] == accounting["candidate_total"] == 100
    assert accounting["non_work_total_unchanged"] == 78
    assert accounting["work_loaded_at_access_points"] == 11.5
    assert accounting["work_retained_at_original_centroids"] == 10.5
    assert {row["state"] for row in result["retained_work_demand"]} == {"unmapped", "explicit_zero"}


def _input():
    return {
        "schema": INPUT_SCHEMA, "method": "aequilibrae", "method_aggregation": "separate",
        "non_work_treatment": "unchanged_not_supported_by_lodes", "arbitrary_point_cap": None,
        "arbitrary_gateway_cap": None, "source_states": {state: {"records": 0} for state in SOURCE_STATES},
        "access_points": [{"block_ids": ["a"]}], "retained_unroutable_access_points": [{"block_ids": ["b"]}],
        "retained_work_demand": [{"demand": 3, "state": "unroutable"}],
        "demand_accounting": {"original_total": 20, "candidate_total": 20, "original_work_total": 8,
            "work_loaded_at_access_points": 5, "work_retained_at_original_centroids": 3},
    }


def _bindings():
    keys = {"registry", "source_release", "source_od", "source_rac", "source_wac", "source_crosswalk", "source_documentation", "source_work_layer", "zone_attributes", "loading_algorithm", "frozen_total_matrix", "loading_input", "candidate_matrix", "candidate_network", "frozen_network", "observation_package", "match_audit", "assignment_profile"}
    return {key: {"sha256": "a" * 64} for key in keys}


def _audit(method="aequilibrae"):
    return {"schema": AUDIT_SCHEMA, "method": method, "frozen_before_assignment_output": True,
        "assignment_output_bytes_read": False, "holdout_accessed": False, "methods_averaged": False,
        "defaults_changed": False, "candidate_promoted": False, "bindings": _bindings()}


def _comparison():
    statuses = {key: 0 for key in ("loaded", "unloaded", "unreachable", "excluded", "ambiguous", "unsupported", "missing_output")}
    statuses["loaded"] = 1
    return {"schema": COMPARISON_SCHEMA, "method": "aequilibrae", "scientific_outcome": "inconclusive",
        "method_aggregation": "separate", "holdout_accessed": False, "defaults_changed": False,
        "records": [{"observation_id": "one"}], "coverage": {"candidate": statuses},
        "county_stratum": {"geography_id": "fixture", "worsened": False},
        "development_gate": {"advanced": False, "demand_conserved": True, "observed_link_reach_improved": False,
            "no_county_stratum_worsened": True, "no_road_class_worsened": True, "same_source_network_custody": True}}


def test_contract_guards_refuse_swallowed_demand_premature_output_and_method_averaging():
    validate_loading_input(_input())
    bad_input = _input(); bad_input["retained_work_demand"] = []
    with pytest.raises(DistributedWorkLoadingRefused, match="swallowed retained"):
        validate_loading_input(bad_input)
    validate_pre_output_audit(_audit())
    bad_audit = _audit(); bad_audit["assignment_output_bytes_read"] = True
    with pytest.raises(DistributedWorkLoadingRefused, match="before exact custody"):
        validate_pre_output_audit(bad_audit)
    validate_development_comparison(_comparison())
    bad_comparison = _comparison(); bad_comparison["method_aggregation"] = "averaged"
    with pytest.raises(DistributedWorkLoadingRefused, match="averaged methods"):
        validate_development_comparison(bad_comparison)


@pytest.mark.parametrize("flag", ["holdout_accessed", "defaults_changed", "candidate_promoted"])
def test_pre_output_audit_refuses_forbidden_boundaries(flag):
    value = _audit(); value[flag] = True
    with pytest.raises(DistributedWorkLoadingRefused, match=flag):
        validate_pre_output_audit(value)


def test_exact_source_and_network_custody_must_match_between_methods():
    left, right = _audit(), _audit("activitysim")
    assert same_custody_by_method([left, right])
    changed = copy.deepcopy(right); changed["bindings"]["source_od"]["sha256"] = "b" * 64
    assert not same_custody_by_method([left, changed])


def test_candidate_cannot_advance_after_county_stratum_worsens():
    value = _comparison()
    value["development_gate"]["advanced"] = True
    value["development_gate"]["observed_link_reach_improved"] = True
    value["development_gate"]["no_county_stratum_worsened"] = False
    with pytest.raises(DistributedWorkLoadingRefused, match="every preregistered county gate"):
        validate_development_comparison(value)


if __name__ == "__main__":
    direct_tests = [
        test_access_points_work_for_place_archetypes_without_jurisdiction_literals,
        test_distribution_preserves_nonwork_and_retains_every_unloadable_work_share,
        test_contract_guards_refuse_swallowed_demand_premature_output_and_method_averaging,
        test_exact_source_and_network_custody_must_match_between_methods,
        test_candidate_cannot_advance_after_county_stratum_worsens,
    ]
    for direct_test in direct_tests:
        direct_test()
    with tempfile.TemporaryDirectory() as directory:
        test_us_adapter_retains_relationships_across_county_and_source_boundaries(Path(directory))
    for boundary_flag in ("holdout_accessed", "defaults_changed", "candidate_promoted"):
        test_pre_output_audit_refuses_forbidden_boundaries(boundary_flag)
    print("distributed work loading: 9 tests passed")
