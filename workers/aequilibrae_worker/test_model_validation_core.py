#!/usr/bin/env python3
"""Focused rules-v4 tests. Run directly or through npm run test:workers."""
from __future__ import annotations

import copy
import hashlib

import model_validation_core as core


HASH = hashlib.sha256(b"fixture").hexdigest()


def observation(
    observation_id: str = "obs-1",
    *,
    grade: str = "B",
    center: float = 100.0,
    bounds="unknown",
    match_status: str = "matched",
    link_id: str = "link-1",
):
    return {
        "schema": core.OBSERVATION_SCHEMA,
        "observation_id": observation_id,
        "source": {
            "dataset_id": "authority:continuous-counts:2024",
            "publisher": "source authority",
            "source_url": "https://example.invalid/source.zip",
            "downloaded_at": "2026-08-27T00:00:00Z",
            "artifact_sha256": HASH,
            "member_path": "source.vol",
            "member_sha256": HASH,
        },
        "route_lrs": {"route_id": "R1", "lrs_id": "L1", "lrs_point": 1.0},
        "geometry": {"type": "Point", "coordinates": [10.0, 10.0]},
        "direction_lane_carriageway": {
            "basis": "both_directions_all_lanes",
            "direction": "combined",
            "lane": "combined",
            "carriageway": "combined",
        },
        "vehicle_basis": {
            "unit": "vehicles",
            "vehicle_definition": "all motor vehicles",
            "conversion": "unknown",
        },
        "time_basis": {
            "year": 2024,
            "start_date": "2024-01-01",
            "end_date": "2024-01-01",
            "day_basis": "all_days_average",
            "observation_period": {"label": "daily", "hours": list(range(24))},
            "frozen_year_adjustment": "unknown",
        },
        "measurement": {
            "method": "direct",
            "duration": {"start": "2024-01-01T00:00:00Z", "end": "2024-01-02T00:00:00Z", "complete_hours": 24},
            "factors": "unknown",
        },
        "qa": {"status": "accepted", "flags": [], "source_fields": {"method": "3"}},
        "estimate": {"center": center, "source_supported_bounds": bounds},
        "evidence_grade": grade,
        "match_audit": {
            "status": match_status,
            "frozen_at": "2026-08-27T00:00:00Z",
            "frozen_before_model_volume": True,
            "geometry": "compatible",
            "route": "compatible",
            "direction": "compatible",
            "facility": "compatible",
            "candidate_link_ids": [link_id],
            "selected_link_id": link_id,
            "reason": "route, direction, facility, and geometry selected this link",
        },
        "duplicate_lineage": {
            "lineage_id": observation_id,
            "canonical_observation_id": observation_id,
            "duplicate_of": "unknown",
            "resolution": "unique",
        },
    }


def basis(*, unit: str = "vehicles", year=2024, day="all_days_average", direction="both_directions_all_lanes", scenario="baseline", acceptance="unknown"):
    return {
        "schema": core.COMPARISON_BASIS_SCHEMA,
        "basis_id": "basis-1",
        "model_run_id": "run-1",
        "model_output_artifact": {"artifact_id": "artifact-1", "artifact_type": "link_volumes", "sha256": HASH},
        "model_base_year": year,
        "day_basis": day,
        "assignment_period": {"label": "daily", "hours": list(range(24))},
        "vehicle_basis": {"unit": unit, "vehicle_pce_conversion": "unknown"},
        "direction_basis": {"basis": direction},
        "planning_use": "development instrument check",
        "scenario": {"scenario_id": "scenario-1", "role": scenario},
        "engine": {"name": "engine-one", "version": "recorded"},
        "coefficient_package": {"name": "package", "sha256": HASH},
        "population_vintage": {"year": 2024, "sha256": HASH},
        "assignment_profile": {"name": "profile", "sha256": HASH},
        "network_settings": {"sha256": HASH},
        "network_state_hashes": {"network": HASH},
        "acceptance_rule": acceptance,
        "frozen_at": "2026-08-27T00:00:00Z",
    }


