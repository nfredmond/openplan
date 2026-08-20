#!/usr/bin/env python3
"""The behavioral assignment consumes one intact, hash-verified local package."""
import hashlib
import inspect
import json
import os
import sqlite3
import sys
import tempfile
import types
from pathlib import Path
from unittest import mock

# Credentials and the engine's module-load boundary both live in one place, so
# the modeling-lane suite that also needs main.py cannot reimplement half of them
# (it did, on 2026-08-20, and CI caught the other half).
from worker_import_for_tests import import_worker_main

main = import_worker_main()


def convergence(gap: float, *, profile: dict | None = None) -> dict:
    applied = profile or main.resolve_assignment_profile({})
    return main.assignment_convergence_record(gap, 2500, applied)


def settings_identity(factors: dict | None = None) -> tuple[dict, str, str]:
    settings = main.assignment_network_settings(factors)
    payload = main.network_settings_payload_json(settings)
    return settings, payload, main.network_settings_digest(settings, payload)


def network_state(settings_digest: str, token: str = "same") -> tuple[dict, str]:
    digest = lambda value: hashlib.sha256(value.encode("utf-8")).hexdigest()
    manifest = {
        "schema_version": "openplan.retained-network-manifest.v1",
        "all_link_count": 1,
        "all_link_ids_digest": digest("all"),
        "roadway_link_count": 1,
        "roadway_link_ids_digest": digest("roadway"),
        "modeling_connector_link_count": 0,
        "modeling_connector_link_ids_digest": digest("connectors"),
        "excluded_roles": ["modeling_connector"],
        "role_definition": {
            "roadway": "link_type != centroid_connector",
            "modeling_connector": "link_type = centroid_connector",
        },
    }
    component = digest(token)
    record = {
        "schema_version": "openplan.assignment-network-state.v1",
        "network_settings_digest": settings_digest,
        "assignment_centroid_count": 1,
        "assignment_centroid_order_digest": component,
        "block_centroid_flows": True,
        "penalty_through_centroids": "positive_infinity",
        "cost_field": "travel_time",
        "capacity_field": "capacity",
        "graph_row_count": 1,
        "graph_rows_digest": component,
        "graph_float_dtype": "<f8",
        "graph_cost_digest": component,
        "graph_cost_dtype": "<f8",
        "compact_cost_digest": component,
        "compact_cost_dtype": "<f8",
        "solver_free_flow_tt_digest": component,
        "solver_free_flow_tt_dtype": "<f8",
        "solver_capacity_digest": component,
        "solver_capacity_dtype": "<f8",
        "retained_network_digest": component,
        "retained_network_manifest": manifest,
    }
    return record, main.assignment_network_state_digest(record)


def identity_record(gap: float, *, profile: dict | None = None, factors: dict | None = None) -> dict:
    settings, payload, digest = settings_identity(factors)
    state, state_digest = network_state(digest)
    return {
        "convergence": convergence(gap, profile=profile),
        "network_settings": settings,
        "network_settings_payload_json": payload,
        "network_settings_digest": digest,
        "network_state_record": state,
        "network_state_digest": state_digest,
    }


class FakeGraph:
    def __init__(self):
        import pandas as pd

        self.graph = pd.DataFrame(
            {
                "link_id": [1, 2, 3],
                "travel_time": [10.0, 20.0, 30.0],
                "capacity": [100.0, 200.0, 300.0],
            }
        )
        self.cost_field = None

    def set_graph(self, field):
        self.cost_field = field


def artifact(path: Path, artifact_type: str, *, digest: str | None = None) -> dict:
    return {
        "artifact_type": artifact_type,
        "file_url": f"local://{path}",
        "content_hash": digest or hashlib.sha256(path.read_bytes()).hexdigest(),
        "metadata_json": {"kind": "activitysim_assignment_handoff"},
    }


def package_artifacts(manifest: Path) -> list[dict]:
    return [
        artifact(manifest, "activitysim_demand_package_manifest"),
        artifact(manifest.parent / "od_trip_matrix.csv", "activitysim_demand_matrix"),
        artifact(manifest.parent / "zone_attributes.csv", "activitysim_demand_zones"),
    ]


def make_package(root: Path) -> Path:
    root.mkdir(parents=True)
    (root / "zone_attributes.csv").write_text("zone_id\n1\n")
    (root / "od_trip_matrix.csv").write_text("zone_id,1\n1,0\n")
    manifest = root / "manifest.json"
    manifest.write_text(json.dumps({"schema_version": "openplan.demand_package.v1"}))
    return manifest


def test_preflight_only_run_has_no_assignment_package():
    with mock.patch.object(main, "sb_get_run_artifacts", return_value=[]):
        assert main.activitysim_assignment_package("run-1") is None


def test_vehicle_demand_never_gets_the_trip_based_mode_split_again():
    assert main.should_apply_trip_based_mode_split(False, True) is True
    assert main.should_apply_trip_based_mode_split(True, True) is False
    assert main.should_apply_trip_based_mode_split(False, False) is False


def test_persisted_network_factors_apply_without_any_demand_handoff():
    with tempfile.TemporaryDirectory() as tmp:
        project = Path(tmp)
        connection = sqlite3.connect(project / "project_database.sqlite")
        connection.execute("CREATE TABLE links (link_id INTEGER, link_type TEXT)")
        connection.executemany(
            "INSERT INTO links VALUES (?, ?)",
            [(1, "motorway"), (2, "primary"), (3, "motorway")],
        )
        connection.commit()
        connection.close()
        graph = FakeGraph()
        changed = main.apply_persisted_network_settings(
            graph,
            str(project),
            main.assignment_network_settings({"motorway": 1.25}),
        )
        assert changed == 2
        assert graph.graph["travel_time"].tolist() == [8.0, 20.0, 24.0]
        assert graph.graph["capacity"].tolist() == [125.0, 200.0, 375.0]
        assert graph.cost_field == "travel_time"


