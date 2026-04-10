import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
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
        throw new Error(`Unexpected table: ${table}`);
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
});
