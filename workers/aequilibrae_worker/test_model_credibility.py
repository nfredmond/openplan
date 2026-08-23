#!/usr/bin/env python3
"""Focused checks for the model-run credibility artifact and claim boundary."""
import csv
import ast
import json
import os
import sys
import tempfile

os.environ.setdefault("SUPABASE_URL", "http://worker-import-only.invalid")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "import-only-not-a-key")

import main
import model_credibility


def _write_json(path, payload):
    with open(path, "w") as handle:
        json.dump(payload, handle)


def test_count_source_failure_states_remain_distinct():
    with tempfile.TemporaryDirectory() as directory:
        for status in (
            "source_unavailable",
            "geography_unsupported",
            "no_eligible_sections",
            "no_traffic_found",
        ):
            _write_json(
                os.path.join(directory, "count_source_status.json"),
                {"status": status, "source_id": "source-under-test"},
            )
            summary = model_credibility.summarize_count_source(None, directory)
            assert summary["status"] == status, summary
            assert summary["eligible_rows"] == 0
            assert "never zero traffic" in summary["coverage_statement"]


def test_count_source_records_vintage_classes_and_exclusions():
    with tempfile.TemporaryDirectory() as directory:
        counts_path = os.path.join(directory, "counts.csv")
        with open(counts_path, "w", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "source_dataset_id", "source_vintage", "source_agency",
                    "facility_class", "candidate_link_types", "measurement_date",
                    "exclusion_status", "exclusion_reason",
                ],
            )
            writer.writeheader()
            writer.writerow({
                "source_dataset_id": "42um-tgh5",
                "source_vintage": "2024",
                "source_agency": "FHWA",
                "facility_class": "interstate",
                "candidate_link_types": "motorway|trunk",
                "measurement_date": "2022",
                "exclusion_status": "eligible",
                "exclusion_reason": "",
            })
        _write_json(
            counts_path + ".count-source.json",
            {
                "status": "available",
                "excluded_rows": 2,
                "source": {
                    "source_id": "us-fhwa-hpms-2024",
                    "dataset_id": "42um-tgh5",
                    "vintage": "2024",
                    "adapter": "us-fhwa-hpms-socrata",
                    "country": "US",
                    "coverage_statement": "Federal-aid highway section AADT.",
                },
                "records": [
                    {"exclusion_status": "excluded", "exclusion_reason": "non_inventory_direction"},
                    {"exclusion_status": "excluded", "exclusion_reason": "ramp_not_represented"},
                ],
            },
        )
        summary = model_credibility.summarize_count_source(counts_path, directory)
        assert summary["status"] == "available"
        assert summary["dataset_id"] == "42um-tgh5"
        assert summary["vintage"] == "2024"
        assert summary["eligible_rows"] == 1
        assert summary["excluded_rows"] == 2
        assert summary["supported_road_classes"] == ["interstate", "motorway", "trunk"]
        assert summary["exclusion_reasons"] == {
            "non_inventory_direction": 1,
            "ramp_not_represented": 1,
        }


def test_auto_ingest_records_source_failure_for_the_artifact_stage():
    import subprocess

    real_run = subprocess.run
    real_flag = main.COUNT_AUTO_INGEST
    real_env = os.environ.pop("VALIDATION_COUNTS_PATH", None)

    class FailedResult:
        returncode = 1
        stderr = "upstream source timed out"

    try:
        main.COUNT_AUTO_INGEST = True
        subprocess.run = lambda *args, **kwargs: FailedResult()
        with tempfile.TemporaryDirectory() as directory:
            open(os.path.join(directory, "project_database.sqlite"), "w").close()
            result = main.auto_ingest_counts(
                (-83.2, 39.8, -82.8, 40.1), directory, directory
            )
            assert result is None
            with open(os.path.join(directory, "count_source_status.json")) as handle:
                status = json.load(handle)
            assert status["status"] == "source_unavailable", status
            assert status["source_id"] == "us-fhwa-hpms-2024"
            assert "timed out" in status["error"]
    finally:
        subprocess.run = real_run
        main.COUNT_AUTO_INGEST = real_flag
        if real_env is not None:
            os.environ["VALIDATION_COUNTS_PATH"] = real_env


def _calibration():
    return {
        "fit_station_count": 70,
        "holdout_station_count": 30,
        "accepted_iterations": 1,
        "baseline": {"holdout": {"objective": 0.5007, "median_ape": 40.0}},
        "calibrated": {"holdout": {"objective": 0.4016, "median_ape": 44.0}},
    }


def _passing_validation():
    return {
        "stations_matched": 30,
        "median_ape": 22.0,
        "max_ape": 70.0,
        "screening_gate": "bounded screening-ready",
        "zone_resolution": {"supports_link_level_validation": True},
    }


