import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Asking this deployment's OCR service to read a scanned document.
 *
 * THE ONE THING THIS ROUTE MUST NEVER DO is claim a capability the deployment
 * does not have. Everything else here is ordinary write-route discipline —
 * membership from the caller's own read, viewers refused, a read failure
 * refusing rather than guessing, the job row written before dispatch — but the
 * refusal wording is the part a planner meets, and it has to name OCR and say
 * whether this deployment has it. "Not supported" would be a lie about a
 * capability their own agency could turn on in ten minutes.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const fetchMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const documentMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const activeJobMaybeSingleMock = vi.fn();
const jobInsertSingleMock = vi.fn();
const jobInsertMock = vi.fn();
const jobUpdateEqMock = vi.fn();
const jobUpdateMock = vi.fn();
const createSignedUrlMock = vi.fn();

const rlsFromMock = vi.fn((table: string) => {
  if (table === "kb_documents") {
    return { select: () => ({ eq: () => ({ maybeSingle: documentMaybeSingleMock }) }) };
  }
  if (table === "workspace_members") {
    return {
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }),
    };
  }
  if (table === "kb_ocr_jobs") {
    return {
      select: () => ({
        eq: () => ({ in: () => ({ limit: () => ({ maybeSingle: activeJobMaybeSingleMock }) }) }),
      }),
    };
  }
  throw new Error(`Unexpected RLS table: ${table}`);
});

const serviceFromMock = vi.fn((table: string) => {
  if (table === "kb_ocr_jobs") {
    return { insert: jobInsertMock, update: jobUpdateMock };
  }
  throw new Error(`Unexpected service table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postOcrRequest } from "@/app/api/knowledge-base/documents/[documentId]/ocr/route";

const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const SCANNED_DOCUMENT = {
  id: DOCUMENT_ID,
  workspace_id: WORKSPACE_ID,
  project_id: null,
  title: "2018 Regional Transportation Plan",
  original_filename: "2018-rtp.pdf",
  byte_size: 48210444,
  checksum: "a".repeat(64),
  storage_ref: `storage://kb-documents/${WORKSPACE_ID}/${DOCUMENT_ID}/2018-rtp.pdf`,
  source_kind: "uploaded_pdf",
  status: "failed",
  extraction_source: null,
};

function acceptedBody() {
  return {
    schemaVersion: "openplan-ocr-extraction.v1",
    requestId: "unused-echo",
    callbackId: "ocr-abcdef0123456789",
    jobReference: "ocr-job-77",
    status: "accepted",
    occurredAt: "2026-08-11T12:00:00Z",
  };
}

function context() {
  return { params: Promise.resolve({ documentId: DOCUMENT_ID }) };
}

function buildRequest() {
  return new NextRequest(
    `https://app.example.com/api/knowledge-base/documents/${DOCUMENT_ID}/ocr`,
    { method: "POST" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);

  process.env.OPENPLAN_KB_OCR_WORKER_URL = "http://localhost:8585";
  process.env.OPENPLAN_KB_OCR_WORKER_TOKEN = "worker-secret";
  process.env.OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN = "callback-secret";
  delete process.env.OPENPLAN_KB_OCR_CALLBACK_URL;
  delete process.env.OPENPLAN_KB_OCR_LANGUAGES;
  delete process.env.OPENPLAN_KB_OCR_CALLBACK_MAX_BYTES;

  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: rlsFromMock,
  });
  createServiceRoleClientMock.mockReturnValue({
    from: serviceFromMock,
    storage: { from: () => ({ createSignedUrl: createSignedUrlMock }) },
  });

  documentMaybeSingleMock.mockResolvedValue({ data: { ...SCANNED_DOCUMENT }, error: null });
  membershipMaybeSingleMock.mockResolvedValue({ data: { role: "editor" }, error: null });
  activeJobMaybeSingleMock.mockResolvedValue({ data: null, error: null });
  jobInsertSingleMock.mockResolvedValue({ data: { id: "job-row-1" }, error: null });
  jobInsertMock.mockReturnValue({ select: () => ({ single: jobInsertSingleMock }) });
  jobUpdateEqMock.mockResolvedValue({ error: null });
  jobUpdateMock.mockReturnValue({ eq: jobUpdateEqMock });
  createSignedUrlMock.mockResolvedValue({
    data: { signedUrl: "https://storage.example.com/signed/plan.pdf?token=x" },
    error: null,
  });
  fetchMock.mockResolvedValue({
    status: 202,
    json: async () => acceptedBody(),
    text: async () => "",
  });
});