def test_network_settings_digest_is_canonical_and_sensitive_to_factors():
    first = main.assignment_network_settings({"primary": 1.1, "motorway": 0.95})
    reordered = main.assignment_network_settings({"motorway": 0.95, "primary": 1.1})
    changed = main.assignment_network_settings({"primary": 1.2, "motorway": 0.95})
    assert main.network_settings_digest(first) == main.network_settings_digest(reordered)
    assert main.network_settings_digest(first) != main.network_settings_digest(changed)


def test_baseline_network_settings_have_the_full_canonical_identity():
    baseline = main.assignment_network_settings()
    assert baseline == {
        "schema_version": "openplan.network-calibration.v1",
        "road_class_factors": {},
        "application": {
            "travel_time": "baseline_travel_time / factor",
            "capacity": "baseline_capacity * factor",
        },
        "excludes": ["trip_based_od_adjustments"],
    }
    assert len(main.network_settings_digest(baseline)) == 64


def test_accepted_settings_artifact_metadata_carries_exact_identity_and_exclusion():
    settings, settings_payload, digest = settings_identity({"primary": 1.1})
    state, state_digest = network_state(digest)
    profile = main.resolve_assignment_profile({})
    convergence_record = convergence(0.0004, profile=profile)
    profile_digest = main.assignment_profile_digest(profile)
    metadata = main.accepted_network_settings_metadata(
        {
            "convergence": convergence_record,
            "calibration": {
                "convergence": convergence_record,
                "network_settings": settings,
                "network_settings_payload_json": settings_payload,
                "network_settings_digest": digest,
                "network_state_record": state,
                "network_state_digest": state_digest,
            }
        },
        "accepted_network_calibration.json",
    )
    assert metadata["filename"] == "accepted_network_calibration.json"
    assert metadata["kind"] == "accepted_assignment_network_settings"
    assert metadata["schema_version"] == "openplan.network-calibration.v1"
    assert metadata["network_settings"] == settings
    assert metadata["network_settings_payload_json"] == settings_payload
    assert metadata["network_settings_digest"] == digest
    assert metadata["assignment_convergence"] == convergence_record
    assert metadata["assignment_profile_digest"] == profile_digest
    assert metadata["network_state_record"] == state
    assert metadata["network_state_digest"] == state_digest
    assert metadata["excludes"] == ["trip_based_od_adjustments"]

    broken = {
        "convergence": convergence_record,
        "calibration": {
            "convergence": {
                **convergence_record,
                "assignment_profile_digest": "wrong-digest",
            },
            "network_settings": settings,
            "network_settings_payload_json": settings_payload,
            "network_settings_digest": digest,
            "network_state_record": state,
            "network_state_digest": state_digest,
        },
    }
    try:
        main.accepted_network_settings_metadata(
            broken,
            "accepted_network_calibration.json",
        )
    except main.AssignmentSettingsError:
        pass
    else:
        raise AssertionError("accepted settings metadata ignored calibration convergence")

    broken["calibration"]["convergence"] = convergence_record
    broken["calibration"]["network_settings_digest"] = "wrong-digest"
    try:
        main.accepted_network_settings_metadata(
            broken,
            "accepted_network_calibration.json",
        )
    except main.AssignmentSettingsError:
        pass
    else:
        raise AssertionError("accepted settings metadata ignored its settings digest")


def test_every_assignment_output_metadata_carries_the_profile_digest():
    profile = main.resolve_assignment_profile({})
    convergence_record = convergence(0.0004, profile=profile)
    profile_digest = main.assignment_profile_digest(profile)
    record = identity_record(0.0004, profile=profile)
    metadata = main.assignment_artifact_metadata(record, "link_volumes.csv")
    assert metadata["filename"] == "link_volumes.csv"
    assert metadata["assignment_convergence"] == convergence_record
    assert metadata["assignment_profile_digest"] == profile_digest
    assert metadata["assignment_profile_payload_json"] == convergence_record[
        "assignment_profile_payload_json"
    ]
    assert metadata["network_settings_digest"] == record["network_settings_digest"]
    assert metadata["network_state_digest"] == record["network_state_digest"]

    tampered_record = {**convergence_record, "assignment_profile_digest": "wrong-digest"}
    for missing_or_tampered in ({}, {**record, "convergence": tampered_record}):
        try:
            main.assignment_artifact_metadata(missing_or_tampered, "link_volumes.csv")
        except main.AssignmentSettingsError:
            pass
        else:
            raise AssertionError("an artifact without the verified assignment digest was accepted")


def test_calibrated_artifact_metadata_uses_the_calibration_convergence_record():
    profile = main.resolve_assignment_profile({})
    baseline = convergence(0.0004, profile=profile)
    calibrated = convergence(0.0003, profile=profile)
    digest = main.assignment_profile_digest(profile)
    result = {
        **identity_record(0.0004, profile=profile),
        "convergence": baseline,
        "calibration": {
            **identity_record(0.0003, profile=profile),
            "convergence": calibrated,
        },
    }
    assert main.assignment_artifact_metadata(
        result,
        "link_volumes_calibrated.csv",
    )["assignment_profile_digest"] == digest

    result["calibration"]["convergence"] = {
        **calibrated,
        "assignment_profile_digest": "wrong-digest",
    }
    try:
        main.assignment_artifact_metadata(result, "link_volumes_calibrated.csv")
    except main.AssignmentSettingsError:
        pass
    else:
        raise AssertionError("calibrated metadata ignored its calibration convergence record")


def test_exact_hash_verified_package_is_resolved():
    with tempfile.TemporaryDirectory() as tmp:
        manifest = make_package(Path(tmp) / "package")
        with mock.patch.object(main, "sb_get_run_artifacts", return_value=package_artifacts(manifest)):
            assert main.activitysim_assignment_package("run-1") == str(manifest.parent)


