#!/usr/bin/env python3
"""The page number that comes out is the page the text was on.

Everything downstream of this worker — the chunk a planner reads, the citation
under a figure in an adopted plan, the "p. 112" a board member checks — hangs
off that being true. So this suite drives the whole recognition pipeline with a
fake `runner`, which is what lets it run on any machine with no ocrmypdf, no
tesseract and no poppler installed, and asks the questions that matter:

  * does a blank page keep its number, or does it silently vanish?
  * do the three page counts have to agree, or does one of them win?
  * does the trailing form feed pdftotext always writes produce a phantom page?
  * does an uninstalled language pack fail loudly, or quietly read a Spanish
    plan with the English model?

Run: python3 workers/ocr_worker/test_ocr.py   (stdlib only)
"""
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ocr


class FakeCompleted:
    def __init__(self, returncode=0, stdout=b"", stderr=b""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def make_runner(
    source_pages=3,
    recognised_pages=None,
    page_texts=None,
    languages=("eng",),
    ocr_returncode=0,
    ocr_stderr=b"",
    write_output=True,
    calls=None,
):
    """A fake subprocess runner standing in for pdfinfo / ocrmypdf / pdftotext.

    Every number the pipeline cross-checks is a separate knob, so a test can
    make exactly one of them disagree.
    """
    recognised_pages = source_pages if recognised_pages is None else recognised_pages
    if page_texts is None:
        page_texts = [f"Page {i + 1} of the plan." for i in range(source_pages)]

    def run(command, capture_output=True, timeout=None, check=False):
        if calls is not None:
            calls.append(list(command))
        program = command[0]

        if program == "tesseract" and "--list-langs" in command:
            body = "List of available languages (%d):\n" % len(languages)
            body += "".join(f"{code}\n" for code in languages)
            return FakeCompleted(0, body.encode())

        if program == "ocrmypdf" and "--version" in command:
            return FakeCompleted(0, b"16.4.0\n")

        if program == "pdfinfo":
            path = command[1]
            pages = recognised_pages if path.endswith("recognised.pdf") else source_pages
            return FakeCompleted(0, f"Title: x\nPages:          {pages}\n".encode())

        if program == "ocrmypdf":
            if ocr_returncode == 0 and write_output:
                with open(command[-1], "wb") as handle:
                    handle.write(b"%PDF-1.7\n")
            return FakeCompleted(ocr_returncode, b"", ocr_stderr)

        if program == "pdftotext":
            # Poppler writes a form feed after EVERY page, including the last.
            body = "".join(f"{text}{ocr.PAGE_SEPARATOR}" for text in page_texts)
            return FakeCompleted(0, body.encode())

        raise AssertionError(f"unexpected command: {command}")

    return run


def expect_failure(fragment, **kwargs):
    work_dir = tempfile.mkdtemp(prefix="ocr_test_")
    source = os.path.join(work_dir, "source.pdf")
    open(source, "wb").write(b"%PDF-1.7\n")
    try:
        ocr.recognize(source, work_dir, runner=make_runner(**kwargs), timeout_seconds=60)
    except ocr.OcrError as exc:
        assert fragment in str(exc), f"expected {fragment!r} in the failure, got: {exc}"
        return str(exc)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
    raise AssertionError(f"recognize() succeeded where it should have failed ({fragment})")


def recognize_with(**kwargs):
    languages = kwargs.pop("request_languages", ("eng",))
    max_pages = kwargs.pop("max_pages", None)
    work_dir = tempfile.mkdtemp(prefix="ocr_test_")
    source = os.path.join(work_dir, "source.pdf")
    open(source, "wb").write(b"%PDF-1.7\n")
    try:
        return ocr.recognize(
            source,
            work_dir,
            languages=languages,
            max_pages=max_pages,
            runner=make_runner(**kwargs),
            timeout_seconds=60,
        )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def check_split_drops_exactly_one_trailing_separator():
    # pdftotext's trailing form feed must not become a phantom final page…
    assert ocr.split_pages("a\fb\f") == ["a", "b"]
    # …and a genuinely blank LAST page must survive, which is the same bug
    # wearing a helpful face: "strip all trailing empties" loses it.
    assert ocr.split_pages("a\f\f") == ["a", ""]
    assert ocr.split_pages("a\f\f\f") == ["a", "", ""]
    assert ocr.split_pages("") == []
    assert ocr.split_pages("only one page\f") == ["only one page"]
    print("  the page split drops exactly one trailing separator, never a blank page")


def check_pages_come_back_numbered_from_one():
    pages, count, version = recognize_with(source_pages=3)
    assert count == 3
    assert [p["page"] for p in pages] == [1, 2, 3]
    assert pages[2]["text"] == "Page 3 of the plan."
    assert version == "16.4.0"
    print("  three pages come back numbered 1, 2, 3 with their own text")


def check_a_blank_page_keeps_its_number():
    # Page 2 recognised nothing — a real and common outcome on a scanned plan
    # (a divider, a fold-out, a photo page). If it were dropped, page 3's text
    # would ship numbered 2 and every citation after it would be wrong.
    pages, count, _ = recognize_with(
        source_pages=3, page_texts=["Front matter", "", "Chapter 1 begins"]
    )
    assert count == 3
    assert [p["page"] for p in pages] == [1, 2, 3]
    assert pages[1]["text"] == ""
    assert pages[2]["text"] == "Chapter 1 begins"
    print("  a page that recognised nothing keeps its number and ships empty")


def check_page_counts_must_agree():
    # pdftotext produced fewer blocks than the PDF has pages.
    detail = expect_failure("page counts disagree", source_pages=4, page_texts=["a", "b", "c"])
    assert "4" in detail and "3" in detail, detail

    # The recognised PDF lost a page somewhere in ocrmypdf.
    expect_failure("page counts disagree", source_pages=4, recognised_pages=3, page_texts=["a"] * 4)
    print("  a disagreement between the three page counts fails the job, naming all three")


def check_missing_language_pack_fails_loudly():
    work_dir = tempfile.mkdtemp(prefix="ocr_test_")
    source = os.path.join(work_dir, "source.pdf")
    open(source, "wb").write(b"%PDF-1.7\n")
    try:
        ocr.recognize(
            source,
            work_dir,
            languages=("spa",),
            runner=make_runner(languages=("eng", "deu")),
            timeout_seconds=60,
        )
        raise AssertionError("a language with no trained data must fail the job")
    except ocr.OcrError as exc:
        assert "no trained data for spa" in str(exc), exc
        assert "deu, eng" in str(exc), "the failure must say what the worker DOES have"
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
    print("  a language with no trained data fails, naming it and what is installed")


def check_language_probe_failure_is_not_an_empty_language_list():
    """`available_languages` returning [] means the probe failed, not that no
    languages exist. Treating the two as the same would refuse every job on a
    working worker whose tesseract binary answers oddly."""

    def runner(command, capture_output=True, timeout=None, check=False):
        if command[0] == "tesseract":
            return FakeCompleted(1, b"", b"tesseract: cannot list")
        return make_runner()(command, capture_output, timeout, check)

    assert ocr.available_languages(runner=runner) == []

    work_dir = tempfile.mkdtemp(prefix="ocr_test_")
    source = os.path.join(work_dir, "source.pdf")
    open(source, "wb").write(b"%PDF-1.7\n")
    try:
        pages, count, _ = ocr.recognize(
            source, work_dir, languages=("spa",), runner=runner, timeout_seconds=60
        )
        assert count == 3 and len(pages) == 3
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
    print("  a failed language probe does not masquerade as 'no languages installed'")


def check_page_ceiling_refuses_rather_than_truncates():
    detail = None
    work_dir = tempfile.mkdtemp(prefix="ocr_test_")
    source = os.path.join(work_dir, "source.pdf")
    open(source, "wb").write(b"%PDF-1.7\n")
    try:
        ocr.recognize(
            source, work_dir, max_pages=2, runner=make_runner(source_pages=5), timeout_seconds=60
        )
        raise AssertionError("a document over the page ceiling must be refused")
    except ocr.OcrError as exc:
        detail = str(exc)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
    assert "OCR_WORKER_MAX_PAGES" in detail, detail
    assert "5" in detail and "2" in detail, detail
    print("  a document over the page ceiling is refused whole, never truncated")


def check_recogniser_failures_are_named():
    expect_failure("text recognition failed", ocr_returncode=3, ocr_stderr=b"x\nEncrypted PDF\n")
    expect_failure("produced no output file", write_output=False)

    # A missing binary names itself rather than crashing with a stack trace.
    def missing(command, capture_output=True, timeout=None, check=False):
        raise FileNotFoundError(command[0])

    work_dir = tempfile.mkdtemp(prefix="ocr_test_")
    source = os.path.join(work_dir, "source.pdf")
    open(source, "wb").write(b"%PDF-1.7\n")
    try:
        ocr.recognize(source, work_dir, runner=missing, timeout_seconds=60)
        raise AssertionError("a missing binary must fail the job")
    except ocr.OcrError as exc:
        assert "not installed in this worker's image" in str(exc), exc
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    # A timeout says how long it waited and which knob moves it.
    def slow(command, capture_output=True, timeout=None, check=False):
        raise subprocess.TimeoutExpired(command, timeout or 0)

    work_dir = tempfile.mkdtemp(prefix="ocr_test_")
    source = os.path.join(work_dir, "source.pdf")
    open(source, "wb").write(b"%PDF-1.7\n")
    try:
        ocr.recognize(source, work_dir, runner=slow, timeout_seconds=60)
        raise AssertionError("a timeout must fail the job")
    except ocr.OcrError as exc:
        assert "OCR_WORKER_TIMEOUT_SECONDS" in str(exc), exc
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
    print("  recogniser failure, missing output, missing binary and timeout each name themselves")


def check_the_command_keeps_existing_text_and_the_layout():
    calls = []
    work_dir = tempfile.mkdtemp(prefix="ocr_test_")
    source = os.path.join(work_dir, "source.pdf")
    open(source, "wb").write(b"%PDF-1.7\n")
    try:
        ocr.recognize(
            source,
            work_dir,
            languages=("eng", "spa"),
            runner=make_runner(languages=("eng", "spa"), calls=calls),
            timeout_seconds=60,
        )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    ocrmypdf_call = next(c for c in calls if c[0] == "ocrmypdf" and "--version" not in c)
    # --skip-text, not --force-ocr: a page that already carries real embedded
    # text keeps it. Real text beats recognised text every time.
    assert "--skip-text" in ocrmypdf_call, ocrmypdf_call
    assert "--force-ocr" not in ocrmypdf_call, ocrmypdf_call
    # The languages the REQUEST asked for, joined the way tesseract wants them.
    assert "eng+spa" in ocrmypdf_call, ocrmypdf_call

    pdftotext_call = next(c for c in calls if c[0] == "pdftotext")
    # -layout: an RTP's fiscal tables are columns, and reflowing them destroys
    # the row a figure belongs to.
    assert "-layout" in pdftotext_call, pdftotext_call
    print("  ocrmypdf keeps existing text and the requested languages; pdftotext keeps the layout")


def main():
    print("ocr checks:")
    check_split_drops_exactly_one_trailing_separator()
    check_pages_come_back_numbered_from_one()
    check_a_blank_page_keeps_its_number()
    check_page_counts_must_agree()
    check_missing_language_pack_fails_loudly()
    check_language_probe_failure_is_not_an_empty_language_list()
    check_page_ceiling_refuses_rather_than_truncates()
    check_recogniser_failures_are_named()
    check_the_command_keeps_existing_text_and_the_layout()
    print("all ocr checks passed")


if __name__ == "__main__":
    main()
