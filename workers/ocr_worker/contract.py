"""The worker's half of the OCR extraction contract.

Validates incoming OcrRequests and builds outgoing OcrCallbacks against
schemas/ocr_extraction_contract.schema.json (committed at the repo root). The
JSON schema is the source of truth; the constants here are a hand mirror, and
test_contract.py cross-checks every enum below against the schema file so the
two cannot drift silently.

Hand-rolled stdlib validation on purpose, mirroring workers/odm_worker: a
jsonschema dependency would buy draft-2020 semantics this contract does not
need, and the worker's posture is stdlib wherever imports do not force
otherwise.

THE PAGE INVARIANT IS LOAD-BEARING. `build_callback` refuses to assemble a
succeeded payload whose pages are not exactly 1..N ascending with no gaps and
no duplicates, and whose declared pageCount disagrees with the list. Everything
downstream — the chunk a planner reads, the citation under a figure in an
adopted plan — hangs off the page number being the page the text was on. A
worker that silently dropped one blank page would renumber every page after it,
and nothing further down the chain could ever notice.
"""

import datetime
import re
import uuid

SCHEMA_VERSION_V1 = "openplan-ocr-extraction.v1"
SCHEMA_VERSIONS = (SCHEMA_VERSION_V1,)

CALLBACK_STATUSES = ("accepted", "running", "succeeded", "failed", "canceled")

MAX_PAGES = 5000
MAX_PAGE_CHARS = 200000
MAX_LANGUAGES = 8

_SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")
_LANGUAGE_CODE = re.compile(r"^[A-Za-z_]{2,32}$")


def _is_http_url(value):
    return isinstance(value, str) and (
        value.startswith("https://") or value.startswith("http://")
    )


def _check_unknown_keys(payload, allowed, where, errors):
    for key in payload:
        if key not in allowed:
            errors.append(f"{where}: unknown property '{key}'")


def _validate_source(source, errors):
    _check_unknown_keys(
        source, {"url", "filename", "sizeBytes", "checksumSha256"}, "source", errors
    )
    if not _is_http_url(source.get("url")):
        errors.append("source.url: required, and must be an http(s) URL")
    filename = source.get("filename")
    if filename is not None and (not isinstance(filename, str) or not (1 <= len(filename) <= 512)):
        errors.append("source.filename: must be 1..512 characters")
    size = source.get("sizeBytes")
    if size is not None and (not isinstance(size, int) or size < 1):
        errors.append("source.sizeBytes: must be an integer >= 1")
    checksum = source.get("checksumSha256")
    if checksum is not None and (
        not isinstance(checksum, str) or not _SHA256_HEX.match(checksum)
    ):
        errors.append("source.checksumSha256: must be 64 lowercase hex characters")


def validate_ocr_request(payload):
    """Return a list of human-readable contract violations; empty means valid."""
    errors = []
    if not isinstance(payload, dict):
        return ["the request body must be a JSON object"]

    allowed = {
        "schemaVersion",
        "requestId",
        "callbackUrl",
        "externalRef",
        "documentTitle",
        "source",
        "languages",
        "maxPages",
        "maxCallbackBytes",
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
            ref, {"system", "documentId", "workspaceId", "projectId"}, "externalRef", errors
        )
        for key in ("system", "documentId", "workspaceId"):
            if not isinstance(ref.get(key), str) or not ref.get(key):
                errors.append(f"externalRef.{key}: required, a non-empty string")

    title = payload.get("documentTitle")
    if not isinstance(title, str) or not (1 <= len(title) <= 256):
        errors.append("documentTitle: required, 1..256 characters")

    source = payload.get("source")
    if not isinstance(source, dict):
        errors.append("source: required, an object")
    else:
        _validate_source(source, errors)

    languages = payload.get("languages")
    if languages is not None:
        if not isinstance(languages, list) or not (1 <= len(languages) <= MAX_LANGUAGES):
            errors.append(f"languages: must be an array of 1..{MAX_LANGUAGES} language codes")
        else:
            for index, code in enumerate(languages):
                if not isinstance(code, str) or not _LANGUAGE_CODE.match(code):
                    errors.append(
                        f"languages[{index}]: must be a 2..32 character tesseract "
                        f"language code, got {code!r}"
                    )

    max_pages = payload.get("maxPages")
    if max_pages is not None and (not isinstance(max_pages, int) or max_pages < 1):
        errors.append("maxPages: must be an integer >= 1")

    max_callback_bytes = payload.get("maxCallbackBytes")
    if max_callback_bytes is not None and (
        not isinstance(max_callback_bytes, int) or max_callback_bytes < 1024
    ):
        errors.append("maxCallbackBytes: must be an integer >= 1024")

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
    return f"ocr-{uuid.uuid4().hex}"