def test_relaunch_uses_the_newest_package_instead_of_a_stale_artifact():
    with tempfile.TemporaryDirectory() as tmp:
        newest = make_package(Path(tmp) / "newest")
        stale = make_package(Path(tmp) / "stale")
        rows = package_artifacts(newest) + package_artifacts(stale)
        with mock.patch.object(main, "sb_get_run_artifacts", return_value=rows):
            assert main.activitysim_assignment_package("run-1") == str(newest.parent)


def test_modified_manifest_is_refused():
    with tempfile.TemporaryDirectory() as tmp:
        manifest = make_package(Path(tmp) / "package")
        with mock.patch.object(
            main,
            "sb_get_run_artifacts",
            return_value=[
                artifact(manifest, "activitysim_demand_package_manifest", digest="0" * 64),
                *package_artifacts(manifest)[1:],
            ],
        ):
            try:
                main.activitysim_assignment_package("run-1")
            except RuntimeError as exc:
                assert "content-hash" in str(exc)
            else:
                raise AssertionError("modified package was accepted")


def test_assignment_stage_reuses_state_and_bypasses_second_mode_split():
    with tempfile.TemporaryDirectory() as tmp:
        work_root = Path(tmp)
        run_id = "11111111-1111-4111-8111-111111111111"
        run_dir = work_root / "runs" / run_id[:12]
        run_dir.mkdir(parents=True)
        first_profile = main.resolve_assignment_profile(
            {
                "OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.0002",
                "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS": "5000",
                "AEQ_CORES": "4",
            }
        )
        accepted_record = identity_record(
            0.0001,
            profile=first_profile,
            factors={"primary": 1.1256789},
        )
        accepted_settings = accepted_record["network_settings"]
        accepted_digest = accepted_record["network_settings_digest"]
        (run_dir / "state.json").write_text(
            json.dumps(
                {
                    "setup": {"centroid_map": {"1": 1001}},
                    "assignment": {
                        "counts_path": "/counts/held-out.csv",
                        # Deliberately stricter than this process's defaults.
                        # Re-resolving on the second worker would silently pass
                        # if this fixture used the default profile too.
                        **identity_record(0.0001, profile=first_profile),
                        "calibration": accepted_record,
                    },
                }
            )
        )
        accepted_settings = json.loads((run_dir / "state.json").read_text())["assignment"][
            "calibration"
        ]["network_settings"]
        first_profile = json.loads((run_dir / "state.json").read_text())["assignment"][
            "convergence"
        ]["assignment_profile"]
        profile_digest = main.assignment_profile_digest(first_profile)
        calls = []

        def assignment(*args, **kwargs):
            calls.append((args, kwargs))
            output = run_dir / kwargs["output_dir_name"]
            output.mkdir()
            (output / "link_volumes.csv").write_text("link_id,PCE_tot\n1,10\n")
            return {
                "log": "assigned\n",
                "counts_path": kwargs["counts_path_override"],
                "network_settings": kwargs["persisted_network_settings"],
                "network_settings_payload_json": kwargs[
                    "persisted_network_settings_payload_json"
                ],
                "network_settings_digest": kwargs["persisted_network_settings_digest"],
                "network_state_record": kwargs["expected_network_state_record"],
                "network_state_digest": kwargs["expected_network_state_digest"],
                "convergence": convergence(
                    0.0003,
                    profile=kwargs["assignment_profile_override"],
                ),
            }

        completion = mock.Mock(status_code=200)
        completion.json.return_value = []
        with (
            mock.patch.object(main, "RUN_WORK_ROOT", str(work_root)),
            mock.patch.object(main, "sb_claim_stage", return_value=True),
            mock.patch.object(main, "sb_patch_stage"),
            mock.patch.object(main, "sb_patch_run"),
            mock.patch.object(main, "sb_post_artifact") as post_artifact,
            mock.patch.object(main, "activitysim_assignment_package", return_value="/activitysim/package"),
            mock.patch.object(main, "stage_assignment", side_effect=assignment),
            mock.patch.object(main.requests, "get", return_value=completion),
        ):
            assert main.process_stage(
                {
                    "id": "stage-5",
                    "run_id": run_id,
                    "stage_name": "ActivitySim Network Assignment",
                }
            )

        assert len(calls) == 1
        _, kwargs = calls[0]
        assert kwargs["output_dir_name"] == "activitysim_assignment_output"
        assert kwargs["demand_is_vehicle"] is True
        assert kwargs["counts_path_override"] == "/counts/held-out.csv"
        assert kwargs["persisted_network_settings"]["road_class_factors"] == {
            "primary": 1.1256789
        }
        assert kwargs["persisted_network_settings_payload_json"] == accepted_record[
            "network_settings_payload_json"
        ]
        assert kwargs["expected_network_state_digest"] == accepted_record[
            "network_state_digest"
        ]
        assert kwargs["assignment_profile_override"] == first_profile
        payload = post_artifact.call_args.args[0]
        assert payload["artifact_type"] == "activitysim_link_volumes"
        assert payload["metadata_json"]["demand_is_vehicle"] is True
        assert payload["metadata_json"]["network_calibration"] == (
            "accepted_trip_based_network_settings"
        )
        assert payload["metadata_json"]["trip_based_od_adjustments_reused"] is False
        assert payload["metadata_json"]["network_settings_digest"] == accepted_digest
        assert payload["metadata_json"]["assignment_profile_digest"] == profile_digest


