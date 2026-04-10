import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadProjectAccessMock = vi.fn();

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const profileSingleMock = vi.fn();
const profileSelectMock = vi.fn(() => ({ single: profileSingleMock }));
const profileUpsertMock = vi.fn(() => ({ select: profileSelectMock }));

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

import { PATCH as patchProjectFundingProfile } from "@/app/api/projects/[projectId]/funding-profile/route";

describe("/api/projects/[projectId]/funding-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } });

    loadProjectAccessMock.mockResolvedValue({
      supabase: null,
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      error: null,
      allowed: true,
    });

    profileSingleMock.mockResolvedValue({
      data: {
        id: "profile-1",
        project_id: PROJECT_ID,
        funding_need_amount: 2500000,
        local_match_need_amount: 500000,
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: vi.fn((table: string) => {
        if (table === "project_funding_profiles") {
          return {
            upsert: profileUpsertMock,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });
  });

  it("PATCH upserts the project funding profile", async () => {
    const response = await patchProjectFundingProfile(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/funding-profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fundingNeedAmount: 2500000, localMatchNeedAmount: 500000 }),
      }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) }
    );

    expect(response.status).toBe(200);
    expect(profileUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        funding_need_amount: 2500000,
        local_match_need_amount: 500000,
      }),
      expect.objectContaining({ onConflict: "project_id" })
    );
    expect(await response.json()).toMatchObject({
      profile: expect.objectContaining({ project_id: PROJECT_ID }),
    });
  });
});
