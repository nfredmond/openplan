import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The horizon-bands route: who may write a band, which workspace a band lands
 * in, and the two refusals that have to read as sentences rather than as raw
 * Postgres — an incoherent year range, and a period a financial line still
 * points at.
 *
 * The Supabase mock is a recording chain rather than per-method stubs, because
 * this route issues seven differently-shaped queries and hand-built stubs for
 * each would be longer than the route. Every call is recorded WITH ITS
 * ARGUMENTS so the assertions can read the projection string and the scoping
 * `.eq()` values — a mocked client returns its fixture whatever columns were
 * asked for, so the only way to prove a projection or a scope is to assert on
 * the query the route actually built.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const RTP_CYCLE_ID = "44444444-4444-4444-8444-444444444444";
const BAND_ID = "55555555-5555-4555-8555-555555555555";

type QueryResult = { data?: unknown; error?: unknown; count?: number | null };
type RecordedCall = { method: string; args: unknown[] };
type RecordedQuery = { table: string; calls: RecordedCall[] };

const queued: Record<string, QueryResult[]> = {};
const recorded: RecordedQuery[] = [];

function queueResult(table: string, result: QueryResult) {
  (queued[table] ??= []).push(result);
}

/** Every query issued against a table, in order. */
function queriesFor(table: string): RecordedQuery[] {
  return recorded.filter((query) => query.table === table);
}

/** The arguments of the first `method` call on the nth query against `table`. */
function argsOf(table: string, method: string, index = 0): unknown[] | undefined {
  const query = queriesFor(table)[index];
  return query?.calls.find((call) => call.method === method)?.args;
}

const fromMock = vi.fn((table: string) => {
  const entry: RecordedQuery = { table, calls: [] };
  recorded.push(entry);

  const settle = (): QueryResult => {
    const next = queued[table]?.shift();
    if (!next) throw new Error(`No queued Supabase result for table "${table}"`);
    return next;
  };

  const chain: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      entry.calls.push({ method, args });
      return chain;
    };
  for (const method of ["select", "insert", "update", "delete", "eq", "limit", "order"]) {
    chain[method] = record(method);
  }
  const terminal =
    (method: string) =>
    (...args: unknown[]) => {
      entry.calls.push({ method, args });
      return Promise.resolve(settle());
    };
  chain.single = terminal("single");
  chain.maybeSingle = terminal("maybeSingle");
  // A head/count query is awaited directly off the builder, so the builder has
  // to be thenable the way PostgREST's is.
  chain.then = (onFulfilled: unknown, onRejected: unknown) =>
    Promise.resolve()
      .then(() => settle())
      .then(onFulfilled as never, onRejected as never);

  return chain;
});

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>(
    "@/lib/workspaces/current"
  );
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
  };
});

import {
  DELETE as deleteBand,
  PATCH as patchBand,
  POST as postBand,
} from "@/app/api/rtp-cycles/[rtpCycleId]/horizon-bands/route";

function request(method: string, payload: unknown) {
  return new NextRequest(`http://localhost/api/rtp-cycles/${RTP_CYCLE_ID}/horizon-bands`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const routeContext = { params: Promise.resolve({ rtpCycleId: RTP_CYCLE_ID }) };

function storedBandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BAND_ID,
    workspace_id: WORKSPACE_A,
    rtp_cycle_id: RTP_CYCLE_ID,
    label: "First ten years",
    start_year: 2026,
    end_year: 2035,
    escalation_target_year: 2030,
    cost_estimate_basis: "itemized",
    sort_order: 0,
    created_by: USER_ID,
    created_at: "2026-08-05T12:00:00.000Z",
    updated_at: "2026-08-05T12:00:00.000Z",
    ...overrides,
  };
}

function setMembership(workspaceId: string, role: string) {
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: workspaceId, role, workspaces: { name: "Agency", created_at: null } },
    workspace: { name: "Agency", created_at: null },
  });
}

