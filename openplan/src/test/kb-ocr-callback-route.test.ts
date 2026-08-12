import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The OCR callback route — where recognised text becomes citable evidence, and
 * therefore the one place in this lane where a mistake reaches a planning
 * document.
 *
 * WHAT IS PINNED, in order of what a failure would cost:
 *
 *   1. A document only becomes `ready` with `extraction_source = 'ocr'` when
 *      pages actually arrived, and the chunks land BEFORE that flip. A crash in
 *      between must leave a document that honestly still says it could not be
 *      read, not one half-claiming to be indexed.
 *   2. The chunks the route writes carry PAGE NUMBERS from the pages the worker
 *      sent — asserted on the ROWS handed to the insert, not on a summary,
 *      because "the text got in" and "the text got in under the right page" are
 *      different facts and only the second one makes a citation true.
 *   3. A redelivered callback (same callbackId) is deduped by the ledger's
 *      UNIQUE and does NOT insert the chunks a second time — a doubling that
 *      would produce no error anywhere and would double every excerpt in
 *      search.
 *   4. A failed or empty result leaves the document uncitable and RECORDS WHY.
 *      A crashed run that read as benign is a defect this repository has
 *      already paid for.
 *   5. No bearer, wrong bearer, unconfigured deployment, and an unknown request
 *      each answer differently, because they are different problems for whoever
 *      is holding the worker's logs.
 *
 * WHAT THIS FILE CANNOT SEE, MEASURED. Replacing `page.page` with the array
 * index in `ocrPagesToExtractedPages` survives every test here, and that is not
 * a gap — it is an EQUIVALENT mutant on this path, because `ocrCallbackSchema`
 * has already refused any payload whose pages are not 1..N ascending, so the
 * index and the page number are the same number by the time the route sees
 * them. The mutation is killed by `kb-ocr-contract.test.ts`, which calls the
 * mapper directly with pages 110/111/112 and therefore CAN tell them apart.
 * Recorded because a future reader who deletes that sibling test would leave
 * the property unguarded and this file would stay green.
 */

const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const jobMaybeSingleMock = vi.fn();
const jobUpdateEqMock = vi.fn();
const jobUpdateMock = vi.fn();
const ledgerInsertMock = vi.fn();
const documentUpdateEqMock = vi.fn();
const documentUpdateMock = vi.fn();
const chunkCountMock = vi.fn();
const chunkInsertMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "kb_ocr_jobs") {
    return {
      select: () => ({ eq: () => ({ maybeSingle: jobMaybeSingleMock }) }),
      update: jobUpdateMock,
    };
  }
  if (table === "kb_ocr_job_callbacks") {
    return { insert: ledgerInsertMock };
  }
  if (table === "kb_documents") {
    return { update: documentUpdateMock };
  }
  if (table === "kb_document_chunks") {
    return {
      select: () => ({ eq: chunkCountMock }),
      insert: chunkInsertMock,
    };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postOcrCallback } from "@/app/api/knowledge-base/ocr-callback/route";

const CALLBACK_TOKEN = "ocr-callback-secret";

const JOB_ROW = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspace_id: "33333333-3333-4333-8333-333333333333",
  document_id: "22222222-2222-4222-8222-222222222222",
  request_id: "11111111-1111-4111-8111-111111111111",
  worker_job_id: "ocr-job-9",
  status: "running",
};

function callbackPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "openplan-ocr-extraction.v1",
    requestId: JOB_ROW.request_id,
    callbackId: "ocr-0000000001",
    jobReference: "ocr-job-9",
    status: "running",
    occurredAt: "2026-08-11T12:00:00Z",
    ...overrides,
  };
}

/** Three pages of real length, so the chunker does not pack them into one. */
function realPages() {
  const filler = (marker: string) => `${marker} ${"lorem ipsum dolor sit amet. ".repeat(200)}`;
  return [
    { page: 1, text: filler("MARKER-ONE") },
    { page: 2, text: "" },
    { page: 3, text: filler("MARKER-THREE fiscally constrained project list") },
  ];
}

