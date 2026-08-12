import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * ATTACHING A MODEL RUN AS THE EVIDENCE BEHIND AN RTP PORTFOLIO DECISION.
 *
 * PATCH verifies the run belongs to the same workspace before it stores the
 * pointer. That verification read used to discard its error, so a read that
 * FAILED took the same branch a read that found nothing takes and answered
 * 400 "Model run not found in this workspace" — a statement about the
 * workspace's own model runs, made on the strength of a question the database
 * never answered, to a planner who picked the run out of a list of that
 * workspace's runs a moment earlier.
 *
 * The harness fails that ONE read and leaves the project, membership and link
 * reads working, because a mocked client returns its fixture for whatever is
 * asked and an untargeted failure proves nothing about which read was checked.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const LINK_ID = "44444444-4444-4444-8444-444444444444";
const MODEL_RUN_ID = "55555555-5555-4555-8555-555555555555";
/** The cycle this link sits in. The link row's own cycle, not one from the request. */
const CYCLE_ID = "66666666-6666-4666-8666-666666666666";
const HORIZON_BAND_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_CYCLE_ID = "88888888-8888-4888-8888-888888888888";
const OTHER_WORKSPACE_ID = "99999999-9999-4999-8999-999999999999";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import {
  DELETE as deleteRtpLink,
  PATCH as patchRtpLink,
  POST as postRtpLink,
} from "@/app/api/projects/[projectId]/rtp-links/route";

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

/** The `model_runs` read — the one read each test varies. */
let modelRunRead: QueryResult;

/** The `rtp_horizon_bands` read — the one the programmed-cost tests vary. */
let horizonBandRead: QueryResult;

/** The `rtp_cycles` read POST makes. Varied to prove the same-workspace check. */
let rtpCycleRead: QueryResult;

/**
 * What the DELETE against `project_rtp_cycle_links` resolves to.
 *
 * Separate from the read fixture because the whole point of the delete tests is
 * that a delete which matched NOTHING is a different outcome from one that
 * matched a row — and a harness that answered the same fixture whichever way
 * the chain was spelled could not tell those apart, which is the vacuous-test
 * trap. Resolved from the ops list below, so it is reached by
 * `.delete().eq().select().maybeSingle()` AND by a bare `.delete().eq()`; a
 * mutation that removes the `.select()` therefore still gets this fixture and
 * is judged on what the ROUTE does with it.
 */
let linkDeleteResult: QueryResult;

/**
 * A transcribed programmed cost, staged off the adopted plan's own project
 * table, and what the flip that marks it accepted answers.
 */
const CANDIDATE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let candidateRead: QueryResult;
let candidateFlip: QueryResult;