def test_uncalibrated_assignment_handoff_reuses_the_canonical_baseline_digest():
    with tempfile.TemporaryDirectory() as tmp:
        work_root = Path(tmp)
        run_id = "11111111-1111-4111-8111-111111111111"
        run_dir = work_root / "runs" / run_id[:12]
        run_dir.mkdir(parents=True)
        profile = main.resolve_assignment_profile({})
        baseline_record = identity_record(0.0004, profile=profile)
        baseline_digest = baseline_record["network_settings_digest"]
        (run_dir / "state.json").write_text(
            json.dumps(
                {
                    "setup": {"centroid_map": {"1": 1001}},
                    "assignment": {
                        "counts_path": "/counts/held-out.csv",
                        **baseline_record,
                    },
                }
            )
        )

        def assignment(*_args, **kwargs):
            assert kwargs["persisted_network_settings"] == baseline_record["network_settings"]
            output = run_dir / kwargs["output_dir_name"]
            output.mkdir()
            (output / "link_volumes.csv").write_text("link_id,PCE_tot\n1,10\n")
            return {
                "log": "assigned\n",
                "network_settings": kwargs["persisted_network_settings"],
                "network_settings_payload_json": kwargs[
                    "persisted_network_settings_payload_json"
                ],
                "network_settings_digest": baseline_digest,
                "network_state_record": kwargs["expected_network_state_record"],
                "network_state_digest": kwargs["expected_network_state_digest"],
                "convergence": convergence(
                    0.0003,
                    profile=kwargs["assignment_profile_override"],
                ),
            }

        completion = mock.Mock(status_code=200)
        completion.json.return_value = []
        with (
            mock.patch.object(main, "RUN_WORK_ROOT", str(work_root)),
            mock.patch.object(main, "sb_claim_stage", return_value=True),
            mock.patch.object(main, "sb_patch_stage"),
            mock.patch.object(main, "sb_patch_run"),
            mock.patch.object(main, "sb_post_artifact") as post_artifact,
            mock.patch.object(main, "activitysim_assignment_package", return_value="/package"),
            mock.patch.object(main, "stage_assignment", side_effect=assignment),
            mock.patch.object(main.requests, "get", return_value=completion),
        ):
            assert main.process_stage(
                {
                    "id": "stage-5-baseline",
                    "run_id": run_id,
                    "stage_name": "ActivitySim Network Assignment",
                }
            )

        metadata = post_artifact.call_args.args[0]["metadata_json"]
        assert metadata["network_calibration"] == "baseline_network_settings"
        assert metadata["network_settings_digest"] == baseline_digest


def test_assignment_handoff_refuses_an_unverified_first_network_digest():
    with tempfile.TemporaryDirectory() as tmp:
        work_root = Path(tmp)
        run_id = "11111111-1111-4111-8111-111111111111"
        run_dir = work_root / "runs" / run_id[:12]
        run_dir.mkdir(parents=True)
        profile = main.resolve_assignment_profile({})
        bad_record = identity_record(0.0004, profile=profile)
        bad_record["network_settings_digest"] = "wrong-digest"
        (run_dir / "state.json").write_text(
            json.dumps(
                {
                    "setup": {"centroid_map": {"1": 1001}},
                    "assignment": {
                        **bad_record,
                    },
                }
            )
        )
        failures = []
        completion = mock.Mock(status_code=200)
        completion.json.return_value = []
        with (
            mock.patch.object(main, "RUN_WORK_ROOT", str(work_root)),
            mock.patch.object(main, "sb_claim_stage", return_value=True),
            mock.patch.object(
                main,
                "sb_patch_stage",
                side_effect=lambda _id, body: failures.append(body),
            ),
            mock.patch.object(main, "sb_patch_run"),
            mock.patch.object(main, "activitysim_assignment_package", return_value="/package"),
            mock.patch.object(main, "stage_assignment") as assignment,
            mock.patch.object(main.requests, "get", return_value=completion),
        ):
            assert main.process_stage(
                {
                    "id": "stage-5-bad-first-digest",
                    "run_id": run_id,
                    "stage_name": "ActivitySim Network Assignment",
                }
            )

        assert assignment.call_count == 0
        assert any(
            body.get("status") == "failed"
            and "ActivitySim assignment handoff"
            in body.get("error_message", "")
            for body in failures
        )


def test_agreement_stage_calls_the_existing_comparator_with_both_convergence_records():
    with tempfile.TemporaryDirectory() as tmp:
        work_root = Path(tmp)
        run_id = "11111111-1111-4111-8111-111111111111"
        run_dir = work_root / "runs" / run_id[:12]
        (run_dir / "run_output").mkdir(parents=True)
        profile = main.resolve_assignment_profile({})
        calibrated_record = identity_record(
            0.0003, profile=profile, factors={"primary": 1.1}
        )
        settings_digest = calibrated_record["network_settings_digest"]
        profile_digest = main.assignment_profile_digest(profile)
        (run_dir / "state.json").write_text(
            json.dumps(
                {
                    "assignment": {
                        **identity_record(0.0004, profile=profile),
                        "calibration": calibrated_record,
                    },
                    "activitysim_assignment": identity_record(
                        0.0005, profile=profile, factors={"primary": 1.1}
                    ),
                }
            )
        )
        comparator_calls = []

        def comparator(**kwargs):
            comparator_calls.append(kwargs)
            output = Path(kwargs["output_dir"])
            output.mkdir(exist_ok=True)
            result = {}
            for key, filename in (
                ("json_path", "corridor_agreement.json"),
                ("markdown_path", "corridor_agreement.md"),
                ("geojson_path", "corridor_agreement.geojson"),
            ):
                path = output / filename
                path.write_text("{}")
                result[key] = str(path)
            result["summary"] = {
                "links_compared": 20,
                "links_carrying_meaningful_traffic": 10,
                "agree_share_meaningful_links": 0.6,
                "diverge_share_meaningful_links": 0.2,
            }
            return result

        completion = mock.Mock(status_code=200)
        completion.json.return_value = []
        fake_module = mock.Mock(compare_link_volume_runs=comparator)
        with (
            mock.patch.object(main, "RUN_WORK_ROOT", str(work_root)),
            mock.patch.object(main, "sb_claim_stage", return_value=True),
            mock.patch.object(main, "sb_patch_stage") as patch_stage,
            mock.patch.object(main, "sb_patch_run"),
            mock.patch.object(
                main,
                "sb_get_run_artifacts",
                return_value=[{"artifact_type": "activitysim_link_volumes"}],
            ),
            mock.patch.object(
                main,
                "verified_latest_local_artifact",
                side_effect=["/trip-based.csv", "/activity-based.csv"],
            ) as verified_artifact,
            mock.patch.object(main, "register_agreement_artifact") as register,
            mock.patch.object(
                main,
                "write_agreement_network_geojson",
                side_effect=lambda _work, path, **_kwargs: path,
            ) as write_geometry,
            mock.patch.object(main.requests, "get", return_value=completion),
            mock.patch.dict("sys.modules", {"compare_behavioral_demand_outputs": fake_module}),
        ):
            assert main.process_stage(
                {
                    "id": "stage-6",
                    "run_id": run_id,
                    "stage_name": "Demand Model Agreement",
                }
            )

        call = comparator_calls[0]
        assert call["first_csv"] == "/trip-based.csv"
        assert call["second_csv"] == "/activity-based.csv"
        assert call["first_label"] == "AequilibraE trip-based demand (count-calibrated)"
        assert verified_artifact.call_args_list[0].args[1] == "link_volumes_calibrated"
        assert call["first_convergence_record"]["final_gap"] == 0.0003
        assert call["second_convergence_record"]["final_gap"] == 0.0005
        assert call["first_network_settings_digest"] == settings_digest
        assert call["second_network_settings_digest"] == settings_digest
        assert call["first_network_settings_payload_json"] == calibrated_record[
            "network_settings_payload_json"
        ]
        assert call["first_network_state_digest"] == calibrated_record[
            "network_state_digest"
        ]
        assert "retained_network.geojson" in call["loaded_links_geojson"]
        assert write_geometry.call_count == 1
        assert register.call_count == 3
        assert all(
            call.kwargs["network_settings_digest"] == settings_digest
            for call in register.call_args_list
        )
        assert all(
            call.kwargs["assignment_profile_digest"] == profile_digest
            for call in register.call_args_list
        )
        completion_patch = patch_stage.call_args_list[-1].args[1]
        assert settings_digest in completion_patch["log_tail"]
        assert profile_digest in completion_patch["log_tail"]