function succeededPayload(overrides: Record<string, unknown> = {}) {
  const pages = (overrides.pages as Array<{ page: number; text: string }>) ?? realPages();
  return callbackPayload({
    status: "succeeded",
    callbackId: "ocr-0000000002",
    pageCount: pages.length,
    pages,
    engine: {
      name: "ocrmypdf+tesseract",
      version: "16.4.0",
      languages: ["eng"],
      pagesWithText: pages.filter((page) => page.text.trim()).length,
    },
    ...overrides,
  });
}

function buildRequest(body: unknown, token: string | null = CALLBACK_TOKEN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest("https://app.example.com/api/knowledge-base/ocr-callback", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN = CALLBACK_TOKEN;
  delete process.env.OPENPLAN_KB_OCR_CALLBACK_MAX_BYTES;

  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  createServiceRoleClientMock.mockReturnValue({ from: fromMock });

  jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW }, error: null });
  ledgerInsertMock.mockResolvedValue({ error: null });
  jobUpdateEqMock.mockResolvedValue({ error: null });
  jobUpdateMock.mockReturnValue({ eq: jobUpdateEqMock });
  documentUpdateEqMock.mockResolvedValue({ error: null });
  documentUpdateMock.mockReturnValue({ eq: documentUpdateEqMock });
  chunkCountMock.mockResolvedValue({ count: 0, error: null });
  chunkInsertMock.mockResolvedValue({ error: null });
});

describe("authentication and configuration", () => {
  it("answers 503 when this deployment has no callback token — not 401", () => {
    delete process.env.OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN;
    return postOcrCallback(buildRequest(callbackPayload())).then(async (response) => {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "missing_config" });
      // "not provisioned" and "bad credentials" are different problems for an
      // operator, and only one of them means someone should check a token.
      expect(fromMock).not.toHaveBeenCalled();
    });
  });

  it("answers 401 with no bearer and with the wrong bearer", async () => {
    for (const token of [null, "not-the-token"]) {
      const response = await postOcrCallback(buildRequest(callbackPayload(), token));
      expect(response.status).toBe(401);
    }
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a request id it never dispatched", async () => {
    jobMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await postOcrCallback(buildRequest(callbackPayload()));
    expect(response.status).toBe(404);
    expect(ledgerInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a payload that breaks the page invariant", async () => {
    const response = await postOcrCallback(
      buildRequest(
        succeededPayload({
          pages: [
            { page: 1, text: "a" },
            { page: 3, text: "c" },
          ],
        })
      )
    );
    expect(response.status).toBe(400);
    expect(chunkInsertMock).not.toHaveBeenCalled();
    expect(documentUpdateMock).not.toHaveBeenCalled();
  });
});

