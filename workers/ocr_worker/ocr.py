"""The recogniser: a scanned PDF in, per-page text out.

Three external programs, each doing the one thing it is best at:

  ocrmypdf  adds a text layer to the PDF (tesseract underneath, plus the
            rasterisation, orientation and image handling that make tesseract
            usable on real scans).
  pdfinfo   states how many pages the PDF has.
  pdftotext extracts the text layer PAGE BY PAGE.

WHY NOT ocrmypdf's --sidecar, WHICH WOULD BE ONE COMMAND FEWER. The sidecar is
one text file for the whole document, and this worker's entire reason to exist
is that the page number survives. Rather than depend on how a sidecar happens
to mark page boundaries, the text comes back out through pdftotext, whose
form-feed page separator is Poppler behaviour that has been stable for decades
and is trivially verifiable on any machine (`pdftotext file.pdf - | od -c`).

WHY --skip-text AND NOT --force-ocr. A page that already carries real embedded
text keeps it: real text beats recognised text every time, and the documents
this worker is pointed at (an upload whose text-layer extraction FAILED) are
overwhelmingly pages with no text at all. --force-ocr would rasterise and
re-recognise those good pages, replacing something exact with something
approximate.

THE PAGE-COUNT CROSS-CHECK IS THE POINT, NOT A NICETY. Three numbers must
agree: the source PDF's page count, the OCR'd PDF's page count, and how many
page blocks pdftotext produced. If any pair disagrees the job FAILS naming the
three numbers. A silently-dropped page renumbers every page after it, and there
is no reader anywhere downstream — not the chunker, not the reviewer, not the
board member reading a citation — who could ever detect that.

NO CONFIDENCE, EVER. tesseract can emit per-word confidence figures and this
module deliberately does not collect, compute, average, or report them. A
number the machine invents about its own accuracy reads to every human as a
quality signal, and the honest answer to "how good is this transcription?" is
that a person has to look.
"""

import os
import re
import shutil
import subprocess

# pdftotext separates pages with a form feed. This is the anchor.
PAGE_SEPARATOR = "\f"

DEFAULT_LANGUAGES = ("eng",)


class OcrError(Exception):
    """A named recognition failure whose message is safe to send in a callback."""