def test_uncalibrated_agreement_compares_both_canonical_baseline_digests():
    with tempfile.TemporaryDirectory() as tmp:
        work_root = Path(tmp)
        run_id = "11111111-1111-4111-8111-111111111111"
        run_dir = work_root / "runs" / run_id[:12]
        run_dir.mkdir(parents=True)
        profile = main.resolve_assignment_profile({})
        first_record = identity_record(0.0004, profile=profile)
        second_record = identity_record(0.0003, profile=profile)
        baseline_digest = first_record["network_settings_digest"]
        (run_dir / "state.json").write_text(
            json.dumps(
                {
                    "assignment": first_record,
                    "activitysim_assignment": second_record,
                }
            )
        )
        comparator_calls = []

        def comparator(**kwargs):
            comparator_calls.append(kwargs)
            output = Path(kwargs["output_dir"])
            output.mkdir(exist_ok=True)
            paths = {}
            for key, filename in (
                ("json_path", "agreement.json"),
                ("markdown_path", "agreement.md"),
                ("geojson_path", "agreement.geojson"),
            ):
                path = output / filename
                path.write_text("{}")
                paths[key] = str(path)
            return {
                **paths,
                "summary": {
                    "links_compared": 2,
                    "links_carrying_meaningful_traffic": 1,
                    "agree_share_meaningful_links": 1.0,
                    "diverge_share_meaningful_links": 0.0,
                },
            }

        completion = mock.Mock(status_code=200)
        completion.json.return_value = []
        fake_module = mock.Mock(compare_link_volume_runs=comparator)
        with (
            mock.patch.object(main, "RUN_WORK_ROOT", str(work_root)),
            mock.patch.object(main, "sb_claim_stage", return_value=True),
            mock.patch.object(main, "sb_patch_stage"),
            mock.patch.object(main, "sb_patch_run"),
            mock.patch.object(
                main,
                "sb_get_run_artifacts",
                return_value=[{"artifact_type": "activitysim_link_volumes"}],
            ),
            mock.patch.object(
                main,
                "verified_latest_local_artifact",
                side_effect=["/trip.csv", "/activitysim.csv"],
            ),
            mock.patch.object(main, "register_agreement_artifact"),
            mock.patch.object(
                main,
                "write_agreement_network_geojson",
                side_effect=lambda _work, path, **_kwargs: path,
            ),
            mock.patch.object(main.requests, "get", return_value=completion),
            mock.patch.dict("sys.modules", {"compare_behavioral_demand_outputs": fake_module}),
        ):
            assert main.process_stage(
                {
                    "id": "stage-6-baseline",
                    "run_id": run_id,
                    "stage_name": "Demand Model Agreement",
                }
            )

        call = comparator_calls[0]
        assert call["first_network_settings_digest"] == baseline_digest
        assert call["second_network_settings_digest"] == baseline_digest


def test_uncalibrated_agreement_refuses_a_missing_or_different_baseline_digest():
    profile = main.resolve_assignment_profile({})
    baseline_digest = main.network_settings_digest(main.assignment_network_settings())
    bad_digests = (
        ("first-missing", None, baseline_digest),
        ("first-different", "wrong-digest", baseline_digest),
        ("second-missing", baseline_digest, None),
        ("second-different", baseline_digest, "wrong-digest"),
    )
    for label, first_digest, second_digest in bad_digests:
        with tempfile.TemporaryDirectory() as tmp:
            work_root = Path(tmp)
            run_id = "11111111-1111-4111-8111-111111111111"
            run_dir = work_root / "runs" / run_id[:12]
            run_dir.mkdir(parents=True)
            first_record = identity_record(0.0004, profile=profile)
            second_record = identity_record(0.0003, profile=profile)
            first_record["network_settings_digest"] = first_digest
            second_record["network_settings_digest"] = second_digest
            (run_dir / "state.json").write_text(
                json.dumps(
                    {
                        "assignment": first_record,
                        "activitysim_assignment": second_record,
                    }
                )
            )
            failures = []
            completion = mock.Mock(status_code=200)
            completion.json.return_value = []
            with (
                mock.patch.object(main, "RUN_WORK_ROOT", str(work_root)),
                mock.patch.object(main, "sb_claim_stage", return_value=True),
                mock.patch.object(
                    main,
                    "sb_patch_stage",
                    side_effect=lambda _id, body: failures.append(body),
                ),
                mock.patch.object(main, "sb_patch_run"),
                mock.patch.object(
                    main,
                    "sb_get_run_artifacts",
                    return_value=[{"artifact_type": "activitysim_link_volumes"}],
                ),
                mock.patch.object(main, "verified_latest_local_artifact") as verified,
                mock.patch.object(main.requests, "get", return_value=completion),
            ):
                assert main.process_stage(
                    {
                        "id": f"stage-6-baseline-{label}",
                        "run_id": run_id,
                        "stage_name": "Demand Model Agreement",
                    }
                )

            assert verified.call_count == 0
            assert any(
                body.get("status") == "failed"
                and "profile, network settings, and solver-visible retained network"
                in body.get("error_message", "")
                for body in failures
            )


