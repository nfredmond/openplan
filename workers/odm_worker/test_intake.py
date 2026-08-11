#!/usr/bin/env python3
"""Intake either downloads exactly what the manifest describes, or fails
naming the file — and a ZIP cannot write outside its own directory.

The photos are source evidence: a silently truncated or corrupted download
would flow into an orthomosaic nobody could distrust, so a declared size or
SHA-256 that does not match the received bytes must FAIL the job with the
filename in the message. And a hostile ZIP entry (../evil) must be skipped,
not extracted over the worker's own files.

Run: python3 workers/odm_worker/test_intake.py   (stdlib only — the suite
serves its fixtures from a local http.server socket)
"""
import hashlib
import io
import os
import shutil
import sys
import tempfile
import threading
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import intake

JPEG_A = b"\xff\xd8\xff\xe0" + b"A" * 100 + b"\xff\xd9"
JPEG_B = b"\xff\xd8\xff\xe0" + b"B" * 200 + b"\xff\xd9"


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve_directory(directory):
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(_QuietHandler, directory=directory)
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def check_manifest_happy_path(base_url, work_root):
    work = os.path.join(work_root, "manifest-ok")
    imagery = {
        "type": "photo_manifest",
        "photos": [
            {
                "url": f"{base_url}/DJI_0001.JPG",
                "filename": "DJI_0001.JPG",
                "sizeBytes": len(JPEG_A),
                "checksumSha256": hashlib.sha256(JPEG_A).hexdigest(),
            },
            {"url": f"{base_url}/DJI_0002.JPG", "filename": "DJI_0002.JPG"},
        ],
        "imageCount": 2,
    }
    images_dir = intake.prepare_imagery(imagery, work)
    images = intake.collect_images(images_dir)
    assert len(images) == 2, f"expected 2 images, got {images}"
    with open(images[0], "rb") as handle:
        assert handle.read() == JPEG_A, "downloaded bytes differ from served bytes"
    print("  manifest happy path: 2 photos downloaded, checksum verified")


def check_manifest_checksum_mismatch(base_url, work_root):
    work = os.path.join(work_root, "manifest-checksum")
    imagery = {
        "type": "photo_manifest",
        "photos": [
            {
                "url": f"{base_url}/DJI_0001.JPG",
                "filename": "DJI_0001.JPG",
                "checksumSha256": "0" * 64,
            }
        ],
        "imageCount": 1,
    }
    try:
        intake.prepare_imagery(imagery, work)
        raise AssertionError("a checksum mismatch must fail the intake")
    except intake.IntakeError as exc:
        assert "DJI_0001.JPG" in str(exc), f"the failure must NAME the file: {exc}"
        assert "SHA-256" in str(exc)
    print("  checksum mismatch fails naming the file")


def check_manifest_size_mismatch(base_url, work_root):
    work = os.path.join(work_root, "manifest-size")
    imagery = {
        "type": "photo_manifest",
        "photos": [
            {
                "url": f"{base_url}/DJI_0001.JPG",
                "filename": "DJI_0001.JPG",
                "sizeBytes": len(JPEG_A) + 5,
            }
        ],
        "imageCount": 1,
    }
    try:
        intake.prepare_imagery(imagery, work)
        raise AssertionError("a size mismatch must fail the intake")
    except intake.IntakeError as exc:
        assert "DJI_0001.JPG" in str(exc) and "declared" in str(exc), str(exc)
    print("  size mismatch fails naming the file and both numbers")


def check_zip_happy_path_and_slip(base_url, serve_dir, work_root):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("photos/DJI_0001.JPG", JPEG_A)
        archive.writestr("photos/DJI_0002.jpg", JPEG_B)
        archive.writestr("readme.txt", b"not an image")
        # The hostile entry: would land OUTSIDE the extraction dir if honored.
        archive.writestr("../evil.jpg", b"\xff\xd8escape\xff\xd9")
    with open(os.path.join(serve_dir, "mission.zip"), "wb") as handle:
        handle.write(buffer.getvalue())

    work = os.path.join(work_root, "zip-ok")
    imagery = {"type": "zip_url", "url": f"{base_url}/mission.zip"}
    images_dir = intake.prepare_imagery(imagery, work)
    images = intake.collect_images(images_dir)
    names = sorted(os.path.basename(p) for p in images)
    assert names == ["DJI_0001.JPG", "DJI_0002.jpg"], names
    assert not os.path.exists(os.path.join(work, "evil.jpg")), (
        "the zip-slip entry escaped the images directory"
    )
    assert not os.path.exists(
        os.path.join(os.path.dirname(work), "evil.jpg")
    ), "the zip-slip entry escaped the work directory"
    print("  zip extract: 2 images collected, non-image ignored, slip entry refused")


def check_zip_with_no_images(base_url, serve_dir, work_root):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("logs/flight.txt", b"telemetry only")
    with open(os.path.join(serve_dir, "empty.zip"), "wb") as handle:
        handle.write(buffer.getvalue())

    try:
        intake.prepare_imagery(
            {"type": "zip_url", "url": f"{base_url}/empty.zip"},
            os.path.join(work_root, "zip-empty"),
        )
        raise AssertionError("a ZIP with no images must fail the intake")
    except intake.IntakeError as exc:
        assert "no image files" in str(exc), str(exc)
    print("  a ZIP with no images is refused with the reason")


def check_manifest_filenames_are_data():
    assert intake.sanitize_filename("../../etc/passwd", 3) == "00003_passwd"
    assert intake.sanitize_filename("photo one?.jpg", 0) == "00000_photo_one_.jpg"
    assert intake.sanitize_filename("", 7).startswith("00007_photo_")
    print("  manifest filenames are treated as data, never as paths")


def main():
    print("intake checks:")
    serve_dir = tempfile.mkdtemp(prefix="odm_intake_serve_")
    work_root = tempfile.mkdtemp(prefix="odm_intake_work_")
    with open(os.path.join(serve_dir, "DJI_0001.JPG"), "wb") as handle:
        handle.write(JPEG_A)
    with open(os.path.join(serve_dir, "DJI_0002.JPG"), "wb") as handle:
        handle.write(JPEG_B)
    server, base_url = serve_directory(serve_dir)
    try:
        check_manifest_happy_path(base_url, work_root)
        check_manifest_checksum_mismatch(base_url, work_root)
        check_manifest_size_mismatch(base_url, work_root)
        check_zip_happy_path_and_slip(base_url, serve_dir, work_root)
        check_zip_with_no_images(base_url, serve_dir, work_root)
        check_manifest_filenames_are_data()
    finally:
        server.shutdown()
        shutil.rmtree(serve_dir, ignore_errors=True)
        shutil.rmtree(work_root, ignore_errors=True)
    print("all intake checks passed")


if __name__ == "__main__":
    main()
