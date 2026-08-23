"""A thin client for NodeODM's REST API — plain `requests`, no pyodm.

The whole surface this worker needs is five endpoints:
  GET  /info                      — is NodeODM there, and which engine/version
  POST /task/new/init             — returns {"uuid": ...}
  POST /task/new/upload/<uuid>    — one image per call (multipart field "images")
  POST /task/new/commit/<uuid>    — starts processing
  GET  /task/<uuid>/info          — status + progress
  GET  /task/<uuid>/download/<asset> — one output file

pyodm would wrap exactly these and bring its own retry opinions; a 100-line
client we can read end to end is the better trade for a worker whose failure
messages must name what actually happened.

NodeODM status codes (task info "status": {"code": N}):
  10 QUEUED, 20 RUNNING, 30 FAILED, 40 COMPLETED, 50 CANCELED.
"""

import json
import os
import shutil
import subprocess
import zipfile

import requests

STATUS_QUEUED = 10
STATUS_RUNNING = 20
STATUS_FAILED = 30
STATUS_COMPLETED = 40
STATUS_CANCELED = 50

TERMINAL_STATUSES = {STATUS_FAILED, STATUS_COMPLETED, STATUS_CANCELED}


class NodeODMError(Exception):
    """NodeODM refused or failed; the message is safe for a callback."""


class NodeODMClient:
    def __init__(self, base_url, token=None, timeout=60, session=None):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.session = session or requests.Session()

    def _params(self):
        return {"token": self.token} if self.token else {}

    def _raise_for(self, response, doing):
        if response.status_code >= 400:
            raise NodeODMError(f"NodeODM {doing} answered HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise NodeODMError(f"NodeODM {doing} answered non-JSON") from exc
        if isinstance(payload, dict) and payload.get("error"):
            raise NodeODMError(f"NodeODM {doing} answered: {payload['error']}")
        return payload

    def info(self):
        response = self.session.get(
            f"{self.base_url}/info", params=self._params(), timeout=self.timeout
        )
        return self._raise_for(response, "info")

    def create_task(self, name, options):
        """options: list of {"name": ..., "value": ...} dicts."""
        response = self.session.post(
            f"{self.base_url}/task/new/init",
            data={"name": name, "options": json.dumps(options)},
            params=self._params(),
            timeout=self.timeout,
        )
        payload = self._raise_for(response, "task init")
        uuid = payload.get("uuid")
        if not uuid:
            raise NodeODMError("NodeODM task init returned no uuid")
        return uuid

    def upload_image(self, uuid, image_path):
        with open(image_path, "rb") as handle:
            response = self.session.post(
                f"{self.base_url}/task/new/upload/{uuid}",
                files={"images": (os.path.basename(image_path), handle)},
                params=self._params(),
                timeout=self.timeout,
            )
        self._raise_for(response, f"upload of {os.path.basename(image_path)}")

    def commit_task(self, uuid):
        response = self.session.post(
            f"{self.base_url}/task/new/commit/{uuid}",
            params=self._params(),
            timeout=self.timeout,
        )
        self._raise_for(response, "task commit")

    def task_info(self, uuid):
        response = self.session.get(
            f"{self.base_url}/task/{uuid}/info",
            params=self._params(),
            timeout=self.timeout,
        )
        return self._raise_for(response, "task info")

    def download_asset(self, uuid, asset, dest_path):
        """Download one output. Returns bytes written, or None when NodeODM has
        no such asset (404) — absence is an answer, not an error, because which
        assets exist depends on the preset."""
        response = self.session.get(
            f"{self.base_url}/task/{uuid}/download/{asset}",
            params=self._params(),
            timeout=self.timeout,
            stream=True,
        )
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise NodeODMError(
                f"NodeODM download of {asset} answered HTTP {response.status_code}"
            )
        content_type = (response.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            try:
                payload = response.json()
            except ValueError as exc:
                raise NodeODMError(
                    f"NodeODM download of {asset} answered invalid JSON"
                ) from exc
            if isinstance(payload, dict) and payload.get("error"):
                raise NodeODMError(
                    f"NodeODM download of {asset} answered: {payload['error']}"
                )
        written = 0
        with open(dest_path, "wb") as out:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                out.write(chunk)
                written += len(chunk)
        return written

    def download_outputs(self, uuid, dest_dir):
        """Fetch NodeODM's supported ``all.zip`` export once, then stage the
        exact outputs OpenPlan understands.

        NodeODM 2.2 answers unknown named downloads with HTTP 200 plus
        ``{"error":"Invalid asset"}``. Treating those 25 bytes as GeoTIFFs was
        the defect this path replaces. The preview is rendered from the real
        orthomosaic because NodeODM's archive does not contain a downloadable
        preview PNG.
        """
        os.makedirs(dest_dir, exist_ok=True)
        archive_path = os.path.join(dest_dir, "nodeodm-all.zip")
        written = self.download_asset(uuid, "all.zip", archive_path)
        if not written:
            raise NodeODMError("NodeODM completed but its all.zip export is missing")

        members = {
            "orthophoto.tif": "odm_orthophoto/odm_orthophoto.tif",
            "dsm.tif": "odm_dem/dsm.tif",
            "dtm.tif": "odm_dem/dtm.tif",
            "georeferenced_model.laz": "odm_georeferencing/odm_georeferenced_model.laz",
        }
        staged = {}
        try:
            with zipfile.ZipFile(archive_path) as archive:
                names = set(archive.namelist())
                for asset, member in members.items():
                    if member not in names:
                        continue
                    dest_path = os.path.join(dest_dir, asset)
                    with archive.open(member) as source, open(dest_path, "wb") as dest:
                        shutil.copyfileobj(source, dest, length=1024 * 1024)
                    staged[asset] = dest_path
        except (OSError, zipfile.BadZipFile) as exc:
            raise NodeODMError(f"NodeODM all.zip could not be read: {exc}") from exc
        finally:
            try:
                os.unlink(archive_path)
            except FileNotFoundError:
                pass

        ortho_path = staged.get("orthophoto.tif")
        if not ortho_path:
            return staged
        gdal_translate = shutil.which("gdal_translate")
        if not gdal_translate:
            raise NodeODMError(
                "gdal_translate is required to render the orthophoto preview"
            )
        preview_path = os.path.join(dest_dir, "orthophoto.png")
        completed = subprocess.run(
            [
                gdal_translate,
                "-q",
                "-of",
                "PNG",
                "-outsize",
                "1600",
                "0",
                ortho_path,
                preview_path,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "no detail").strip()
            raise NodeODMError(f"orthophoto preview rendering failed: {detail}"[:2048])
        try:
            with open(preview_path, "rb") as preview:
                signature = preview.read(8)
        except OSError as exc:
            raise NodeODMError(f"orthophoto preview was not created: {exc}") from exc
        if signature != b"\x89PNG\r\n\x1a\n":
            raise NodeODMError("orthophoto preview is not a PNG")
        staged["orthophoto.png"] = preview_path
        return staged
