import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildOcrRequest,
  KB_OCR_JOB_STATUSES,
  normalizeOcrPageText,
  OCR_CALLBACK_STATUSES,
  OCR_CONTRACT_SCHEMA_VERSION,
  OCR_CONTRACT_SCHEMA_VERSIONS,
  OCR_MAX_PAGE_CHARS,
  OCR_MAX_PAGES,
  OCR_STATUS_TO_JOB_STATUS,
  ocrCallbackSchema,
  ocrPagesToExtractedPages,
} from "@/lib/knowledge-base/ocr-contract";
import { chunkExtractedDocument } from "@/lib/knowledge-base/chunk";
import { extractedFromText } from "@/lib/knowledge-base/extract";

/**
 * OpenPlan's half of the OCR extraction contract, and the page invariant it
 * exists to hold.
 *
 * THE SCHEMA FILE AT THE REPOSITORY ROOT IS THE SOURCE OF TRUTH. The Python
 * worker mirrors it and cross-checks itself; this suite does the same job from
 * the TypeScript side, so a change to the contract that reaches only two of the
 * three copies fails a build rather than failing a job at 2 a.m.
 */

const SCHEMA_PATH = path.join(
  process.cwd(),
  "..",
  "schemas",
  "ocr_extraction_contract.schema.json"
);

type ContractSchema = {
  $defs: {
    OcrRequest: { properties: Record<string, { enum?: string[]; maxItems?: number }> };
    OcrCallback: {
      properties: Record<string, { enum?: string[]; maxItems?: number }>;
      allOf: Array<{ then: { required: string[] } }>;
    };
    OcrPage: { properties: { text: { maxLength: number } } };
  };
};

function loadSchema(): ContractSchema {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as ContractSchema;
}

function succeededCallback(
  pages: Array<{ page: number; text: string }>,
  overrides: Record<string, unknown> = {}
) {
  return {
    schemaVersion: OCR_CONTRACT_SCHEMA_VERSION,
    requestId: "11111111-1111-4111-8111-111111111111",
    callbackId: "ocr-abcdef0123456789",
    jobReference: "ocr-job-1",
    status: "succeeded",
    occurredAt: "2026-08-11T12:00:00Z",
    pageCount: pages.length,
    pages,
    ...overrides,
  };
}

describe("the OCR contract mirror cannot drift from the schema file", () => {
  const schema = loadSchema();

  it("reads a real schema file (the cross-check is not comparing nothing)", () => {
    expect(Object.keys(schema.$defs.OcrCallback.properties).length).toBeGreaterThan(5);
  });

  it("matches every enum and cap", () => {
    expect(schema.$defs.OcrRequest.properties.schemaVersion.enum).toEqual([
      ...OCR_CONTRACT_SCHEMA_VERSIONS,
    ]);
    expect(schema.$defs.OcrCallback.properties.schemaVersion.enum).toEqual([
      ...OCR_CONTRACT_SCHEMA_VERSIONS,
    ]);
    expect(schema.$defs.OcrCallback.properties.status.enum).toEqual([...OCR_CALLBACK_STATUSES]);
    expect(schema.$defs.OcrCallback.properties.pages.maxItems).toBe(OCR_MAX_PAGES);
    expect(schema.$defs.OcrPage.properties.text.maxLength).toBe(OCR_MAX_PAGE_CHARS);
  });

  it("keeps the succeeded-requires-pages rule written down in the schema too", () => {
    expect([...schema.$defs.OcrCallback.allOf[0].then.required].sort()).toEqual([
      "pageCount",
      "pages",
    ]);
  });

  it("maps every contract status onto a job status, with no hole", () => {
    for (const status of OCR_CALLBACK_STATUSES) {
      expect(KB_OCR_JOB_STATUSES).toContain(OCR_STATUS_TO_JOB_STATUS[status]);
    }
    // A cancelled job is a job whose text is not coming. Folding it into
    // `failed` is the answer a planner can act on; a fifth state they cannot
    // would be schema mirroring a protocol.
    expect(OCR_STATUS_TO_JOB_STATUS.canceled).toBe("failed");
    expect(OCR_STATUS_TO_JOB_STATUS.accepted).toBe("running");
  });
});

