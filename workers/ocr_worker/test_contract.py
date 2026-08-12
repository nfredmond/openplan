#!/usr/bin/env python3
"""The worker's contract mirror cannot drift from the schema file, and the
page invariant cannot be bypassed.

The JSON schema (schemas/ocr_extraction_contract.schema.json, repo root) is the
single source of truth. This suite cross-checks EVERY enum and cap the worker
mirrors against that file, then exercises the validator and — the part that
matters most — every way a page list could be wrong.

Run: python3 workers/ocr_worker/test_contract.py   (stdlib only)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import contract

SCHEMA_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "schemas",
    "ocr_extraction_contract.schema.json",
)


def _valid_request():
    return {
        "schemaVersion": "openplan-ocr-extraction.v1",
        "requestId": "11111111-1111-4111-8111-111111111111",
        "callbackUrl": "https://openplan.example.com/api/knowledge-base/ocr-callback",
        "externalRef": {
            "system": "openplan",
            "documentId": "22222222-2222-4222-8222-222222222222",
            "workspaceId": "33333333-3333-4333-8333-333333333333",
            "projectId": "44444444-4444-4444-8444-444444444444",
        },
        "documentTitle": "2022 Regional Transportation Plan (adopted)",
        "source": {
            "url": "https://storage.example.com/kb/plan.pdf?signature=abc",
            "filename": "2022-rtp-adopted.pdf",
            "sizeBytes": 48210444,
            "checksumSha256": "a" * 64,
        },
        "languages": ["eng", "spa"],
        "maxPages": 500,
        "maxCallbackBytes": 4194304,
        "notes": "Scanned; no text layer.",
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
            "schemas/ocr_extraction_contract.schema.json"
        )
        return
    with open(SCHEMA_PATH, encoding="utf-8") as handle:
        schema = json.load(handle)
    defs = schema["$defs"]

    request_versions = defs["OcrRequest"]["properties"]["schemaVersion"]["enum"]
    assert sorted(request_versions) == sorted(contract.SCHEMA_VERSIONS), (
        "request schemaVersion enum drifted from contract.SCHEMA_VERSIONS"
    )
    callback_versions = defs["OcrCallback"]["properties"]["schemaVersion"]["enum"]
    assert sorted(callback_versions) == sorted(contract.SCHEMA_VERSIONS), (
        "callback schemaVersion enum drifted"
    )

    statuses = defs["OcrCallback"]["properties"]["status"]["enum"]
    assert sorted(statuses) == sorted(contract.CALLBACK_STATUSES), "status enum drifted"

    max_pages = defs["OcrCallback"]["properties"]["pages"]["maxItems"]
    assert max_pages == contract.MAX_PAGES, "page cap drifted"

    max_page_chars = defs["OcrPage"]["properties"]["text"]["maxLength"]
    assert max_page_chars == contract.MAX_PAGE_CHARS, "per-page character cap drifted"

    max_languages = defs["OcrRequest"]["properties"]["languages"]["maxItems"]
    assert max_languages == contract.MAX_LANGUAGES, "language cap drifted"

    # The invariant must be written down in the schema too, not only enforced
    # in Python: a second implementation of this contract reads the schema.
    succeeded_rule = defs["OcrCallback"]["allOf"][0]["then"]["required"]
    assert sorted(succeeded_rule) == ["pageCount", "pages"], (
        "the schema no longer REQUIRES pages+pageCount on a succeeded callback"
    )
    print("  enums, caps and the succeeded-requires-pages rule match the schema file")


def check_no_confidence_vocabulary_anywhere():
    """The one word that must never enter this contract.

    A confidence, certainty or likelihood figure is the machine grading its own
    transcription. Every human who saw it would read it as a quality signal,
    and there is nothing behind it. This check reads the schema file and this
    worker's own modules, because the cheapest moment to refuse the field is
    before anyone has a reason to want it.
    """
    banned = ("confidence", "certainty", "likelihood", "probability")
    here = os.path.dirname(os.path.abspath(__file__))
    targets = [os.path.join(here, name) for name in ("contract.py", "ocr.py", "main.py")]
    if os.path.exists(SCHEMA_PATH):
        targets.append(SCHEMA_PATH)

    for path in targets:
        with open(path, encoding="utf-8") as handle:
            text = handle.read().lower()
        for word in banned:
            # The prose that FORBIDS the word names it. Only a JSON key or a
            # Python assignment would be the real thing, so look for the shapes
            # a field takes rather than the bare word.
            for shape in (f'"{word}"', f"{word}=", f"{word}:", f"'{word}'"):
                assert shape not in text, (
                    f"{os.path.basename(path)} carries a {word} FIELD ({shape!r}). "
                    "This contract does not report how sure the machine is."
                )
    print("  no confidence/certainty/likelihood field in the schema or the worker")


def check_valid_request_validates():
    assert contract.validate_ocr_request(_valid_request()) == [], (
        contract.validate_ocr_request(_valid_request())
    )
    minimal = {
        "schemaVersion": "openplan-ocr-extraction.v1",
        "requestId": "abcdefgh",
        "callbackUrl": "http://localhost:3000/api/knowledge-base/ocr-callback",
        "externalRef": {"system": "openplan", "documentId": "d", "workspaceId": "w"},
        "documentTitle": "A plan",
        "source": {"url": "http://localhost:54321/object/sign/kb/x.pdf"},
    }
    assert contract.validate_ocr_request(minimal) == [], contract.validate_ocr_request(minimal)
    print("  the full and the minimal request both validate")


def check_strictness():
    unknown = _valid_request()
    unknown["surprise"] = True
    assert any("unknown property" in e for e in contract.validate_ocr_request(unknown))

    short_id = _valid_request()
    short_id["requestId"] = "short"
    assert contract.validate_ocr_request(short_id), "short requestId must be refused"

    bad_checksum = _valid_request()
    bad_checksum["source"]["checksumSha256"] = "A" * 64
    errors = contract.validate_ocr_request(bad_checksum)
    assert any("checksumSha256" in e for e in errors), errors

    bad_language = _valid_request()
    bad_language["languages"] = ["eng", "en-US"]
    errors = contract.validate_ocr_request(bad_language)
    assert any("languages[1]" in e for e in errors), errors

    empty_languages = _valid_request()
    empty_languages["languages"] = []
    assert contract.validate_ocr_request(empty_languages), "an empty language list must be refused"

    bad_url = _valid_request()
    bad_url["source"]["url"] = "file:///etc/passwd"
    errors = contract.validate_ocr_request(bad_url)
    assert any("source.url" in e for e in errors), errors

    tiny_ceiling = _valid_request()
    tiny_ceiling["maxCallbackBytes"] = 100
    assert contract.validate_ocr_request(tiny_ceiling), "an absurd callback ceiling must be refused"

    missing_ref = _valid_request()
    del missing_ref["externalRef"]["workspaceId"]
    errors = contract.validate_ocr_request(missing_ref)
    assert any("workspaceId" in e for e in errors), errors
    print("  strictness: unknown keys, id length, checksum case, language codes, url scheme, refs")


def _pages(count):
    return [{"page": i + 1, "text": f"page {i + 1} text"} for i in range(count)]


def check_page_sequence_invariant():
    """Every way the page list could lie, refused by name."""
    contract.validate_page_sequence(_pages(3), 3)  # the control: this must pass

    def refuses(pages, count, because):
        try:
            contract.validate_page_sequence(pages, count)
        except contract.PageSequenceError:
            return
        raise AssertionError(f"validate_page_sequence accepted {because}")

    # A dropped page. THE bug this worker exists to make impossible: page 3's
    # text would ship numbered 2, and every citation after it would be wrong.
    dropped = _pages(3)
    del dropped[1]
    dropped[1]["page"] = 2
    refuses(dropped, 3, "a page list with a page dropped and the rest renumbered")

    refuses(_pages(2), 3, "a page list shorter than its declared pageCount")
    refuses(_pages(4), 3, "a page list longer than its declared pageCount")

    gap = _pages(3)
    gap[1]["page"] = 5
    refuses(gap, 3, "a gap in the page numbers")

    duplicate = _pages(3)
    duplicate[2]["page"] = 2
    refuses(duplicate, 3, "a duplicated page number")

    zero_based = [{"page": 0, "text": "x"}, {"page": 1, "text": "y"}]
    refuses(zero_based, 2, "0-based page numbers")

    reversed_pages = list(reversed(_pages(3)))
    refuses(reversed_pages, 3, "pages in descending order")

    extra_key = _pages(1)
    extra_key[0]["confidence"] = 0.91
    refuses(extra_key, 1, "a page carrying an extra field")

    too_long = [{"page": 1, "text": "x" * (contract.MAX_PAGE_CHARS + 1)}]
    refuses(too_long, 1, "a page over the character cap")

    refuses(_pages(contract.MAX_PAGES + 1), contract.MAX_PAGES + 1, "more pages than the contract cap")

    # A BLANK page is legal and must stay legal — it is how the numbering
    # survives a page the recogniser found nothing on.
    contract.validate_page_sequence([{"page": 1, "text": ""}, {"page": 2, "text": "b"}], 2)
    print("  page invariant: drops, gaps, duplicates, order, extra fields and caps all refused")


def check_callback_builder():
    accepted = contract.build_callback("req-00000001", "job-1", "accepted")
    assert accepted["schemaVersion"] == contract.SCHEMA_VERSION_V1
    assert len(accepted["callbackId"]) >= 8
    assert accepted["occurredAt"].endswith("Z")
    assert "pages" not in accepted

    try:
        contract.build_callback("req-00000001", "job-1", "succeeded")
        raise AssertionError("a succeeded callback with no pages must be refused")
    except ValueError:
        pass

    try:
        contract.build_callback("req-00000001", "job-1", "failed", pages=_pages(2), page_count=2)
        raise AssertionError("a failed callback carrying pages must be refused")
    except ValueError:
        pass

    try:
        contract.build_callback("req-00000001", "job-1", "invented")
        raise AssertionError("an unknown status must be refused")
    except ValueError:
        pass

    # The builder is the LAST place before the wire, so the invariant is
    # enforced there too — not only where the pipeline happens to call it.
    bad = _pages(3)
    del bad[0]
    try:
        contract.build_callback("req-00000001", "job-1", "succeeded", pages=bad, page_count=3)
        raise AssertionError("build_callback accepted a broken page sequence")
    except contract.PageSequenceError:
        pass

    good = contract.build_callback(
        "req-00000001",
        "job-1",
        "succeeded",
        pages=_pages(2),
        page_count=2,
        progress=100,
        engine=contract.build_engine("ocrmypdf+tesseract", version="16.4.0", languages=["eng"], pages_with_text=2),
    )
    assert good["pageCount"] == 2 and len(good["pages"]) == 2
    assert good["engine"]["pagesWithText"] == 2
    assert good["progress"] == 100
    print("  callback builder: status vocabulary, pages-required, pages-forbidden, invariant")


def main():
    print("contract checks:")
    check_enums_match_schema_file()
    check_no_confidence_vocabulary_anywhere()
    check_valid_request_validates()
    check_strictness()
    check_page_sequence_invariant()
    check_callback_builder()
    print("all contract checks passed")


if __name__ == "__main__":
    main()