def test_agreement_refuses_mismatched_calibrated_network_settings():
    with tempfile.TemporaryDirectory() as tmp:
        work_root = Path(tmp)
        run_id = "11111111-1111-4111-8111-111111111111"
        run_dir = work_root / "runs" / run_id[:12]
        run_dir.mkdir(parents=True)
        profile = main.resolve_assignment_profile({})
        calibrated_record = identity_record(
            0.0003, profile=profile, factors={"primary": 1.1}
        )
        activitysim_record = identity_record(
            0.0005, profile=profile, factors={"primary": 1.1}
        )
        activitysim_record["network_settings_digest"] = "wrong-digest"
        (run_dir / "state.json").write_text(
            json.dumps(
                {
                    "assignment": {
                        **identity_record(0.0004, profile=profile),
                        "calibration": calibrated_record,
                    },
                    "activitysim_assignment": activitysim_record,
                }
            )
        )
        failure_patches = []
        completion = mock.Mock(status_code=200)
        completion.json.return_value = []
        with (
            mock.patch.object(main, "RUN_WORK_ROOT", str(work_root)),
            mock.patch.object(main, "sb_claim_stage", return_value=True),
            mock.patch.object(main, "sb_patch_stage", side_effect=lambda _id, body: failure_patches.append(body)),
            mock.patch.object(main, "sb_patch_run"),
            mock.patch.object(
                main,
                "sb_get_run_artifacts",
                return_value=[{"artifact_type": "activitysim_link_volumes"}],
            ),
            mock.patch.object(main, "verified_latest_local_artifact") as verified,
            mock.patch.object(main.requests, "get", return_value=completion),
        ):
            assert main.process_stage(
                {
                    "id": "stage-6",
                    "run_id": run_id,
                    "stage_name": "Demand Model Agreement",
                }
            )

        assert verified.call_count == 0
        assert any(
            patch.get("status") == "failed"
            and "profile, network settings, and solver-visible retained network"
            in patch.get("error_message", "")
            for patch in failure_patches
        )


def test_uncalibrated_agreement_refuses_missing_or_mismatched_assignment_profiles():
    base_profile = main.resolve_assignment_profile({})
    stricter_profile = main.resolve_assignment_profile(
        {
            "OPENPLAN_ASSIGNMENT_RGAP_TARGET": "0.0002",
            "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS": "5000",
        }
    )
    bad_second_records = {
        "missing": {"final_gap": 0.0002},
        "mismatched": convergence(0.0001, profile=stricter_profile),
    }
    for label, second_record in bad_second_records.items():
        with tempfile.TemporaryDirectory() as tmp:
            work_root = Path(tmp)
            run_id = "11111111-1111-4111-8111-111111111111"
            run_dir = work_root / "runs" / run_id[:12]
            run_dir.mkdir(parents=True)
            first_record = identity_record(0.0003, profile=base_profile)
            second_identity = identity_record(0.0002, profile=base_profile)
            second_identity["convergence"] = second_record
            (run_dir / "state.json").write_text(
                json.dumps(
                    {
                        "assignment": first_record,
                        "activitysim_assignment": second_identity,
                    }
                )
            )
            failure_patches = []
            completion = mock.Mock(status_code=200)
            completion.json.return_value = []
            with (
                mock.patch.object(main, "RUN_WORK_ROOT", str(work_root)),
                mock.patch.object(main, "sb_claim_stage", return_value=True),
                mock.patch.object(
                    main,
                    "sb_patch_stage",
                    side_effect=lambda _id, body: failure_patches.append(body),
                ),
                mock.patch.object(main, "sb_patch_run"),
                mock.patch.object(
                    main,
                    "sb_get_run_artifacts",
                    return_value=[{"artifact_type": "activitysim_link_volumes"}],
                ),
                mock.patch.object(main, "verified_latest_local_artifact") as verified,
                mock.patch.object(main.requests, "get", return_value=completion),
            ):
                assert main.process_stage(
                    {
                        "id": f"stage-6-{label}",
                        "run_id": run_id,
                        "stage_name": "Demand Model Agreement",
                    }
                )

            assert verified.call_count == 0
            assert any(
                patch.get("status") == "failed"
                and "without identical, verified assignment profile"
                in patch.get("error_message", "")
                for patch in failure_patches
            ), (label, failure_patches)


def test_artifact_registration_refuses_a_non_success_response():
    response = mock.Mock(status_code=400, text="invalid artifact")
    with mock.patch.object(main.requests, "post", return_value=response):
        try:
            main.sb_post_artifact({"artifact_type": "link_volumes"})
        except RuntimeError as error:
            assert "400" in str(error)
            assert "invalid artifact" in str(error)
        else:
            raise AssertionError("HTTP 400 was treated as a registered artifact")


