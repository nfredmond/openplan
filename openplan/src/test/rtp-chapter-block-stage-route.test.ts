import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * PUTTING THE PLAN'S OWN WORDS INTO A CHAPTER — and the four things this route
 * must never do.
 *
 * 1. IT MUST NEVER TOUCH `rtp_cycle_chapters`. Not `content_markdown`, not
 *    anything. The chapter row is READ to prove the chapter is in this plan, and
 *    that is the whole of its involvement. Published chapter text stays what a
 *    planner writes in the chapter editor (Nathaniel's Q3, 2026-08-11), and the
 *    assertion below is a table-level one so it cannot be satisfied by a route
 *    that writes a different column of the same table.
 * 2. IT MUST NEVER STAGE A BLOCK THAT IS NOT A VERBATIM COPY. The verifier runs
 *    again here, against the DOCUMENT as it is stored now, and a mismatch is a
 *    400 with nothing written.
 * 3. IT MUST NEVER TAKE A BATCH. A body naming a list of passages is a 400 —
 *    each block is a decision, and forty of them behind one click is forty
 *    decisions nobody made.
 * 4. IT MUST NEVER TREAT A FAILED READ AS AN ANSWER. A chunk query that did not
 *    complete is not a document that changed, and the route refuses rather than
 *    recording "could not be re-checked" over a broken query.
 *
 * MUTATION RESULTS are recorded at the bottom of this file.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const CYCLE_ID = "33333333-3333-4333-8333-333333333333";
const CHAPTER_ID = "44444444-4444-4444-8444-444444444444";
const CANDIDATE_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "66666666-6666-4666-8666-666666666666";
const CHUNK_ID = "77777777-7777-4777-8777-777777777777";
const DOCUMENT_ID = "88888888-8888-4888-8888-888888888888";
const DRAFT_ID = "99999999-9999-4999-8999-999999999999";

const QUOTE =
  "Goal 3: Reduce fatalities and serious injuries on the regional roadway network to zero by 2050.";
const PAGE_TEXT = `Chapter 3 — Safety\n\n${QUOTE}\n\nThe agency will report progress annually.`;

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import * as stageRoute from "@/app/api/rtp-cycles/[rtpCycleId]/chapters/[chapterId]/transcribed-blocks/route";

const { POST } = stageRoute;

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

const dbCalls: Array<{ table: string; method: string; args: unknown[]; role: "caller" | "service" }> = [];

const CHAIN_METHODS = ["select", "eq", "in", "order", "limit", "insert", "update", "delete"];

function makeChain(table: string, role: "caller" | "service", resolve: (ops: string[]) => QueryResult) {
  const ops: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of CHAIN_METHODS) {
    chain[method] = vi.fn((...args: unknown[]) => {
      ops.push(method);
      dbCalls.push({ table, method, args, role });
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => resolve(ops));
  chain.single = vi.fn(async () => resolve(ops));
  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(resolve(ops)).then(onFulfilled, onRejected);
  return chain;
}

let membershipRead: QueryResult;
let chapterRead: QueryResult;
let candidateRead: QueryResult;
let runRead: QueryResult;
let chunkRead: QueryResult;
let draftInsert: QueryResult;
let candidateFlip: QueryResult;

function pendingCandidate(overrides: Record<string, unknown> = {}): QueryResult {
  return {
    data: {
      id: CANDIDATE_ID,
      run_id: RUN_ID,
      target_kind: "chapter_block",
      proposed_json: { text: QUOTE },
      source_chunk_id: CHUNK_ID,
      source_page: 112,
      source_quote: QUOTE,
      quote_verified: true,
      status: "pending",
      ...overrides,
    },
    error: null,
  };
}

function installClient() {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      if (table === "rtp_cycles") {
        return makeChain(table, "caller", () => ({
          data: { id: CYCLE_ID, workspace_id: WORKSPACE_ID },
          error: null,
        }));
      }
      if (table === "workspace_members") return makeChain(table, "caller", () => membershipRead);
      if (table === "rtp_cycle_chapters") return makeChain(table, "caller", () => chapterRead);
      if (table === "rtp_extraction_candidates") return makeChain(table, "caller", () => candidateRead);
      if (table === "rtp_extraction_runs") return makeChain(table, "caller", () => runRead);
      if (table === "kb_document_chunks") return makeChain(table, "caller", () => chunkRead);
      if (table === "document_narrative_drafts") return makeChain(table, "caller", () => draftInsert);
      throw new Error(`Unexpected table: ${table}`);
    }),
  });
  createServiceRoleClientMock.mockImplementation(() => ({
    from: (table: string) => {
      if (table !== "rtp_extraction_candidates") {
        throw new Error(`Unexpected service-role table: ${table}`);
      }
      return makeChain(table, "service", () => candidateFlip);
    },
  }));
}

