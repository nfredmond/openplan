import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE PLAN'S COST BASIS YEAR AND INFLATION RATE — the two numbers that decide
 * whether an RTP reports constant dollars or year-of-expenditure dollars, and
 * the door they arrive through.
 *
 * WHY THIS FILE EXISTS AT ALL. `rtp_cycles.financial_basis_year` and
 * `rtp_cycles.annual_inflation_rate` were added on 2026-08-05 and, until the
 * document-ingestion lane, were READ in five places — the fiscal-constraint
 * engine, the board export, the public plan page, the chapter-draft facts and
 * the assistant's context — and WRITTEN by nothing at all. `PATCH
 * /api/rtp-cycles/[rtpCycleId]` had no test file either. Both gaps are the
 * repo's shipped-invisible defect class, and this is the one place that
 * asserts the numbers can be recorded and that recording them is bounded.
 *
 * WHAT MUST NOT COLLAPSE HERE:
 *   - an inflation rate of 0 is a REAL answer (a plan programmed in constant
 *     dollars, stated deliberately), not "no rate given";
 *   - a rate is a FRACTION. Three per cent typed as `3` is refused, not read
 *     as three hundred per cent a year compounding across a 25-year horizon;
 *   - null CLEARS the field, which is a different request from omitting it.
 *
 * And the transcription half: these two values are the whole content of a
 * `cycle_financial_basis` passage, so this route is where one is accepted. It
 * writes no provenance column — `rtp_cycles` deliberately has none — so what
 * acceptance does here is mark the passage reviewed and point it at the cycle.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const CYCLE_ID = "33333333-3333-4333-8333-333333333333";
const CANDIDATE_ID = "44444444-4444-4444-8444-444444444444";
const MEASURE_CANDIDATE_ID = "55555555-5555-4555-8555-555555555555";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { PATCH as patchCycle } from "@/app/api/rtp-cycles/[rtpCycleId]/route";

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
let cycleUpdate: QueryResult;
let candidateRead: QueryResult;
let candidateFlip: QueryResult;

const STORED_CYCLE = {
  id: CYCLE_ID,
  workspace_id: WORKSPACE_ID,
  title: "2050 RTP",
  status: "draft",
  geography_label: null,
  horizon_start_year: 2026,
  horizon_end_year: 2050,
  adoption_target_date: null,
  public_review_open_at: null,
  public_review_close_at: null,
  summary: null,
  anchor_latitude: null,
  anchor_longitude: null,
  financial_basis_year: 2026,
  annual_inflation_rate: 0.03,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-11T00:00:00.000Z",
};

function pendingBasisCandidate(overrides: Record<string, unknown> = {}): QueryResult {
  return {
    data: {
      id: CANDIDATE_ID,
      workspace_id: WORKSPACE_ID,
      rtp_cycle_id: CYCLE_ID,
      target_kind: "cycle_financial_basis",
      status: "pending",
      quote_verified: true,
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
        return makeChain(table, (ops) =>
          ops.includes("update") ? cycleUpdate : { data: { id: CYCLE_ID, workspace_id: WORKSPACE_ID }, error: null },
        );
      }
      if (table === "workspace_members") {
        return makeChain(table, () => membershipRead);
      }
      if (table === "rtp_extraction_candidates") {
        return makeChain(table, (ops) => (ops.includes("update") ? candidateFlip : candidateRead));
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  });
  createServiceRoleClientMock.mockImplementation(() => ({
    from: (table: string) => {
      if (table !== "rtp_extraction_candidates") throw new Error(`Unexpected service-role table: ${table}`);
      return makeChain(table, (ops) => (ops.includes("update") ? candidateFlip : candidateRead));
    },
  }));
}

const routeContext = { params: Promise.resolve({ rtpCycleId: CYCLE_ID }) };

function patchRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/rtp-cycles/${CYCLE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * The object handed to `.update()` on `rtp_cycles`.
 *
 * Asserted on rather than the response body, because the fixture answers the
 * same row whatever was sent — a body assertion would pass with the write
 * removed entirely.
 */
function cycleUpdatePayload(): Record<string, unknown> | undefined {
  const call = dbCalls.find((entry) => entry.table === "rtp_cycles" && entry.method === "update");
  return call?.args[0] as Record<string, unknown> | undefined;
}

function cycleUpdateHappened(): boolean {
  return dbCalls.some((entry) => entry.table === "rtp_cycles" && entry.method === "update");
}

function touchedStagingTable(): boolean {
  return dbCalls.some((entry) => entry.table === "rtp_extraction_candidates");
}

function candidateLookupFilters(): unknown[][] {
  const flipAt = dbCalls.findIndex(
    (entry) => entry.table === "rtp_extraction_candidates" && entry.method === "update",
  );
  return (flipAt === -1 ? dbCalls : dbCalls.slice(0, flipAt))
    .filter((entry) => entry.table === "rtp_extraction_candidates" && entry.method === "eq")
    .map((call) => call.args);
}

function candidateFlipValues(): Record<string, unknown> | undefined {
  const call = dbCalls.find((entry) => entry.table === "rtp_extraction_candidates" && entry.method === "update");
  return call?.args[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbCalls.length = 0;
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  membershipRead = { data: { workspace_id: WORKSPACE_ID, role: "admin" }, error: null };
  cycleUpdate = { data: STORED_CYCLE, error: null };
  candidateRead = pendingBasisCandidate();
  candidateFlip = { data: { id: CANDIDATE_ID }, error: null };
  installClient();
});

describe("PATCH /api/rtp-cycles/[rtpCycleId] — the plan's cost basis", () => {
  it("records a basis year and an inflation rate a planner typed", async () => {
    const response = await patchCycle(
      patchRequest({ financialBasisYear: 2026, annualInflationRate: 0.03 }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(cycleUpdatePayload()).toEqual({ financial_basis_year: 2026, annual_inflation_rate: 0.03 });
  });

  it("reads the two columns back, so the surface shows what was saved", async () => {
    /**
     * A mocked client answers its fixture for whatever projection was asked,
     * so the only way to prove a column is read back is to assert on the
     * `.select()` string the route built. A projection missing a column the
     * editor renders shows up as `undefined` on the page and in no test.
     */
    await patchCycle(patchRequest({ financialBasisYear: 2026 }), routeContext);

    const projections = dbCalls
      .filter((entry) => entry.table === "rtp_cycles" && entry.method === "select")
      .map((entry) => String(entry.args[0] ?? ""));
    const readBack = projections.find((projection) => projection.includes("annual_inflation_rate"));
    expect(readBack, "the update's read-back does not project the financial columns").toBeDefined();
    expect(readBack).toContain("financial_basis_year");
  });

  it("an inflation rate of ZERO is a real answer, not an absent one", async () => {
    /**
     * A plan that programmes in constant dollars and says so deliberately.
     *
     * MUTATION: `if (payload.data.annualInflationRate !== undefined)` ->
     *   `if (payload.data.annualInflationRate)`
     *   => fails: expected undefined to be +0. The production consequence is a
     *      planner who states "no escalation" and gets the disclosure for "no
     *      rate was ever given" instead.
     */
    const response = await patchCycle(patchRequest({ annualInflationRate: 0 }), routeContext);

    expect(response.status).toBe(200);
    expect(cycleUpdatePayload()!.annual_inflation_rate).toBe(0);
    expect(cycleUpdatePayload()!.annual_inflation_rate).not.toBeNull();
    expect(cycleUpdatePayload()!.annual_inflation_rate).not.toBeUndefined();
  });

  it("null CLEARS the basis year rather than being ignored", async () => {
    const response = await patchCycle(patchRequest({ financialBasisYear: null }), routeContext);

    expect(response.status).toBe(200);
    expect(cycleUpdatePayload()).toEqual({ financial_basis_year: null });
  });

  it("refuses a rate expressed as a percentage rather than a fraction", async () => {
    /**
     * The column is `NUMERIC(6, 5) CHECK (… BETWEEN 0 AND 1)`. Three per cent
     * typed as `3` would be three hundred per cent a year, which across a
     * 25-year horizon turns a $12M project into an astronomical figure on a
     * board packet. Refused here so the planner is told, rather than at the
     * database as an opaque constraint violation.
     */
    const response = await patchCycle(patchRequest({ annualInflationRate: 3 }), routeContext);

    expect(response.status).toBe(400);
    expect(cycleUpdateHappened()).toBe(false);
  });

  it("refuses a negative rate and a basis year outside the column's range", async () => {
    for (const payload of [
      { annualInflationRate: -0.01 },
      { financialBasisYear: 1492 },
      { financialBasisYear: 2500 },
      { financialBasisYear: 2026.5 },
    ]) {
      dbCalls.length = 0;
      const response = await patchCycle(patchRequest(payload), routeContext);
      expect(response.status, JSON.stringify(payload)).toBe(400);
      expect(cycleUpdateHappened(), JSON.stringify(payload)).toBe(false);
    }
  });

  it("still refuses a viewer", async () => {
    membershipRead = { data: { workspace_id: WORKSPACE_ID, role: "viewer" }, error: null };

    const response = await patchCycle(patchRequest({ financialBasisYear: 2026 }), routeContext);

    expect(response.status).toBe(403);
    expect(cycleUpdateHappened()).toBe(false);
  });
});

describe("PATCH /api/rtp-cycles/[rtpCycleId] — accepting a transcribed cost basis", () => {
  it("a hand-typed change asks the staging table nothing", async () => {
    const response = await patchCycle(patchRequest({ financialBasisYear: 2026 }), routeContext);

    expect(response.status).toBe(200);
    expect(touchedStagingTable()).toBe(false);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(await response.json()).not.toHaveProperty("extractionCandidate");
  });

  it("marks the passage accepted and points it at the cycle", async () => {
    const response = await patchCycle(
      patchRequest({
        financialBasisYear: 2026,
        annualInflationRate: 0.028,
        fromExtractionCandidateId: CANDIDATE_ID,
      }),
      routeContext,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(cycleUpdatePayload()).toEqual({ financial_basis_year: 2026, annual_inflation_rate: 0.028 });
    expect(candidateLookupFilters()).toEqual([
      ["id", CANDIDATE_ID],
      ["rtp_cycle_id", CYCLE_ID],
      ["workspace_id", WORKSPACE_ID],
    ]);
    expect(candidateFlipValues()).toMatchObject({
      status: "accepted",
      accepted_row_id: CYCLE_ID,
      reviewed_by: USER_ID,
    });
    expect(body.extractionCandidate).toEqual({ id: CANDIDATE_ID, recorded: true });
  });

  it("writes NO provenance column — rtp_cycles deliberately has none", async () => {
    /**
     * 20260811000009 adds `extraction_candidate_id` to four tables and not to
     * `rtp_cycles`: a cycle is not a transcribed artifact, and the passage
     * itself already records what it proposed and which page it came from.
     * Naming the column here would be a PGRST204 on every save.
     *
     * The acceptance is PERFORMED first, deliberately. An earlier draft of
     * this test asserted on `cycleUpdatePayload()` with no request made at
     * all — `Object.keys(undefined ?? {})` is `[]`, which contains nothing,
     * so it passed while proving nothing. The write has to happen for the
     * absence to mean anything.
     */
    const response = await patchCycle(
      patchRequest({ financialBasisYear: 2026, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext,
    );

    expect(response.status).toBe(200);
    const payload = cycleUpdatePayload();
    expect(payload, "no update reached rtp_cycles, so this assertion would be vacuous").toBeDefined();
    expect(Object.keys(payload!)).toEqual(["financial_basis_year"]);
  });

  it("naming a transcription and changing nothing is refused", async () => {
    /**
     * MUTATION: `!isOnlyExtractionProvenance(value)` ->
     *   `Object.values(value).some((item) => item !== undefined)`
     *   => fails: 200 for 400, and the passage flips to accepted having
     *      changed neither the basis year nor the rate — the plan would then
     *      cite a page for figures that page's numbers never reached.
     */
    const response = await patchCycle(
      patchRequest({ fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid RTP cycle update payload");
    expect(cycleUpdateHappened()).toBe(false);
    expect(touchedStagingTable()).toBe(false);
  });

  it("refuses a passage staged for a different part of the plan", async () => {
    candidateRead = pendingBasisCandidate({ id: MEASURE_CANDIDATE_ID, target_kind: "performance_measure" });

    const response = await patchCycle(
      patchRequest({ financialBasisYear: 2026, fromExtractionCandidateId: MEASURE_CANDIDATE_ID }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("That transcription belongs somewhere else in the plan");
    expect(cycleUpdateHappened()).toBe(false);
  });

  it("refuses a passage a colleague already accepted", async () => {
    candidateRead = pendingBasisCandidate({ status: "accepted" });

    const response = await patchCycle(
      patchRequest({ financialBasisYear: 2026, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expect(cycleUpdateHappened()).toBe(false);
  });

  it("the same bad rate is refused whether or not it names a transcription", async () => {
    const typed = await patchCycle(patchRequest({ annualInflationRate: 3 }), routeContext);
    dbCalls.length = 0;
    const transcribed = await patchCycle(
      patchRequest({ annualInflationRate: 3, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext,
    );

    expect(typed.status).toBe(400);
    expect(transcribed.status).toBe(typed.status);
    expect(cycleUpdateHappened()).toBe(false);
    // The zod refusal comes first, so the passage is never looked up and is
    // certainly never burned by a payload the plan refused.
    expect(touchedStagingTable()).toBe(false);
  });

  it("saves the change even when the review list could not be updated, and says so", async () => {
    createServiceRoleClientMock.mockImplementation(() => {
      throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
    });

    const response = await patchCycle(
      patchRequest({ financialBasisYear: 2026, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(cycleUpdatePayload()).toEqual({ financial_basis_year: 2026 });
    expect(body.extractionCandidate.recorded).toBe(false);
    expect(body.extractionCandidate.warning).toContain("twice");
  });
});