def test_agreement_artifact_registration_carries_both_full_convergence_records():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "agreement.json"
        path.write_text("{}")
        first = identity_record(0.0004)
        second = identity_record(0.0003)
        response = mock.Mock(status_code=500, text="storage unavailable")
        with (
            mock.patch.object(main.requests, "post", return_value=response),
            mock.patch.object(main, "sb_post_artifact") as register,
        ):
            main.register_agreement_artifact(
                "run",
                "stage",
                "demand_model_agreement",
                str(path),
                "application/json",
                first_assignment_convergence=first["convergence"],
                second_assignment_convergence=second["convergence"],
                assignment_profile=first["convergence"]["assignment_profile"],
                assignment_profile_payload_json=first["convergence"][
                    "assignment_profile_payload_json"
                ],
                assignment_profile_digest=first["convergence"][
                    "assignment_profile_digest"
                ],
                network_settings=first["network_settings"],
                network_settings_payload_json=first["network_settings_payload_json"],
                network_settings_digest=first["network_settings_digest"],
                network_state_record=first["network_state_record"],
                network_state_digest=first["network_state_digest"],
            )
        row = register.call_args.args[0]
        metadata = row["metadata_json"]
        assert row["content_hash"] == hashlib.sha256(path.read_bytes()).hexdigest()
        assert len(row["content_hash"]) == 64
        assert metadata["first_assignment_convergence"] == first["convergence"]
        assert metadata["second_assignment_convergence"] == second["convergence"]
        assert metadata["assignment_profile_payload_json"] == first["convergence"][
            "assignment_profile_payload_json"
        ]
        assert metadata["network_settings_payload_json"] == first[
            "network_settings_payload_json"
        ]
        assert metadata["network_state_digest"] == first["network_state_digest"]
        assert metadata["upload_status"] == "local_fallback"


def test_latest_local_artifact_requires_full_hash_and_all_identity_metadata():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "link_volumes.csv"
        path.write_text("link_id,PCE_tot\n1,10\n")
        identity = identity_record(0.0004)
        metadata = main.assignment_artifact_metadata(identity, "link_volumes.csv")
        row = {
            "artifact_type": "link_volumes",
            "file_url": f"local://{path}",
            "content_hash": hashlib.sha256(path.read_bytes()).hexdigest(),
            "metadata_json": metadata,
        }
        kwargs = {
            "expected_assignment_profile": metadata["assignment_profile"],
            "expected_assignment_profile_payload_json": metadata[
                "assignment_profile_payload_json"
            ],
            "expected_assignment_profile_digest": metadata["assignment_profile_digest"],
            "expected_network_settings": metadata["network_settings"],
            "expected_network_settings_payload_json": metadata[
                "network_settings_payload_json"
            ],
            "expected_network_settings_digest": metadata["network_settings_digest"],
            "expected_network_state_record": metadata["network_state_record"],
            "expected_network_state_digest": metadata["network_state_digest"],
        }
        with mock.patch.object(main, "sb_get_run_artifacts", return_value=[row]):
            assert main.verified_latest_local_artifact(
                "run", "link_volumes", **kwargs
            ) == str(path)

        truncated = {**row, "content_hash": row["content_hash"][:16]}
        with mock.patch.object(main, "sb_get_run_artifacts", return_value=[truncated]):
            try:
                main.verified_latest_local_artifact("run", "link_volumes", **kwargs)
            except RuntimeError as error:
                assert "content-hash" in str(error)
            else:
                raise AssertionError("a truncated artifact hash was accepted")

        tampered_metadata = {
            **metadata,
            "network_state_digest": "0" * 64,
        }
        with mock.patch.object(
            main,
            "sb_get_run_artifacts",
            return_value=[{**row, "metadata_json": tampered_metadata}],
        ):
            try:
                main.verified_latest_local_artifact("run", "link_volumes", **kwargs)
            except main.AssignmentSettingsError:
                pass
            else:
                raise AssertionError("tampered assignment-state metadata was accepted")


def test_stage5_network_state_mismatch_is_guarded_before_execute():
    identity = identity_record(0.0004)
    state = identity["network_state_record"]
    digest = identity["network_state_digest"]
    changed, changed_digest = network_state(identity["network_settings_digest"], "changed")
    try:
        main.require_expected_network_state(
            changed,
            changed_digest,
            state,
            digest,
            identity["network_settings_digest"],
            "ActivitySim assignment",
        )
    except main.AssignmentSettingsError as error:
        assert "solver-visible retained network changed" in str(error)
    else:
        raise AssertionError("a changed Stage-5 retained network was accepted")

    source = inspect.getsource(main.stage_assignment)
    assert source.index("require_expected_network_state(") < source.index("assig.execute()")