const routeContext = { params: Promise.resolve({ rtpCycleId: CYCLE_ID, chapterId: CHAPTER_ID }) };

function postRequest(body: unknown) {
  return new NextRequest(
    `http://localhost/api/rtp-cycles/${CYCLE_ID}/chapters/${CHAPTER_ID}/transcribed-blocks`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
}

function callsOn(table: string, method: string) {
  return dbCalls.filter((entry) => entry.table === table && entry.method === method);
}

function insertedDraft(): Record<string, unknown> | undefined {
  return callsOn("document_narrative_drafts", "insert")[0]?.args[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbCalls.length = 0;
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  membershipRead = { data: [{ workspace_id: WORKSPACE_ID, role: "admin", user_id: USER_ID }], error: null };
  chapterRead = {
    data: { id: CHAPTER_ID, title: "Safety", rtp_cycle_id: CYCLE_ID, workspace_id: WORKSPACE_ID },
    error: null,
  };
  candidateRead = pendingCandidate();
  runRead = {
    data: {
      id: RUN_ID,
      model: "claude-opus-4-8",
      kb_document_id: DOCUMENT_ID,
      kb_documents: { id: DOCUMENT_ID, title: "2020 Regional Transportation Plan" },
    },
    error: null,
  };
  chunkRead = { data: { id: CHUNK_ID, content: PAGE_TEXT }, error: null };
  draftInsert = { data: { id: DRAFT_ID, status: "draft", draft_markdown: "…" }, error: null };
  candidateFlip = { data: { id: CANDIDATE_ID }, error: null };
  installClient();
});

describe("what this route is NOT", () => {
  it("exposes only POST", () => {
    expect(typeof stageRoute.POST).toBe("function");
    for (const verb of ["GET", "PATCH", "PUT", "DELETE"]) {
      expect((stageRoute as Record<string, unknown>)[verb], verb).toBeUndefined();
    }
  });

  it("NEVER writes to rtp_cycle_chapters — the chapter row is only ever read", async () => {
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBe(201);

    const chapterWrites = dbCalls.filter(
      (entry) => entry.table === "rtp_cycle_chapters" && ["insert", "update", "delete"].includes(entry.method)
    );
    expect(chapterWrites).toEqual([]);
    expect(callsOn("rtp_cycle_chapters", "select").length).toBeGreaterThan(0);
  });

  it("touches no RTP ledger table at all", async () => {
    await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    const tables = new Set(dbCalls.map((entry) => entry.table));
    for (const table of [
      "rtp_financial_assumptions",
      "rtp_performance_measures",
      "rtp_horizon_bands",
      "project_rtp_cycle_links",
    ]) {
      expect(tables.has(table), table).toBe(false);
    }
  });

  it("refuses a BATCH of passages rather than staging the first one", async () => {
    const response = await POST(
      postRequest({ candidateIds: [CANDIDATE_ID, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }),
      routeContext
    );
    expect(response.status).toBe(400);
    expect(callsOn("document_narrative_drafts", "insert")).toEqual([]);

    const body = (await response.json()) as { details?: string };
    expect(body.details).toMatch(/one at a time/i);
  });

  it("refuses an unrecognised key rather than stripping it", async () => {
    // A stripped key is how a request that asked for something else succeeds
    // having ignored it.
    const response = await POST(
      postRequest({ fromExtractionCandidateId: CANDIDATE_ID, status: "accepted", contentMarkdown: "anything" }),
      routeContext
    );
    expect(response.status).toBe(400);
    expect(callsOn("document_narrative_drafts", "insert")).toEqual([]);
  });
});

describe("staging one verbatim block", () => {
  it("writes ONE draft row, in the draft state, with the plan's own words", async () => {
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBe(201);

    const inserts = callsOn("document_narrative_drafts", "insert");
    expect(inserts).toHaveLength(1);

    const values = insertedDraft() ?? {};
    expect(values.status).toBe("draft");
    expect(values.target_kind).toBe("rtp_chapter");
    expect(values.target_id).toBe(CHAPTER_ID);
    expect(values.section_key).toBeNull();
    expect(values.workspace_id).toBe(WORKSPACE_ID);
    expect(values.created_by).toBe(USER_ID);
    expect(String(values.draft_markdown)).toContain(QUOTE);
    expect(String(values.draft_markdown)).toContain("page 112");
    expect(values.model).toBe("claude-opus-4-8");
    expect(typeof values.facts_hash).toBe("string");
    expect(String(values.facts_hash)).toHaveLength(64);
  });

  it("inserts through the CALLER's client, never the service role", async () => {
    // `document_narrative_drafts` has a member INSERT policy requiring
    // `created_by = auth.uid()`. Writing this row as the service role would step
    // around a boundary that already says the right thing.
    await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    const insert = callsOn("document_narrative_drafts", "insert")[0];
    expect(insert?.role).toBe("caller");
  });

  it("reads the candidate scoped by id, cycle AND workspace", async () => {
    await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    const filters = dbCalls
      .filter((entry) => entry.table === "rtp_extraction_candidates" && entry.method === "eq")
      .map((entry) => entry.args);
    expect(filters).toEqual(
      expect.arrayContaining([
        ["id", CANDIDATE_ID],
        ["rtp_cycle_id", CYCLE_ID],
        ["workspace_id", WORKSPACE_ID],
      ])
    );
  });

  it("marks the candidate accepted and points it at the draft it became", async () => {
    await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    const flip = callsOn("rtp_extraction_candidates", "update")[0];
    expect(flip?.role).toBe("service");
    const values = flip?.args[0] as Record<string, unknown> | undefined;
    expect(values?.status).toBe("accepted");
    expect(values?.accepted_row_id).toBe(DRAFT_ID);
    expect(values?.reviewed_by).toBe(USER_ID);
  });

  it("records that the page could not be re-checked when the passage is gone", async () => {
    chunkRead = { data: null, error: null };
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBe(201);
    const grounding = (insertedDraft()?.grounding_json ?? {}) as Record<string, unknown>;
    expect(grounding.chunk_recheck).toBe("chunk_no_longer_stored");
  });

  it("records `matched` when the passage still contains the quote", async () => {
    await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    const grounding = (insertedDraft()?.grounding_json ?? {}) as Record<string, unknown>;
    expect(grounding.chunk_recheck).toBe("matched");
    expect(grounding.mode).toBe("transcription");
  });
});

describe("what it refuses", () => {
  it("refuses a block whose text is not the plan's words, and writes nothing", async () => {
    candidateRead = pendingCandidate({ proposed_json: { text: "Goal 3: eliminate deaths by 2050." } });
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBe(400);
    expect(callsOn("document_narrative_drafts", "insert")).toEqual([]);

    const body = (await response.json()) as { reason?: string; details?: string };
    expect(body.reason).toBe("not_a_verbatim_copy");
    expect(body.details).toMatch(/word for word/i);
  });

  it("refuses a block whose quote is no longer on the page it cites", async () => {
    chunkRead = { data: { id: CHUNK_ID, content: "This chapter was rewritten in 2025." }, error: null };
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBe(400);
    expect(callsOn("document_narrative_drafts", "insert")).toEqual([]);
  });

  it("refuses a candidate of any other kind", async () => {
    candidateRead = pendingCandidate({ target_kind: "financial_line" });
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBe(400);
    expect(callsOn("document_narrative_drafts", "insert")).toEqual([]);
  });

  it("refuses a passage somebody already reviewed", async () => {
    candidateRead = pendingCandidate({ status: "accepted" });
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBe(409);
    expect(callsOn("document_narrative_drafts", "insert")).toEqual([]);
  });

  it("refuses a chapter that is not in this plan — 404, and nothing written", async () => {
    chapterRead = { data: null, error: null };
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBe(404);
    expect(callsOn("document_narrative_drafts", "insert")).toEqual([]);
  });

  it("refuses a viewer", async () => {
    membershipRead = { data: [{ workspace_id: WORKSPACE_ID, role: "viewer", user_id: USER_ID }], error: null };
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBe(403);
    expect(callsOn("document_narrative_drafts", "insert")).toEqual([]);
  });

  it("refuses when the CHUNK READ FAILED — a broken query is not a changed document", async () => {
    // The subtle one. Answering "could not be re-checked" here would put a
    // staged block on the screen carrying a disclosure about the document, when
    // what actually happened is that a query did not run.
    chunkRead = { data: null, error: { message: "connection reset by peer" } };
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(callsOn("document_narrative_drafts", "insert")).toEqual([]);
  });

  it("refuses when the candidate read failed, rather than answering `not in this plan`", async () => {
    candidateRead = { data: null, error: { message: "statement timeout" } };
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).not.toBe(404);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(callsOn("document_narrative_drafts", "insert")).toEqual([]);
  });
});

describe("the acceptance record", () => {
  it("does not fail the request when the candidate flip fails — the block IS staged", async () => {
    // Reporting failure for a write that succeeded is how the same paragraph
    // ends up staged twice.
    candidateFlip = { data: null, error: { message: "deadlock detected" } };
    const response = await POST(postRequest({ fromExtractionCandidateId: CANDIDATE_ID }), routeContext);
    expect(response.status).toBe(201);

    const body = (await response.json()) as { extractionCandidate?: { recorded?: boolean; warning?: string } };
    expect(body.extractionCandidate?.recorded).toBe(false);
    expect(body.extractionCandidate?.warning).toBeTruthy();
  });
});

/*
  MUTATION RESULTS — 2026-08-11, each applied to the route, run, and reverted.
  Recorded so the next model can see which assertions are load-bearing.

  1. The verifier's refusal branch short-circuited to `false` →
     FAILED "refuses a block whose text is not the plan's words", "refuses a
     block whose quote is no longer on the page it cites", "refuses a candidate
     of any other kind" (3).
  2. `classifyRouteReadFailure` on the chunk read replaced with `null`, so a
     failed query looked like a passage that is gone →
     FAILED "refuses when the CHUNK READ FAILED" (1). This is the subtle one:
     without it, a broken query stages a block carrying a disclosure about the
     document instead of refusing.
  3. `.strict()` → `.passthrough()` on the request schema →
     FAILED "refuses an unrecognised key rather than stripping it" (1).
  4. The draft inserted as `status: "accepted"` →
     FAILED "writes ONE draft row, in the draft state" (1).
  5. The candidate read's `.eq("workspace_id", …)` deleted →
     FAILED "reads the candidate scoped by id, cycle AND workspace" (1).
  6. The already-reviewed check short-circuited →
     FAILED "refuses a passage somebody already reviewed" (1).
  7. A failed candidate flip turned into a 500 →
     FAILED "does not fail the request when the candidate flip fails" (1).
  8. THE IMPORTANT ONE. An `update({ content_markdown: draftMarkdown })` on
     `rtp_cycle_chapters` added after the insert →
     FAILED "NEVER writes to rtp_cycle_chapters — the chapter row is only ever
     read" (1). The assertion is table-level rather than column-level, so it
     also catches a write to a different column of the same row.
*/
