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

/**
 * The printable public address (20260810000002). The column had a public
 * RESOLVER (/engage/{slug}) before anything could write it — the
 * shipped-invisible defect class — so these hold the writer's whole contract:
 * the value written is the value asked for (varied, so a hardcode cannot
 * pass), a bad format is refused in planner words before any write, the
 * database's uniqueness refusal reaches the planner as "taken" rather than as
 * a raw constraint error, and clearing works through both spellings.
 */
describe("PATCH /api/engagement/campaigns/[campaignId] — the printable link name (publicSlug)", () => {
  it("writes the slug it was asked to write — binding varied across two saves", async () => {
    let response = await PATCH(patchRequest({ publicSlug: "jefferson-street-study" }), ctx);
    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ public_slug: "jefferson-street-study" })
    );

    response = await PATCH(patchRequest({ publicSlug: "oak-avenue-plan" }), ctx);
    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ public_slug: "oak-avenue-plan" })
    );
  });

  it("normalizes before writing — a pasted ' Jefferson-Street-Study ' saves as the address the flyer reader reaches", async () => {
    const response = await PATCH(patchRequest({ publicSlug: " Jefferson-Street-Study " }), ctx);
    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ public_slug: "jefferson-street-study" })
    );
  });

  it("refuses a name the public door would refuse, in planner words, before any write", async () => {
    for (const bad of ["not a link name!", "ab", "-leading-hyphen", "a".repeat(65)]) {
      const response = await PATCH(patchRequest({ publicSlug: bad }), ctx);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("lowercase letters");
    }
    expect(campaignUpdateMock).not.toHaveBeenCalled();
  });

  it("maps the uniqueness refusal to 'that link name is taken' — never a raw constraint error", async () => {
    campaignUpdateMaybeSingle.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "engagement_campaigns_public_slug_unique"',
      },
    });

    const response = await PATCH(patchRequest({ publicSlug: "downtown-plan" }), ctx);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("taken");
    expect(JSON.stringify(body)).not.toContain("duplicate key");
    expect(JSON.stringify(body)).not.toContain("constraint");
  });

  it("keeps every other unique violation on the generic failure path", async () => {
    campaignUpdateMaybeSingle.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "engagement_campaigns_share_token_key"',
      },
    });

    const response = await PATCH(patchRequest({ publicSlug: "downtown-plan" }), ctx);
    expect(response.status).toBe(500);
  });

  it("clears the slug on null, and on an emptied field", async () => {
    let response = await PATCH(patchRequest({ publicSlug: null }), ctx);
    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ public_slug: null })
    );

    response = await PATCH(patchRequest({ publicSlug: "   " }), ctx);
    expect(response.status).toBe(200);
    expect(campaignUpdateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ public_slug: null })
    );
  });

  it("leaves the slug untouched when the request does not mention it", async () => {
    const response = await PATCH(patchRequest({ publicDescription: "New words" }), ctx);
    expect(response.status).toBe(200);
    const updates = (campaignUpdateMock.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0];
    expect("public_slug" in updates).toBe(false);
  });
});
