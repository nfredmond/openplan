import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE RUN ROUTE — reading an adopted plan into staged proposals.
 *
 * WHAT THESE TESTS ARE FOR, in the order the mistakes would hurt:
 *
 * 1. THE PROMPT MUST NEVER SEE THE DATABASE. The route reads the cycle's
 *    horizon bands, because the VERIFIER resolves a quoted period label against
 *    them. That read is one refactor away from becoming "for context, here is
 *    what is already recorded", and the result would be a figure that left
 *    OpenPlan and came back wearing a page citation. So the workspace below is
 *    seeded with sentinel ledger rows and every prompt is searched for them.
 *
 * 2. A HALLUCINATED FIGURE MUST STAGE NOTHING. Asserted at the unit level in
 *    rtp-extraction-verify.test.ts, and asserted again HERE against the real
 *    route, because a route that stored `outcome.discarded` "so the planner can
 *    see them" would pass every verifier test and break the feature.
 *
 * 3. A FAILED RUN MUST NOT READ AS "RECORDED". The 2026-08-10 modeling defect.
 *
 * 4. SPEND IS METERED PER MODEL CALL. A three-hundred-page plan is many calls.
 *
 * WHY THE HARNESS MODELS FILTERS. Following rtp-financial-assumptions-route's
 * fake: rows live in tables and recorded `.eq()` / `.range()` filters are
 * APPLIED, so deleting a scoping filter changes what the route sees and the
 * assertions move. A mock that returned its fixture whatever was asked could
 * not tell "the route scoped the query" from "the route got lucky".
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const generateTextMock = vi.fn();
const hasAnthropicAccessMock = vi.fn();
const checkAiUsageRateLimitMock = vi.fn();
const recordAiUsageEventMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const CYCLE_ID = "44444444-4444-4444-8444-444444444444";
const FOREIGN_CYCLE_ID = "55555555-5555-4555-8555-555555555555";
const DOCUMENT_ID = "66666666-6666-4666-8666-666666666666";
const FOREIGN_DOCUMENT_ID = "77777777-7777-4777-8777-777777777777";
const CHUNK_ONE = "88888888-8888-4888-8888-888888888888";
const CHUNK_SPANNING = "99999999-9999-4999-8999-999999999999";
const BAND_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Values that exist ONLY in this workspace's already-recorded RTP rows. If any
 * of them ever appears in a prompt, a figure has travelled out of the database
 * and is about to come back labelled "transcribed from p.112".
 */
const SENTINEL_SOURCE = "SENTINEL-LEDGER-SOURCE-DO-NOT-LEAK";
const SENTINEL_BAND_LABEL = "SENTINEL-BAND-LABEL-DO-NOT-LEAK";
const SENTINEL_AMOUNT = 999888777;

/** The page the fixture document really has. */
const PAGE_112 =
  "Table 5-2. Reasonably Available Revenues, 2023-2032. " +
  "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars). " +
  "Operations and maintenance is estimated at $145,300,000 over the same period.";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), requestId: "test" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@/lib/integrations/anthropic-access", () => ({
  hasAnthropicAccess: () => hasAnthropicAccessMock(),
  anthropicModel: (modelId: string) => ({ modelId }),
}));

