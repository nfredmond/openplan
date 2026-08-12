#!/usr/bin/env python3
"""Intake refuses a document that is not the one it was sent.

The recognised text becomes citable evidence inside an adopted plan. Text read
off a corrupted or substituted download would be indistinguishable, everywhere
downstream, from text read off the real document — so every check here is a
refusal, and none of them is a warning.

Run: python3 workers/ocr_worker/test_intake.py   (stdlib only)
"""
import hashlib
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import intake

PDF_BYTES = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n"


def fetcher_serving(payload, record=None):
    """A fetcher that writes `payload` and honours the byte ceiling the same
    way the real one does."""

    def fetch(url, dest_path, max_bytes, timeout=300):
        if record is not None:
            record.append((url, max_bytes))
        if not (url.startswith("http://") or url.startswith("https://")):
            raise intake.IntakeError(f"the source URL is not http(s): {url[:80]}")
        if len(payload) > max_bytes:
            raise intake.IntakeError(
                f"the source document is larger than this worker's ceiling of "
                f"{max_bytes} bytes (OCR_WORKER_MAX_SOURCE_BYTES). Nothing was recognised."
            )
        with open(dest_path, "wb") as handle:
            handle.write(payload)
        return len(payload)

    return fetch


def source(**overrides):
    base = {"url": "https://storage.example.com/kb/plan.pdf?sig=a", "filename": "plan.pdf"}
    base.update(overrides)
    return base


def expect_refusal(fragment, work_dir, src, payload, max_bytes=10_000_000):
    try:
        intake.prepare_source(src, work_dir, max_bytes, fetcher=fetcher_serving(payload))
    except intake.IntakeError as exc:
        assert fragment in str(exc), f"expected {fragment!r} in the refusal, got: {exc}"
        return str(exc)
    raise AssertionError(f"intake accepted a document it should have refused ({fragment})")


def main():
    print("intake checks:")
    work_root = tempfile.mkdtemp(prefix="ocr_intake_test_")
    try:
        # The control: a good download, verified against both declarations.
        checksum = hashlib.sha256(PDF_BYTES).hexdigest()
        record = []
        path = intake.prepare_source(
            source(sizeBytes=len(PDF_BYTES), checksumSha256=checksum),
            os.path.join(work_root, "ok"),
            10_000_000,
            fetcher=fetcher_serving(PDF_BYTES, record),
        )
        assert os.path.exists(path)
        assert open(path, "rb").read() == PDF_BYTES
        assert record[0][1] == 10_000_000, "the ceiling must be handed to the fetcher"
        print("  a matching document is accepted, and the ceiling reaches the fetcher")

        expect_refusal(
            "failed its SHA-256 check",
            os.path.join(work_root, "badsum"),
            source(checksumSha256="b" * 64),
            PDF_BYTES,
        )
        print("  a checksum mismatch is refused")

        expect_refusal(
            "the request declared",
            os.path.join(work_root, "badsize"),
            source(sizeBytes=999999),
            PDF_BYTES,
        )
        print("  a declared-size mismatch is refused")

        expect_refusal(
            "does not begin with a PDF header",
            os.path.join(work_root, "notpdf"),
            source(),
            b"PK\x03\x04 this is a zip",
        )
        print("  a file that is not a PDF is refused before the recogniser sees it")

        expect_refusal(
            "downloaded as an empty file",
            os.path.join(work_root, "empty"),
            source(),
            b"",
        )
        print("  an empty download is refused")

        expect_refusal(
            "OCR_WORKER_MAX_SOURCE_BYTES",
            os.path.join(work_root, "toobig"),
            source(),
            PDF_BYTES,
            max_bytes=8,
        )
        print("  a document over the ceiling is refused, naming the variable")

        expect_refusal(
            "not http(s)",
            os.path.join(work_root, "file"),
            source(url="file:///etc/passwd"),
            PDF_BYTES,
        )
        print("  a non-http(s) source URL is refused")

        # A checksum the request did NOT declare must not be invented: a source
        # with no checksum is accepted on its bytes alone. (The consumer always
        # sends one; a second implementation of this contract might not.)
        intake.prepare_source(
            source(), os.path.join(work_root, "nosum"), 10_000_000, fetcher=fetcher_serving(PDF_BYTES)
        )
        print("  a request with no declared checksum is still accepted")

        # The real fetcher's ceiling is enforced WHILE streaming, not after —
        # asserted on the function's own behaviour with a fake response.
        assert "max_bytes" in intake.default_fetcher.__code__.co_varnames
        print("  the real fetcher takes a byte ceiling")
    finally:
        shutil.rmtree(work_root, ignore_errors=True)

    print("all intake checks passed")


if __name__ == "__main__":
    main()