describe("a succeeded delivery makes the document citable", () => {
  it("writes chunks carrying the worker's page numbers, then flips the document", async () => {
    const response = await postOcrCallback(buildRequest(succeededPayload()));
    expect(response.status).toBe(200);

    // (2) The rows, not a summary. A chunk whose page is wrong produces a
    // citation naming the wrong page, and nothing downstream can tell.
    expect(chunkInsertMock).toHaveBeenCalledTimes(1);
    const rows = chunkInsertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.document_id).toBe(JOB_ROW.document_id);
      expect(row.workspace_id).toBe(JOB_ROW.workspace_id);
      expect(typeof row.page_from).toBe("number");
      expect(typeof row.page_to).toBe("number");
    }
    // Page 2 recognised nothing, so no anchor may name it; page 3's text must
    // be reachable under a page-3 anchor.
    const anchors = new Set(rows.flatMap((row) => [row.page_from, row.page_to]));
    expect([...anchors].sort()).toEqual([1, 3]);
    const pageThree = rows.filter((row) => String(row.content).includes("MARKER-THREE"));
    expect(pageThree.length).toBeGreaterThan(0);
    for (const row of pageThree) {
      expect(row.page_to).toBe(3);
    }

    // (1) The document flip: ready, ocr, and the stale parser error cleared.
    expect(documentUpdateMock).toHaveBeenCalledTimes(1);
    const documentPatch = documentUpdateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(documentPatch.status).toBe("ready");
    expect(documentPatch.extraction_source).toBe("ocr");
    expect(documentPatch.page_count).toBe(3);
    expect(documentPatch.chunk_count).toBe(rows.length);
    expect(documentPatch.extraction_error).toBeNull();
    expect(documentUpdateEqMock).toHaveBeenCalledWith("id", JOB_ROW.document_id);

    // The engine that read it is recorded on the job — text recognised with the
    // wrong language pack is the failure a reader cannot see.
    const jobPatch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(jobPatch.status).toBe("succeeded");
    expect(jobPatch.engine_name).toBe("ocrmypdf+tesseract");
    expect(jobPatch.engine_version).toBe("16.4.0");
    expect(jobPatch.languages).toEqual(["eng"]);
    expect(jobPatch.pages_with_text).toBe(2);
  });

  it("indexes the text BEFORE it says the document is readable", async () => {
    const order: string[] = [];
    chunkInsertMock.mockImplementation(async () => {
      order.push("chunks");
      return { error: null };
    });
    documentUpdateEqMock.mockImplementation(async () => {
      order.push("document");
      return { error: null };
    });

    await postOcrCallback(buildRequest(succeededPayload()));
    expect(order).toEqual(["chunks", "document"]);
  });

  it("leaves the document unread when the chunks could not be indexed", async () => {
    chunkInsertMock.mockResolvedValue({ error: { message: "insert exploded" } });

    const response = await postOcrCallback(buildRequest(succeededPayload()));
    expect(response.status).toBe(500);
    // The document must not claim to be readable when its text is not there.
    expect(documentUpdateMock).not.toHaveBeenCalled();
    const jobPatch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(jobPatch.status).toBe("failed");
    expect(String(jobPatch.failure_detail)).toContain("insert exploded");
  });

  it("does not index twice when the document already has chunks", async () => {
    chunkCountMock.mockResolvedValue({ count: 42, error: null });

    const response = await postOcrCallback(buildRequest(succeededPayload()));
    expect(response.status).toBe(200);
    expect(chunkInsertMock).not.toHaveBeenCalled();
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "kb_ocr_chunks_already_present",
      expect.objectContaining({ existingChunks: 42 })
    );
  });

  it("refuses to guess when the existing-chunk count could not be read", async () => {
    // A read that failed is not a document with zero chunks. Continuing would
    // insert a second copy of every excerpt in the document.
    chunkCountMock.mockResolvedValue({ count: null, error: { message: "count failed" } });

    const response = await postOcrCallback(buildRequest(succeededPayload()));
    expect(response.status).toBe(500);
    expect(chunkInsertMock).not.toHaveBeenCalled();
    expect(documentUpdateMock).not.toHaveBeenCalled();
  });
});

