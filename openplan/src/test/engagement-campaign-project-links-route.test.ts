import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PATCH /api/engagement/campaigns/[campaignId] maintains the coverage set
 * (engagement_campaign_projects, 20260810000003).
 *
 * The invariants under test, each of which the console cannot enforce for an
 * API caller:
 *
 *   - the join is synced to the REQUESTED set: missing rows inserted, extra
 *     rows deleted, untouched rows left alone (no delete-all-reinsert churn);
 *   - the LEAD project can never leave the set through `projectIds` — the
 *     desired set unions it in server-side;
 *   - every requested id is verified against THIS campaign's workspace before
 *     anything is written, and a cross-workspace id refuses the whole request;
 *   - a failed verification read is reported as a failure, never converted
 *     into the claim that the projects are not in the workspace.
 */

const createClientMock = vi.fn();
const loadCampaignAccessMock = vi.fn();
const loadProjectAccessMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const LEAD_PROJECT = "44444444-4444-4444-8444-444444444444";
const PROJECT_B = "55555555-5555-4555-8555-555555555555";
const PROJECT_C = "66666666-6666-4666-8666-666666666666";

// --- projects table -----------------------------------------------------
// `.eq(...).maybeSingle()` is the lead workspace re-check; `.in(...)` is the
// batch verification of the requested coverage set.
const projectScopeMaybeSingle = vi.fn();
const projectsInMock = vi.fn();
const projectsSelectMock = vi.fn(() => ({
  eq: () => ({ maybeSingle: projectScopeMaybeSingle }),
  in: projectsInMock,
}));

// --- engagement_campaigns -----------------------------------------------
const campaignUpdateMaybeSingle = vi.fn();
const campaignUpdateMock = vi.fn(() => ({
  eq: () => ({ select: () => ({ maybeSingle: campaignUpdateMaybeSingle }) }),
}));

// --- engagement_campaign_projects ---------------------------------------
const currentLinksEqMock = vi.fn();
const linksSelectMock = vi.fn(() => ({ eq: currentLinksEqMock }));
const linksDeleteInMock = vi.fn();
const linksDeleteMock = vi.fn(() => ({
  eq: () => ({ in: (column: string, values: string[]) => ({ select: () => linksDeleteInMock(column, values) }) }),
}));
const linksInsertMock = vi.fn();

const fromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return { select: projectsSelectMock };
  }
  if (table === "engagement_campaigns") {
    return { update: campaignUpdateMock };
  }
  if (table === "engagement_campaign_projects") {
    return { select: linksSelectMock, delete: linksDeleteMock, insert: linksInsertMock };
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

const ctx = { params: Promise.resolve({ campaignId: CAMPAIGN_ID }) };

function patchRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/engagement/campaigns/${CAMPAIGN_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The rows the batch verification returns — all in the campaign's workspace unless a test says otherwise. */
function workspaceProjects(...ids: string[]) {
  return { data: ids.map((id) => ({ id, workspace_id: WORKSPACE_ID })), error: null };
}

function currentLinks(...ids: string[]) {
  return { data: ids.map((id) => ({ project_id: id })), error: null };
}

beforeEach(() => {
  vi.clearAllMocks();

  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: fromMock,
  });

  loadCampaignAccessMock.mockResolvedValue({
    campaign: { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID, project_id: LEAD_PROJECT },
    membership: { workspace_id: WORKSPACE_ID, role: "editor" },
    error: null,
    allowed: true,
  });

  loadProjectAccessMock.mockResolvedValue({
    project: { id: PROJECT_B, workspace_id: WORKSPACE_ID },
    membership: { workspace_id: WORKSPACE_ID, role: "editor" },
    error: null,
    allowed: true,
  });

  projectScopeMaybeSingle.mockResolvedValue({
    data: { id: PROJECT_B, workspace_id: WORKSPACE_ID },
    error: null,
  });
  projectsInMock.mockResolvedValue(workspaceProjects(PROJECT_B, PROJECT_C));
  campaignUpdateMaybeSingle.mockResolvedValue({ data: { id: CAMPAIGN_ID }, error: null });

  currentLinksEqMock.mockResolvedValue(currentLinks(LEAD_PROJECT));
  linksDeleteInMock.mockResolvedValue({ data: [], error: null });
  linksInsertMock.mockResolvedValue({ error: null });
});

