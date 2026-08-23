#!/usr/bin/env python3
"""The pipeline delivers what NodeODM produced — with the orthomosaic's OWN
georeferencing on the callback — and fails with a sentence that names the
stage, never a silent stall.

What is pinned:
  * a completed task yields a succeeded callback whose artifacts carry the
    kinds NodeODM actually produced (orthomosaic + ortho_preview + dsm here),
    and NOT the ones it did not (dtm, point_cloud absent => absent);
  * the orthomosaic and the preview both carry boundsWgs84/crs/pixelSizeM read
    from the GeoTIFF's own tags — the preview is the same pixel grid;
  * an orthomosaic whose tags cannot be read still succeeds, but WITHOUT the
    georef fields and with a message saying georeferencing was not read —
    absent-is-refusal is the consumer's cue, never guessed numbers;
  * a missing required orthomosaic output fails naming the asset;
  * an intake failure (checksum mismatch et al.) reaches the callback trail as
    a failed status with the intake's own sentence.

Run: python3 workers/odm_worker/test_pipeline.py
  (stdlib + the same pyproj condition as test_georef for the georef fields —
  the suite says so when pyproj is absent)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import main
import intake
from test_georef import build_geotiff

try:
    import pyproj  # noqa: F401

    HAVE_PYPROJ = True
except ImportError:
    HAVE_PYPROJ = False


class FakeClient:
    """Answers the five NodeODM calls from canned data; writes canned assets."""

    def __init__(self, assets, infos=None):
        self.assets = assets  # asset name -> bytes, or absent for 404
        self.infos = infos or [
            {"status": {"code": 20}, "progress": 50},
            {"status": {"code": 40}, "progress": 100},
        ]
        self.uploaded = []

    def create_task(self, name, options):
        self.options = options
        return "task-uuid-1"

    def upload_image(self, uuid, path):
        self.uploaded.append(os.path.basename(path))

    def commit_task(self, uuid):
        pass

    def task_info(self, uuid):
        info = self.infos[0]
        if len(self.infos) > 1:
            self.infos.pop(0)
        return info

    def download_asset(self, uuid, asset, dest):
        if asset not in self.assets:
            return None
        with open(dest, "wb") as handle:
            handle.write(self.assets[asset])
        return len(self.assets[asset])


def make_job(request_id="req-pipe-0001"):
    return {
        "request": {
            "schemaVersion": "natford-aerial-processing.v1.1",
            "requestId": request_id,
            "callbackUrl": "https://openplan.example.com/cb",
            "externalRef": {"system": "openplan", "missionId": "m", "workspaceId": "w"},
            "missionTitle": "Corridor survey",
            "imagery": {
                "type": "photo_manifest",
                "photos": [{"url": "https://x/p.jpg", "filename": "p.jpg"}],
                "imageCount": 1,
            },
            "presetId": "balanced",
        },
        "job_reference": f"jobref-{request_id}",
        "state": "accepted",
    }


def fake_prepare(images=("a.jpg", "b.jpg")):
    def prepare(imagery, work_dir):
        images_dir = os.path.join(work_dir, "images")
        os.makedirs(images_dir, exist_ok=True)
        for name in images:
            with open(os.path.join(images_dir, name), "wb") as handle:
                handle.write(b"\xff\xd8jpeg\xff\xd9")
        return images_dir

    return prepare


def run(job, client, prepare=None):
    sent = []

    def send(job_arg, status, progress=None, message=None, artifacts=None, benchmark=None):
        sent.append({"status": status, "message": message, "artifacts": artifacts,
                     "benchmark": benchmark})
        return True

    main.process_job(
        job,
        make_client=lambda: client,
        prepare=prepare or fake_prepare(),
        send=send,
        sleep=lambda _s: None,
    )
    return sent


def check_success_with_georef():
    client = FakeClient({
        "orthophoto.tif": build_geotiff(),
        "orthophoto.png": b"png-bytes",
        "dsm.tif": b"dsm-bytes",
    })
    job = make_job("req-ok-000001")
    sent = run(job, client)

    assert job["state"] == "succeeded"
    final = sent[-1]
    assert final["status"] == "succeeded"
    kinds = sorted(a["kind"] for a in final["artifacts"])
    assert kinds == ["dsm", "ortho_preview", "orthomosaic"], (
        f"only what NodeODM produced may be claimed: {kinds}"
    )
    assert client.uploaded == ["a.jpg", "b.jpg"], "every image must reach NodeODM"
    assert {"name": "orthophoto-png", "value": True} in client.options, (
        "the preview PNG must always be requested from ODM"
    )
    by_kind = {a["kind"]: a for a in final["artifacts"]}
    for artifact in final["artifacts"]:
        assert artifact["downloadUrl"].startswith(main.CONFIG["public_url"] + "/artifacts/")

    if HAVE_PYPROJ:
        for kind in ("orthomosaic", "ortho_preview"):
            artifact = by_kind[kind]
            assert artifact["crs"] == "EPSG:32610", (kind, artifact)
            west, south, east, north = artifact["boundsWgs84"]
            assert -123.1 < west < -122.9 and 39.5 < south < 40.0
            assert artifact["pixelSizeM"] == 0.05
        assert "boundsWgs84" not in by_kind["dsm"], (
            "only the ortho pair was parsed; the DSM must not borrow its bounds"
        )
        assert final["message"] is None, "a clean georef read needs no caveat"
        print("  success: produced kinds only; ortho pair carries the file's own georef")
    else:
        assert "boundsWgs84" not in by_kind["orthomosaic"]
        assert "georeferencing was not read" in (final["message"] or "")
        print("  success (pyproj absent): georef fields absent and the message says so")


def check_unreadable_georef_still_succeeds_with_the_caveat():
    client = FakeClient({
        "orthophoto.tif": b"not a tiff at all",
        "orthophoto.png": b"png-bytes",
    })
    job = make_job("req-nogeo-0001")
    sent = run(job, client)
    final = sent[-1]
    assert job["state"] == "succeeded"
    assert final["status"] == "succeeded"
    for artifact in final["artifacts"]:
        assert "boundsWgs84" not in artifact, "unreadable tags must yield NO bounds"
        assert "crs" not in artifact
    assert "georeferencing was not read" in (final["message"] or ""), final["message"]
    print("  unreadable GeoTIFF: succeeded, no georef fields, the caveat is stated")


def check_missing_orthomosaic_fails_by_name():
    client = FakeClient({"orthophoto.png": b"png-bytes"})
    job = make_job("req-noortho-01")
    sent = run(job, client)
    final = sent[-1]
    assert job["state"] == "failed"
    assert final["status"] == "failed"
    assert "orthophoto.tif" in final["message"], final["message"]
    print("  a missing orthomosaic output fails naming the asset")


def check_odm_failure_carries_odms_own_detail():
    client = FakeClient(
        {},
        infos=[{"status": {"code": 30, "errorMessage": "Not enough overlap"}, "progress": 40}],
    )
    job = make_job("req-odmfail-01")
    sent = run(job, client)
    final = sent[-1]
    assert job["state"] == "failed"
    assert "Not enough overlap" in final["message"], final["message"]
    print("  a NodeODM failure forwards NodeODM's own error message")


def check_intake_failure_reaches_the_callback_trail():
    def failing_prepare(imagery, work_dir):
        raise intake.IntakeError(
            "photo 'DJI_0001.JPG' failed its SHA-256 check"
        )

    job = make_job("req-intake-01")
    sent = run(job, FakeClient({}), prepare=failing_prepare)
    final = sent[-1]
    assert job["state"] == "failed"
    assert final["status"] == "failed"
    assert "Imagery intake failed" in final["message"]
    assert "DJI_0001.JPG" in final["message"]
    print("  an intake failure reaches the callback trail with its own sentence")


def check_expired_outputs_are_actually_deleted():
    """
    THE SWEEP THE COMMENT PROMISED FOR MONTHS.

    The pipeline's `finally` block removed source images and left the outputs
    "until expiry sweep"; no sweep existed. The /artifacts handler answered 410
    past expiry and left the files on disk, telling the caller "the worker does
    not keep outputs forever" — false, in the direction that fills the disk
    NodeODM reconstructs on. Each job leaves an orthomosaic, a DSM, a DTM and a
    point cloud behind: hundreds of megabytes to gigabytes, per job, forever.
    """
    root = main.CONFIG["work_dir"]

    def stage(reference, expires_at):
        job_dir = os.path.join(root, reference)
        outputs = os.path.join(job_dir, "outputs")
        os.makedirs(outputs, exist_ok=True)
        path = os.path.join(outputs, "odm_orthophoto.tif")
        with open(path, "wb") as handle:
            handle.write(b"\x00" * 1024)
        main.ARTIFACTS[reference] = {
            "token": "t-" + reference,
            "expires_at": expires_at,
            "files": {"odm_orthophoto.tif": path},
        }
        return job_dir

    now = 1_000_000.0
    stale = stage("job-stale", now - 1)
    fresh = stage("job-fresh", now + 3600)
    exactly_now = stage("job-boundary", now)

    removed = main.sweep_expired_artifacts(now=now, work_dir=root)

    assert sorted(removed) == ["job-boundary", "job-stale"], f"swept the wrong set: {removed}"
    assert not os.path.exists(stale), "an expired job's outputs are still on disk"
    assert not os.path.exists(exactly_now), "a job expiring exactly now was kept"
    assert os.path.exists(fresh), "a live job's outputs were deleted"

    # And it forgets them, so a later sweep is not re-deleting nothing forever
    # and a stale token cannot resolve.
    assert "job-stale" not in main.ARTIFACTS, "the registry still holds a swept job"
    assert "job-fresh" in main.ARTIFACTS, "the registry dropped a live job"

    # A second sweep is a no-op rather than an error.
    assert main.sweep_expired_artifacts(now=now, work_dir=root) == []

    # A job reference arriving from a request body is not a path: a traversal
    # attempt must not delete anything outside the work root.
    # ONE level up, into the same tmp parent as the work root. The first
    # version of this used "../../", which resolved to a path that does not
    # exist — so the canary survived whether or not the guard was there, and
    # removing the guard left the test green. The mutation said so.
    outside = tempfile.mkdtemp(prefix="odm_outside_", dir=os.path.dirname(os.path.realpath(root)))
    canary = os.path.join(outside, "keep-me")
    with open(canary, "wb") as handle:
        handle.write(b"canary")
    traversal = os.path.join("..", os.path.basename(outside))
    assert os.path.realpath(os.path.join(root, traversal)) == os.path.realpath(outside), (
        "fixture: the traversal must actually resolve outside the work root"
    )
    main.ARTIFACTS[traversal] = {
        "token": "t",
        "expires_at": now - 1,
        "files": {},
    }
    main.sweep_expired_artifacts(now=now, work_dir=root)
    assert os.path.exists(canary), "the sweep followed a traversal out of the work root"

    main.ARTIFACTS.clear()
    print("  expired job outputs are deleted; live ones and anything outside the root are not")


def main_check():
    print("pipeline checks:")
    main.CONFIG["work_dir"] = tempfile.mkdtemp(prefix="odm_pipeline_test_")
    main.CONFIG["poll_interval_seconds"] = 0
    check_success_with_georef()
    check_unreadable_georef_still_succeeds_with_the_caveat()
    check_missing_orthomosaic_fails_by_name()
    check_odm_failure_carries_odms_own_detail()
    check_intake_failure_reaches_the_callback_trail()
    check_expired_outputs_are_actually_deleted()
    print("all pipeline checks passed")


if __name__ == "__main__":
    main_check()