def test_agreement_geometry_excludes_connectors_and_binds_exact_roadway_count():
    roadway_ids = [1, 3]
    manifest = {
        "schema_version": "openplan.retained-network-manifest.v1",
        "all_link_count": 3,
        "all_link_ids_digest": main._payload_digest([1, 2, 3]),
        "roadway_link_count": 2,
        "roadway_link_ids_digest": main._payload_digest(roadway_ids),
        "modeling_connector_link_count": 1,
        "modeling_connector_link_ids_digest": main._payload_digest([2]),
        "excluded_roles": ["modeling_connector"],
        "role_definition": {
            "roadway": "link_type != centroid_connector",
            "modeling_connector": "link_type = centroid_connector",
        },
    }
    settings, _, settings_digest = settings_identity()
    state, _ = network_state(settings_digest)
    state["retained_network_manifest"] = manifest
    state_digest = main.assignment_network_state_digest(state)

    class GeometryConnection:
        def __init__(self, rows=None):
            line = json.dumps({"type": "LineString", "coordinates": [[0, 0], [1, 1]]})
            self.rows = rows or [
                (1, "primary", "Road A", line),
                (2, "centroid_connector", "", line),
                (3, "secondary", "Road B", line),
            ]

        def enable_load_extension(self, _enabled):
            pass

        def load_extension(self, _path):
            pass

        def execute(self, _query):
            return types.SimpleNamespace(fetchall=lambda: self.rows)

        def close(self):
            pass

    with tempfile.TemporaryDirectory() as tmp:
        work_dir = Path(tmp)
        project_dir = work_dir / "aeq_project"
        project_dir.mkdir()
        (project_dir / "project_database.sqlite").touch()
        output = work_dir / "retained_network.geojson"
        with (
            mock.patch.object(main, "retained_network_manifest", return_value=manifest),
            mock.patch.object(main.sqlite3, "connect", return_value=GeometryConnection()),
        ):
            main.write_agreement_network_geojson(
                str(work_dir),
                str(output),
                network_state_record=state,
                network_state_digest=state_digest,
            )
        payload = json.loads(output.read_text())
        assert [feature["properties"]["link_id"] for feature in payload["features"]] == roadway_ids
        assert payload["metadata"]["source_feature_count"] == 2
        assert payload["metadata"]["retained_network_manifest"] == manifest
        assert payload["metadata"]["network_state_digest"] == state_digest

        line = json.dumps({"type": "LineString", "coordinates": [[0, 0], [1, 1]]})
        for label, rows in (
            (
                "duplicate",
                [(1, "primary", "Road A", line), (1, "secondary", "Road B", line)],
            ),
            (
                "noninteger",
                [("1", "primary", "Road A", line), (3, "secondary", "Road B", line)],
            ),
        ):
            with (
                mock.patch.object(main, "retained_network_manifest", return_value=manifest),
                mock.patch.object(
                    main.sqlite3, "connect", return_value=GeometryConnection(rows)
                ),
            ):
                try:
                    main.write_agreement_network_geojson(
                        str(work_dir),
                        str(output),
                        network_state_record=state,
                        network_state_digest=state_digest,
                    )
                except RuntimeError:
                    pass
                else:
                    raise AssertionError(f"{label} geometry IDs were accepted")


def test_network_factor_bools_and_local_engine_stamp_are_not_trusted():
    for factor in (True, False):
        try:
            main.assignment_network_settings({"primary": factor})
        except main.AssignmentSettingsError:
            pass
        else:
            raise AssertionError("boolean calibration factor was accepted")

    profile = main.resolve_assignment_profile({})
    persisted = {**profile, "engine_version": "persisted-version"}
    assert main.assignment_engine_stamp(persisted) == "AequilibraE persisted-version"
    artifact_source = inspect.getsource(main.stage_artifacts)
    assert "verified_engine_stamp" in artifact_source
    assert "ENGINE_STAMP" not in artifact_source
    assert "hexdigest()[:16]" not in artifact_source


def test_installed_aequilibrae_state_is_stable_and_solver_mutation_sensitive():
    if not hasattr(sys.modules.get("aequilibrae"), "Project"):
        return
    import numpy as np
    from aequilibrae import Project
    from aequilibrae.matrix import AequilibraeMatrix
    from aequilibrae.paths import TrafficAssignment, TrafficClass
    from shapely.geometry import LineString, Point

    with tempfile.TemporaryDirectory() as tmp:
        project_dir = Path(tmp) / "tiny_project"
        project = Project()
        project.new(str(project_dir))
        for node_id, x in ((1, 0.0), (2, 0.01)):
            node = project.network.nodes.new_centroid(node_id)
            node.geometry = Point(x, 0.0)
            node.save()
        link = project.network.links.new()
        # AequilibraE derives these from editing tools in normal imports; the
        # two-node test fixture sets the persisted endpoints directly.
        link.__dict__["a_node"] = 1
        link.__dict__["b_node"] = 2
        link.direction = 0
        link.modes = "c"
        link.distance = 1000.0
        link.speed_ab = 30.0
        link.speed_ba = 30.0
        link.travel_time_ab = 2.0
        link.travel_time_ba = 2.0
        link.capacity_ab = 1000.0
        link.capacity_ba = 1000.0
        link.geometry = LineString([(0.0, 0.0), (0.01, 0.0)])
        link.save()

        project.network.build_graphs(modes=["c"])
        graph = project.network.graphs["c"]
        centroids = np.array([1, 2])
        graph.set_graph("travel_time")
        graph.prepare_graph(centroids)
        graph.set_blocked_centroid_flows(True)
        matrix = AequilibraeMatrix()
        matrix.create_empty(zones=2, matrix_names=["resident"], memory_only=True)
        matrix.index = centroids
        matrix.computational_view(["resident"])
        traffic_class = TrafficClass("resident", graph, matrix)
        assignment = main.build_traffic_assignment(
            TrafficAssignment,
            [traffic_class],
            profile=main.resolve_assignment_profile({}),
        )
        _, settings_payload, settings_digest = settings_identity()
        assert settings_payload
        first, first_digest = main.assignment_network_state(
            assignment,
            graph,
            centroids,
            str(project_dir),
            network_settings_digest_value=settings_digest,
        )
        repeated, repeated_digest = main.assignment_network_state(
            assignment,
            graph,
            centroids,
            str(project_dir),
            network_settings_digest_value=settings_digest,
        )
        assert repeated == first
        assert repeated_digest == first_digest
        assert first["graph_row_count"] == 2
        assert first["retained_network_manifest"]["all_link_count"] == 1

        scripts_dir = Path(__file__).resolve().parents[2] / "scripts" / "modeling"
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        import screening_runtime

        cli_state, cli_digest = screening_runtime.assignment_network_state(
            assignment,
            graph,
            centroids,
            project_dir,
            network_settings_digest_value=settings_digest,
        )
        assert cli_state == first
        assert cli_digest == first_digest

        assignment.assignment.free_flow_tt[0] += 0.125
        changed, changed_digest = main.assignment_network_state(
            assignment,
            graph,
            centroids,
            str(project_dir),
            network_settings_digest_value=settings_digest,
        )
        assert changed_digest != first_digest
        assert changed["solver_free_flow_tt_digest"] != first[
            "solver_free_flow_tt_digest"
        ]
        project.close()


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
    print(f"{len(tests)} ActivitySim assignment handoff tests passed")
