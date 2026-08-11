#!/usr/bin/env python3
"""The worker's contract mirror cannot drift from the schema file, and the
validator enforces the rules that keep both workers compatible.

The JSON schema (schemas/aerial_processing_contract.schema.json, repo root) is
the single source of truth and is committed identically to the external
platform's repository. This suite cross-checks EVERY enum the worker mirrors
against that file, then exercises the validator on the payload shapes that
matter: the external-worker-shaped v1 request (byte compatibility), the v1.1
manifest, and the version↔imagery pairing rule in both directions.

Run: python3 workers/odm_worker/test_contract.py   (stdlib only)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import contract

SCHEMA_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "schemas",
    "aerial_processing_contract.schema.json",
)


def _valid_zip_request():
    return {
        "schemaVersion": "natford-aerial-processing.v1",
        "requestId": "11111111-1111-4111-8111-111111111111",
        "callbackUrl": "https://openplan.example.com/api/aerial/processing-callback",
        "externalRef": {
            "system": "openplan",
            "missionId": "22222222-2222-4222-8222-222222222222",
            "workspaceId": "33333333-3333-4333-8333-333333333333",
            "projectId": "44444444-4444-4444-8444-444444444444",
        },
        "missionTitle": "Hwy 49 corridor survey",
        "imagery": {
            "type": "zip_url",
            "url": "https://storage.example.com/imagery.zip?signature=abc",
            "imageCount": 240,
            "sizeBytes": 536870912,
        },
        "presetId": "balanced",
        "notes": "Rush processing for the corridor study.",
    }


def _valid_manifest_request():
    return {
        "schemaVersion": "natford-aerial-processing.v1.1",
        "requestId": "11111111-1111-4111-8111-111111111111",
        "callbackUrl": "https://openplan.example.com/api/aerial/processing-callback",
        "externalRef": {
            "system": "openplan",
            "missionId": "22222222-2222-4222-8222-222222222222",
            "workspaceId": "33333333-3333-4333-8333-333333333333",
        },
        "missionTitle": "Hwy 49 corridor survey",
        "imagery": {
            "type": "photo_manifest",
            "photos": [
                {
                    "url": "https://storage.example.com/p/DJI_0001.JPG?sig=a",
                    "filename": "DJI_0001.JPG",
                    "sizeBytes": 8400000,
                    "checksumSha256": "a" * 64,
                },
                {"url": "https://storage.example.com/p/DJI_0002.JPG?sig=b", "filename": "DJI_0002.JPG"},
            ],
            "imageCount": 2,
            "totalSizeBytes": 16800000,
        },
        "presetId": "balanced",
    }


def check_enums_match_schema_file():
    if not os.path.exists(SCHEMA_PATH):
        # Inside the built container only the worker's own files exist; the
        # schema lives at the repo root. The cross-check is a repo-level drift
        # guard, so the repo checkout is where it must run — and this skip is
        # NAMED so an in-container run cannot be mistaken for having done it.
        print(
            "  SKIPPED (schema file not present — running outside the repo "
            "checkout): enum cross-check against "
            "schemas/aerial_processing_contract.schema.json"
        )
        return
    with open(SCHEMA_PATH, encoding="utf-8") as handle:
        schema = json.load(handle)
    defs = schema["$defs"]

    request_versions = defs["ProcessingRequest"]["properties"]["schemaVersion"]["enum"]
    assert sorted(request_versions) == sorted(contract.SCHEMA_VERSIONS), (
        "request schemaVersion enum drifted from contract.SCHEMA_VERSIONS"
    )
    callback_versions = defs["ProcessingCallback"]["properties"]["schemaVersion"]["enum"]
    assert sorted(callback_versions) == sorted(contract.SCHEMA_VERSIONS), (
        "callback schemaVersion enum drifted"
    )

    presets = defs["ProcessingRequest"]["properties"]["presetId"]["enum"]
    assert sorted(presets) == sorted(contract.PRESET_IDS), "presetId enum drifted"

    statuses = defs["ProcessingCallback"]["properties"]["status"]["enum"]
    assert sorted(statuses) == sorted(contract.CALLBACK_STATUSES), "status enum drifted"

    kinds = defs["ProcessingCallback"]["properties"]["artifacts"]["items"]["properties"][
        "kind"
    ]["enum"]
    assert sorted(kinds) == sorted(contract.ARTIFACT_KINDS), "artifact kind enum drifted"

    imagery_types = sorted(
        (defs["ZipImagery"]["properties"]["type"]["const"],
         defs["PhotoManifestImagery"]["properties"]["type"]["const"])
    )
    assert imagery_types == sorted(contract.IMAGERY_TYPES), "imagery type consts drifted"

    max_photos = defs["PhotoManifestImagery"]["properties"]["photos"]["maxItems"]
    assert max_photos == contract.MAX_MANIFEST_PHOTOS, "manifest photo cap drifted"
    print("  enums match the schema file")


def check_external_worker_shaped_v1_still_validates():
    assert contract.validate_processing_request(_valid_zip_request()) == [], (
        "the external-worker-shaped v1 payload must keep validating unchanged"
    )
    print("  external-worker-shaped v1 request validates")


def check_manifest_v1_1_validates():
    assert contract.validate_processing_request(_valid_manifest_request()) == []
    print("  v1.1 photo_manifest request validates")


def check_version_pairing_rule_both_directions():
    zip_wrong = _valid_zip_request()
    zip_wrong["schemaVersion"] = "natford-aerial-processing.v1.1"
    errors = contract.validate_processing_request(zip_wrong)
    assert any("versioning rule" in e for e in errors), (
        f"zip_url under v1.1 must be refused, got: {errors}"
    )

    manifest_wrong = _valid_manifest_request()
    manifest_wrong["schemaVersion"] = "natford-aerial-processing.v1"
    errors = contract.validate_processing_request(manifest_wrong)
    assert any("versioning rule" in e for e in errors), (
        f"photo_manifest under v1 must be refused, got: {errors}"
    )
    print("  version-imagery pairing enforced both directions")


def check_strictness():
    unknown = _valid_zip_request()
    unknown["surprise"] = True
    assert contract.validate_processing_request(unknown), "unknown key must be refused"

    mismatch = _valid_manifest_request()
    mismatch["imagery"]["imageCount"] = 3
    errors = contract.validate_processing_request(mismatch)
    assert any("must equal photos.length" in e for e in errors), errors

    bad_checksum = _valid_manifest_request()
    bad_checksum["imagery"]["photos"][0]["checksumSha256"] = "A" * 64
    errors = contract.validate_processing_request(bad_checksum)
    assert any("checksumSha256" in e for e in errors), errors

    short_id = _valid_zip_request()
    short_id["requestId"] = "short"
    assert contract.validate_processing_request(short_id), "short requestId must be refused"

    bad_preset = _valid_zip_request()
    bad_preset["presetId"] = "ultra"
    assert contract.validate_processing_request(bad_preset), "unknown preset must be refused"
    print("  strictness: unknown keys, count mismatch, checksum case, id length, preset")


def check_callback_builder():
    accepted = contract.build_callback(
        "natford-aerial-processing.v1.1", "req-00000001", "job-1", "accepted"
    )
    assert accepted["schemaVersion"] == "natford-aerial-processing.v1.1", (
        "the callback must ECHO the request's version"
    )
    assert len(accepted["callbackId"]) >= 8
    assert accepted["occurredAt"].endswith("Z")

    try:
        contract.build_callback("some-other.v9", "req-00000001", "job-1", "accepted")
        raise AssertionError("an unknown schema version must be refused")
    except ValueError:
        pass

    artifact = contract.build_artifact(
        "ortho_preview",
        "https://worker.example.com/artifacts/j/t/orthophoto.png",
        "2026-08-12T00:00:00Z",
        size_bytes=1234,
        content_type="image/png",
        bounds_wgs84=(-121.07, 39.2, -121.05, 39.22),
        crs="EPSG:32610",
        pixel_size_m=0.05,
    )
    assert artifact["boundsWgs84"] == [-121.07, 39.2, -121.05, 39.22]
    assert artifact["crs"] == "EPSG:32610"

    try:
        contract.build_artifact(
            "orthomosaic", "https://x", "2026-08-12T00:00:00Z",
            bounds_wgs84=(-121.05, 39.2, -121.07, 39.22),
        )
        raise AssertionError("inverted bounds must be refused")
    except ValueError:
        pass

    try:
        contract.build_artifact("contour_lines", "https://x", "2026-08-12T00:00:00Z")
        raise AssertionError("an unknown artifact kind must be refused")
    except ValueError:
        pass
    print("  callback/artifact builders: echo, ranges, kind vocabulary")


def main():
    print("contract checks:")
    check_enums_match_schema_file()
    check_external_worker_shaped_v1_still_validates()
    check_manifest_v1_1_validates()
    check_version_pairing_rule_both_directions()
    check_strictness()
    check_callback_builder()
    print("all contract checks passed")


if __name__ == "__main__":
    main()
