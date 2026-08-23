#!/usr/bin/env python3
"""NodeODM output collection uses the supported archive and refuses JSON
errors masquerading as successful binary downloads.

Run: python3 workers/odm_worker/test_nodeodm_client.py
"""

import io
import os
import sys
import tempfile
import zipfile
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nodeodm_client import NodeODMClient, NodeODMError


class FakeResponse:
    def __init__(self, body, content_type, payload=None, status_code=200):
        self.body = body
        self.headers = {"content-type": content_type}
        self.payload = payload
        self.status_code = status_code

    def json(self):
        if self.payload is None:
            raise ValueError("not JSON")
        return self.payload

    def iter_content(self, chunk_size):
        for offset in range(0, len(self.body), chunk_size):
            yield self.body[offset : offset + chunk_size]


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.urls = []

    def get(self, url, **_kwargs):
        self.urls.append(url)
        return self.response


def archive_bytes():
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("odm_orthophoto/odm_orthophoto.tif", b"real-geotiff-bytes")
        archive.writestr(
            "odm_georeferencing/odm_georeferenced_model.laz", b"real-laz-bytes"
        )
        archive.writestr("../must-not-extract.txt", b"unsafe")
    return data.getvalue()


def check_http_200_json_error_is_not_an_artifact():
    response = FakeResponse(
        b'{"error":"Invalid asset"}',
        "application/json; charset=utf-8",
        payload={"error": "Invalid asset"},
    )
    client = NodeODMClient("http://nodeodm.invalid", session=FakeSession(response))
    with tempfile.TemporaryDirectory() as temp_dir:
        dest = os.path.join(temp_dir, "orthophoto.tif")
        try:
            client.download_asset("task", "orthophoto.tif", dest)
            raise AssertionError("HTTP 200 JSON error must not become a TIFF")
        except NodeODMError as exc:
            assert "Invalid asset" in str(exc), str(exc)
        assert not os.path.exists(dest), "refused response must not be written"
    print("  HTTP 200 JSON errors are refused before any artifact is written")


def check_archive_is_extracted_and_previewed():
    response = FakeResponse(archive_bytes(), "application/zip")
    session = FakeSession(response)
    client = NodeODMClient("http://nodeodm.invalid", session=session)

    def render_preview(args, **_kwargs):
        assert args[1:6] == ["-q", "-of", "PNG", "-outsize", "1600"]
        with open(args[-1], "wb") as preview:
            preview.write(b"\x89PNG\r\n\x1a\npreview")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    with tempfile.TemporaryDirectory() as temp_dir:
        with mock.patch("nodeodm_client.shutil.which", return_value="/usr/bin/gdal_translate"), mock.patch(
            "nodeodm_client.subprocess.run", side_effect=render_preview
        ):
            staged = client.download_outputs("task", temp_dir)

        assert session.urls == ["http://nodeodm.invalid/task/task/download/all.zip"]
        assert set(staged) == {
            "orthophoto.tif",
            "orthophoto.png",
            "georeferenced_model.laz",
        }
        assert open(staged["orthophoto.tif"], "rb").read() == b"real-geotiff-bytes"
        assert open(staged["orthophoto.png"], "rb").read().startswith(b"\x89PNG")
        assert not os.path.exists(os.path.join(temp_dir, "nodeodm-all.zip"))
        assert not os.path.exists(os.path.join(temp_dir, "must-not-extract.txt"))
    print("  all.zip yields only named outputs and a rendered PNG preview")


if __name__ == "__main__":
    print("nodeodm client checks:")
    check_http_200_json_error_is_not_an_artifact()
    check_archive_is_extracted_and_previewed()
    print("all nodeodm client checks passed")