function pendingProjectCandidate(overrides: Record<string, unknown> = {}): QueryResult {
  return {
    data: {
      id: CANDIDATE_ID,
      workspace_id: WORKSPACE_ID,
      rtp_cycle_id: CYCLE_ID,
      target_kind: "programmed_project",
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
      if (table === "project_rtp_cycle_links") {
        return makeChain(table, (ops) =>
          ops.includes("delete")
            ? linkDeleteResult
            : ops.includes("update") || ops.includes("insert")
            ? {
                data: {
                  id: LINK_ID,
                  project_id: PROJECT_ID,
                  rtp_cycle_id: CYCLE_ID,
                  portfolio_role: "candidate",
                  priority_rationale: null,
                  priority_scores: {},
                  evidence_model_run_id: MODEL_RUN_ID,
                  created_at: "2026-08-01T00:00:00.000Z",
                },
                error: null,
              }
            : {
                data: {
                  id: LINK_ID,
                  project_id: PROJECT_ID,
                  workspace_id: WORKSPACE_ID,
                  // The horizon-band check compares against the STORED cycle.
                  rtp_cycle_id: CYCLE_ID,
                },
                error: null,
              }
        );
      }
      if (table === "workspace_members") {
        return makeChain(table, () => ({
          data: { workspace_id: WORKSPACE_ID, role: "admin" },
          error: null,
        }));
      }
      if (table === "model_runs") {
        return makeChain(table, () => modelRunRead);
      }
      if (table === "rtp_horizon_bands") {
        return makeChain(table, () => horizonBandRead);
      }
      if (table === "projects") {
        return makeChain(table, () => ({
          data: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Corridor resurfacing" },
          error: null,
        }));
      }
      if (table === "rtp_cycles") {
        return makeChain(table, () => rtpCycleRead);
      }
      // The staging table a transcribed programmed cost is accepted from.
      // Lookup and flip are separate fixtures so a test can fail one without
      // pretending the other failed too.
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

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/rtp-links`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeContext = { params: Promise.resolve({ projectId: PROJECT_ID }) };

function linkUpdateHappened(): boolean {
  return dbCalls.some((call) => call.table === "project_rtp_cycle_links" && call.method === "update");
}

/**
 * The object handed to `.update()`.
 *
 * Asserted on instead of the response body because the fixture above returns
 * the same row whatever was sent — a body assertion would pass with the write
 * removed. What reached the database is the claim worth making.
 */
function linkUpdatePayload(): Record<string, unknown> | undefined {
  const call = dbCalls.find((entry) => entry.table === "project_rtp_cycle_links" && entry.method === "update");
  return call?.args[0] as Record<string, unknown> | undefined;
}

/** Every `.select("…")` string this request asked `table` for. */
function projectionsFor(table: string): string[] {
  return dbCalls
    .filter((call) => call.table === table && call.method === "select")
    .map((call) => String(call.args[0] ?? ""));
}

describe("PATCH /api/projects/[projectId]/rtp-links — the evidence run check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbCalls.length = 0;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    modelRunRead = { data: { id: MODEL_RUN_ID, workspace_id: WORKSPACE_ID }, error: null };
    installClient();
  });

  it("does not claim the run is missing from the workspace when the lookup failed", async () => {
    modelRunRead = {
      data: null,
      error: { message: "permission denied for table model_runs", code: "42501" },
    };

    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, evidenceModelRunId: MODEL_RUN_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load model run");
    expect(body.hint).toContain("read failure, not an empty result");

    // The old false claim, in the planner's own words.
    expect(body.error).not.toBe("Model run not found in this workspace");
    expect(linkUpdateHappened()).toBe(false);

    expect(mockAudit.error).toHaveBeenCalledWith(
      "evidence_model_run_lookup_failed",
      expect.objectContaining({
        modelRunId: MODEL_RUN_ID,
        message: "permission denied for table model_runs",
      })
    );
  });

  it("answers 503 when the model run table is not migrated yet", async () => {
    modelRunRead = {
      data: null,
      error: { message: "Could not find the table 'public.model_runs' in the schema cache" },
    };

    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, evidenceModelRunId: MODEL_RUN_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("Model run schema is not available yet");
    expect(linkUpdateHappened()).toBe(false);
  });

  it("still refuses a run that genuinely is not in this workspace", async () => {
    modelRunRead = { data: null, error: null };

    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, evidenceModelRunId: MODEL_RUN_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Model run not found in this workspace");
    expect(linkUpdateHappened()).toBe(false);
  });

  it("still refuses a run that belongs to another workspace", async () => {
    modelRunRead = {
      data: { id: MODEL_RUN_ID, workspace_id: "99999999-9999-4999-8999-999999999999" },
      error: null,
    };

    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, evidenceModelRunId: MODEL_RUN_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Model run not found in this workspace");
    expect(linkUpdateHappened()).toBe(false);
  });

  it("attaches the evidence run when the lookup succeeds", async () => {
    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, evidenceModelRunId: MODEL_RUN_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.link.evidence_model_run_id).toBe(MODEL_RUN_ID);
    expect(linkUpdateHappened()).toBe(true);
  });
});

/**
 * THE COST A PROJECT IS PROGRAMMED AT IN THIS CYCLE.
 *
 * Two things here are load-bearing beyond ordinary CRUD.
 *
 * NULL MEANS UNPRICED, and it is a different answer from zero. A cycle holding
 * forty projects, twelve of them uncosted, has to report twelve uncosted
 * projects — not a total that looks complete and a fiscal-constraint verdict
 * resting on it. Every coercion between the two directions is asserted against
 * below, because both are one character away in ordinary code (`|| null`
 * swallows a deliberate zero; `?? 0` prices everything a planner cleared).
 *
 * A BAND BELONGS TO ONE CYCLE. Writing another cycle's band onto this link
 * moves the project's money out of this plan's arithmetic and into a different
 * plan's, and both totals look entirely ordinary afterwards. Nothing downstream
 * can detect it, so it has to be refused here.
 *
 * Assertions are made on what reached `.update()` rather than on the response
 * body: the harness fixture returns the same row whatever was sent, so a body
 * assertion would still pass with the write deleted.
 */
describe("PATCH /api/projects/[projectId]/rtp-links — the programmed cost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbCalls.length = 0;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    modelRunRead = { data: { id: MODEL_RUN_ID, workspace_id: WORKSPACE_ID }, error: null };
    horizonBandRead = {
      data: { id: HORIZON_BAND_ID, rtp_cycle_id: CYCLE_ID, workspace_id: WORKSPACE_ID },
      error: null,
    };
    installClient();
  });

  it("stores the cost, its basis year and the band it belongs to", async () => {
    const response = await patchRtpLink(
      patchRequest({
        linkId: LINK_ID,
        horizonBandId: HORIZON_BAND_ID,
        estimatedCost: 2_500_000,
        costBasisYear: 2026,
      }),
      routeContext
    );

    expect(response.status).toBe(200);
    // The values sent, not merely "some values": a route that hardcoded a
    // figure would satisfy a shape assertion.
    expect(linkUpdatePayload()).toMatchObject({
      horizon_band_id: HORIZON_BAND_ID,
      estimated_cost: 2_500_000,
      cost_basis_year: 2026,
    });
  });

  it("keeps a deliberate zero as a price rather than filing it as unpriced", async () => {
    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, estimatedCost: 0 }), routeContext);

    expect(response.status).toBe(200);
    // `|| null` here would say this project has never been costed, when the
    // agency costed it and the answer was zero.
    expect(linkUpdatePayload()?.estimated_cost).toBe(0);
  });

  it("clears the cost back to unpriced without writing a zero", async () => {
    const response = await patchRtpLink(
      patchRequest({ linkId: LINK_ID, estimatedCost: null, costBasisYear: null, horizonBandId: null }),
      routeContext
    );
    const payload = linkUpdatePayload();

    expect(response.status).toBe(200);
    expect(payload).toHaveProperty("estimated_cost");
    expect(payload?.estimated_cost).toBeNull();
    expect(payload?.estimated_cost).not.toBe(0);
    expect(payload?.cost_basis_year).toBeNull();
    expect(payload?.horizon_band_id).toBeNull();
    // Clearing a band is not a band to verify — no cycle check is owed here.
    expect(dbCalls.some((call) => call.table === "rtp_horizon_bands")).toBe(false);
  });

  it("treats an emptied text box as unpriced rather than as zero dollars", async () => {
    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, estimatedCost: "" }), routeContext);

    expect(response.status).toBe(200);
    expect(linkUpdatePayload()?.estimated_cost).toBeNull();
    expect(linkUpdatePayload()?.estimated_cost).not.toBe(0);
  });

  it("leaves a cost it was not asked about alone", async () => {
    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, costBasisYear: 2030 }), routeContext);
    const payload = linkUpdatePayload();

    expect(response.status).toBe(200);
    expect(payload?.cost_basis_year).toBe(2030);
    // ABSENT and null are different requests. A key written as null here would
    // erase a cost the planner never mentioned.
    expect(payload).not.toHaveProperty("estimated_cost");
    expect(payload).not.toHaveProperty("horizon_band_id");
  });

  it("refuses a negative cost and says which field and why", async () => {
    const response = await patchRtpLink(patchRequest({ linkId: LINK_ID, estimatedCost: -1 }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.details).toContain("estimatedCost");
    expect(body.details).toContain("cannot be negative");
    expect(linkUpdateHappened()).toBe(false);
  });

  /**
   * The ceiling is the COLUMN'S, and it was wrong by a factor of ten.
   *
   * `estimated_cost` is NUMERIC(16, 2) — 99,999,999,999,999.99 — and the route
   * originally rejected at 9,999,999,999,999, one digit short, while its own
   * comment said "fourteen digits". The sibling financial-assumptions route
   * bounds the same NUMERIC(16, 2) at the correct figure, so the revenue side
   * and the cost side of one fiscal-constraint subtraction disagreed about what
   * a plan may hold. Both boundaries are asserted because only the pair
   * distinguishes "the right ceiling" from "some ceiling".
   */
  it("accepts a cost at the column's ceiling and refuses one past it", async () => {
    const CEILING = 99_999_999_999_999;

    const accepted = await patchRtpLink(patchRequest({ linkId: LINK_ID, estimatedCost: CEILING }), routeContext);
    expect(accepted.status).toBe(200);
    expect(linkUpdatePayload()?.estimated_cost).toBe(CEILING);

    dbCalls.length = 0;

    const refused = await patchRtpLink(patchRequest({ linkId: LINK_ID, estimatedCost: CEILING * 10 }), routeContext);
    const body = await refused.json();

    expect(refused.status).toBe(400);
    expect(body.details).toContain("estimatedCost");
    expect(body.details).toContain("larger than this field can store");
    expect(linkUpdateHappened()).toBe(false);
  });

  it("refuses a horizon band from another RTP cycle", async () => {
    horizonBandRead = {
      data: { id: HORIZON_BAND_ID, rtp_cycle_id: OTHER_CYCLE_ID, workspace_id: WORKSPACE_ID },
      error: null,
    };

    const response = await patchRtpLink(
      patchRequest({ linkId: LINK_ID, horizonBandId: HORIZON_BAND_ID, estimatedCost: 2_500_000 }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Horizon band not found in this RTP cycle");
    // Nothing at all is saved — not the band, and not the cost that came with it.
    expect(linkUpdateHappened()).toBe(false);
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "horizon_band_rejected",
      expect.objectContaining({ linkId: LINK_ID, expectedRtpCycleId: CYCLE_ID, bandRtpCycleId: OTHER_CYCLE_ID })
    );
  });

  it("refuses a horizon band from another workspace", async () => {
    horizonBandRead = {
      data: { id: HORIZON_BAND_ID, rtp_cycle_id: CYCLE_ID, workspace_id: OTHER_WORKSPACE_ID },
      error: null,
    };

    const response = await patchRtpLink(
      patchRequest({ linkId: LINK_ID, horizonBandId: HORIZON_BAND_ID }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Horizon band not found in this RTP cycle");
    expect(linkUpdateHappened()).toBe(false);
  });

  it("does not claim the band is in another cycle when the band lookup failed", async () => {
    horizonBandRead = {
      data: null,
      error: { message: "Could not find the table 'public.rtp_horizon_bands' in the schema cache" },
    };

    const response = await patchRtpLink(
      patchRequest({ linkId: LINK_ID, horizonBandId: HORIZON_BAND_ID }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("RTP financial schema is not available yet");
    expect(body.error).not.toBe("Horizon band not found in this RTP cycle");
    expect(linkUpdateHappened()).toBe(false);
  });

  it("asks the database for the columns the band check and the response depend on", async () => {
    await patchRtpLink(
      patchRequest({ linkId: LINK_ID, horizonBandId: HORIZON_BAND_ID, estimatedCost: 12_345 }),
      routeContext
    );

    const linkProjections = projectionsFor("project_rtp_cycle_links");

    // A mocked client answers with its fixture whatever was asked for, so the
    // band check would still pass with `rtp_cycle_id` dropped from the lookup
    // — and would then compare against `undefined` against a real database and
    // refuse every band. The projection string is the only place this is
    // visible from a unit test.
    expect(linkProjections[0]).toContain("rtp_cycle_id");

    for (const column of ["horizon_band_id", "estimated_cost", "cost_basis_year"]) {
      expect(linkProjections[1]).toContain(column);
    }
    expect(projectionsFor("rtp_horizon_bands")[0]).toContain("rtp_cycle_id");
  });
});

/**
 * THE SAME MONEY, ON THE DAY THE LINK IS CREATED.
 *
 * POST accepts the identical three financial fields PATCH does, and until this
 * block existed not one of them was exercised — the whole creation path was
 * covered by nothing at all. That matters more than a missing-coverage note
 * usually does, because the two handlers verify the horizon band through the
 * SAME shared function but reach it with DIFFERENT cycle ids: PATCH compares
 * against the stored link's cycle, POST against the cycle named in the request
 * body it has just proved belongs to the project's workspace. A test that only
 * drives PATCH proves the shared function works and says nothing about whether
 * the second caller passes it the right cycle — which is the exact shape of the
 * defect the shared function was extracted to prevent.
 */
describe("POST /api/projects/[projectId]/rtp-links — the programmed cost at creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbCalls.length = 0;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    horizonBandRead = {
      data: { id: HORIZON_BAND_ID, rtp_cycle_id: CYCLE_ID, workspace_id: WORKSPACE_ID },
      error: null,
    };
    rtpCycleRead = {
      data: {
        id: CYCLE_ID,
        workspace_id: WORKSPACE_ID,
        title: "2050 RTP",
        status: "draft",
        geography_label: null,
        horizon_start_year: 2026,
        horizon_end_year: 2050,
      },
      error: null,
    };
    installClient();
  });

  function postRequest(body: Record<string, unknown>) {
    return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/rtp-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** The row handed to `.insert()`, for the same reason `linkUpdatePayload` exists. */
  function linkInsertPayload(): Record<string, unknown> | undefined {
    const call = dbCalls.find((entry) => entry.table === "project_rtp_cycle_links" && entry.method === "insert");
    return call?.args[0] as Record<string, unknown> | undefined;
  }

  function linkInsertHappened(): boolean {
    return dbCalls.some((call) => call.table === "project_rtp_cycle_links" && call.method === "insert");
  }

  it("stores the cost, its basis year and the band, and takes the workspace from the project", async () => {
    const response = await postRtpLink(
      postRequest({
        rtpCycleId: CYCLE_ID,
        horizonBandId: HORIZON_BAND_ID,
        estimatedCost: 4_200_000,
        costBasisYear: 2026,
      }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(linkInsertPayload()).toMatchObject({
      // Never from the request body. The body carries no workspace id at all,
      // and this is the row that decides which agency owns the money.
      workspace_id: WORKSPACE_ID,
      project_id: PROJECT_ID,
      rtp_cycle_id: CYCLE_ID,
      horizon_band_id: HORIZON_BAND_ID,
      estimated_cost: 4_200_000,
      cost_basis_year: 2026,
    });
  });

  it("creates an unpriced link as unpriced rather than as zero dollars", async () => {
    const response = await postRtpLink(postRequest({ rtpCycleId: CYCLE_ID }), routeContext);
    const payload = linkInsertPayload();

    expect(response.status).toBe(200);
    // A NOT NULL column with a zero default would be the same defect one layer
    // down; the row this route writes must carry the null explicitly.
    expect(payload?.estimated_cost).toBeNull();
    expect(payload?.estimated_cost).not.toBe(0);
    expect(payload?.cost_basis_year).toBeNull();
    expect(payload?.horizon_band_id).toBeNull();
    // Nothing to verify when no band was named.
    expect(dbCalls.some((call) => call.table === "rtp_horizon_bands")).toBe(false);
  });

  it("keeps a deliberate zero at creation as a price", async () => {
    const response = await postRtpLink(postRequest({ rtpCycleId: CYCLE_ID, estimatedCost: 0 }), routeContext);

    expect(response.status).toBe(200);
    expect(linkInsertPayload()?.estimated_cost).toBe(0);
  });

  it("refuses a horizon band from another RTP cycle at creation", async () => {
    horizonBandRead = {
      data: { id: HORIZON_BAND_ID, rtp_cycle_id: OTHER_CYCLE_ID, workspace_id: WORKSPACE_ID },
      error: null,
    };

    const response = await postRtpLink(
      postRequest({ rtpCycleId: CYCLE_ID, horizonBandId: HORIZON_BAND_ID, estimatedCost: 4_200_000 }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Horizon band not found in this RTP cycle");
    // The band is checked against the cycle THIS link is being created in.
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "horizon_band_rejected",
      expect.objectContaining({ expectedRtpCycleId: CYCLE_ID, bandRtpCycleId: OTHER_CYCLE_ID })
    );
    // Not the band, and not the cost that came with it.
    expect(linkInsertHappened()).toBe(false);
  });

  it("refuses a cycle in another workspace before it looks at anything else", async () => {
    rtpCycleRead = {
      data: {
        id: CYCLE_ID,
        workspace_id: OTHER_WORKSPACE_ID,
        title: "Someone else's RTP",
        status: "draft",
        geography_label: null,
        horizon_start_year: 2026,
        horizon_end_year: 2050,
      },
      error: null,
    };

    const response = await postRtpLink(
      postRequest({ rtpCycleId: CYCLE_ID, estimatedCost: 4_200_000 }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("RTP cycle must belong to the same workspace");
    expect(linkInsertHappened()).toBe(false);
  });

  it("refuses a negative cost at creation and says which field and why", async () => {
    const response = await postRtpLink(postRequest({ rtpCycleId: CYCLE_ID, estimatedCost: -5 }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.details).toContain("estimatedCost");
    expect(body.details).toContain("cannot be negative");
    expect(linkInsertHappened()).toBe(false);
  });

  it("asks the database for the financial columns it hands back", async () => {
    await postRtpLink(
      postRequest({ rtpCycleId: CYCLE_ID, horizonBandId: HORIZON_BAND_ID, estimatedCost: 1 }),
      routeContext
    );

    const projection = projectionsFor("project_rtp_cycle_links")[0] ?? "";
    for (const column of ["horizon_band_id", "estimated_cost", "cost_basis_year"]) {
      expect(projection).toContain(column);
    }
  });
});

/**
 * REMOVING A PROJECT FROM AN RTP CYCLE — and not saying so when nothing moved.
 *
 * DELETE used to be `.delete().eq("id", …)` with `if (error) return 500`. That
 * spelling cannot see the outcome it most needs to see: PostgREST answers a
 * delete that matched ZERO rows with `error: null`, so the handler returned
 * `{ ok: true }` and wrote `audit.info("deleted")` for a row still sitting in
 * the table. The planner is told the project left the plan, the audit ledger
 * records a deletion that did not occur, and the interface removes the row from
 * the list until the next reload puts it back.
 *
 * WHETHER THIS IS LIVE DATA LOSS TODAY: it is not. `20260409000036` creates a
 * PERMISSIVE `FOR DELETE` policy for every member of the row's workspace, and
 * `20260728000006` narrows it with a RESTRICTIVE gate at `role >= member` —
 * which is exactly the set `canAccessWorkspaceAction("plans.write", …)` admits
 * (owner/admin/member), so a caller the route lets through is a caller the
 * database lets through. The reachable zero-row cases are a concurrent delete
 * and a future policy regression. This test is what makes the second one
 * visible instead of silent.
 */
describe("DELETE /api/projects/[projectId]/rtp-links — a delete that changed nothing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbCalls.length = 0;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    linkDeleteResult = { data: { id: LINK_ID }, error: null };
    installClient();
  });

  function deleteRequest(body: Record<string, unknown>) {
    return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/rtp-links`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function linkDeleteHappened(): boolean {
    return dbCalls.some((call) => call.table === "project_rtp_cycle_links" && call.method === "delete");
  }

  it("removes the link and reports it once, when a row actually matched", async () => {
    const response = await deleteRtpLink(deleteRequest({ linkId: LINK_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(linkDeleteHappened()).toBe(true);
    expect(mockAudit.info).toHaveBeenCalledWith("deleted", expect.objectContaining({ linkId: LINK_ID }));
  });

  it("does not report success when the delete matched no rows and reported no error", async () => {
    // `.maybeSingle()`'s spelling of "nothing matched": no row, no error. The
    // old handler read this as a clean success.
    linkDeleteResult = { data: null, error: null };

    const response = await deleteRtpLink(deleteRequest({ linkId: LINK_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("The RTP link was not saved");
    expect(body.details).toContain("matched no rows");
    // The claim the planner was previously given for a row that never moved.
    expect(body.ok).toBeUndefined();

    // And the ledger must not record a deletion that did not happen.
    expect(mockAudit.info).not.toHaveBeenCalledWith("deleted", expect.anything());
    expect(mockAudit.error).toHaveBeenCalledWith(
      "delete_matched_no_rows",
      expect.objectContaining({ linkId: LINK_ID, projectId: PROJECT_ID })
    );
  });

  it("treats PGRST116 as nothing matched rather than as a server fault", async () => {
    // The OTHER spelling of the same outcome, which arrives when the query is
    // written with `.single()`. A route that tests `if (error)` alone collapses
    // it into "Failed to remove RTP link" — an authorization or concurrency
    // outcome wearing a server error's clothes.
    linkDeleteResult = { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };

    const response = await deleteRtpLink(deleteRequest({ linkId: LINK_ID }), routeContext);
    const body = await response.json();

    expect(body.error).toBe("The RTP link was not saved");
    expect(body.error).not.toBe("Failed to remove RTP link");
    expect(body.details).toContain("matched no rows");
    expect(mockAudit.info).not.toHaveBeenCalledWith("deleted", expect.anything());
  });

  it("still reports a genuine database failure as a failure", async () => {
    linkDeleteResult = { data: null, error: { message: "permission denied for table project_rtp_cycle_links", code: "42501" } };

    const response = await deleteRtpLink(deleteRequest({ linkId: LINK_ID }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to remove RTP link");
    expect(mockAudit.error).toHaveBeenCalledWith(
      "delete_failed",
      expect.objectContaining({ code: "42501" })
    );
  });

  it("reads back only the id, so a delete does not depend on the financial migration", async () => {
    await deleteRtpLink(deleteRequest({ linkId: LINK_ID }), routeContext);

    // The projection after the lookup is the delete's own read-back. Asking for
    // `estimated_cost` here would make every delete answer 503 "RTP financial
    // schema is not available yet" on a deployment that has not run
    // 20260805000003 — a migration this handler does not write through.
    const projections = projectionsFor("project_rtp_cycle_links");
    expect(projections).toHaveLength(2);
    expect(projections[1]).toBe("id");
    for (const column of ["estimated_cost", "cost_basis_year", "horizon_band_id"]) {
      expect(projections[1]).not.toContain(column);
    }
  });
});

// ---------------------------------------------------------------------------
// A PROGRAMMED COST TRANSCRIBED OFF THE ADOPTED PLAN'S OWN PROJECT TABLE.
//
// The assistant action that assigns a project to a horizon band STAYS REFUSED,
// and nothing here weakens it. Its argument is that the PAIRING is authored
// content — the schema records which period a project is planned for nowhere
// else, and the band sets the escalation exponent. That is still true of a
// model choosing a band. It is not true of copying a row the agency's board
// already adopted and printed, which is what these tests exercise.
//
// The project is never inferred either: a `programmed_project` passage stages a
// NAME STRING, and the project id here comes from the URL a person navigated
// to. There is no fuzzy match anywhere in this path.
// ---------------------------------------------------------------------------

describe("project RTP links — accepting a transcription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbCalls.length = 0;
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    modelRunRead = { data: { id: MODEL_RUN_ID, workspace_id: WORKSPACE_ID }, error: null };
    horizonBandRead = {
      data: { id: HORIZON_BAND_ID, rtp_cycle_id: CYCLE_ID, workspace_id: WORKSPACE_ID },
      error: null,
    };
    rtpCycleRead = {
      data: {
        id: CYCLE_ID,
        workspace_id: WORKSPACE_ID,
        title: "2050 RTP",
        status: "draft",
        geography_label: null,
        horizon_start_year: 2026,
        horizon_end_year: 2050,
      },
      error: null,
    };
    candidateRead = pendingProjectCandidate();
    candidateFlip = { data: { id: CANDIDATE_ID }, error: null };
    installClient();
  });

  function postRequest(body: Record<string, unknown>) {
    return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/rtp-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function linkInsertPayload(): Record<string, unknown> | undefined {
    const call = dbCalls.find((entry) => entry.table === "project_rtp_cycle_links" && entry.method === "insert");
    return call?.args[0] as Record<string, unknown> | undefined;
  }

  function touchedStagingTable(): boolean {
    return dbCalls.some((call) => call.table === "rtp_extraction_candidates");
  }

  /** The lookup's `.eq()`s, cut off before the flip's own. */
  function candidateLookupFilters(): unknown[][] {
    const flipAt = dbCalls.findIndex(
      (entry) => entry.table === "rtp_extraction_candidates" && entry.method === "update"
    );
    return (flipAt === -1 ? dbCalls : dbCalls.slice(0, flipAt))
      .filter((entry) => entry.table === "rtp_extraction_candidates" && entry.method === "eq")
      .map((call) => call.args);
  }

  function candidateFlipValues(): Record<string, unknown> | undefined {
    const call = dbCalls.find((entry) => entry.table === "rtp_extraction_candidates" && entry.method === "update");
    return call?.args[0] as Record<string, unknown> | undefined;
  }

  it("a hand-typed link asks the staging table nothing", async () => {
    const response = await postRtpLink(
      postRequest({ rtpCycleId: CYCLE_ID, estimatedCost: 4_200_000, costBasisYear: 2026 }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(touchedStagingTable()).toBe(false);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(linkInsertPayload()).not.toHaveProperty("extraction_candidate_id");
  });

  it("records the page a transcribed cost, basis year, role and period came from", async () => {
    const response = await postRtpLink(
      postRequest({
        rtpCycleId: CYCLE_ID,
        portfolioRole: "constrained",
        horizonBandId: HORIZON_BAND_ID,
        estimatedCost: 12_400_000,
        costBasisYear: 2026,
        fromExtractionCandidateId: CANDIDATE_ID,
      }),
      routeContext
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(linkInsertPayload()).toMatchObject({
      project_id: PROJECT_ID,
      rtp_cycle_id: CYCLE_ID,
      portfolio_role: "constrained",
      horizon_band_id: HORIZON_BAND_ID,
      estimated_cost: 12_400_000,
      cost_basis_year: 2026,
      extraction_candidate_id: CANDIDATE_ID,
    });
    expect(candidateLookupFilters()).toEqual([
      ["id", CANDIDATE_ID],
      ["rtp_cycle_id", CYCLE_ID],
      ["workspace_id", WORKSPACE_ID],
    ]);
    expect(candidateFlipValues()).toMatchObject({ status: "accepted", reviewed_by: USER_ID });
    expect(body.extractionCandidate).toEqual({ id: CANDIDATE_ID, recorded: true });
  });

  it("an UNPRICED transcribed project is still unpriced, never zero", async () => {
    /**
     * The plan lists the project in its constrained programme and prints no
     * cost for it. NULL means UNPRICED all the way to the fiscal-constraint
     * check, and a transcription that wrote 0 would make an uncosted project
     * look costed and flip the plan's balance.
     */
    const response = await postRtpLink(
      postRequest({
        rtpCycleId: CYCLE_ID,
        portfolioRole: "constrained",
        fromExtractionCandidateId: CANDIDATE_ID,
      }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(linkInsertPayload()!.estimated_cost).toBeNull();
    expect(linkInsertPayload()!.estimated_cost).not.toBe(0);
  });

  it("a band from ANOTHER plan cycle is refused for a transcription too", async () => {
    horizonBandRead = {
      data: { id: HORIZON_BAND_ID, rtp_cycle_id: OTHER_CYCLE_ID, workspace_id: WORKSPACE_ID },
      error: null,
    };

    const typed = await postRtpLink(
      postRequest({ rtpCycleId: CYCLE_ID, horizonBandId: HORIZON_BAND_ID, estimatedCost: 1 }),
      routeContext
    );
    dbCalls.length = 0;
    const transcribed = await postRtpLink(
      postRequest({
        rtpCycleId: CYCLE_ID,
        horizonBandId: HORIZON_BAND_ID,
        estimatedCost: 1,
        fromExtractionCandidateId: CANDIDATE_ID,
      }),
      routeContext
    );

    expect(typed.status).toBe(400);
    expect(transcribed.status).toBe(400);
    expect((await transcribed.json()).error).toBe("Horizon band not found in this RTP cycle");
    expect(linkInsertPayload()).toBeUndefined();
    // The band refusal comes first, so the passage is never even looked up —
    // and it is certainly never marked accepted.
    expect(touchedStagingTable()).toBe(false);
  });

  it("a negative programmed cost is refused whether or not a transcription is named", async () => {
    const typed = await postRtpLink(
      postRequest({ rtpCycleId: CYCLE_ID, estimatedCost: -1 }),
      routeContext
    );
    const typedBody = await typed.json();
    dbCalls.length = 0;
    const transcribed = await postRtpLink(
      postRequest({ rtpCycleId: CYCLE_ID, estimatedCost: -1, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );
    const transcribedBody = await transcribed.json();

    expect(typed.status).toBe(400);
    expect(transcribed.status).toBe(400);
    expect(transcribedBody.details).toBe(typedBody.details);
    expect(transcribedBody.details).toContain("Leave it blank for a project that is not costed yet");
    expect(touchedStagingTable()).toBe(false);
  });

  it("refuses a passage staged as a financial line", async () => {
    candidateRead = pendingProjectCandidate({ target_kind: "financial_line" });

    const response = await postRtpLink(
      postRequest({ rtpCycleId: CYCLE_ID, estimatedCost: 1, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("That transcription belongs somewhere else in the plan");
    expect(linkInsertPayload()).toBeUndefined();
  });

  it("a PATCH naming only a transcription is still 'nothing to update'", async () => {
    const response = await patchRtpLink(
      patchRequest({ linkId: LINK_ID, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("No updatable fields provided");
    expect(linkUpdateHappened()).toBe(false);
    expect(touchedStagingTable()).toBe(false);
  });

  it("a PATCH that takes the document's cost records where it came from", async () => {
    const response = await patchRtpLink(
      patchRequest({ linkId: LINK_ID, estimatedCost: 12_400_000, fromExtractionCandidateId: CANDIDATE_ID }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(linkUpdatePayload()).toMatchObject({
      estimated_cost: 12_400_000,
      extraction_candidate_id: CANDIDATE_ID,
    });
    expect(candidateFlipValues()).toMatchObject({ status: "accepted", accepted_row_id: LINK_ID });
  });

  it("the PATCH scopes the lookup by the STORED link's cycle, not one from the body", async () => {
    /**
     * The same reasoning the horizon-band check rests on: a cycle id taken
     * from the body would let a caller name the plan their passage belongs to
     * and defeat the scoping entirely. Two things hold that line — the update
     * schema has no `rtpCycleId` field at all (so the one sent here is
     * stripped), and the resolver is threaded from `link.rtp_cycle_id`.
     *
     * MUTATION: bind the lookup to `link.workspace_id` instead
     *   => this fails on the filter list. Sending `rtpCycleId` in the body and
     *      reading it back does NOT fail, because zod strips it — which is why
     *      the assertion is on the STORED value rather than on the absence of
     *      the body one.
     */
    await patchRtpLink(
      patchRequest({
        linkId: LINK_ID,
        estimatedCost: 5,
        rtpCycleId: OTHER_CYCLE_ID,
        fromExtractionCandidateId: CANDIDATE_ID,
      }),
      routeContext
    );

    expect(candidateLookupFilters()).toEqual([
      ["id", CANDIDATE_ID],
      ["rtp_cycle_id", CYCLE_ID],
      ["workspace_id", WORKSPACE_ID],
    ]);
  });
});
