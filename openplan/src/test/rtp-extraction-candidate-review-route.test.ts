import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * SETTING A TRANSCRIPTION ASIDE — the review screen's ONLY write, and the
 * boundary that keeps it that way.
 *
 * The interesting assertions in this file are the negative ones. Accepting a
 * transcription must never be possible here: acceptance runs the plan's own
 * write route, with its zod, its band check, its amount ceiling and its audit
 * line, and a second writer that could mark a candidate accepted would be the
 * door a machine authors a planning number through. So this route is checked
 * for what it CANNOT do as much as for what it does:
 *
 *   - it exposes no POST and no DELETE, only PATCH;
 *   - `{ action: "accept" }` is a 400, not a write;
 *   - the only status it ever writes is `rejected`;
 *   - it touches no RTP table at all — "reject records the rejection and
 *     nothing else".
 *
 * And the ordinary refusals: a viewer may not decide what the plan will never
 * say, a candidate from another workspace is a 404 rather than a 403, and a
 * passage somebody already reviewed is a 409 rather than a silent second write.
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
const CANDIDATE_ID = "44444444-4444-4444-8444-444444444444";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import * as candidateRoute from "@/app/api/rtp-cycles/[rtpCycleId]/extraction-candidates/[candidateId]/route";

const { PATCH } = candidateRoute;

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

const dbCalls: Array<{ table: string; method: string; args: unknown[] }> = [];

const CHAIN_METHODS = ["select", "eq", "in", "order", "limit", "insert", "update", "delete"];