describe("idempotency", () => {
  it("dedupes a redelivered callbackId without re-applying anything", async () => {
    ledgerInsertMock.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });

    const response = await postOcrCallback(buildRequest(succeededPayload()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deduped: true });
    // The doubling this prevents produces NO error anywhere: every excerpt in
    // the document would simply appear twice in search from then on.
    expect(chunkInsertMock).not.toHaveBeenCalled();
    expect(documentUpdateMock).not.toHaveBeenCalled();
  });

  it("never walks a terminal job backwards", async () => {
    jobMaybeSingleMock.mockResolvedValue({ data: { ...JOB_ROW, status: "succeeded" }, error: null });

    const response = await postOcrCallback(
      buildRequest(callbackPayload({ status: "failed", callbackId: "ocr-0000000003" }))
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ignored: "terminal" });
    expect(jobUpdateMock).not.toHaveBeenCalled();
    expect(documentUpdateMock).not.toHaveBeenCalled();
    // The delivery is still LEDGERED — the record of what arrived is kept even
    // when the transition is not applied.
    expect(ledgerInsertMock).toHaveBeenCalledTimes(1);
  });

  it("records the delivery's size and page count in the ledger, and not its text", async () => {
    await postOcrCallback(buildRequest(succeededPayload()));
    const ledgerRow = ledgerInsertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(ledgerRow.callback_id).toBe("ocr-0000000002");
    expect(ledgerRow.ocr_job_id).toBe(JOB_ROW.id);
    expect(ledgerRow.workspace_id).toBe(JOB_ROW.workspace_id);
    expect(ledgerRow.page_count).toBe(3);
    expect(ledgerRow.payload_bytes).toBeGreaterThan(0);
    // The pages are the document's own text; a second copy of every scanned
    // plan is not a record, it is a duplicate.
    expect(Object.keys(ledgerRow)).not.toContain("payload");
    expect(JSON.stringify(ledgerRow)).not.toContain("MARKER-THREE");
  });
});

describe("failures stay failures, and say why", () => {
  it("records the worker's reason and leaves the document uncitable", async () => {
    const response = await postOcrCallback(
      buildRequest(
        callbackPayload({
          status: "failed",
          callbackId: "ocr-0000000004",
          message: "this worker has no trained data for spa. It has: eng.",
        })
      )
    );
    expect(response.status).toBe(200);
    expect(documentUpdateMock).not.toHaveBeenCalled();
    const jobPatch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(jobPatch.status).toBe("failed");
    expect(jobPatch.failure_detail).toBe("this worker has no trained data for spa. It has: eng.");
  });

  it("invents a reason for NOTHING, but never leaves the reason empty", async () => {
    // A crashed run that read as benign is a defect this repository has paid
    // for. A failure with no message gets a sentence that says the worker did
    // not say why — never a cause nobody reported.
    const response = await postOcrCallback(
      buildRequest(callbackPayload({ status: "failed", callbackId: "ocr-0000000005" }))
    );
    expect(response.status).toBe(200);
    const jobPatch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(jobPatch.failure_detail).toBe(
      "The OCR service reported a failure without saying why."
    );
  });

  it("treats a canceled delivery as 'the text is not coming'", async () => {
    const response = await postOcrCallback(
      buildRequest(callbackPayload({ status: "canceled", callbackId: "ocr-0000000006" }))
    );
    expect(response.status).toBe(200);
    const jobPatch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(jobPatch.status).toBe("failed");
    expect(String(jobPatch.failure_detail)).toContain("cancelled");
  });

  it("refuses to call an all-blank result a success", async () => {
    // The recogniser ran and found nothing — a real outcome for a photocopy of
    // a photocopy. Flipping the document to `ready` with zero chunks would read
    // everywhere as "indexed" and would silently make it searchable-and-empty.
    const response = await postOcrCallback(
      buildRequest(
        succeededPayload({
          callbackId: "ocr-0000000007",
          pages: [
            { page: 1, text: "" },
            { page: 2, text: "   " },
          ],
        })
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "failed", reason: "no_text_recognised" });
    expect(chunkInsertMock).not.toHaveBeenCalled();
    expect(documentUpdateMock).not.toHaveBeenCalled();
    const jobPatch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(jobPatch.status).toBe("failed");
    expect(String(jobPatch.failure_detail)).toContain("recognised no text");
  });

  it("advances a running delivery without touching the document", async () => {
    const response = await postOcrCallback(
      buildRequest(callbackPayload({ progress: 40, message: "Recognising 212 pages (eng)" }))
    );
    expect(response.status).toBe(200);
    expect(documentUpdateMock).not.toHaveBeenCalled();
    const jobPatch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(jobPatch.status).toBe("running");
    expect(jobPatch.progress).toBe(40);
  });
});
