"""The worker's half of the aerial processing contract.

Validates incoming ProcessingRequests and builds outgoing ProcessingCallbacks
against schemas/aerial_processing_contract.schema.json (committed at the repo
root, and identically to the external platform's repository). The JSON schema
is the source of truth; the constants here are a hand mirror, and
test_contract.py cross-checks every enum below against the schema file so the
two cannot drift silently.

Hand-rolled stdlib validation on purpose: a jsonschema dependency would buy
draft-2020 semantics this contract does not need, and the worker's posture
(mirroring workers/aequilibrae_worker) is stdlib wherever imports do not force
otherwise.

THE VERSIONING RULE IS LOAD-BEARING. A zip_url request MUST declare v1 (the
external worker validates v1 strictly and receives byte-identical payloads);
a photo_manifest request MUST declare v1.1. This validator enforces the
pairing, and callbacks echo the version the request declared.
"""

import datetime
import re
import uuid

SCHEMA_VERSION_V1 = "natford-aerial-processing.v1"
SCHEMA_VERSION_V1_1 = "natford-aerial-processing.v1.1"
SCHEMA_VERSIONS = (SCHEMA_VERSION_V1, SCHEMA_VERSION_V1_1)

IMAGERY_TYPES = ("zip_url", "photo_manifest")
PRESET_IDS = ("fast-preview", "balanced", "high-quality")
CALLBACK_STATUSES = ("accepted", "running", "succeeded", "failed", "canceled")
ARTIFACT_KINDS = ("orthomosaic", "dsm", "dtm", "point_cloud", "mesh", "ortho_preview")

MAX_MANIFEST_PHOTOS = 10000
_SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")


def _is_http_url(value):
    return isinstance(value, str) and (
        value.startswith("https://") or value.startswith("http://")
    )


def _check_unknown_keys(payload, allowed, where, errors):
    for key in payload:
        if key not in allowed:
            errors.append(f"{where}: unknown property '{key}'")


def _validate_zip_imagery(imagery, errors):
    _check_unknown_keys(imagery, {"type", "url", "imageCount", "sizeBytes"}, "imagery", errors)
    if not _is_http_url(imagery.get("url")):
        errors.append("imagery.url: required, and must be an http(s) URL")
    image_count = imagery.get("imageCount")
    if image_count is not None and (not isinstance(image_count, int) or image_count < 1):
        errors.append("imagery.imageCount: must be an integer >= 1")
    size = imagery.get("sizeBytes")
    if size is not None and (not isinstance(size, int) or size < 1):
        errors.append("imagery.sizeBytes: must be an integer >= 1")


def _validate_manifest_imagery(imagery, errors):
    _check_unknown_keys(
        imagery, {"type", "photos", "imageCount", "totalSizeBytes"}, "imagery", errors
    )
    photos = imagery.get("photos")
    if not isinstance(photos, list) or not photos:
        errors.append("imagery.photos: required, a non-empty array")
        return
    if len(photos) > MAX_MANIFEST_PHOTOS:
        errors.append(f"imagery.photos: at most {MAX_MANIFEST_PHOTOS} photos")
    for index, photo in enumerate(photos):
        where = f"imagery.photos[{index}]"
        if not isinstance(photo, dict):
            errors.append(f"{where}: must be an object")
            continue
        _check_unknown_keys(
            photo, {"url", "filename", "sizeBytes", "checksumSha256"}, where, errors
        )
        if not _is_http_url(photo.get("url")):
            errors.append(f"{where}.url: required, and must be an http(s) URL")
        filename = photo.get("filename")
        if not isinstance(filename, str) or not (1 <= len(filename) <= 512):
            errors.append(f"{where}.filename: required, 1..512 characters")
        size = photo.get("sizeBytes")
        if size is not None and (not isinstance(size, int) or size < 0):
            errors.append(f"{where}.sizeBytes: must be an integer >= 0")
        checksum = photo.get("checksumSha256")
        if checksum is not None and (
            not isinstance(checksum, str) or not _SHA256_HEX.match(checksum)
        ):
            errors.append(f"{where}.checksumSha256: must be 64 lowercase hex characters")
    image_count = imagery.get("imageCount")
    if not isinstance(image_count, int) or image_count < 1:
        errors.append("imagery.imageCount: required, an integer >= 1")
    elif image_count != len(photos):
        errors.append(
            f"imagery.imageCount ({image_count}) must equal photos.length ({len(photos)})"
        )
    total = imagery.get("totalSizeBytes")
    if total is not None and (not isinstance(total, int) or total < 0):
        errors.append("imagery.totalSizeBytes: must be an integer >= 0")