describe("the page invariant, refused at the door", () => {
  it("accepts pages 1..N ascending, blanks included", () => {
    const parsed = ocrCallbackSchema.safeParse(
      succeededCallback([
        { page: 1, text: "Front matter" },
        { page: 2, text: "" },
        { page: 3, text: "Chapter 1" },
      ])
    );
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("refuses a dropped page whose successors were renumbered", () => {
    // THE bug. Page 3's text arrives numbered 2, every citation after it is
    // wrong, and nothing downstream — not the chunker, not the reviewer, not
    // the board member checking p. 112 — could ever detect it.
    const parsed = ocrCallbackSchema.safeParse(
      succeededCallback([
        { page: 1, text: "a" },
        { page: 2, text: "c" },
      ], { pageCount: 3 })
    );
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("pageCount is 3 but 2 pages arrived");
  });

  it("refuses a gap, a duplicate, and a 0-based list", () => {
    for (const pages of [
      [{ page: 1, text: "a" }, { page: 3, text: "c" }],
      [{ page: 1, text: "a" }, { page: 1, text: "a" }],
      [{ page: 0, text: "a" }, { page: 1, text: "b" }],
    ]) {
      const parsed = ocrCallbackSchema.safeParse(succeededCallback(pages));
      expect(parsed.success, `accepted ${JSON.stringify(pages)}`).toBe(false);
    }
  });

  it("refuses a succeeded callback with no pages at all", () => {
    const parsed = ocrCallbackSchema.safeParse({
      schemaVersion: OCR_CONTRACT_SCHEMA_VERSION,
      requestId: "11111111-1111-4111-8111-111111111111",
      callbackId: "ocr-abcdef0123456789",
      jobReference: "ocr-job-1",
      status: "succeeded",
      occurredAt: "2026-08-11T12:00:00Z",
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("a failure that did not say so");
  });

  it("refuses a failed callback that smuggles pages", () => {
    const parsed = ocrCallbackSchema.safeParse(
      succeededCallback([{ page: 1, text: "a" }], { status: "failed" })
    );
    expect(parsed.success).toBe(false);
  });

  it("refuses a confidence field the worker never sends and no one may add", () => {
    // `.strict()` is what enforces this. Without it, a worker that started
    // sending a confidence figure would have it silently ignored — and then,
    // one release later, silently displayed next to a dollar amount.
    const parsed = ocrCallbackSchema.safeParse(
      succeededCallback([{ page: 1, text: "a" }], { confidence: 0.94 })
    );
    expect(parsed.success).toBe(false);
    const engineWithScore = ocrCallbackSchema.safeParse(
      succeededCallback([{ page: 1, text: "a" }], {
        engine: { name: "ocrmypdf+tesseract", accuracy: 0.94 },
      })
    );
    expect(engineWithScore.success).toBe(false);
  });
});

describe("OCR text is normalized exactly as text-layer text is", () => {
  /**
   * THE DRIFT GUARD for the duplicated `normalizeWhitespace`.
   *
   * `normalizeOcrPageText` is a second copy of a private function in
   * extract.ts, which this lane may not modify. The duplication is held by this
   * test rather than by a comment: the other implementation is reached through
   * its exported `extractedFromText`, which applies it, so the two are compared
   * on real behaviour and not on their source text.
   *
   * If they ever diverge, chunks from a scanned document and chunks from a
   * text-layer document stop being the same kind of thing — and the RTP
   * extraction lane's verifier depends on a quote being a substring of the
   * chunk that carries it.
   */
  const fixtures = [
    "Plain prose with no surprises.",
    "Windows lines\r\nand a stray\rcarriage return.",
    "Trailing spaces before a newline   \nand after.",
    "Four\n\n\n\nblank lines collapse.",
    "Table    columns     spaced      wide, as pdftotext -layout writes them.",
    "  leading and trailing whitespace  ",
    "A figure: $12,400,000 in the 2023–2032 band.",
    "Tabs\tbetween\t\tcolumns.",
    "Mixed   non-breaking space stays.",
  ];

  it.each(fixtures)("agrees with extractedFromText on %j", (raw) => {
    expect(normalizeOcrPageText(raw)).toBe(extractedFromText(raw).pages[0].text);
  });

  it("strips the control characters Postgres would reject", () => {
    // A NUL in a chunk fails the insert; the recogniser can emit one from a
    // damaged scan. Not caught by the comparison above, because
    // `extractedFromText` would strip it too — asserted directly so the
    // behaviour is pinned even if that path changes.
    expect(normalizeOcrPageText("before after")).toBe("beforeafter");
    expect(normalizeOcrPageText("bellhere")).toBe("bellhere");
    expect(normalizeOcrPageText("keep\ttab and\nnewline")).toBe("keep\ttab and\nnewline");
  });
});

describe("pages become page-anchored chunks", () => {
  it("keeps a chunk's page range pointing at the pages its text was on", () => {
    const pages = ocrPagesToExtractedPages([
      { page: 1, text: "Page one prose." },
      { page: 2, text: "" },
      { page: 3, text: "Page three prose about the constrained project list." },
    ]);
    // The empty page produces no chunk, but page THREE is still page three.
    expect(pages.map((page) => page.page)).toEqual([1, 3]);

    // Three short pages pack into one chunk, which then honestly spans 1..3 —
    // the text-layer path's behaviour, unchanged, and what `excerptPageLabel`
    // renders as "pp. 1–3".
    const chunks = chunkExtractedDocument(pages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageFrom).toBe(1);
    expect(chunks[0].pageTo).toBe(3);
  });

  it("anchors a real-sized page to its own page number", () => {
    // Pages of ordinary plan length exceed TARGET_CHUNK_CHARS and do not pack
    // together, which is the case that matters: a citation naming p. 112 must
    // come from p. 112.
    const filler = (label: string) => `${label} ${"lorem ipsum dolor sit amet. ".repeat(200)}`;
    const pages = ocrPagesToExtractedPages([
      { page: 110, text: filler("PAGE-110-MARKER") },
      { page: 111, text: "" },
      { page: 112, text: filler("PAGE-112-MARKER constrained project list") },
    ]);
    const chunks = chunkExtractedDocument(pages);

    // No chunk may name a page the document does not have text on. Page 111
    // recognised nothing, so 111 must appear in no anchor — the chunker packs
    // greedily and a boundary chunk legitimately spans 110–112, but neither
    // endpoint may ever be a page that contributed nothing.
    const anchors = new Set(chunks.flatMap((chunk) => [chunk.pageFrom, chunk.pageTo]));
    expect([...anchors].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([110, 112]);

    // Every chunk carrying page-112 text has an anchor that REACHES 112. The
    // first one also carries the tail of page 110 (greedy packing) and honestly
    // says 110–112; what must never happen is text from p. 112 sitting under an
    // anchor that stops at 110, because a citation made from it would name the
    // wrong page.
    const carrying112 = chunks.filter((chunk) => chunk.content.includes("PAGE-112-MARKER"));
    expect(carrying112.length).toBeGreaterThan(0);
    for (const chunk of carrying112) {
      expect(chunk.pageTo).toBe(112);
    }

    // And most of page 112 is anchored to 112 alone, which is what a citation
    // reading "p. 112" needs.
    expect(chunks.filter((chunk) => chunk.pageFrom === 112 && chunk.pageTo === 112).length)
      .toBeGreaterThan(0);
  });

  it("a page of only whitespace is dropped from chunking without renumbering", () => {
    const pages = ocrPagesToExtractedPages([
      { page: 1, text: "   \n\n  " },
      { page: 2, text: "Real text." },
    ]);
    expect(pages).toEqual([{ page: 2, text: "Real text." }]);
    expect(chunkExtractedDocument(pages)[0].pageFrom).toBe(2);
  });
});

describe("the dispatched request", () => {
  it("carries the ceiling, the languages, and no nulls", () => {
    const body = buildOcrRequest({
      requestId: "11111111-1111-4111-8111-111111111111",
      callbackUrl: "https://app.example.com/api/knowledge-base/ocr-callback",
      documentId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      projectId: null,
      documentTitle: "2022 RTP",
      sourceUrl: "https://storage.example.com/kb/plan.pdf?sig=a",
      filename: null,
      sizeBytes: null,
      checksumSha256: null,
      languages: ["eng", "spa"],
      maxCallbackBytes: 4194304,
    });

    expect(body.schemaVersion).toBe(OCR_CONTRACT_SCHEMA_VERSION);
    expect(body.languages).toEqual(["eng", "spa"]);
    // The worker measures its payload against this before sending; without it
    // an oversized result meets a 413 it can learn nothing from and the job
    // sits `running` forever.
    expect(body.maxCallbackBytes).toBe(4194304);
    // Absent, not null: the worker's validator is strict about types and `null`
    // is not "absent" to it.
    expect(body.source).toEqual({ url: "https://storage.example.com/kb/plan.pdf?sig=a" });
    expect(body.externalRef).toEqual({
      system: "openplan",
      documentId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
    });
  });
});
