import { describe, expect, it } from "vitest";

import {
  DEFAULT_KB_OCR_CALLBACK_MAX_BYTES,
  KB_OCR_PROVENANCE_NOTICE,
  describeUnreadableDocument,
  documentCanBeOcred,
  resolveKbOcrCallbackMaxBytes,
  resolveKbOcrLanguages,
} from "@/lib/knowledge-base/ocr-availability";
import { NoExtractableTextError } from "@/lib/knowledge-base/extract";

/**
 * What a planner is told about a document OpenPlan could not read.
 *
 * THE DEFECT THIS PREVENTS. `NoExtractableTextError`'s message is written into
 * `kb_documents.extraction_error` at upload time and ends "OCR is not enabled."
 * That was unconditionally true until the OCR worker existed. It is now a claim
 * about the DEPLOYMENT, frozen into a row, at a moment when the answer can
 * still change — a document uploaded on Monday keeps telling a planner OCR is
 * unavailable on the Tuesday their operator wires up a worker.
 *
 * The stored string is not rewritten (a record of what the parser found is not
 * a claim about what is possible), so the fix has to be at display time, and
 * this is where it is held.
 */

describe("the stored extraction error carries a claim that goes stale", () => {
  it("still contains the deployment-dependent sentence — the reason this module exists", () => {
    // If this ever stops being true, `describeUnreadableDocument` may be
    // unnecessary. It failing is a prompt to check, not a bug on its own — but
    // it must be a prompt, not a silence.
    expect(new NoExtractableTextError().message).toMatch(/OCR is not enabled/i);
  });
});

describe("describeUnreadableDocument", () => {
  const stored = new NoExtractableTextError().message;

  it("never repeats the stale claim when this deployment HAS a worker", () => {
    const sentence = describeUnreadableDocument(stored, true);
    expect(sentence).not.toMatch(/not enabled/i);
    expect(sentence).toMatch(/can be read with OCR/i);
  });

  it("says plainly that this deployment cannot, when it cannot", () => {
    const sentence = describeUnreadableDocument(stored, false);
    expect(sentence).toMatch(/OCR service/i);
    expect(sentence).toMatch(/this deployment does not have/i);
    // Not "scans are not supported": a planner must not conclude the product
    // cannot do this when their own agency could turn it on.
    expect(sentence).not.toMatch(/not supported/i);
  });

  it("passes a DIFFERENT parser failure through untouched", () => {
    // A corrupt PDF has nothing stale in its message, and paraphrasing it would
    // lose the only detail that identifies the problem.
    const corrupt = "Could not parse the PDF (Invalid XRef stream header).";
    expect(describeUnreadableDocument(corrupt, true)).toBe(corrupt);
    expect(describeUnreadableDocument(corrupt, false)).toBe(corrupt);
  });

  it("does not invent a reason when none was recorded", () => {
    for (const empty of [null, undefined, "   "]) {
      expect(describeUnreadableDocument(empty, true)).toBe(
        "This document could not be read, and the reason was not recorded."
      );
    }
  });
});

describe("the OCR provenance disclosure", () => {
  it("says a scan can misread, and tells the reader to check the original", () => {
    // The disclosure that lets a planner — and a board member reading the plan
    // afterwards — treat a transcribed figure differently from a typed one.
    expect(KB_OCR_PROVENANCE_NOTICE).toMatch(/misread/i);
    expect(KB_OCR_PROVENANCE_NOTICE).toMatch(/against the original/i);
    expect(KB_OCR_PROVENANCE_NOTICE).toMatch(/page/i);
  });

  it("is a disclosure, never a score", () => {
    expect(KB_OCR_PROVENANCE_NOTICE).not.toMatch(/confiden|accura|likelihood|certain|%|\d/i);
  });

  it("is written for a planner, not an operator", () => {
    // Environment variables belong in the API refusal and DEPLOY.md, where the
    // person who can act on them is the reader. A planner meeting
    // OPENPLAN_KB_OCR_WORKER_URL on a document card learns nothing.
    expect(KB_OCR_PROVENANCE_NOTICE).not.toMatch(/OPENPLAN_|extraction_source|kb_/);
  });
});

