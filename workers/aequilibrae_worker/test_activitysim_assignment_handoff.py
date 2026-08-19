#!/usr/bin/env python3
"""The behavioral assignment consumes one intact, hash-verified local package."""
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import types
from pathlib import Path
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")


try:
    import aequilibrae  # noqa: F401
except ImportError:
    # CI deliberately runs the lightweight worker environment. Nothing in this
    # seam test executes the engine, but main imports its OSM builder at module
    # load time, so provide only that import boundary rather than skipping the
    # production orchestration the test exists to exercise.
    class OSMBuilder:
        pass

    osm_builder = types.ModuleType("aequilibrae.project.network.osm.osm_builder")
    osm_builder.OSMBuilder = OSMBuilder
    for module_name in (
        "aequilibrae",
        "aequilibrae.project",
        "aequilibrae.project.network",
        "aequilibrae.project.network.osm",
    ):
        sys.modules.setdefault(module_name, types.ModuleType(module_name))
    sys.modules["aequilibrae.project.network.osm.osm_builder"] = osm_builder

import main


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
            {
                "schema_version": "openplan.network-calibration.v1",
                "road_class_factors": {"motorway": 1.25},
                "excludes": ["trip_based_od_adjustments"],
            },
        )
        assert changed == 2
        assert graph.graph["travel_time"].tolist() == [8.0, 20.0, 24.0]
        assert graph.graph["capacity"].tolist() == [125.0, 200.0, 375.0]
        assert graph.cost_field == "travel_time"


def test_network_settings_digest_is_canonical_and_sensitive_to_factors():
    first = {
        "schema_version": "openplan.network-calibration.v1",
        "road_class_factors": {"primary": 1.1, "motorway": 0.95},
    }
    reordered = {
        "road_class_factors": {"motorway": 0.95, "primary": 1.1},
        "schema_version": "openplan.network-calibration.v1",
    }
    changed = {
        **first,
        "road_class_factors": {"primary": 1.2, "motorway": 0.95},
    }
    assert main.network_settings_digest(first) == main.network_settings_digest(reordered)
    assert main.network_settings_digest(first) != main.network_settings_digest(changed)


def test_accepted_settings_artifact_metadata_carries_exact_identity_and_exclusion():
    settings = {
        "schema_version": "openplan.network-calibration.v1",
        "road_class_factors": {"primary": 1.1},
        "excludes": ["trip_based_od_adjustments"],
    }
    digest = main.network_settings_digest(settings)
    metadata = main.accepted_network_settings_metadata(
        {
            "calibration": {
                "network_settings": settings,
                "network_settings_digest": digest,
            }
        },
        "accepted_network_calibration.json",
    )
    assert metadata == {
        "filename": "accepted_network_calibration.json",
        "kind": "accepted_assignment_network_settings",
        "schema_version": "openplan.network-calibration.v1",
        "network_settings_digest": digest,
        "excludes": ["trip_based_od_adjustments"],
    }


def test_assignment_handoff_refuses_a_different_applied_settings_digest():
    try:
        main.require_network_settings_digest(
            "accepted-digest", "different-digest", "ActivitySim assignment handoff"
        )
    except RuntimeError as exc:
        assert "ActivitySim assignment handoff" in str(exc)
        assert "do not match" in str(exc)
    else:
        raise AssertionError("different assignment settings were accepted")


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
        (run_dir / "state.json").write_text(
            json.dumps(
                {
                    "setup": {"centroid_map": {"1": 1001}},
                    "assignment": {
                        "counts_path": "/counts/held-out.csv",
                        "calibration": {
                            "network_settings": {
                                "schema_version": "openplan.network-calibration.v1",
                                "road_class_factors": {"primary": 1.1256789},
                                "excludes": ["trip_based_od_adjustments"],
                            }
                        },
                    },
                }
            )
        )
        accepted_settings = json.loads((run_dir / "state.json").read_text())["assignment"][
            "calibration"
        ]["network_settings"]
        accepted_digest = main.network_settings_digest(accepted_settings)
        calls = []

        def assignment(*args, **kwargs):
            calls.append((args, kwargs))
            output = run_dir / kwargs["output_dir_name"]
            output.mkdir()
            (output / "link_volumes.csv").write_text("link_id,PCE_tot\n1,10\n")
            return {
                "log": "assigned\n",
                "counts_path": kwargs["counts_path_override"],
                "network_settings_digest": main.network_settings_digest(
                    kwargs["persisted_network_settings"]
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
        payload = post_artifact.call_args.args[0]
        assert payload["artifact_type"] == "activitysim_link_volumes"
        assert payload["metadata_json"]["demand_is_vehicle"] is True
        assert payload["metadata_json"]["network_calibration"] == (
            "accepted_trip_based_network_settings"
        )
        assert payload["metadata_json"]["trip_based_od_adjustments_reused"] is False
        assert payload["metadata_json"]["network_settings_digest"] == accepted_digest


def test_agreement_stage_calls_the_existing_comparator_with_both_convergence_records():
    with tempfile.TemporaryDirectory() as tmp:
        work_root = Path(tmp)
        run_id = "11111111-1111-4111-8111-111111111111"
        run_dir = work_root / "runs" / run_id[:12]
        (run_dir / "run_output").mkdir(parents=True)
        settings = {
            "schema_version": "openplan.network-calibration.v1",
            "road_class_factors": {"primary": 1.1},
        }
        settings_digest = main.network_settings_digest(settings)
        (run_dir / "state.json").write_text(
            json.dumps(
                {
                    "assignment": {
                        "convergence": {"final_gap": 0.0004},
                        "calibration": {
                            "convergence": {"final_gap": 0.0003},
                            "network_settings": settings,
                            "network_settings_digest": settings_digest,
                        },
                    },
                    "activitysim_assignment": {
                        "convergence": {"final_gap": 0.0005},
                        "network_settings_digest": settings_digest,
                    },
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
                side_effect=lambda _work, path: path,
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
        assert "retained_network.geojson" in call["loaded_links_geojson"]
        assert write_geometry.call_count == 1
        assert register.call_count == 3
        assert all(
            call.kwargs["network_settings_digest"] == settings_digest
            for call in register.call_args_list
        )
        completion_patch = patch_stage.call_args_list[-1].args[1]
        assert settings_digest in completion_patch["log_tail"]


def test_agreement_refuses_mismatched_calibrated_network_settings():
    with tempfile.TemporaryDirectory() as tmp:
        work_root = Path(tmp)
        run_id = "11111111-1111-4111-8111-111111111111"
        run_dir = work_root / "runs" / run_id[:12]
        run_dir.mkdir(parents=True)
        settings = {
            "schema_version": "openplan.network-calibration.v1",
            "road_class_factors": {"primary": 1.1},
        }
        (run_dir / "state.json").write_text(
            json.dumps(
                {
                    "assignment": {
                        "calibration": {
                            "network_settings": settings,
                            "network_settings_digest": main.network_settings_digest(settings),
                        }
                    },
                    "activitysim_assignment": {"network_settings_digest": "wrong-digest"},
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
            and "do not share the accepted network-settings digest"
            in patch.get("error_message", "")
            for patch in failure_patches
        )


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
    print(f"{len(tests)} ActivitySim assignment handoff tests passed")