def test_selection_holdout_is_not_independent_accuracy():
    selection = model_credibility.summarize_calibration_selection(_calibration())
    independent = model_credibility.summarize_independent_validation(
        _passing_validation(), _calibration()
    )
    assert selection["baseline"] == {"objective": 0.5007, "median_ape": 40.0}
    assert selection["selected"] == {"objective": 0.4016, "median_ape": 44.0}
    assert selection["evidence_role"] == "candidate_selection_not_accuracy"
    assert independent["status"] == "not_run"
    assert independent["supports_claim_tier"] is False
    assert "cannot also establish accuracy" in independent["reason"]


def test_gateway_basis_never_infers_measured_from_source_presence():
    summary = model_credibility.summarize_gateway_volume_basis([
        {"label": "i-80-west", "link_type": "motorway", "daily_in": 20_000},
        {"label": "sr-49", "link_type": "primary", "daily_in": 6_000, "volume_basis": "measured"},
        {"label": "unknown", "link_type": "secondary"},
    ])
    assert summary["measured"] == 1
    assert summary["inferred"] == 1
    assert summary["unsupported"] == 1
    assert summary["candidate_adopted"] is False


def test_claim_spine_refuses_selection_holdout_promotion():
    posted = []
    real_post = main.requests.post
    real_delete = main.requests.delete

    class Response:
        status_code = 200

    def fake_post(url, **kwargs):
        posted.append((url, kwargs.get("json")))
        return Response()

    try:
        main.requests.post = fake_post
        main.requests.delete = lambda *args, **kwargs: Response()
        main.write_model_run_modeling_evidence(
            "run-1", "workspace-1", _passing_validation(), _calibration()
        )
    finally:
        main.requests.post = real_post
        main.requests.delete = real_delete

    decisions = [payload for url, payload in posted if "modeling_claim_decisions" in url]
    assert len(decisions) == 1
    assert decisions[0]["claim_status"] == "prototype_only", decisions[0]
    assert "no calibrated tier is recorded" in decisions[0]["status_reason"]
    assert decisions[0]["validation_summary_json"]["independent_validation"]["status"] == "not_run"


def test_claim_spine_requires_separate_passing_validation_for_calibrated_tier():
    posted = []
    real_post = main.requests.post
    real_delete = main.requests.delete

    class Response:
        status_code = 200

    try:
        main.requests.post = lambda url, **kwargs: (posted.append((url, kwargs.get("json"))) or Response())
        main.requests.delete = lambda *args, **kwargs: Response()
        main.write_model_run_modeling_evidence(
            "run-2",
            "workspace-1",
            _passing_validation(),
            _calibration(),
            _passing_validation(),
        )
    finally:
        main.requests.post = real_post
        main.requests.delete = real_delete

    decision = [payload for url, payload in posted if "modeling_claim_decisions" in url][0]
    assert decision["claim_status"] == "calibrated_to_counts", decision
    assert "separate untouched" in decision["status_reason"]


def test_artifact_driver_wires_every_credibility_block_and_independent_result():
    with open(main.__file__) as handle:
        tree = ast.parse(handle.read())
    stage = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "stage_artifacts"
    )
    evidence_dict = next(
        node.value
        for node in ast.walk(stage)
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "evidence" for target in node.targets)
        and isinstance(node.value, ast.Dict)
    )
    keys = {
        key.value for key in evidence_dict.keys
        if isinstance(key, ast.Constant) and isinstance(key.value, str)
    }
    assert {
        "count_source",
        "gateway_volume_basis",
        "calibration_selection",
        "independent_validation",
    }.issubset(keys), keys

    credibility_call = next(
        node for node in ast.walk(stage)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "build_model_credibility_evidence"
    )
    assert {keyword.arg for keyword in credibility_call.keywords} == {
        "counts_path", "out_dir", "gateways", "validation", "calibration", "independent_validation"
    }
    claim_call = next(
        node for node in ast.walk(stage)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "write_model_run_modeling_evidence"
    )
    assert len(claim_call.args) == 5, "stage_artifacts must hand the untouched validation to the claim writer"


if __name__ == "__main__":
    tests = [
        test_count_source_failure_states_remain_distinct,
        test_count_source_records_vintage_classes_and_exclusions,
        test_auto_ingest_records_source_failure_for_the_artifact_stage,
        test_selection_holdout_is_not_independent_accuracy,
        test_gateway_basis_never_infers_measured_from_source_presence,
        test_claim_spine_refuses_selection_holdout_promotion,
        test_claim_spine_requires_separate_passing_validation_for_calibrated_tier,
        test_artifact_driver_wires_every_credibility_block_and_independent_result,
    ]
    try:
        for test in tests:
            test()
            print(f"ok  {test.__name__}")
        print(f"\n{len(tests)} model-credibility checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