function makeChain(table: string, resolve: (ops: string[]) => QueryResult) {
  const ops: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of CHAIN_METHODS) {
    chain[method] = vi.fn((...args: unknown[]) => {
      ops.push(method);
      dbCalls.push({ table, method, args });
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
let candidateRead: QueryResult;
let candidateFlip: QueryResult;

function pendingCandidate(overrides: Record<string, unknown> = {}): QueryResult {
  return {
    data: {
      id: CANDIDATE_ID,
      target_kind: "financial_line",
      status: "pending",
      source_page: 112,
      ...overrides,
    },
    error: null,
  };
}

/** Every table the route is allowed to touch. Anything else throws by design. */
function installClient() {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      if (table === "rtp_cycles") {
        return makeChain(table, () => ({
          data: { id: CYCLE_ID, workspace_id: WORKSPACE_ID },
          error: null,
        }));
      }
      if (table === "workspace_members") return makeChain(table, () => membershipRead);
      if (table === "rtp_extraction_candidates") {
        return makeChain(table, (ops) => (ops.includes("update") ? candidateFlip : candidateRead));
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  });
  createServiceRoleClientMock.mockImplementation(() => ({
    from: (table: string) => {
      if (table !== "rtp_extraction_candidates") {
        throw new Error(`Unexpected service-role table: ${table}`);
      }
      return makeChain(table, (ops) => (ops.includes("update") ? candidateFlip : candidateRead));
    },
  }));
}

const routeContext = {
  params: Promise.resolve({ rtpCycleId: CYCLE_ID, candidateId: CANDIDATE_ID }),
};

function patchRequest(body: unknown) {
  return new NextRequest(
    `http://localhost/api/rtp-cycles/${CYCLE_ID}/extraction-candidates/${CANDIDATE_ID}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function updateValues(): Record<string, unknown> | undefined {
  const call = dbCalls.find(
    (entry) => entry.table === "rtp_extraction_candidates" && entry.method === "update"
  );
  return call?.args[0] as Record<string, unknown> | undefined;
}

function updateHappened(): boolean {
  return dbCalls.some(
    (entry) => entry.table === "rtp_extraction_candidates" && entry.method === "update"
  );
}

/** The `.eq()` filters applied AFTER the update — the concurrency guard. */
function updateFilters(): unknown[][] {
  const at = dbCalls.findIndex(
    (entry) => entry.table === "rtp_extraction_candidates" && entry.method === "update"
  );
  if (at === -1) return [];
  return dbCalls
    .slice(at)
    .filter((entry) => entry.table === "rtp_extraction_candidates" && entry.method === "eq")
    .map((call) => call.args);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbCalls.length = 0;
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  // `loadCurrentWorkspaceMembership` selects a LIST and picks from it.
  membershipRead = {
    data: [{ workspace_id: WORKSPACE_ID, role: "admin", user_id: USER_ID }],
    error: null,
  };
  candidateRead = pendingCandidate();
  candidateFlip = { data: { id: CANDIDATE_ID, status: "rejected" }, error: null };
  installClient();
});

describe("what this route is NOT", () => {
  it("exposes only PATCH — there is no accept door here", () => {
    expect(typeof candidateRoute.PATCH).toBe("function");
    expect((candidateRoute as Record<string, unknown>).POST).toBeUndefined();
    expect((candidateRoute as Record<string, unknown>).DELETE).toBeUndefined();
    expect((candidateRoute as Record<string, unknown>).PUT).toBeUndefined();
  });

  it("refuses `accept` as an action and writes nothing", async () => {
    const response = await PATCH(patchRequest({ action: "accept" }), routeContext);
    expect(response.status).toBe(400);
    expect(updateHappened()).toBe(false);

    const body = (await response.json()) as { details?: string };
    // The refusal says where acceptance actually happens, rather than only
    // saying no.
    expect(body.details).toMatch(/saving it into the plan/i);
  });

  it("refuses an unknown key rather than stripping it", async () => {
    const response = await PATCH(
      patchRequest({ action: "reject", status: "accepted", acceptedRowId: "row-1" }),
      routeContext
    );
    expect(response.status).toBe(400);
    expect(updateHappened()).toBe(false);
  });

  it("touches no RTP table — the rejection is recorded and nothing else", async () => {
    await PATCH(patchRequest({ action: "reject" }), routeContext);
    const tables = new Set(dbCalls.map((entry) => entry.table));
    expect(tables.has("rtp_financial_assumptions")).toBe(false);
    expect(tables.has("rtp_performance_measures")).toBe(false);
    expect(tables.has("rtp_horizon_bands")).toBe(false);
    expect(tables.has("project_rtp_cycle_links")).toBe(false);
  });
});

describe("setting a passage aside", () => {
  it("writes `rejected`, who did it and when — and no other field", async () => {
    const response = await PATCH(patchRequest({ action: "reject" }), routeContext);
    expect(response.status).toBe(200);

    const values = updateValues();
    expect(values?.status).toBe("rejected");
    expect(values?.reviewed_by).toBe(USER_ID);
    expect(typeof values?.reviewed_at).toBe("string");
    expect(Object.keys(values ?? {}).sort()).toEqual(["reviewed_at", "reviewed_by", "status"]);
  });

  it("scopes the write to this candidate, this plan, this workspace, and only while pending", async () => {
    await PATCH(patchRequest({ action: "reject" }), routeContext);
    const filters = Object.fromEntries(updateFilters().map(([column, value]) => [column, value]));
    expect(filters.id).toBe(CANDIDATE_ID);
    expect(filters.rtp_cycle_id).toBe(CYCLE_ID);
    expect(filters.workspace_id).toBe(WORKSPACE_ID);
    // The concurrency half: an acceptance that landed first cannot be
    // overwritten by a rejection arriving a moment later.
    expect(filters.status).toBe("pending");
  });

  it("records the rejection in the audit log", async () => {
    await PATCH(patchRequest({ action: "reject" }), routeContext);
    expect(createApiAuditLoggerMock).toHaveBeenCalled();
    expect(mockAudit.info).toHaveBeenCalledWith(
      "extraction_candidate_rejected",
      expect.objectContaining({ extractionCandidateId: CANDIDATE_ID })
    );
  });
});

describe("who may do it", () => {
  it("refuses a viewer", async () => {
    membershipRead = { data: [{ workspace_id: WORKSPACE_ID, role: "viewer", user_id: USER_ID }], error: null };
    const response = await PATCH(patchRequest({ action: "reject" }), routeContext);
    expect(response.status).toBe(403);
    expect(updateHappened()).toBe(false);
  });

  it("refuses a signed-out caller", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const response = await PATCH(patchRequest({ action: "reject" }), routeContext);
    expect(response.status).toBe(401);
    expect(updateHappened()).toBe(false);
  });
});

describe("candidates this plan does not have", () => {
  it("answers 404 for a passage that is not in this cycle", async () => {
    candidateRead = { data: null, error: null };
    const response = await PATCH(patchRequest({ action: "reject" }), routeContext);
    expect(response.status).toBe(404);
    expect(updateHappened()).toBe(false);
  });

  it("does not answer 404 when the read FAILED", async () => {
    // "That transcription is not part of this plan" is a claim, and a query
    // that never ran cannot make it.
    candidateRead = { data: null, error: { message: "connection reset" } };
    const response = await PATCH(patchRequest({ action: "reject" }), routeContext);
    expect(response.status).not.toBe(404);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(updateHappened()).toBe(false);
  });

  it("answers 409 for a passage somebody already reviewed", async () => {
    candidateRead = pendingCandidate({ status: "accepted" });
    const response = await PATCH(patchRequest({ action: "reject" }), routeContext);
    expect(response.status).toBe(409);
    expect(updateHappened()).toBe(false);

    const body = (await response.json()) as { details?: string };
    expect(body.details).toMatch(/already saved this passage into the plan/i);
  });

  it("answers 409 when somebody reviewed it between the read and the write", async () => {
    candidateFlip = { data: null, error: null };
    const response = await PATCH(patchRequest({ action: "reject" }), routeContext);
    expect(response.status).toBe(409);
  });

  it("says the staging table is missing rather than failing anonymously", async () => {
    candidateFlip = {
      data: null,
      error: { message: 'relation "public.rtp_extraction_candidates" does not exist', code: "42P01" },
    };
    const response = await PATCH(patchRequest({ action: "reject" }), routeContext);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { hint?: string };
    expect(body.hint).toContain("20260811000008");
  });
});

/*
  MUTATION RESULTS, 2026-08-11. Each applied to the route, this file RUN, then
  restored:

    - `z.literal("reject")` widened to `z.enum(["reject", "accept"])` with the
      update's status taken from the body → "refuses `accept` as an action and
      writes nothing" fails. This is the mutation that turns the review screen
      into a second writer, which is the one thing this route may never become.
    - `.strict()` removed from the schema → "refuses an unknown key rather than
      stripping it" fails.
    - `.eq("status", "pending")` dropped from the update → "scopes the write …
      only while pending" fails; without it a late rejection silently overwrites
      an acceptance and orphans the row's citation.
    - `.eq("workspace_id", workspaceId)` dropped from the update → the same test
      fails, naming the missing scope.
    - the `candidate.status !== "pending"` branch deleted → "answers 409 for a
      passage somebody already reviewed" fails.
    - `classifyRouteReadFailure` result ignored, so a failed read fell into the
      `!candidate` branch → "does not answer 404 when the read FAILED" fails.
*/