vi.mock("@/lib/integrations/workspace-keys", () => ({
  withWorkspaceIntegrationContext: async (_workspaceId: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/runtime/ai-rate-limit", () => ({
  checkAiUsageRateLimit: (...args: unknown[]) => checkAiUsageRateLimitMock(...args),
  recordAiUsageEvent: (...args: unknown[]) => recordAiUsageEventMock(...args),
}));

import {
  GET as listRuns,
  POST as createRun,
} from "@/app/api/rtp-cycles/[rtpCycleId]/extraction-runs/route";

// ---------------------------------------------------------------------------
// A tiny in-memory PostgREST: rows in tables, filters that filter, ranges that
// range.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type QueryError = { message: string; code?: string } | null;
type Filter = { column: string; value: unknown };
type Operation = "select" | "insert" | "update" | "delete";

let tables: Record<string, Row[]> = {};
let tableFailures: Record<string, QueryError> = {};
/** Fail ONE operation on one table — an insert that works and an update that does not. */
let operationFailures: Record<string, Partial<Record<Operation, QueryError>>> = {};
let writes: Array<{ table: string; operation: Operation; values: Row[] | null; filters: Filter[] }> = [];
let insertedIdCounter = 0;

function makeChain(table: string) {
  const filters: Filter[] = [];
  let operation: Operation = "select";
  let payload: Row[] | null = null;
  let range: { from: number; to: number } | null = null;
  let limit: number | null = null;
  let memo: { data: Row[]; error: QueryError } | null = null;

  const rowsOf = () => (tables[table] ??= []);

  function run(): { data: Row[]; error: QueryError } {
    if (memo) return memo;

    const failure = tableFailures[table] ?? operationFailures[table]?.[operation] ?? null;
    if (failure) {
      memo = { data: [], error: failure };
      return memo;
    }

    if (operation === "insert") {
      const inserted = (payload ?? []).map((values) => ({
        id: values.id ?? `inserted-${(insertedIdCounter += 1)}`,
        created_at: "2026-08-11T00:00:00.000Z",
        ...values,
      }));
      rowsOf().push(...inserted);
      writes.push({ table, operation, values: (payload ?? []).map((v) => ({ ...v })), filters: [...filters] });
      memo = { data: inserted, error: null };
      return memo;
    }

    let matched = rowsOf().filter((row) => filters.every((f) => row[f.column] === f.value));

    if (operation === "update") {
      writes.push({ table, operation, values: (payload ?? []).map((v) => ({ ...v })), filters: [...filters] });
      for (const row of matched) Object.assign(row, payload?.[0] ?? {});
      memo = { data: matched, error: null };
      return memo;
    }

    if (operation === "delete") {
      writes.push({ table, operation, values: null, filters: [...filters] });
      tables[table] = rowsOf().filter((row) => !matched.includes(row));
      memo = { data: matched, error: null };
      return memo;
    }

    if (range) matched = matched.slice(range.from, range.to + 1);
    if (limit !== null) matched = matched.slice(0, limit);
    memo = { data: matched, error: null };
    return memo;
  }

  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((column: string, value: unknown) => {
    filters.push({ column, value });
    return chain;
  });
  chain.insert = vi.fn((values: Row | Row[]) => {
    operation = "insert";
    payload = Array.isArray(values) ? values : [values];
    return chain;
  });
  chain.update = vi.fn((values: Row) => {
    operation = "update";
    payload = [values];
    return chain;
  });
  chain.delete = vi.fn(() => {
    operation = "delete";
    return chain;
  });
  chain.range = vi.fn((from: number, to: number) => {
    range = { from, to };
    return chain;
  });
  chain.limit = vi.fn((value: number) => {
    limit = value;
    return chain;
  });
  for (const method of ["order", "in", "is", "not", "filter", "match"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => {
    const result = run();
    if (result.error) return { data: null, error: result.error };
    return { data: result.data[0] ?? null, error: null };
  });
  chain.single = vi.fn(async () => {
    const result = run();
    if (result.error) return { data: null, error: result.error };
    if (result.data.length === 0) {
      return { data: null, error: { code: "PGRST116", message: "no rows returned" } };
    }
    return { data: result.data[0], error: null };
  });
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(run()).then(onFulfilled, onRejected);
  return chain;
}

function installClients() {
  const client = { auth: { getUser: authGetUserMock }, from: vi.fn((table: string) => makeChain(table)) };
  createClientMock.mockResolvedValue(client);
  createServiceRoleClientMock.mockReturnValue({ from: vi.fn((table: string) => makeChain(table)) });
}

type SeedOptions = {
  role?: string;
  documentStatus?: string;
  documentSourceKind?: string;
  documentExtractionSource?: string | null;
  documentExtractionError?: string | null;
  chunks?: Row[];
  priorSucceededRun?: boolean;
};

function seed(options: SeedOptions = {}) {
  tables = {
    workspace_members: [
      {
        user_id: USER_ID,
        workspace_id: WORKSPACE_ID,
        role: options.role ?? "admin",
        workspaces: { name: "Regional Agency", created_at: "2026-01-01T00:00:00.000Z" },
      },
    ],
    rtp_cycles: [
      { id: CYCLE_ID, workspace_id: WORKSPACE_ID, title: "2026 Regional Transportation Plan" },
      { id: FOREIGN_CYCLE_ID, workspace_id: OTHER_WORKSPACE_ID, title: "Another agency's plan" },
    ],
    kb_documents: [
      {
        id: DOCUMENT_ID,
        workspace_id: WORKSPACE_ID,
        title: "2020 Regional Transportation Plan (adopted)",
        doc_kind: "rtp",
        source_kind: options.documentSourceKind ?? "uploaded_pdf",
        status: options.documentStatus ?? "ready",
        extraction_source:
          options.documentExtractionSource === undefined
            ? "text_layer"
            : options.documentExtractionSource,
        extraction_error: options.documentExtractionError ?? null,
        chunk_count: 2,
        page_count: 300,
      },
      {
        id: FOREIGN_DOCUMENT_ID,
        workspace_id: OTHER_WORKSPACE_ID,
        title: "Another agency's plan",
        doc_kind: "rtp",
        source_kind: "uploaded_pdf",
        status: "ready",
        extraction_source: "text_layer",
        extraction_error: null,
        chunk_count: 1,
        page_count: 10,
      },
    ],
    kb_document_chunks: options.chunks ?? [
      {
        id: CHUNK_ONE,
        document_id: DOCUMENT_ID,
        workspace_id: WORKSPACE_ID,
        chunk_index: 0,
        page_from: 112,
        page_to: 112,
        content: PAGE_112,
      },
      {
        id: CHUNK_SPANNING,
        document_id: DOCUMENT_ID,
        workspace_id: WORKSPACE_ID,
        chunk_index: 1,
        page_from: 113,
        page_to: 114,
        content: "Revenue continues: Federal Formula Funds    $50,000,000.",
      },
    ],
    // ALREADY RECORDED in this cycle. None of it may reach a prompt.
    rtp_horizon_bands: [
      { id: BAND_ID, workspace_id: WORKSPACE_ID, rtp_cycle_id: CYCLE_ID, label: SENTINEL_BAND_LABEL },
    ],
    rtp_financial_assumptions: [
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        workspace_id: WORKSPACE_ID,
        rtp_cycle_id: CYCLE_ID,
        horizon_band_id: BAND_ID,
        entry_kind: "revenue",
        source_name: SENTINEL_SOURCE,
        amount: SENTINEL_AMOUNT,
      },
    ],
    rtp_extraction_runs: options.priorSucceededRun
      ? [
          {
            id: RUN_ID,
            workspace_id: WORKSPACE_ID,
            rtp_cycle_id: CYCLE_ID,
            kb_document_id: DOCUMENT_ID,
            status: "succeeded",
            created_at: "2026-08-10T00:00:00.000Z",
          },
        ]
      : [],
    rtp_extraction_candidates: [],
  };
  tableFailures = {};
  operationFailures = {};
}

function request(body: unknown, cycleId = CYCLE_ID) {
  return new NextRequest(`http://localhost/api/rtp-cycles/${cycleId}/extraction-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(cycleId = CYCLE_ID) {
  return { params: Promise.resolve({ rtpCycleId: cycleId }) };
}

/** Answer every model call with the same JSON payload. */
function answerWith(candidates: unknown[]) {
  generateTextMock.mockResolvedValue({ text: JSON.stringify({ candidates }) });
}

const TRUE_REVENUE_CANDIDATE = {
  target_kind: "financial_line",
  fields: {
    entryKind: "revenue",
    sourceName: "Local Transportation Sales Tax Measure R",
    amount: 412000000,
    amountBasisYear: 2024,
  },
  source_chunk_id: `chunk_${CHUNK_ONE}`,
  page: 112,
  quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
};

const prompts = () =>
  generateTextMock.mock.calls.map((call) => {
    const args = call[0] as { system: string; prompt: string };
    return `${args.system}\n${args.prompt}`;
  });

const stagedCandidateWrites = () =>
  writes.filter((write) => write.table === "rtp_extraction_candidates" && write.operation === "insert");

const runUpdates = () =>
  writes.filter((write) => write.table === "rtp_extraction_runs" && write.operation === "update");

beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  insertedIdCounter = 0;
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  hasAnthropicAccessMock.mockReturnValue(true);
  checkAiUsageRateLimitMock.mockResolvedValue({ allowed: true, count: 0, retryAfterSeconds: 0 });
  recordAiUsageEventMock.mockResolvedValue(undefined);
  answerWith([]);
  seed();
  installClients();
});

afterEach(() => {
  delete process.env.OPENPLAN_KB_OCR_WORKER_URL;
  delete process.env.OPENPLAN_KB_OCR_WORKER_TOKEN;
});

describe("the prompt is blind to what the plan already records", () => {
  it("sends the document's pages and none of the cycle's own rows", async () => {
    answerWith([TRUE_REVENUE_CANDIDATE]);

    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );

    expect(response.status).toBe(201);
    expect(prompts().length).toBeGreaterThan(0);

    for (const prompt of prompts()) {
      expect(prompt).toContain("Local Transportation Sales Tax Measure R");
      // The three things that exist only in the database.
      expect(prompt).not.toContain(SENTINEL_SOURCE);
      expect(prompt).not.toContain(SENTINEL_BAND_LABEL);
      expect(prompt).not.toContain(String(SENTINEL_AMOUNT));
      expect(prompt).not.toContain(BAND_ID);
      expect(prompt).not.toContain(CYCLE_ID);
    }
  });

  it("still uses those bands for label resolution, which is why the seal matters", async () => {
    // The bands ARE read. Proving the verifier receives them is what makes the
    // assertion above a seal on a real leak path rather than a tautology about
    // data nobody loaded.
    answerWith([
      {
        target_kind: "financial_line",
        fields: {
          entryKind: "revenue",
          sourceName: "Local Transportation Sales Tax Measure R",
          amount: 412000000,
          horizonBandLabel: SENTINEL_BAND_LABEL,
        },
        source_chunk_id: `chunk_${CHUNK_ONE}`,
        page: 112,
        quote: "Local Transportation Sales Tax Measure R    $412,000,000    (2024 dollars)",
      },
    ]);

    await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );

    // The label is not in the quote, so the candidate is discarded — the band
    // was available to resolve against and the text rule still refused it.
    expect(stagedCandidateWrites()).toEqual([]);
    const update = runUpdates().at(-1);
    expect(update?.values?.[0]).toMatchObject({ status: "succeeded", discarded_count: 1 });
  });
});

describe("a hallucinated figure stages nothing", () => {
  it("stores zero candidates and counts the discard on the run", async () => {
    answerWith([
      {
        ...TRUE_REVENUE_CANDIDATE,
        fields: { ...TRUE_REVENUE_CANDIDATE.fields, amount: 421000000 },
      },
    ]);

    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(stagedCandidateWrites()).toEqual([]);
    expect(body.candidates).toEqual([]);
    expect(body.summary.proposed).toBe(0);
    expect(body.summary.discarded).toBe(1);
    expect(body.summary.discardsByReason).toEqual({ figure_not_in_quote: 1 });
    expect(runUpdates().at(-1)?.values?.[0]).toMatchObject({
      status: "succeeded",
      candidate_count: 0,
      discarded_count: 1,
    });
  });

  it("stages the true figure with the page from the chunk and quote_verified true", async () => {
    // The negative control for the test above. Without it, a route that staged
    // nothing at all would pass every hallucination assertion in this file.
    answerWith([{ ...TRUE_REVENUE_CANDIDATE, page: 9999 }]);

    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    const staged = stagedCandidateWrites();
    expect(staged).toHaveLength(1);
    expect(staged[0].values).toHaveLength(1);
    expect(staged[0].values![0]).toMatchObject({
      workspace_id: WORKSPACE_ID,
      rtp_cycle_id: CYCLE_ID,
      target_kind: "financial_line",
      // THE MODEL SAID 9999. The chunk says 112.
      source_page: 112,
      quote_verified: true,
      status: "pending",
    });
    expect(staged[0].values![0].source_quote).toContain("$412,000,000");
    expect(body.summary.proposed).toBe(1);
  });

  it("never stores a candidate the verifier discarded, even as a rejected row", async () => {
    answerWith([
      TRUE_REVENUE_CANDIDATE,
      { ...TRUE_REVENUE_CANDIDATE, fields: { ...TRUE_REVENUE_CANDIDATE.fields, amount: 1 } },
    ]);

    await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );

    const staged = stagedCandidateWrites();
    expect(staged).toHaveLength(1);
    expect(staged[0].values).toHaveLength(1);
    for (const row of staged[0].values ?? []) {
      expect(row.quote_verified).toBe(true);
    }
  });

  it("stores no confidence column, whatever the model volunteered", async () => {
    answerWith([{ ...TRUE_REVENUE_CANDIDATE, confidence: 0.98 }]);

    await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );

    const row = stagedCandidateWrites()[0]?.values?.[0] ?? {};
    expect(JSON.stringify(row)).not.toMatch(/confiden|certain|likelihood/i);
  });
});

describe("a failed run says so", () => {
  it("answers 502, marks the run failed with a NAMED reason, and stages nothing", async () => {
    generateTextMock.mockRejectedValue(new Error("upstream 529"));

    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.reason).toBe("model_error");
    expect(body.error).toMatch(/did not answer/i);
    expect(body.candidates).toEqual([]);
    expect(stagedCandidateWrites()).toEqual([]);

    const update = runUpdates().at(-1)?.values?.[0];
    expect(update).toMatchObject({ status: "failed" });
    expect(String(update?.failure_reason)).toMatch(/did not answer/i);
  });

  it("records it by name when even the failure could not be written down", async () => {
    // A run stuck at 'running' because the marking itself failed reads as still
    // working, forever. The caller learns the truth from the 502; the operator
    // learns it from this log line, and it must not be swallowed.
    generateTextMock.mockRejectedValue(new Error("upstream 529"));
    operationFailures.rtp_extraction_runs = { update: { message: "connection reset" } };

    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );

    expect(response.status).toBe(502);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "extraction_run_failure_not_recorded",
      expect.objectContaining({ message: "connection reset" })
    );
  });

  it("fails rather than falling back when the answer is not JSON", async () => {
    // There is no honest offline answer to "what does page 112 say". A
    // deterministic fallback here would be a half-read plan presented as a
    // finished one.
    generateTextMock.mockResolvedValue({ text: "I could not find any revenue figures." });

    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.reason).toBe("unreadable_model_answer");
    expect(stagedCandidateWrites()).toEqual([]);
  });

  it("does not answer 201 when the run could not be marked finished", async () => {
    // The proposals ARE stored; the run row still says 'running'. A 201 here
    // would show a finished-looking result over a record that contradicts it,
    // and the review header's counts would be zero on a run that produced
    // neither number.
    answerWith([TRUE_REVENUE_CANDIDATE]);
    operationFailures.rtp_extraction_runs = { update: { message: "connection reset" } };

    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/could not be marked finished/i);
    // The candidates really were written — this is a disclosure, not a rollback.
    expect(stagedCandidateWrites()).toHaveLength(1);
  });

  it("treats an explicitly empty answer as a succeeded run with nothing found", async () => {
    answerWith([]);

    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.summary.proposed).toBe(0);
    expect(runUpdates().at(-1)?.values?.[0]).toMatchObject({ status: "succeeded" });
  });
});

describe("it refuses by name when the document cannot be read", () => {
  it("names OCR and says this deployment has no worker", async () => {
    seed({
      documentStatus: "failed",
      documentExtractionError: "No extractable text layer was found in this PDF. OCR is not enabled.",
    });
    installClients();

    const response = await createRun(request({ kbDocumentId: DOCUMENT_ID }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.reason).toBe("document_needs_ocr");
    expect(body.ocrWorkerConfigured).toBe(false);
    expect(body.error).toMatch(/OCR service, which this deployment does not have/i);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("names OCR and says it can be run when this deployment HAS a worker", async () => {
    process.env.OPENPLAN_KB_OCR_WORKER_URL = "http://localhost:9000";
    process.env.OPENPLAN_KB_OCR_WORKER_TOKEN = "token";
    seed({
      documentStatus: "failed",
      documentExtractionError: "No extractable text layer was found in this PDF. OCR is not enabled.",
    });
    installClients();

    const response = await createRun(request({ kbDocumentId: DOCUMENT_ID }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ocrWorkerConfigured).toBe(true);
    expect(body.error).toMatch(/It can be read with OCR/i);
  });

  it("refuses a stored-only document with the reason it has no pages", async () => {
    seed({ documentStatus: "stored", documentExtractionSource: "none" });
    installClients();

    const response = await createRun(request({ kbDocumentId: DOCUMENT_ID }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/no text was extracted/i);
  });

  it("refuses pasted text, which has no page to cite", async () => {
    seed({ documentSourceKind: "pasted_text", documentExtractionSource: "pasted" });
    installClients();

    const response = await createRun(request({ kbDocumentId: DOCUMENT_ID }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.reason).toBe("no_page_anchor");
    expect(body.error).toMatch(/no pages to cite/i);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("says the AI is offline honestly rather than producing an empty run", async () => {
    hasAnthropicAccessMock.mockReturnValue(false);

    const response = await createRun(request({ kbDocumentId: DOCUMENT_ID }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.reason).toBe("ai_offline");
    expect(body.error).toMatch(/Anthropic API key/i);
    // Nothing was recorded, because nothing happened.
    expect(writes.filter((w) => w.table === "rtp_extraction_runs")).toEqual([]);
  });
});

describe("scoping", () => {
  it("does not find another workspace's cycle", async () => {
    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID }, FOREIGN_CYCLE_ID),
      routeContext(FOREIGN_CYCLE_ID)
    );
    expect(response.status).toBe(404);
  });

  it("does not find another workspace's document", async () => {
    const response = await createRun(request({ kbDocumentId: FOREIGN_DOCUMENT_ID }), routeContext());
    expect(response.status).toBe(404);
  });

  it("refuses a viewer", async () => {
    seed({ role: "viewer" });
    installClients();
    const response = await createRun(request({ kbDocumentId: DOCUMENT_ID }), routeContext());
    expect(response.status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const response = await createRun(request({ kbDocumentId: DOCUMENT_ID }), routeContext());
    expect(response.status).toBe(401);
  });
});

describe("reads that FAILED are not reported as empty", () => {
  it("refuses when the document's pages could not be read", async () => {
    tableFailures.kb_document_chunks = { message: "connection reset" };

    const response = await createRun(request({ kbDocumentId: DOCUMENT_ID }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).toMatch(/read failure, not an empty result/i);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("refuses when the plan's periods could not be read", async () => {
    // An unreadable band list would silently make every quoted period label
    // unresolvable, and the planner would be told the plan named no periods.
    tableFailures.rtp_horizon_bands = { message: "connection reset" };

    const response = await createRun(request({ kbDocumentId: DOCUMENT_ID }), routeContext());
    expect(response.status).toBe(500);
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});

describe("spend is metered per model call", () => {
  it("records one usage event for each call, not one for the run", async () => {
    answerWith([]);

    await createRun(
      request({
        kbDocumentId: DOCUMENT_ID,
        targetKinds: ["financial_line", "performance_measure", "horizon_band"],
      }),
      routeContext()
    );

    // The fixture page matches the terms of more than one kind, so more than
    // one call happens — and the counts must agree.
    expect(generateTextMock.mock.calls.length).toBeGreaterThan(1);
    expect(recordAiUsageEventMock).toHaveBeenCalledTimes(generateTextMock.mock.calls.length);
    for (const call of recordAiUsageEventMock.mock.calls) {
      expect(call[0]).toMatchObject({
        workspaceId: WORKSPACE_ID,
        bucketKey: "rtp_document_extraction",
      });
    }
  });

  it("429s without calling the model when the workspace is over its window", async () => {
    checkAiUsageRateLimitMock.mockResolvedValue({ allowed: false, count: 40, retryAfterSeconds: 300 });

    const response = await createRun(request({ kbDocumentId: DOCUMENT_ID }), routeContext());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});

describe("what the run discloses", () => {
  it("reports the passages it could not cite, and why, in words", async () => {
    answerWith([]);

    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );
    const body = await response.json();

    expect(body.disclosures.passagesIndexed).toBe(2);
    expect(body.disclosures.passagesCitable).toBe(1);
    expect(body.disclosures.passagesNotCitable).toEqual({ spans_pages: 1 });
    expect(body.disclosures.passagesNotCitableReasons.spans_pages).toMatch(/page break/i);
  });

  it("warns, without blocking, when this document was already read into this plan", async () => {
    seed({ priorSucceededRun: true });
    installClients();
    answerWith([]);

    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.warning).toMatch(/already been read into this plan/i);
  });

  it("says nothing about a prior run when there is none", async () => {
    answerWith([]);
    const response = await createRun(
      request({ kbDocumentId: DOCUMENT_ID, targetKinds: ["financial_line"] }),
      routeContext()
    );
    expect((await response.json()).warning).toBeNull();
  });
});

describe("GET lists this plan's readings", () => {
  it("returns the runs recorded for the cycle", async () => {
    seed({ priorSucceededRun: true });
    installClients();

    const response = await listRuns(
      new NextRequest(`http://localhost/api/rtp-cycles/${CYCLE_ID}/extraction-runs`),
      routeContext()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe(RUN_ID);
  });

  it("does not report a failed list as an empty one", async () => {
    tableFailures.rtp_extraction_runs = { message: "connection reset" };

    const response = await listRuns(
      new NextRequest(`http://localhost/api/rtp-cycles/${CYCLE_ID}/extraction-runs`),
      routeContext()
    );

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).toMatch(/read failure, not an empty result/i);
  });
});

describe("no assistant action is registered for any of this", () => {
  it("leaves ACTION_METADATA untouched", async () => {
    // The five 2026-08-05 RTP financial refusals stay green BY CONSTRUCTION:
    // the guard enumerates Object.keys(ACTION_METADATA) and this lane gives it
    // no new key. Asserted here, beside the route, because the day someone adds
    // `propose_rtp_extraction_run` this is the file they will be editing.
    const { ACTION_METADATA } = await import("@/lib/runtime/action-metadata");
    const kinds = Object.keys(ACTION_METADATA);
    expect(kinds).toHaveLength(12);
    for (const kind of kinds) {
      expect(kind).not.toMatch(/extraction|transcri|candidate/i);
    }
  });
});