describe("documentCanBeOcred", () => {
  it("is a failed PDF and nothing else", () => {
    expect(documentCanBeOcred({ source_kind: "uploaded_pdf", status: "failed" })).toBe(true);
    for (const document of [
      { source_kind: "uploaded_pdf", status: "ready" },
      { source_kind: "uploaded_pdf", status: "stored" },
      { source_kind: "uploaded_image", status: "stored" },
      { source_kind: "uploaded_spreadsheet", status: "stored" },
      { source_kind: "uploaded_docx", status: "failed" },
      { source_kind: "pasted_text", status: "ready" },
    ]) {
      expect(documentCanBeOcred(document), JSON.stringify(document)).toBe(false);
    }
  });
});

describe("operator settings", () => {
  it("defaults languages to English and says so, rather than sending nothing", () => {
    expect(resolveKbOcrLanguages({})).toEqual(["eng"]);
    expect(resolveKbOcrLanguages({ OPENPLAN_KB_OCR_LANGUAGES: "" })).toEqual(["eng"]);
  });

  it("parses the shapes an operator will actually type", () => {
    expect(resolveKbOcrLanguages({ OPENPLAN_KB_OCR_LANGUAGES: "spa" })).toEqual(["spa"]);
    expect(resolveKbOcrLanguages({ OPENPLAN_KB_OCR_LANGUAGES: "spa,eng" })).toEqual(["spa", "eng"]);
    expect(resolveKbOcrLanguages({ OPENPLAN_KB_OCR_LANGUAGES: "spa + eng" })).toEqual(["spa", "eng"]);
    expect(resolveKbOcrLanguages({ OPENPLAN_KB_OCR_LANGUAGES: " vie , chi_sim " })).toEqual([
      "vie",
      "chi_sim",
    ]);
  });

  it("falls back rather than dispatching an empty language list", () => {
    // A locale tag is the mistake an operator will make. The worker would
    // refuse an empty list outright, costing them the whole capability; falling
    // back costs them a language and still runs.
    expect(resolveKbOcrLanguages({ OPENPLAN_KB_OCR_LANGUAGES: "en-US" })).toEqual(["eng"]);
    expect(resolveKbOcrLanguages({ OPENPLAN_KB_OCR_LANGUAGES: "!!!" })).toEqual(["eng"]);
  });

  it("caps the language list at the contract's eight", () => {
    const many = "aaa,bbb,ccc,ddd,eee,fff,ggg,hhh,iii,jjj";
    expect(resolveKbOcrLanguages({ OPENPLAN_KB_OCR_LANGUAGES: many })).toHaveLength(8);
  });

  it("defaults the callback ceiling under Vercel's fixed request-body limit", () => {
    expect(resolveKbOcrCallbackMaxBytes({})).toBe(DEFAULT_KB_OCR_CALLBACK_MAX_BYTES);
    // 4.5 MB is the limit a hosted Function enforces and an operator cannot
    // raise. A default above it would make every large scan fail on a hosted
    // deployment with a 413 nobody could act on.
    expect(DEFAULT_KB_OCR_CALLBACK_MAX_BYTES).toBeLessThan(4.5 * 1000 * 1000);
  });

  it("honours a raised ceiling and ignores nonsense", () => {
    expect(resolveKbOcrCallbackMaxBytes({ OPENPLAN_KB_OCR_CALLBACK_MAX_BYTES: "33554432" })).toBe(
      33554432
    );
    for (const bad of ["0", "-1", "abc", "1.5", ""]) {
      expect(
        resolveKbOcrCallbackMaxBytes({ OPENPLAN_KB_OCR_CALLBACK_MAX_BYTES: bad }),
        bad
      ).toBe(DEFAULT_KB_OCR_CALLBACK_MAX_BYTES);
    }
  });
});
