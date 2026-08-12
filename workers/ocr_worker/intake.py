"""Source intake: turn an OcrRequest's `source` into a PDF file on disk.

One signed link, streamed to disk against a byte ceiling, then three checks
before the recogniser is allowed near it:

  * the declared SHA-256, when the request carries one. A mismatch FAILS the
    job naming the file. The recognised text becomes citable evidence inside an
    adopted plan; text read off a corrupted download would be indistinguishable
    from text read off the real document.
  * the declared byte size, when the request carries one, for the same reason.
  * the magic bytes. A file that is not a PDF is refused here rather than
    producing an empty, blameless-looking result three minutes later.

Stdlib only (urllib), with the fetcher injectable so the test suite can run
without a network.
"""

import hashlib
import os
import urllib.request

_DOWNLOAD_CHUNK = 1024 * 1024

PDF_MAGIC = b"%PDF-"


class IntakeError(Exception):
    """A named intake failure whose message is safe to send in a callback."""


def default_fetcher(url, dest_path, max_bytes, timeout=300):
    """Stream `url` to `dest_path`, refusing past `max_bytes`; returns bytes
    written. http(s) only."""
    if not (url.startswith("https://") or url.startswith("http://")):
        raise IntakeError(f"the source URL is not http(s): {url[:80]}")
    request = urllib.request.Request(url, headers={"User-Agent": "openplan-ocr-worker"})
    written = 0
    with urllib.request.urlopen(request, timeout=timeout) as response, open(
        dest_path, "wb"
    ) as out:
        while True:
            chunk = response.read(_DOWNLOAD_CHUNK)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                # Stop reading: the point of a ceiling is not to spend the disk
                # first and complain afterwards.
                raise IntakeError(
                    f"the source document is larger than this worker's ceiling of "
                    f"{max_bytes} bytes (OCR_WORKER_MAX_SOURCE_BYTES). Nothing was "
                    "recognised."
                )
            out.write(chunk)
    return written


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_DOWNLOAD_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def looks_like_pdf(path):
    with open(path, "rb") as handle:
        return handle.read(len(PDF_MAGIC)) == PDF_MAGIC


def prepare_source(source, work_dir, max_bytes, fetcher=default_fetcher):
    """Materialize the request's source PDF under work_dir; returns its path.
    Raises IntakeError with a sendable message."""
    os.makedirs(work_dir, exist_ok=True)
    dest = os.path.join(work_dir, "source.pdf")
    label = source.get("filename") or "the source document"

    try:
        written = fetcher(source["url"], dest, max_bytes)
    except IntakeError:
        raise
    except Exception as exc:  # noqa: BLE001 - the cause goes in the message
        raise IntakeError(f"{label} could not be downloaded: {exc}") from exc

    declared_size = source.get("sizeBytes")
    if isinstance(declared_size, int):
        actual_size = os.path.getsize(dest)
        if actual_size != declared_size:
            raise IntakeError(
                f"{label} downloaded {actual_size} bytes but the request declared "
                f"{declared_size} — refusing to recognise text from a document that "
                "does not match what was sent"
            )
    else:
        actual_size = written

    if actual_size == 0:
        raise IntakeError(f"{label} downloaded as an empty file; there is nothing to read")

    checksum = source.get("checksumSha256")
    if checksum:
        actual = sha256_of(dest)
        if actual != checksum:
            raise IntakeError(
                f"{label} failed its SHA-256 check (request {checksum[:12]}…, "
                f"downloaded {actual[:12]}…) — refusing to recognise text from a "
                "document that does not match what was sent"
            )

    if not looks_like_pdf(dest):
        raise IntakeError(
            f"{label} does not begin with a PDF header, so it is not a PDF this "
            "worker can read. Nothing was recognised."
        )

    return dest