describe("/api/rtp-cycles/[rtpCycleId]/horizon-bands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorded.length = 0;
    for (const key of Object.keys(queued)) delete queued[key];

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    setMembership(WORKSPACE_A, "member");
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    // `rtp_extraction_candidates` has no client write policy, so the flip that
    // marks a transcription accepted goes through the service role. It shares
    // the recording chain, which is what lets the assertions below read the
    // update the route actually built.
    createServiceRoleClientMock.mockImplementation(() => ({ from: fromMock }));
  });

  it("refuses an unauthenticated caller with 401 and touches no table", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postBand(
      request("POST", { label: "First ten years", startYear: 2026, endYear: 2035 }),
      routeContext
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("refuses a caller with no membership at all with 403", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: undefined, workspace: null });

    const response = await postBand(
      request("POST", { label: "First ten years", startYear: 2026, endYear: 2035 }),
      routeContext
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Forbidden" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("refuses a viewer with 403 before any table is read", async () => {
    setMembership(WORKSPACE_A, "viewer");

    const response = await postBand(
      request("POST", { label: "First ten years", startYear: 2026, endYear: 2035 }),
      routeContext
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Forbidden" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a cycle that belongs to another workspace, and never writes", async () => {
    // The cycle lookup is scoped to the caller's workspace, so someone else's
    // cycle comes back as no row rather than as a row to refuse.
    queueResult("rtp_cycles", { data: null, error: null });

    const response = await postBand(
      request("POST", { label: "First ten years", startYear: 2026, endYear: 2035 }),
      routeContext
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "RTP cycle not found" });
    expect(queriesFor("rtp_horizon_bands")).toHaveLength(0);

    const eqCalls = queriesFor("rtp_cycles")[0].calls.filter((call) => call.method === "eq");
    expect(eqCalls).toEqual([
      { method: "eq", args: ["id", RTP_CYCLE_ID] },
      { method: "eq", args: ["workspace_id", WORKSPACE_A] },
    ]);
  });

  it("reports a failed cycle read as a failure rather than as a missing cycle", async () => {
    queueResult("rtp_cycles", { data: null, error: { message: "connection reset" } });

    const response = await postBand(
      request("POST", { label: "First ten years", startYear: 2026, endYear: 2035 }),
      routeContext
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ hint: expect.stringContaining("not an empty result") });
  });

  // Two workspaces, so the assertion cannot pass on a hardcoded id: a route that
  // wrote a constant would fail one of the two runs.
  it.each([
    [WORKSPACE_A, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    [WORKSPACE_B, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  ])("creates a band in the caller's own workspace %s", async (workspaceId, newBandId) => {
    setMembership(workspaceId, "member");
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: workspaceId }, error: null });
    queueResult("rtp_horizon_bands", {
      data: storedBandRow({ id: newBandId, workspace_id: workspaceId }),
      error: null,
    });

    const response = await postBand(
      request("POST", {
        label: "First ten years",
        startYear: 2026,
        endYear: 2035,
        // An emptied number input sends "", which means NOT SET — not 0.
        escalationTargetYear: "",
        costEstimateBasis: "itemized",
        sortOrder: 1,
        // Not part of the schema; the workspace must come from the membership.
        workspaceId: "99999999-9999-4999-8999-999999999999",
      }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ band: expect.objectContaining({ id: newBandId }) });

    expect(argsOf("rtp_horizon_bands", "insert")).toEqual([
      {
        workspace_id: workspaceId,
        rtp_cycle_id: RTP_CYCLE_ID,
        label: "First ten years",
        start_year: 2026,
        end_year: 2035,
        escalation_target_year: null,
        cost_estimate_basis: "itemized",
        sort_order: 1,
        created_by: USER_ID,
      },
    ]);

    // The projection is the only place a missing column shows up: the mock
    // returns the fixture whatever was asked for.
    const projection = String(argsOf("rtp_horizon_bands", "select")?.[0] ?? "");
    for (const column of [
      "id",
      "workspace_id",
      "rtp_cycle_id",
      "label",
      "start_year",
      "end_year",
      "escalation_target_year",
      "cost_estimate_basis",
      "sort_order",
      "updated_at",
    ]) {
      expect(projection).toContain(column);
    }
  });

  it("refuses an end year before the start year with a 400 that states the rule", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });

    const response = await postBand(
      request("POST", { label: "Backwards", startYear: 2040, endYear: 2035 }),
      routeContext
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("2040");
    expect(body.error).toContain("2035");
    expect(body.error).toMatch(/end/i);
    // Nothing was attempted against the table.
    expect(queriesFor("rtp_horizon_bands")).toHaveLength(0);
  });

  it("refuses an escalation target year outside the band with a 400 that states the rule", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });

    const response = await postBand(
      request("POST", {
        label: "First ten years",
        startYear: 2026,
        endYear: 2035,
        escalationTargetYear: 2044,
      }),
      routeContext
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("2044");
    expect(body.error).toMatch(/escalation target year/i);
    expect(queriesFor("rtp_horizon_bands")).toHaveLength(0);
  });

  it("PATCH validates the band AS IT WILL BE, not only the fields sent", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    // Stored band is 2026–2035; narrowing the end to 2028 strands the stored
    // escalation year of 2030.
    queueResult("rtp_horizon_bands", { data: storedBandRow(), error: null });

    const response = await patchBand(
      request("PATCH", { bandId: BAND_ID, endYear: 2028 }),
      routeContext
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("2030");
    expect(body.error).toContain("2028");
    // The read happened; the write did not.
    expect(queriesFor("rtp_horizon_bands")).toHaveLength(1);
  });

  it("PATCH updates only the fields sent, scoped to the cycle and workspace", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_horizon_bands", { data: storedBandRow(), error: null });
    queueResult("rtp_horizon_bands", { data: storedBandRow({ label: "Years 1-10" }), error: null });

    const response = await patchBand(
      request("PATCH", { bandId: BAND_ID, label: "Years 1-10", escalationTargetYear: "" }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(argsOf("rtp_horizon_bands", "update", 1)).toEqual([
      { label: "Years 1-10", escalation_target_year: null },
    ]);

    const readEqCalls = queriesFor("rtp_horizon_bands")[0].calls.filter((call) => call.method === "eq");
    expect(readEqCalls).toEqual([
      { method: "eq", args: ["id", BAND_ID] },
      { method: "eq", args: ["rtp_cycle_id", RTP_CYCLE_ID] },
      { method: "eq", args: ["workspace_id", WORKSPACE_A] },
    ]);
  });

  it("answers 409, not 500, when a financial line still points at the band", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_horizon_bands", { data: storedBandRow(), error: null });
    queueResult("project_rtp_cycle_links", { data: null, error: null, count: 0 });
    queueResult("rtp_horizon_bands", {
      data: null,
      error: {
        code: "23503",
        message:
          'update or delete on table "rtp_horizon_bands" violates foreign key constraint on table "rtp_financial_assumptions"',
      },
    });
    queueResult("rtp_financial_assumptions", {
      data: [
        { id: "line-1", entry_kind: "revenue", source_name: "STBG" },
        { id: "line-2", entry_kind: "operations_maintenance", source_name: "Transit operations" },
      ],
      error: null,
      count: 2,
    });

    const response = await deleteBand(request("DELETE", { bandId: BAND_ID }), routeContext);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; details: string; blockingLineCount: number };
    expect(body.blockingLineCount).toBe(2);
    expect(body.details).toContain("STBG");
    expect(body.details).toMatch(/move/i);
    expect(body.details).toMatch(/remove/i);
  });

  it("still answers 409 when the blocking lines cannot be listed", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_horizon_bands", { data: storedBandRow(), error: null });
    queueResult("project_rtp_cycle_links", { data: null, error: null, count: 0 });
    queueResult("rtp_horizon_bands", { data: null, error: { code: "23503", message: "fk violation" } });
    queueResult("rtp_financial_assumptions", { data: null, error: { message: "permission denied" } });

    const response = await deleteBand(request("DELETE", { bandId: BAND_ID }), routeContext);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { details: string; blockingLineCount: number | null };
    expect(body.blockingLineCount).toBeNull();
    expect(body.details).toMatch(/move them to another period or remove them/i);
  });

  it("deletes a band and reports how many programmed projects lost their period", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_horizon_bands", { data: storedBandRow(), error: null });
    queueResult("project_rtp_cycle_links", { data: null, error: null, count: 3 });
    queueResult("rtp_horizon_bands", { data: { id: BAND_ID }, error: null });

    const response = await deleteBand(request("DELETE", { bandId: BAND_ID }), routeContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      bandId: BAND_ID,
      projectLinksUnassigned: 3,
    });
    // Counted before the delete, because ON DELETE SET NULL destroys the evidence.
    expect(recorded.map((query) => query.table)).toEqual([
      "rtp_cycles",
      "rtp_horizon_bands",
      "project_rtp_cycle_links",
      "rtp_horizon_bands",
    ]);
  });

  it("reports an unreadable project-link count as unknown rather than as zero", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_horizon_bands", { data: storedBandRow(), error: null });
    queueResult("project_rtp_cycle_links", { data: null, error: { message: "boom" }, count: null });
    queueResult("rtp_horizon_bands", { data: { id: BAND_ID }, error: null });

    const response = await deleteBand(request("DELETE", { bandId: BAND_ID }), routeContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ projectLinksUnassigned: null });
  });

  it("answers 409 when two periods in one plan would share a name", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_horizon_bands", {
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const response = await postBand(
      request("POST", { label: "First ten years", startYear: 2026, endYear: 2035 }),
      routeContext
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/already exists/i),
    });
  });

  it("reports an insert that could not be read back as created, never as failed", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    // PGRST116 after an INSERT means the row WAS written and the select could
    // not see it. Answering 4xx/5xx here is how a retry creates a second band.
    queueResult("rtp_horizon_bands", { data: null, error: { code: "PGRST116", message: "no rows" } });

    const response = await postBand(
      request("POST", { label: "First ten years", startYear: 2026, endYear: 2035 }),
      routeContext
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: true, record: null });
  });

  it("does not report a delete that matched no rows as a success", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_horizon_bands", { data: storedBandRow(), error: null });
    queueResult("project_rtp_cycle_links", { data: null, error: null, count: 0 });
    queueResult("rtp_horizon_bands", { data: null, error: null });

    const response = await deleteBand(request("DELETE", { bandId: BAND_ID }), routeContext);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/was not saved/i),
    });
  });
});

