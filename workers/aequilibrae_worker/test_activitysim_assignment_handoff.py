#!/usr/bin/env python3
"""The behavioral assignment consumes one intact, hash-verified local package."""
import hashlib
import json
import os
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
                    "assignment": {"counts_path": "/counts/held-out.csv"},
                }
            )
        )
        calls = []

        def assignment(*args, **kwargs):
            calls.append((args, kwargs))
            output = run_dir / kwargs["output_dir_name"]
            output.mkdir()
            (output / "link_volumes.csv").write_text("link_id,PCE_tot\n1,10\n")
            return {"log": "assigned\n", "counts_path": kwargs["counts_path_override"]}

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
        payload = post_artifact.call_args.args[0]
        assert payload["artifact_type"] == "activitysim_link_volumes"
        assert payload["metadata_json"]["demand_is_vehicle"] is True


def test_agreement_stage_calls_the_existing_comparator_with_both_convergence_records():
    with tempfile.TemporaryDirectory() as tmp:
        work_root = Path(tmp)
        run_id = "11111111-1111-4111-8111-111111111111"
        run_dir = work_root / "runs" / run_id[:12]
        (run_dir / "run_output").mkdir(parents=True)
        (run_dir / "state.json").write_text(
            json.dumps(
                {
                    "assignment": {"convergence": {"final_gap": 0.0004}},
                    "activitysim_assignment": {"convergence": {"final_gap": 0.0005}},
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
                side_effect=["/trip-based.csv", "/activity-based.csv"],
            ),
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
        assert call["first_convergence_record"]["final_gap"] == 0.0004
        assert call["second_convergence_record"]["final_gap"] == 0.0005
        assert "retained_network.geojson" in call["loaded_links_geojson"]
        assert write_geometry.call_count == 1
        assert register.call_count == 3


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
    print(f"{len(tests)} ActivitySim assignment handoff tests passed")