def _run(command, timeout, runner=None):
    """Run a command, returning CompletedProcess. `runner` is injectable so the
    test suite can drive the pipeline with no binaries installed."""
    run = runner or subprocess.run
    try:
        return run(command, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise OcrError(
            f"{command[0]} is not installed in this worker's image, so nothing "
            f"could be recognised ({exc})"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise OcrError(
            f"{command[0]} did not finish within {timeout} seconds and was stopped. "
            "Nothing was recognised. Raise OCR_WORKER_TIMEOUT_SECONDS for very long "
            "documents, or send fewer pages."
        ) from exc


def _decode(stream):
    if stream is None:
        return ""
    if isinstance(stream, bytes):
        return stream.decode("utf-8", errors="replace")
    return str(stream)


def available_languages(runner=None, timeout=30):
    """Tesseract's installed language packs, as a sorted list. An empty list
    means the probe itself failed — the caller must treat that as "could not
    look", never as "none installed"."""
    result = _run(["tesseract", "--list-langs"], timeout, runner)
    if result.returncode != 0:
        return []
    lines = _decode(result.stdout).splitlines()
    # The first line is a header ("List of available languages (N):").
    return sorted(
        line.strip()
        for line in lines[1:]
        if line.strip() and not line.strip().endswith(":")
    )


def page_count(pdf_path, runner=None, timeout=120):
    """Pages in `pdf_path`, per pdfinfo. Raises OcrError when it cannot be read
    — a page count that could not be established is not a page count of zero."""
    result = _run(["pdfinfo", pdf_path], timeout, runner)
    if result.returncode != 0:
        raise OcrError(
            "the PDF's page count could not be read "
            f"({_decode(result.stderr).strip()[:400] or 'pdfinfo failed'})"
        )
    match = re.search(r"^Pages:\s+(\d+)\s*$", _decode(result.stdout), re.MULTILINE)
    if not match:
        raise OcrError("the PDF's page count could not be read: pdfinfo reported no Pages line")
    return int(match.group(1))


def split_pages(raw_text):
    """Split pdftotext output into per-page strings.

    pdftotext writes a form feed AFTER every page including the last, so the
    naive split leaves one trailing empty element. Exactly one is dropped —
    dropping "all trailing empties" would silently swallow genuinely blank final
    pages, which is the same renumbering bug wearing a helpful face.
    """
    parts = raw_text.split(PAGE_SEPARATOR)
    if parts and parts[-1] == "":
        parts.pop()
    return parts


def recognize(
    source_pdf,
    work_dir,
    languages=DEFAULT_LANGUAGES,
    timeout_seconds=3600,
    max_pages=None,
    jobs=None,
    runner=None,
    progress=None,
):
    """Recognise `source_pdf` and return
    (pages, page_count, engine_version_line).

    `pages` is a list of {"page": n, "text": s} covering 1..page_count with no
    gaps — including pages that produced no text, which carry an empty string.
    """
    report = progress or (lambda percent, message: None)

    source_pages = page_count(source_pdf, runner=runner, timeout=min(timeout_seconds, 300))
    if source_pages < 1:
        raise OcrError("the PDF reports zero pages, so there is nothing to read")
    if max_pages is not None and source_pages > max_pages:
        raise OcrError(
            f"this document has {source_pages} pages and this deployment's ceiling is "
            f"{max_pages} (OCR_WORKER_MAX_PAGES). Nothing was recognised — a document "
            "read only as far as the ceiling would look, from every screen downstream, "
            "exactly like a document that ends there."
        )

    installed = available_languages(runner=runner)
    if installed:
        missing = [code for code in languages if code not in installed]
        if missing:
            raise OcrError(
                f"this worker has no trained data for {', '.join(missing)}. It has: "
                f"{', '.join(installed)}. Install the tesseract language pack "
                "(e.g. tesseract-ocr-spa) and rebuild, or request a language it has. "
                "Nothing was recognised — reading a Spanish plan with the English "
                "model produces text that looks like text and says nothing."
            )

    report(10, f"Recognising {source_pages} pages ({'+'.join(languages)})")

    ocr_pdf = os.path.join(work_dir, "recognised.pdf")
    command = [
        "ocrmypdf",
        "--skip-text",
        "--output-type",
        "pdf",
        "--language",
        "+".join(languages),
        "--quiet",
    ]
    if jobs:
        command += ["--jobs", str(int(jobs))]
    command += [source_pdf, ocr_pdf]

    result = _run(command, timeout_seconds, runner)
    if result.returncode != 0:
        detail = _decode(result.stderr).strip().splitlines()
        raise OcrError(
            "text recognition failed: "
            + (detail[-1][:400] if detail else f"ocrmypdf exited {result.returncode}")
        )
    if not os.path.exists(ocr_pdf):
        raise OcrError(
            "text recognition reported success but produced no output file; nothing "
            "was recognised"
        )

    report(75, "Reading the recognised text back, page by page")

    recognised_pages = page_count(ocr_pdf, runner=runner, timeout=min(timeout_seconds, 300))

    text_result = _run(["pdftotext", "-layout", "-enc", "UTF-8", ocr_pdf, "-"], timeout_seconds, runner)
    if text_result.returncode != 0:
        raise OcrError(
            "the recognised text could not be read back out of the PDF "
            f"({_decode(text_result.stderr).strip()[:400] or 'pdftotext failed'})"
        )

    blocks = split_pages(_decode(text_result.stdout))

    # THE CROSS-CHECK. Three numbers, all three must agree.
    if not (source_pages == recognised_pages == len(blocks)):
        raise OcrError(
            f"page counts disagree — the source PDF has {source_pages} pages, the "
            f"recognised PDF has {recognised_pages}, and {len(blocks)} page blocks came "
            "back out. Nothing was delivered: a page number that has shifted is worse "
            "than no text at all, because every citation made from it would be wrong "
            "and nothing downstream could tell."
        )

    pages = [{"page": index + 1, "text": text} for index, text in enumerate(blocks)]
    engine_version = _engine_version(runner)
    return pages, source_pages, engine_version


def _engine_version(runner=None):
    """ocrmypdf's version string, or None. Recorded rather than assumed: the
    same scan read by two ocrmypdf versions can differ, and the consumer stores
    which one read it."""
    try:
        result = _run(["ocrmypdf", "--version"], 30, runner)
    except OcrError:
        return None
    if result.returncode != 0:
        return None
    return _decode(result.stdout).strip().splitlines()[0][:64] if _decode(result.stdout).strip() else None


def binaries_present():
    """Which of the three programs this worker needs are on PATH. Reported by
    /healthz so a misbuilt image is visible before a job is sent, not after."""
    return {name: shutil.which(name) is not None for name in ("ocrmypdf", "pdfinfo", "pdftotext")}