// ---------------------------------------------------------------------------
// A PERIOD TRANSCRIBED OUT OF THE ADOPTED PLAN'S OWN TABLE.
//
// The band rules do not relax for it. A period copied off a page still has to
// end after it starts, still may not overlap another period of the same plan,
// and — the one that matters most — still may not carry an escalation target
// year the document did not state, because filling that field deletes the
// public document's "midpoint assumed and disclosed" caveat.
// ---------------------------------------------------------------------------

const CANDIDATE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEASURE_CANDIDATE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function pendingBandCandidate(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: CANDIDATE_ID,
      workspace_id: WORKSPACE_A,
      rtp_cycle_id: RTP_CYCLE_ID,
      target_kind: "horizon_band",
      status: "pending",
      quote_verified: true,
      ...overrides,
    },
    error: null,
  };
}

const TRANSCRIBED_BAND = { label: "2023–2032", startYear: 2023, endYear: 2032 };

describe("/api/rtp-cycles/[rtpCycleId]/horizon-bands — accepting a transcription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorded.length = 0;
    for (const key of Object.keys(queued)) delete queued[key];

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    setMembership(WORKSPACE_A, "member");
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    createServiceRoleClientMock.mockImplementation(() => ({ from: fromMock }));
  });

  it("a hand-typed period asks the staging table nothing", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_horizon_bands", { data: storedBandRow(), error: null });

    const response = await postBand(request("POST", TRANSCRIBED_BAND), routeContext);

    expect(response.status).toBe(200);
    expect(queriesFor("rtp_extraction_candidates")).toEqual([]);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    const inserted = argsOf("rtp_horizon_bands", "insert")?.[0] as Record<string, unknown>;
    expect(inserted).not.toHaveProperty("extraction_candidate_id");
  });

  it("records the page a transcribed period came from and marks the passage accepted", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_extraction_candidates", pendingBandCandidate());
    queueResult("rtp_horizon_bands", { data: storedBandRow({ id: BAND_ID }), error: null });
    queueResult("rtp_extraction_candidates", { data: { id: CANDIDATE_ID }, error: null });

    const response = await postBand(
      request("POST", { ...TRANSCRIBED_BAND, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const inserted = argsOf("rtp_horizon_bands", "insert")?.[0] as Record<string, unknown>;
    expect(inserted.extraction_candidate_id).toBe(CANDIDATE_ID);
    // Still null, because the document did not state one. This is the caveat
    // the whole band lane is careful about.
    expect(inserted.escalation_target_year).toBeNull();

    const flip = queriesFor("rtp_extraction_candidates")[1];
    const update = flip?.calls.find((call) => call.method === "update")?.args[0] as Record<string, unknown>;
    expect(update).toMatchObject({ status: "accepted", accepted_row_id: BAND_ID, reviewed_by: USER_ID });
    expect(body.extractionCandidate).toEqual({ id: CANDIDATE_ID, recorded: true });
  });

  it("the lookup is scoped to this plan and this workspace", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_extraction_candidates", pendingBandCandidate());
    queueResult("rtp_horizon_bands", { data: storedBandRow(), error: null });
    queueResult("rtp_extraction_candidates", { data: { id: CANDIDATE_ID }, error: null });

    await postBand(
      request("POST", { ...TRANSCRIBED_BAND, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );

    const lookup = queriesFor("rtp_extraction_candidates")[0];
    const scoping = lookup.calls.filter((call) => call.method === "eq").map((call) => call.args);
    expect(scoping).toEqual([
      ["id", CANDIDATE_ID],
      ["rtp_cycle_id", RTP_CYCLE_ID],
      ["workspace_id", WORKSPACE_A],
    ]);
  });

  it("refuses a passage staged for a different part of the plan, and writes nothing", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult(
      "rtp_extraction_candidates",
      pendingBandCandidate({ id: MEASURE_CANDIDATE_ID, target_kind: "performance_measure" })
    );

    const response = await postBand(
      request("POST", { ...TRANSCRIBED_BAND, fromExtractionCandidateId: MEASURE_CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "That transcription belongs somewhere else in the plan",
    });
    expect(queriesFor("rtp_horizon_bands")).toEqual([]);
  });

  it("the same incoherent years are refused whether or not a transcription is named", async () => {
    /**
     * Both runs get an authorization read and NOTHING else queued. The year
     * check sits between authorization and the resolver, so if naming a
     * transcription ever bought a payload past a rule — or if the resolver
     * were moved above the check — the harness would throw "No queued Supabase
     * result" instead of quietly passing.
     */
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });

    const typed = await postBand(
      request("POST", { label: "Backwards", startYear: 2035, endYear: 2026 }),
      routeContext
    );
    const transcribed = await postBand(
      request("POST", {
        label: "Backwards",
        startYear: 2035,
        endYear: 2026,
        fromExtractionCandidateId: CANDIDATE_ID,
      }),
      routeContext
    );

    expect(typed.status).toBe(400);
    expect(transcribed.status).toBe(400);
    expect(queriesFor("rtp_extraction_candidates")).toEqual([]);
    expect(queriesFor("rtp_horizon_bands")).toEqual([]);
  });

  it("an escalation year outside the period is refused for a transcription too", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });

    const response = await postBand(
      request("POST", {
        ...TRANSCRIBED_BAND,
        escalationTargetYear: 2045,
        fromExtractionCandidateId: CANDIDATE_ID,
      }),
      routeContext
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("must fall inside the period");
    expect(queriesFor("rtp_horizon_bands")).toEqual([]);
  });

  it("a PATCH naming only a transcription is still 'nothing to update'", async () => {
    const response = await patchBand(
      request("PATCH", { bandId: BAND_ID, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid horizon period update payload" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("a PATCH that changes a value records the page it came from", async () => {
    queueResult("rtp_cycles", { data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_A }, error: null });
    queueResult("rtp_horizon_bands", { data: storedBandRow(), error: null });
    queueResult("rtp_extraction_candidates", pendingBandCandidate());
    queueResult("rtp_horizon_bands", { data: storedBandRow({ end_year: 2032 }), error: null });
    queueResult("rtp_extraction_candidates", { data: { id: CANDIDATE_ID }, error: null });

    const response = await patchBand(
      request("PATCH", { bandId: BAND_ID, endYear: 2032, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(200);
    const update = argsOf("rtp_horizon_bands", "update", 1)?.[0] as Record<string, unknown>;
    expect(update).toMatchObject({ end_year: 2032, extraction_candidate_id: CANDIDATE_ID });
  });
});