class PageSequenceError(ValueError):
    """The page list is not 1..N ascending — the one thing that must never ship."""


def validate_page_sequence(pages, page_count):
    """Raise PageSequenceError unless `pages` is exactly pages 1..page_count,
    ascending, no gaps, no duplicates, every text within the contract cap.

    This is the invariant the entire feature rests on, so it is checked where
    the payload is BUILT rather than trusted from the pipeline that produced it.
    """
    if not isinstance(pages, list):
        raise PageSequenceError("pages must be a list")
    if len(pages) != page_count:
        raise PageSequenceError(
            f"pageCount is {page_count} but {len(pages)} pages were assembled — "
            "refusing to deliver pages whose numbers may have shifted"
        )
    if page_count > MAX_PAGES:
        raise PageSequenceError(
            f"{page_count} pages exceeds the contract maximum of {MAX_PAGES}"
        )
    for index, page in enumerate(pages):
        expected = index + 1
        if not isinstance(page, dict):
            raise PageSequenceError(f"pages[{index}] is not an object")
        if set(page) != {"page", "text"}:
            raise PageSequenceError(
                f"pages[{index}] must carry exactly 'page' and 'text', got {sorted(page)}"
            )
        if page.get("page") != expected:
            raise PageSequenceError(
                f"pages[{index}] is numbered {page.get('page')!r} where page "
                f"{expected} was expected — a gap or a duplicate renumbers every "
                "page after it, and no reader downstream could ever notice"
            )
        text = page.get("text")
        if not isinstance(text, str):
            raise PageSequenceError(f"pages[{index}].text must be a string")
        if len(text) > MAX_PAGE_CHARS:
            raise PageSequenceError(
                f"pages[{index}].text is {len(text)} characters, over the contract "
                f"cap of {MAX_PAGE_CHARS}"
            )


def build_callback(
    request_id,
    job_reference,
    status,
    progress=None,
    message=None,
    pages=None,
    page_count=None,
    engine=None,
):
    """Assemble an OcrCallback. A succeeded callback MUST carry pages, and its
    page list is validated here — the last place before the wire."""
    if status not in CALLBACK_STATUSES:
        raise ValueError(f"unknown callback status: {status!r}")

    callback = {
        "schemaVersion": SCHEMA_VERSION_V1,
        "requestId": request_id,
        "callbackId": new_callback_id(),
        "jobReference": job_reference,
        "status": status,
        "occurredAt": utc_now_iso(),
    }

    if status == "succeeded":
        if pages is None or page_count is None:
            raise ValueError(
                "a succeeded OCR callback must carry pages and pageCount — a "
                "success with no pages is a failure that did not say so"
            )
        validate_page_sequence(pages, page_count)
        callback["pages"] = pages
        callback["pageCount"] = page_count
    else:
        if pages is not None:
            raise ValueError(f"a {status} callback must not carry pages")
        if page_count is not None:
            callback["pageCount"] = page_count

    if progress is not None:
        callback["progress"] = max(0, min(100, int(progress)))
    if message:
        callback["message"] = str(message)[:2048]
    if engine is not None:
        callback["engine"] = engine

    return callback


def build_engine(name, version=None, languages=None, pages_with_text=None):
    """The engine block. `pagesWithText` is a COUNT and deliberately not a
    score: this worker never reports a confidence, certainty or likelihood for
    what it read. A number the machine invents about its own accuracy would be
    read as a quality signal by every human who saw it, and there is nothing
    behind it."""
    engine = {"name": str(name)[:64]}
    if version:
        engine["version"] = str(version)[:64]
    if languages:
        engine["languages"] = [str(code)[:32] for code in languages][:MAX_LANGUAGES]
    if pages_with_text is not None:
        engine["pagesWithText"] = max(0, int(pages_with_text))
    return engine