describe("a deployment with no OCR service says so, by name", () => {
  it.each([
    ["OPENPLAN_KB_OCR_WORKER_URL"],
    ["OPENPLAN_KB_OCR_WORKER_TOKEN"],
    ["OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN"],
  ])("refuses with 501 when %s is unset, and names it", async (variable) => {
    delete process.env[variable];

    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(501);
    const payload = (await response.json()) as {
      capability: string;
      detail: string;
      missingEnvironmentVariables: string[];
    };

    expect(payload.capability).toBe("ocr");
    expect(payload.missingEnvironmentVariables).toContain(variable);
    // The sentence a planner reads names OCR and says THIS deployment lacks it.
    expect(payload.detail).toContain("OCR service");
    expect(payload.detail.toLowerCase()).toContain("this deployment");
    // And nothing was invented: no job row, no dispatch.
    expect(jobInsertMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a URL with no token as unconfigured, not as configured", async () => {
    // A half-configured deployment must not offer the capability: the request
    // would fail at the worker with a 401 nobody could interpret.
    delete process.env.OPENPLAN_KB_OCR_WORKER_TOKEN;
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(501);
  });
});

describe("who may ask, and for what", () => {
  it("refuses an unauthenticated caller", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: rlsFromMock,
    });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(401);
  });

  it("answers 404 for a document the caller cannot see", async () => {
    // kb_documents SELECT is member-scoped, so a miss through the caller's own
    // client means "not yours" — 404, never 403, which would confirm it exists.
    documentMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(404);
    expect(jobInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a viewer", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the role could not be read — neither 403 nor a dispatch", async () => {
    // A read that failed established no role. Dispatching would spend the
    // machine's cores on a permission check that never ran; 403 would assert a
    // viewer role nobody read either.
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(500);
    expect(String((await response.json()).error)).toContain("could not confirm your role");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a document that is not a scanned PDF", async () => {
    documentMaybeSingleMock.mockResolvedValue({
      data: { ...SCANNED_DOCUMENT, source_kind: "uploaded_image", status: "stored" },
      error: null,
    });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("not_a_scanned_pdf");
  });

  it("refuses a document that is already readable", async () => {
    documentMaybeSingleMock.mockResolvedValue({
      data: { ...SCANNED_DOCUMENT, status: "ready", extraction_source: "text_layer" },
      error: null,
    });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(409);
    expect((await response.json()).detail).toContain("already has a text layer");
  });

  it("refuses a second job while one is running", async () => {
    activeJobMaybeSingleMock.mockResolvedValue({
      data: { id: "j", request_id: "req-1", status: "running" },
      error: null,
    });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("ocr_already_running");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the active-job check itself failed", async () => {
    // A failed read is not an idle document. Continuing would dispatch a second
    // job for a document already being read and pay for the same pages twice.
    activeJobMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("ocr_job_state_unreadable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a storage_ref pointing outside the document's own prefix", async () => {
    documentMaybeSingleMock.mockResolvedValue({
      data: {
        ...SCANNED_DOCUMENT,
        storage_ref: "storage://kb-documents/some-other-workspace/other-doc/secret.pdf",
      },
      error: null,
    });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });
});

describe("the dispatch", () => {
  it("records the job before calling the worker, then marks it running", async () => {
    const order: string[] = [];
    jobInsertSingleMock.mockImplementation(async () => {
      order.push("insert");
      return { data: { id: "job-row-1" }, error: null };
    });
    fetchMock.mockImplementation(async () => {
      order.push("dispatch");
      return { status: 202, json: async () => acceptedBody(), text: async () => "" };
    });

    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(202);
    // A crash between the two must not orphan an accepted worker job: the
    // callback route resolves the document from request_id via this row.
    expect(order).toEqual(["insert", "dispatch"]);

    const inserted = jobInsertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.status).toBe("queued");
    expect(inserted.document_id).toBe(DOCUMENT_ID);
    expect(inserted.workspace_id).toBe(WORKSPACE_ID);
    expect(inserted.requested_by).toBe("user-1");
    expect(inserted.languages).toEqual(["eng"]);

    const patch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(patch.status).toBe("running");
    expect(patch.worker_job_id).toBe("ocr-job-77");
  });

  it("sends the contract's request shape, with the signed link and the ceiling", async () => {
    await postOcrRequest(buildRequest(), context());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8585/api/v1/ocr-requests");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer worker-secret");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.schemaVersion).toBe("openplan-ocr-extraction.v1");
    expect((body.source as Record<string, unknown>).url).toBe(
      "https://storage.example.com/signed/plan.pdf?token=x"
    );
    // The checksum travels so the worker can refuse a corrupted download rather
    // than recognising text nobody could distrust.
    expect((body.source as Record<string, unknown>).checksumSha256).toBe("a".repeat(64));
    // The worker measures its result against this before sending, so an
    // oversized document fails with both numbers instead of a 413 loop.
    expect(body.maxCallbackBytes).toBe(4 * 1024 * 1024);
    expect(body.callbackUrl).toBe("https://app.example.com/api/knowledge-base/ocr-callback");
    // request_id is the idempotency key BOTH sides use; it must be the one
    // stored on the row, or no callback could ever find its job.
    const inserted = jobInsertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body.requestId).toBe(inserted.request_id);
  });

  it("asks for the languages this deployment configured, not English by assumption", async () => {
    // A Spanish plan read with the English model comes back looking exactly
    // like text and saying nothing. The operator's setting has to reach the
    // wire, so this varies the binding rather than asserting the default twice.
    process.env.OPENPLAN_KB_OCR_LANGUAGES = "spa, eng";
    await postOcrRequest(buildRequest(), context());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body.languages).toEqual(["spa", "eng"]);
    expect((jobInsertMock.mock.calls[0][0] as Record<string, unknown>).languages).toEqual([
      "spa",
      "eng",
    ]);
  });

  it("honours the operator's callback ceiling on the wire", async () => {
    process.env.OPENPLAN_KB_OCR_CALLBACK_MAX_BYTES = "33554432";
    await postOcrRequest(buildRequest(), context());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(body.maxCallbackBytes).toBe(33554432);
  });

  it("marks the job failed with the reason when the worker cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(502);
    const patch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(patch.status).toBe("failed");
    expect(String(patch.failure_detail)).toContain("ECONNREFUSED");
  });

  it("marks the job failed when the worker's answer is not the contract's", async () => {
    fetchMock.mockResolvedValue({
      status: 202,
      json: async () => ({ ok: true }),
      text: async () => "",
    });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(502);
    const patch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(patch.status).toBe("failed");
    expect(String(patch.failure_detail)).toContain("extraction contract");
  });

  it("marks the job failed when the worker refuses the request", async () => {
    fetchMock.mockResolvedValue({
      status: 503,
      json: async () => ({}),
      text: async () => '{"error":"queue_full"}',
    });
    const response = await postOcrRequest(buildRequest(), context());
    expect(response.status).toBe(502);
    const patch = jobUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(String(patch.failure_detail)).toContain("queue_full");
  });
});