def validate_processing_request(payload):
    """Return a list of human-readable contract violations; empty means valid."""
    errors = []
    if not isinstance(payload, dict):
        return ["the request body must be a JSON object"]

    allowed = {
        "schemaVersion",
        "requestId",
        "callbackUrl",
        "externalRef",
        "missionTitle",
        "imagery",
        "presetId",
        "notes",
    }
    _check_unknown_keys(payload, allowed, "request", errors)

    version = payload.get("schemaVersion")
    if version not in SCHEMA_VERSIONS:
        errors.append(
            f"schemaVersion: must be one of {list(SCHEMA_VERSIONS)}, got {version!r}"
        )

    request_id = payload.get("requestId")
    if not isinstance(request_id, str) or not (8 <= len(request_id) <= 128):
        errors.append("requestId: required, 8..128 characters")

    if not _is_http_url(payload.get("callbackUrl")):
        errors.append("callbackUrl: required, and must be an http(s) URL")

    ref = payload.get("externalRef")
    if not isinstance(ref, dict):
        errors.append("externalRef: required, an object")
    else:
        _check_unknown_keys(
            ref, {"system", "missionId", "workspaceId", "projectId"}, "externalRef", errors
        )
        for key in ("system", "missionId", "workspaceId"):
            if not isinstance(ref.get(key), str) or not ref.get(key):
                errors.append(f"externalRef.{key}: required, a non-empty string")

    title = payload.get("missionTitle")
    if not isinstance(title, str) or not (1 <= len(title) <= 256):
        errors.append("missionTitle: required, 1..256 characters")

    imagery = payload.get("imagery")
    if not isinstance(imagery, dict):
        errors.append("imagery: required, an object")
    else:
        imagery_type = imagery.get("type")
        if imagery_type == "zip_url":
            _validate_zip_imagery(imagery, errors)
            if version == SCHEMA_VERSION_V1_1:
                errors.append(
                    "schemaVersion: a zip_url request must declare "
                    f"{SCHEMA_VERSION_V1} (the contract's versioning rule)"
                )
        elif imagery_type == "photo_manifest":
            _validate_manifest_imagery(imagery, errors)
            if version == SCHEMA_VERSION_V1:
                errors.append(
                    "schemaVersion: a photo_manifest request must declare "
                    f"{SCHEMA_VERSION_V1_1} (the contract's versioning rule)"
                )
        else:
            errors.append(
                f"imagery.type: must be one of {list(IMAGERY_TYPES)}, got {imagery_type!r}"
            )

    preset = payload.get("presetId")
    if preset is not None and preset not in PRESET_IDS:
        errors.append(f"presetId: must be one of {list(PRESET_IDS)}, got {preset!r}")

    notes = payload.get("notes")
    if notes is not None and (not isinstance(notes, str) or len(notes) > 2048):
        errors.append("notes: must be a string of at most 2048 characters")

    return errors


def utc_now_iso():
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def new_callback_id():
    return f"odm-{uuid.uuid4().hex}"


def build_callback(
    schema_version,
    request_id,
    job_reference,
    status,
    progress=None,
    message=None,
    artifacts=None,
    benchmark_summary=None,
):
    """Assemble a ProcessingCallback. The schema_version is ECHOED from the
    request that started the job — callbacks are valid under either version,
    and echoing means a v1 (zip) job never carries a v1.1 marker."""
    if schema_version not in SCHEMA_VERSIONS:
        raise ValueError(f"unknown schema version: {schema_version!r}")
    if status not in CALLBACK_STATUSES:
        raise ValueError(f"unknown callback status: {status!r}")
    callback = {
        "schemaVersion": schema_version,
        "requestId": request_id,
        "callbackId": new_callback_id(),
        "jobReference": job_reference,
        "status": status,
        "occurredAt": utc_now_iso(),
    }
    if progress is not None:
        callback["progress"] = max(0, min(100, progress))
    if message:
        callback["message"] = str(message)[:2048]
    if artifacts is not None:
        callback["artifacts"] = artifacts
    if benchmark_summary is not None:
        callback["benchmarkSummary"] = benchmark_summary
    return callback


def build_artifact(
    kind,
    download_url,
    expires_at,
    size_bytes=None,
    content_type=None,
    bounds_wgs84=None,
    crs=None,
    pixel_size_m=None,
):
    if kind not in ARTIFACT_KINDS:
        raise ValueError(f"unknown artifact kind: {kind!r}")
    artifact = {"kind": kind, "downloadUrl": download_url, "expiresAt": expires_at}
    if size_bytes is not None:
        artifact["sizeBytes"] = int(size_bytes)
    if content_type:
        artifact["contentType"] = content_type
    # The georeferencing trio travels together or not at all: bounds without a
    # recorded native CRS would be a fact with no provenance.
    if bounds_wgs84 is not None:
        west, south, east, north = bounds_wgs84
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError(f"boundsWgs84 out of range or inverted: {bounds_wgs84!r}")
        artifact["boundsWgs84"] = [west, south, east, north]
        if crs:
            artifact["crs"] = str(crs)[:64]
        if pixel_size_m is not None and pixel_size_m > 0:
            artifact["pixelSizeM"] = pixel_size_m
    return artifact
