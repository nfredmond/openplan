import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const fundingOpportunitiesSingleMock = vi.fn();
const fundingOpportunitiesSelectMock = vi.fn(() => ({ single: fundingOpportunitiesSingleMock }));
const fundingOpportunitiesEqMock = vi.fn(() => ({ select: fundingOpportunitiesSelectMock }));
const fundingOpportunitiesUpdateMock = vi.fn(() => ({ eq: fundingOpportunitiesEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/programs/api", () => ({
  loadFundingOpportunityAccess: (...args: unknown[]) => loadFundingOpportunityAccessMock(...args),
}));

import { PATCH as patchFundingOpportunity } from "@/app/api/funding-opportunities/[opportunityId]/route";

function jsonRequest(payload: unknown) {
  return new NextRequest(`http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/funding-opportunities/[opportunityId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "22222222-2222-4222-8222-222222222222" },
      },
    });

    loadFundingOpportunityAccessMock.mockResolvedValue({
      supabase: null,
      opportunity: {
        id: OPPORTUNITY_ID,
        workspace_id: WORKSPACE_ID,
      },
      membership: {
        workspace_id: WORKSPACE_ID,
        role: "member",
      },
      error: null,
      allowed: true,
    });

    fundingOpportunitiesSingleMock.mockResolvedValue({
      data: {
        id: OPPORTUNITY_ID,
        workspace_id: WORKSPACE_ID,
        decision_state: "skip",
        decision_rationale: "Out of cycle.",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === "funding_opportunities") {
          return {
            update: fundingOpportunitiesUpdateMock,
          };
        }
        if (table === "assistant_action_executions") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });
    createServiceRoleClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "assistant_action_executions") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        throw new Error(`Unexpected service table: ${table}`);
      }),
    });
  });

  it("PATCH updates the funding decision fields", async () => {
    const response = await patchFundingOpportunity(
      jsonRequest({
        decisionState: "skip",
        expectedAwardAmount: 325000,
        fitNotes: "Scoring fit is weak.",
        readinessNotes: "Project definition is not mature enough.",
        decisionRationale: "Out of cycle and below threshold for this package.",
      }),
      { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) }
    );

    expect(response.status).toBe(200);
    expect(fundingOpportunitiesUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decision_state: "skip",
        expected_award_amount: 325000,
        fit_notes: "Scoring fit is weak.",
        readiness_notes: "Project definition is not mature enough.",
        decision_rationale: "Out of cycle and below threshold for this package.",
      })
    );
    expect(await response.json()).toMatchObject({
      opportunity: expect.objectContaining({
        id: OPPORTUNITY_ID,
        decision_state: "skip",
      }),
    });
  });

  it("PATCH reports an update that matched no rows as a refused write, not a broken one", async () => {
    // PostgREST answers `.single()` with PGRST116 when the UPDATE touched
    // nothing. The route already read this opportunity through the caller's own
    // client and passed the write gate, so the refusal came from below the
    // application — the answer names that instead of "Failed to update".
    fundingOpportunitiesSingleMock.mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });

    const response = await patchFundingOpportunity(jsonRequest({ decisionState: "skip" }), {
      params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }),
    });

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toBe("The funding opportunity was not saved");
    expect(payload.details).toContain("row-level security");
    expect(mockAudit.error).toHaveBeenCalledWith(
      "funding_opportunity_update_matched_no_rows",
      expect.objectContaining({ opportunityId: OPPORTUNITY_ID, workspaceId: WORKSPACE_ID })
    );
    expect(mockAudit.error).not.toHaveBeenCalledWith(
      "funding_opportunity_update_failed",
      expect.anything()
    );
  });

  it("PATCH still answers a generic 500 when the update genuinely fails", async () => {
    fundingOpportunitiesSingleMock.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    const response = await patchFundingOpportunity(jsonRequest({ decisionState: "skip" }), {
      params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }),
    });

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("Failed to update funding opportunity");
    expect(mockAudit.error).toHaveBeenCalledWith(
      "funding_opportunity_update_failed",
      expect.objectContaining({ opportunityId: OPPORTUNITY_ID })
    );
  });
});