def frozen_rule(**updates):
    rule = {
        "status": "frozen",
        "preregistration_sha256": HASH,
        "minimum_decisive_observations": 1,
        "maximum_median_raw_ape": 30.0,
        "maximum_median_interval_excess": "unknown",
    }
    rule.update(updates)
    return rule


def assess(observations, comparison_basis, volumes=None):
    return core.assess_validation(
        observations,
        comparison_basis,
        volumes or {"link-1": 110.0},
        partition={"kind": "development", "id": "partition-1"},
        assessment_id="assessment-1",
        created_at="2026-08-27T00:00:00Z",
    )


def test_contract_rejects_missing_source_hash():
    item = observation()
    del item["source"]["artifact_sha256"]
    try:
        core.validate_observation(item)
    except core.ContractError as exc:
        assert "artifact_sha256" in str(exc)
    else:
        raise AssertionError("missing exact source hash was accepted")


def test_contract_rejects_invented_bounds():
    item = observation(bounds={"lower": 90, "upper": 110, "method": "generic 10 percent", "authority": "unknown", "artifact_sha256": HASH})
    try:
        core.validate_observation(item)
    except core.ContractError as exc:
        assert "authoritative" in str(exc)
    else:
        raise AssertionError("unsupported bounds were accepted")


def test_contract_rejects_evidence_grade_promotion():
    item = observation(grade="A")
    try:
        core.validate_observation(item)
    except core.ContractError as exc:
        assert "at most Grade B" in str(exc)
    else:
        raise AssertionError("one-day observation was promoted to Grade A")


def test_incompatible_year_day_direction_and_units_are_inconclusive():
    cases = [
        basis(year=2023, acceptance=frozen_rule()),
        basis(day="weekday", acceptance=frozen_rule()),
        basis(direction="single_direction", acceptance=frozen_rule()),
        basis(unit="pce", acceptance=frozen_rule()),
    ]
    expected = ["base_year", "day_basis", "direction_carriageway", "vehicle_units"]
    for comparison_basis, key in zip(cases, expected):
        result = assess([observation()], comparison_basis)
        assert result["scientific_outcome"] == "inconclusive", (key, result)
        finding = result["comparability_findings"]["obs-1"]
        assert any(row["key"] == key and row["status"] == "incompatible" for row in finding), finding


def test_pce_requires_a_frozen_recorded_conversion():
    comparison_basis = basis(unit="pce", acceptance=frozen_rule())
    comparison_basis["vehicle_basis"]["vehicle_pce_conversion"] = {
        "status": "proven", "factor": 0.94, "artifact_sha256": HASH
    }
    result = assess([observation()], comparison_basis)
    assert result["scientific_outcome"] == "pass", result


def test_raw_residual_zero_observation_and_source_interval_metrics():
    authoritative = {
        "lower": 95.0,
        "upper": 105.0,
        "method": "publisher precision study",
        "authority": "source authority",
        "artifact_sha256": HASH,
    }
    item = observation(grade="A", bounds=authoritative)
    item["measurement"]["duration"]["complete_hours"] = 28 * 24
    result = assess([item], basis(acceptance=frozen_rule(maximum_median_interval_excess=10.0)), {"link-1": 112.0})
    assert result["exact_inputs"]["network_state_hashes"] == basis(
        acceptance=frozen_rule(maximum_median_interval_excess=10.0)
    )["network_state_hashes"]
    row = result["observation_results"][0]
    assert row["raw_signed_residual"] == 12.0
    assert row["raw_absolute_percent_error"] == 12.0
    assert row["interval_excess_error"] == 7.0

    zero = observation(center=0.0)
    zero_result = assess([zero], basis(acceptance=frozen_rule()), {"link-1": 5.0})
    assert zero_result["observation_results"][0]["raw_absolute_percent_error"] is None

    no_bounds = assess([observation()], basis(acceptance=frozen_rule()))
    no_bounds_row = no_bounds["observation_results"][0]
    assert no_bounds_row["observed_bounds"] == "unknown"
    assert no_bounds_row["interval_excess_error"] is None


