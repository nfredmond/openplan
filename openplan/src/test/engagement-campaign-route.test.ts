import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A FAILED READ MAY NOT BECOME A CLAIM ABOUT WORKSPACE MEMBERSHIP.
 *
 * `PATCH /api/engagement/campaigns/[campaignId]` re-checks that the project it
 * is about to link lives in this campaign's workspace, and answers 404 "Project
 * not found in this workspace" when it does not. That sentence is a fact about
 * the agency's own data. It used to be reachable from a read that failed —
 * `const { data: project } = await …` binds no error, so a permission failure, a
 * dropped connection and an unapplied migration all arrived as `null` and were
 * answered as "that project is not yours", about a project the operator was
 * looking at when they clicked.
 *
 * The mocked client is what makes this testable at all: it returns its fixture
 * whatever the code asks for, so the failure path only exists if a named read is
 * made to fail deliberately.
 */

const createClientMock = vi.fn();
const loadCampaignAccessMock = vi.fn();
const loadProjectAccessMock = vi.fn();

const projectScopeMaybeSingle = vi.fn();
const campaignUpdateMaybeSingle = vi.fn();
const campaignUpdateMock = vi.fn(() => ({
  eq: () => ({ select: () => ({ maybeSingle: campaignUpdateMaybeSingle }) }),
}));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return { select: () => ({ eq: () => ({ maybeSingle: projectScopeMaybeSingle }) }) };
  }
  if (table === "engagement_campaigns") {
    return { update: campaignUpdateMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));
vi.mock("@/lib/engagement/api", () => ({
  loadCampaignAccess: (...args: unknown[]) => loadCampaignAccessMock(...args),
  loadProjectAccess: (...args: unknown[]) => loadProjectAccessMock(...args),
}));

import { PATCH } from "@/app/api/engagement/campaigns/[campaignId]/route";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const ctx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };

function patchRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } }) },
    from: fromMock,
  });

  loadCampaignAccessMock.mockResolvedValue({
    campaign: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID, project_id: null },
    membership: { workspace_id: WORKSPACE_ID, role: "editor" },
    error: null,
    allowed: true,
  });

  loadProjectAccessMock.mockResolvedValue({
    project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
    membership: { workspace_id: WORKSPACE_ID, role: "editor" },
    error: null,
    allowed: true,
  });

  projectScopeMaybeSingle.mockResolvedValue({
    data: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
    error: null,
  });
  campaignUpdateMaybeSingle.mockResolvedValue({ data: { id: CAMPAIGN_ID }, error: null });
});

describe("PATCH /api/engagement/campaigns/[campaignId] — linking a project", () => {
  it("links the project when the workspace check reads back the same workspace", async () => {
    const response = await PATCH(patchRequest({ projectId: PROJECT_ID }), ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
  });

  it("still says the project is not in this workspace when the read SUCCEEDED and it is not", async () => {
    projectScopeMaybeSingle.mockResolvedValue({
      data: { id: PROJECT_ID, workspace_id: "99999999-9999-4999-8999-999999999999" },
      error: null,
    });

    const response = await PATCH(patchRequest({ projectId: PROJECT_ID }), ctx);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Project not found in this workspace");
  });

  it("reports a failed workspace check instead of claiming the project is not in this workspace", async () => {
    projectScopeMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table projects", code: "42501" },
    });

    const response = await PATCH(patchRequest({ projectId: PROJECT_ID }), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load linked project");
    expect(body.hint).toContain("read failure");
    // The false claim is gone, not merely accompanied by something truer.
    expect(JSON.stringify(body)).not.toContain("not found in this workspace");
    // ...and nothing was written on the strength of a check that never ran.
    expect(campaignUpdateMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "campaign_patch_project_workspace_check_failed",
      expect.objectContaining({ message: "permission denied for table projects" })
    );
  });

  it("answers 503 when the projects table has not been migrated on this deployment", async () => {
    projectScopeMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'relation "projects" does not exist', code: "42P01" },
    });

    const response = await PATCH(patchRequest({ projectId: PROJECT_ID }), ctx);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("Linked project schema is not available yet");
    expect(campaignUpdateMock).not.toHaveBeenCalled();
  });
});
