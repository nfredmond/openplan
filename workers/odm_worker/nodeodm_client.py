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
        written = 0
        with open(dest_path, "wb") as out:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                out.write(chunk)
                written += len(chunk)
        return written
