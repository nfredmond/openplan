import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadProjectAccessMock = vi.fn();

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const AWARD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const awardsOrderMock = vi.fn();
const awardsEqMock = vi.fn(() => ({ order: awardsOrderMock }));
const awardsSelectMock = vi.fn(() => ({ eq: awardsEqMock, order: awardsOrderMock }));
const awardsSingleMock = vi.fn();
const awardsInsertSelectMock = vi.fn(() => ({ single: awardsSingleMock }));
const awardsInsertMock = vi.fn(() => ({ select: awardsInsertSelectMock }));

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
  loadProjectAccess: (...args: unknown[]) => loadProjectAccessMock(...args),
}));

import { GET as getFundingAwards, POST as postFundingAwards } from "@/app/api/funding-awards/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/funding-awards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/funding-awards", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } });

    awardsOrderMock.mockResolvedValue({
      data: [
        {
          id: AWARD_ID,
          project_id: PROJECT_ID,
          title: "ATP award",
          awarded_amount: 1750000,
          match_amount: 250000,
          match_posture: "secured",
          spending_status: "active",
          risk_flag: "watch",
        },
      ],
      error: null,
    });

    awardsSingleMock.mockResolvedValue({
      data: {
        id: AWARD_ID,
        project_id: PROJECT_ID,
        title: "ATP award",
        awarded_amount: 1750000,
      },
      error: null,
    });

    loadProjectAccessMock.mockResolvedValue({
      supabase: null,
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === "funding_awards") {
          return {
            select: awardsSelectMock,
            insert: awardsInsertMock,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });
  });

  it("GET lists funding awards", async () => {
    const response = await getFundingAwards(new NextRequest(`http://localhost/api/funding-awards?projectId=${PROJECT_ID}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      awards: [expect.objectContaining({ id: AWARD_ID, title: "ATP award" })],
    });
  });

  it("POST creates a funding award", async () => {
    const response = await postFundingAwards(
      jsonRequest({
        projectId: PROJECT_ID,
        title: "ATP award",
        awardedAmount: 1750000,
        matchAmount: 250000,
      })
    );

    expect(response.status).toBe(201);
    expect(awardsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        title: "ATP award",
        awarded_amount: 1750000,
      })
    );
  });
});
