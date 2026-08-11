/**
 * A SCAFFOLDED BAND NEVER CARRIES AN ESCALATION TARGET YEAR.
 *
 * This is the guard the refused-actions tripwire demanded before
 * `create_rtp_horizon_bands_from_cycle_horizon` could register. The chain it
 * protects: `escalation_target_year` is what flips `expenditureYearAssumed`
 * to false in `buildRtpFiscalConstraint`, and that flag keeps the "midpoint
 * of the period was assumed" caveat on the PUBLIC draft-review document. A
 * scaffold able to supply the year would be deleting a caveat on a public
 * page — the machine-translation refusal wearing this module's clothes.
 *
 * Both halves are asserted, because each fails a different way:
 *   - BEHAVIORAL: the real route runs against a fake client and every row it
 *     inserts carries the null — plus the rest of the scaffold's honesty
 *     surface (derived labels, refusal of an occupied or horizonless plan,
 *     the agent body-key scope).
 *   - STRUCTURAL: the route source contains the literal and no body path to
 *     the column, so "someone added an escalationTargetYear field" fails
 *     here even if every behavioral fixture forgets to exercise it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn(() => ({}));
const loadCurrentWorkspaceMembershipMock = vi.fn();
const verifyAssistantActionApprovalMock = vi.fn();

const cycleMaybeSingleMock = vi.fn();
const bandCountMock = vi.fn();
const bandInsertMock = vi.fn();

const RTP_CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: () => createServiceRoleClientMock(),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

vi.mock("@/lib/assistant/action-approval-server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    verifyAssistantActionApproval: (...args: unknown[]) => verifyAssistantActionApprovalMock(...args),
  };
});

vi.mock("@/lib/observability/action-audit", () => ({
  withAssistantActionAudit: async (
    _service: unknown,
    _meta: unknown,
    fn: () => Promise<unknown>
  ) => fn(),
  assistantActionAuditIdentity: () => ({}),
}));

const fromMock = vi.fn((table: string) => {
  if (table === "rtp_cycles") {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: cycleMaybeSingleMock })) })),
      })),
    };
  }
  if (table === "rtp_horizon_bands") {
    return {
      select: vi.fn((_cols: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) {
          return { eq: vi.fn(() => ({ eq: vi.fn(() => bandCountMock()) })) };
        }
        return { eq: vi.fn(() => ({ eq: vi.fn(() => bandCountMock()) })) };
      }),
      insert: (rows: unknown) => ({ select: vi.fn(() => bandInsertMock(rows)) }),
    };
  }
  throw new Error(`Unexpected table: ${table}`);
});

import { POST as scaffoldBands } from "@/app/api/rtp-cycles/[rtpCycleId]/horizon-bands/from-cycle-horizon/route";

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/rtp-cycles/${RTP_CYCLE_ID}/horizon-bands/from-cycle-horizon`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function routeContext() {
  return { params: Promise.resolve({ rtpCycleId: RTP_CYCLE_ID }) };
}

function givenAScaffoldableCycle() {
  vi.clearAllMocks();
  createClientMock.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
    from: fromMock,
  });
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: WORKSPACE_ID, role: "member" },
  });
  cycleMaybeSingleMock.mockResolvedValue({
    data: {
      id: RTP_CYCLE_ID,
      workspace_id: WORKSPACE_ID,
      horizon_start_year: 2026,
      horizon_end_year: 2050,
    },
    error: null,
  });
  bandCountMock.mockResolvedValue({ count: 0, error: null });
  bandInsertMock.mockImplementation(async (rows: unknown) => ({ data: rows, error: null }));
}

function insertedRows(): Array<Record<string, unknown>> {
  expect(bandInsertMock).toHaveBeenCalledTimes(1);
  return bandInsertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
}

describe("the scaffold route's rows", () => {
  beforeEach(givenAScaffoldableCycle);

  it("writes escalation_target_year null on EVERY band, and derives everything else", async () => {
    const res = await scaffoldBands(
      request({ workspaceId: WORKSPACE_ID, bandingProfileKey: "near_term_then_outyears" }),
      routeContext()
    );

    expect(res.status).toBe(201);
    const rows = insertedRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.escalation_target_year).toBeNull();
      // Scoping comes from what the route proved, never from the body.
      expect(row.workspace_id).toBe(WORKSPACE_ID);
      expect(row.rtp_cycle_id).toBe(RTP_CYCLE_ID);
      expect(row.created_by).toBe(USER_ID);
    }
    // Derived from the cycle's own 2026–2050 horizon: first ten years, then
    // the out-years — labels from the years, sort order from position.
    expect(rows[0]).toMatchObject({ label: "2026–2035", start_year: 2026, end_year: 2035, sort_order: 0 });
    expect(rows[1]).toMatchObject({ label: "2036–2050", start_year: 2036, end_year: 2050, sort_order: 1 });
  });

  it("refuses a plan that has not declared its horizon, naming the fix", async () => {
    cycleMaybeSingleMock.mockResolvedValue({
      data: { id: RTP_CYCLE_ID, workspace_id: WORKSPACE_ID, horizon_start_year: null, horizon_end_year: null },
      error: null,
    });

    const res = await scaffoldBands(
      request({ bandingProfileKey: "single_period" }),
      routeContext()
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("has not declared its horizon"),
    });
    expect(bandInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a plan that already has periods, instead of interleaving", async () => {
    bandCountMock.mockResolvedValue({ count: 3, error: null });

    const res = await scaffoldBands(
      request({ bandingProfileKey: "five_year_periods" }),
      routeContext()
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("already has horizon periods"),
    });
    expect(bandInsertMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown profile key — the registry is closed", async () => {
    const res = await scaffoldBands(
      request({ bandingProfileKey: "whatever_the_model_invented" }),
      routeContext()
    );
    expect(res.status).toBe(400);
    expect(bandInsertMock).not.toHaveBeenCalled();
  });

  it("refuses an agent request smuggling band fields alongside the approved keys", async () => {
    // The approval hash covers the action the route rebuilds, so extra body
    // keys would ride free — refuseOutOfScopeAgentRequest is the enforcement.
    const res = await scaffoldBands(
      request(
        {
          workspaceId: WORKSPACE_ID,
          bandingProfileKey: "single_period",
          escalationTargetYear: 2040,
        },
        { "x-openplan-assistant-execution-source": "planner_agent_quick_link" }
      ),
      routeContext()
    );

    expect(res.status).toBe(400);
    expect(bandInsertMock).not.toHaveBeenCalled();
    expect(verifyAssistantActionApprovalMock).not.toHaveBeenCalled();
  });

  it("verifies agent approval against the REBUILT action, and 403s a rejection", async () => {
    verifyAssistantActionApprovalMock.mockRejectedValue(new Error("approval hash mismatch"));

    const res = await scaffoldBands(
      request(
        { workspaceId: WORKSPACE_ID, bandingProfileKey: "single_period" },
        { "x-openplan-assistant-execution-source": "planner_agent_quick_link" }
      ),
      routeContext()
    );

    expect(res.status).toBe(403);
    expect(bandInsertMock).not.toHaveBeenCalled();
    const rebuilt = verifyAssistantActionApprovalMock.mock.calls[0]?.[0] as {
      action?: Record<string, unknown>;
    };
    expect(rebuilt?.action).toEqual({
      kind: "create_rtp_horizon_bands_from_cycle_horizon",
      workspaceId: WORKSPACE_ID,
      rtpCycleId: RTP_CYCLE_ID,
      bandingProfileKey: "single_period",
    });
  });
});

describe("the scaffold route's source", () => {
  const routeSource = readFileSync(
    path.join(
      process.cwd(),
      "src/app/api/rtp-cycles/[rtpCycleId]/horizon-bands/from-cycle-horizon/route.ts"
    ),
    "utf8"
  );

  it("writes the column as a literal null and has no body path to it", () => {
    expect(routeSource).toContain("escalation_target_year: null");
    // The sibling route's body-field spelling. Its absence here is what makes
    // "no code path able to set it" a fact about the file rather than about
    // the fixtures above.
    expect(routeSource).not.toContain("escalationTargetYear");
  });

  it("keeps the approval-schema branch on the CLOSED profile enum", () => {
    // A bare `.min(1)` here would let the propose_ tool mint an approval
    // sheet carrying a model-INVENTED profile key the route is guaranteed to
    // 400 — a planner consenting to an action that cannot execute (the
    // 2026-08-10 adversarial review's authorship finding).
    const approvalServer = readFileSync(
      path.join(process.cwd(), "src/lib/assistant/action-approval-server.ts"),
      "utf8"
    );
    expect(approvalServer).toContain("bandingProfileKey: z.enum(HORIZON_BANDING_PROFILE_KEYS)");
  });

  it("accepts exactly the two agent body keys, nothing band-shaped", () => {
    const schemaBlock = /const bodySchema = z\.object\(\{([\s\S]*?)\}\);/.exec(routeSource)?.[1] ?? "";
    expect(schemaBlock).toContain("workspaceId");
    expect(schemaBlock).toContain("bandingProfileKey");
    for (const banned of ["label", "startYear", "endYear", "sortOrder", "costEstimateBasis"]) {
      expect(schemaBlock, `bodySchema must not accept ${banned}`).not.toContain(banned);
    }
  });
});