def test_unloaded_observations_are_retained_and_ambiguous_are_not_scored():
    unloaded = observation(match_status="unloaded")
    ambiguous = observation("obs-2", match_status="ambiguous", link_id="link-2")
    result = assess([unloaded, ambiguous], basis(acceptance=frozen_rule()))
    assert result["coverage"]["unloaded"] == 1
    assert result["coverage"]["ambiguous"] == 1
    assert result["observation_results"][0]["modeled_volume"] == 0.0
    assert len(result["observation_results"]) == 1

    frozen_match_becomes_unloaded = assess(
        [observation()], basis(acceptance=frozen_rule()), {"link-1": 0.0}
    )
    assert frozen_match_becomes_unloaded["coverage"]["matched"] == 0
    assert frozen_match_becomes_unloaded["coverage"]["unloaded"] == 1
    assert frozen_match_becomes_unloaded["observation_results"][0]["match_status"] == "unloaded"


def test_duplicate_lineage_cannot_double_count_a_source_record():
    first = observation()
    duplicate = observation("obs-duplicate")
    duplicate["duplicate_lineage"] = {
        "lineage_id": "lineage-1",
        "canonical_observation_id": "obs-1",
        "duplicate_of": "obs-1",
        "resolution": "same source record exposed by two adapters",
    }
    result = assess([first, duplicate], basis(acceptance=frozen_rule()))
    assert result["metrics"]["all_computed"]["observations"] == 1


def test_grade_c_is_diagnostic_and_grade_d_stays_in_coverage():
    grade_c = observation(grade="C")
    grade_c["measurement"]["method"] = "derived"
    grade_d = observation("obs-2", grade="D", link_id="link-2")
    result = assess(
        [grade_c, grade_d],
        basis(acceptance=frozen_rule()),
        {"link-1": 110.0, "link-2": 90.0},
    )
    assert result["scientific_outcome"] == "inconclusive"
    assert result["coverage"]["diagnostic"] == 1
    assert result["coverage"]["grade_d"] == 1
    assert result["coverage"]["decisive"] == 0
    assert not next(
        row for row in result["observation_results"]
        if row["observation_id"] == "obs-2"
    )["decisive"]


def test_build_forecast_is_never_validated_against_base_year_counts():
    result = assess([observation()], basis(scenario="build", acceptance=frozen_rule()))
    assert result["scientific_outcome"] == "inconclusive"
    assert any("forecast validity" in reason for reason in result["reasons"])

    legacy_rows = uncontracted = core.uncontracted_v4_assessment(
        {"results": [], "coverage": {}},
        basis(scenario="build"),
        assessment_id="uncontracted-build",
        validation_input_bundle_sha256=HASH,
    )
    assert legacy_rows is uncontracted
    assert any("forecast validity" in reason for reason in uncontracted["reasons"])


def test_missing_acceptance_rule_stays_inconclusive_without_a_new_default():
    result = assess([observation()], basis())
    assert result["scientific_outcome"] == "inconclusive"
    assert any("No frozen" in reason for reason in result["reasons"])


def test_legacy_rows_remain_ungraded_and_inconclusive():
    old = {"validation_rules_version": 3, "median_ape": 12.5, "results": [{"station_id": "old"}]}
    result = core.legacy_v1_to_v3_assessment(old, assessment_id="legacy")
    assert result["scientific_outcome"] == "inconclusive"
    assert result["metrics"]["legacy_raw"] == old
    assert "evidence_grade" not in result["observation_results"][0]


if __name__ == "__main__":
    for name, value in sorted(globals().items()):
        if name.startswith("test_") and callable(value):
            value()
    print("model_validation_core: all tests passed")
