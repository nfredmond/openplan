"""Mirror registered local bytes without changing scientific handoff references."""
from pathlib import Path
import mimetypes
import re
import tempfile
from uuid import UUID

import model_handoff_files
from supabase_service_headers import service_key_headers


def configured_upload(object_path, data, content_type):
    """Verify the private mirror through the same installation's stored bytes."""
    import os
    import requests
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = service_key_headers(key)
    try:
        requests.post(base + "/storage/v1/object/run-artifacts/" + object_path,
                      headers={**headers, "Content-Type": content_type, "x-upsert": "false"},
                      data=data, timeout=60, allow_redirects=False)
    except requests.RequestException:
        pass
    retained = requests.get(base + "/storage/v1/object/authenticated/run-artifacts/" + object_path,
                            headers=headers, timeout=60, allow_redirects=False)
    try:
        if retained.status_code != 200 or retained.content != data:
            raise RuntimeError("Hosted artifact stored bytes unconfirmed")
    finally:
        retained.close()
    return "storage://run-artifacts/" + object_path


def mirror_registered(root, payload, upload):
    """Copy pinned same-run bytes, then require the immutable Storage receipt."""
    reference = payload.get("file_url", "")
    if not reference.startswith("local://"):
        return None
    run_id = payload["run_id"]
    stage_id = payload["stage_id"]
    if str(UUID(run_id)) != run_id or str(UUID(stage_id)) != stage_id:
        raise ValueError("Canonical mirror stage identity required")
    source = Path(reference.removeprefix("local://"))
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", source.name):
        raise ValueError("Canonical mirror filename required")
    # copy_registered validates the run, path, original byte size and digest.
    # Keep a private snapshot until the uploader verifies the stored bytes.
    with tempfile.TemporaryDirectory(prefix=".hosted-mirror-", dir=Path(root) / "runs" / run_id) as directory:
        retained = model_handoff_files.copy_registered(
            root, run_id, source, Path(directory) / source.name,
            sha256=payload["content_hash"], size_bytes=payload["file_size_bytes"],
        )
        data = Path(retained).read_bytes()
        object_path = f"model-runs/{run_id}/stages/{stage_id}/sha256-{payload['content_hash']}/{source.name}"
        content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        return upload(object_path, data, content_type)