describe("PATCH projectIds — syncing the coverage set", () => {
  it("inserts the missing links and leaves the rows already right untouched", async () => {
    const response = await PATCH(patchRequest({ projectIds: [PROJECT_B, PROJECT_C] }), ctx);

    expect(response.status).toBe(200);
    // The lead's row was already present, so only B and C are inserted — and
    // each new row carries the campaign's OWN workspace id, not a caller value.
    expect(linksInsertMock).toHaveBeenCalledTimes(1);
    expect(linksInsertMock.mock.calls[0][0]).toEqual([
      { workspace_id: WORKSPACE_ID, campaign_id: CAMPAIGN_ID, project_id: PROJECT_B, created_by: USER_ID },
      { workspace_id: WORKSPACE_ID, campaign_id: CAMPAIGN_ID, project_id: PROJECT_C, created_by: USER_ID },
    ]);
    expect(linksDeleteMock).not.toHaveBeenCalled();
    // No campaign column changed, so no campaign update ran.
    expect(campaignUpdateMock).not.toHaveBeenCalled();
    expect(mockAudit.info).toHaveBeenCalledWith(
      "campaign_updated",
      expect.objectContaining({ projectLinksAdded: 2, projectLinksRemoved: 0 })
    );
  });

  it("removes a project the request no longer lists — but NEVER the lead", async () => {
    currentLinksEqMock.mockResolvedValue(currentLinks(LEAD_PROJECT, PROJECT_B));
    linksDeleteInMock.mockResolvedValue({ data: [{ project_id: PROJECT_B }], error: null });

    const response = await PATCH(patchRequest({ projectIds: [] }), ctx);

    expect(response.status).toBe(200);
    // An empty requested set still keeps the lead: only B is removed.
    expect(linksDeleteInMock).toHaveBeenCalledTimes(1);
    expect(linksDeleteInMock).toHaveBeenCalledWith("project_id", [PROJECT_B]);
    expect(linksInsertMock).not.toHaveBeenCalled();
  });

  it("refuses the whole request when one requested project is in another workspace", async () => {
    projectsInMock.mockResolvedValue({
      data: [
        { id: PROJECT_B, workspace_id: WORKSPACE_ID },
        { id: PROJECT_C, workspace_id: "99999999-9999-4999-8999-999999999999" },
      ],
      error: null,
    });

    const response = await PATCH(patchRequest({ projectIds: [PROJECT_B, PROJECT_C] }), ctx);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Some of those projects are not in this workspace");
    expect(linksInsertMock).not.toHaveBeenCalled();
    expect(linksDeleteMock).not.toHaveBeenCalled();
    expect(campaignUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses a project the caller cannot see at all, the same way", async () => {
    // RLS returns only what the caller may read; an invisible project simply
    // does not come back, and absence refuses like a wrong workspace does.
    projectsInMock.mockResolvedValue(workspaceProjects(PROJECT_B));

    const response = await PATCH(patchRequest({ projectIds: [PROJECT_B, PROJECT_C] }), ctx);

    expect(response.status).toBe(404);
    expect(linksInsertMock).not.toHaveBeenCalled();
  });

  it("reports a failed verification read instead of claiming the projects are not in the workspace", async () => {
    projectsInMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table projects", code: "42501" },
    });

    const response = await PATCH(patchRequest({ projectIds: [PROJECT_B] }), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("not in this workspace");
    expect(linksInsertMock).not.toHaveBeenCalled();
    expect(linksDeleteMock).not.toHaveBeenCalled();
    expect(campaignUpdateMock).not.toHaveBeenCalled();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "campaign_patch_project_links_check_failed",
      expect.objectContaining({ message: expect.stringContaining("permission denied") })
    );
  });

  it("unions a newly chosen lead into the set it syncs", async () => {
    // Lead moves to B while the request lists only the old lead: B must join
    // the set without the caller having said so.
    loadProjectAccessMock.mockResolvedValue({
      project: { id: PROJECT_B, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      error: null,
      allowed: true,
    });
    projectsInMock.mockResolvedValue(workspaceProjects(LEAD_PROJECT));
    currentLinksEqMock.mockResolvedValue(currentLinks(LEAD_PROJECT));

    const response = await PATCH(
      patchRequest({ projectId: PROJECT_B, projectIds: [LEAD_PROJECT] }),
      ctx
    );

    expect(response.status).toBe(200);
    expect(linksInsertMock).toHaveBeenCalledTimes(1);
    expect(linksInsertMock.mock.calls[0][0]).toEqual([
      { workspace_id: WORKSPACE_ID, campaign_id: CAMPAIGN_ID, project_id: PROJECT_B, created_by: USER_ID },
    ]);
    // The OLD lead stays covered: changing the lead is not an unlinking.
    expect(linksDeleteMock).not.toHaveBeenCalled();
  });

  it("surfaces a delete the database refused instead of reporting success over it", async () => {
    currentLinksEqMock.mockResolvedValue(currentLinks(LEAD_PROJECT, PROJECT_B));
    // RLS ate the delete: zero rows came back for one requested removal.
    linksDeleteInMock.mockResolvedValue({ data: [], error: null });

    const response = await PATCH(patchRequest({ projectIds: [] }), ctx);

    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("could not be removed");
  });

  it("a rename PATCH never touches the coverage set", async () => {
    const response = await PATCH(patchRequest({ title: "Corridor listening window" }), ctx);

    expect(response.status).toBe(200);
    expect(linksSelectMock).not.toHaveBeenCalled();
    expect(linksInsertMock).not.toHaveBeenCalled();
    expect(linksDeleteMock).not.toHaveBeenCalled();
  });
});
