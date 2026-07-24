import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authGetUserMock = vi.fn();
const projectInsertMock = vi.fn();
const projectSelectMock = vi.fn();
const projectSingleMock = vi.fn();
const fromMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const checkWorkspaceMembershipMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: authGetUserMock }, from: fromMock }),
  // A project no longer provisions a workspace, so the route no longer uses the
  // service-role client at all. Mock it as a throw so a regression that
  // reintroduces the fork fails loudly instead of silently.
  createServiceRoleClient: () => {
    throw new Error("projects.create must not use the service-role client");
  },
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

vi.mock("@/lib/workspaces/membership", () => ({
  checkWorkspaceMembership: (...args: unknown[]) => checkWorkspaceMembershipMock(...args),
}));

import { POST as postProject } from "@/app/api/projects/route";

const CURRENT_WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "44444444-4444-4444-8444-444444444444";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_RECORD_ID = "33333333-3333-4333-8333-333333333333";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    projectSingleMock.mockResolvedValue({
      data: {
        id: PROJECT_RECORD_ID,
        name: "CA Safety Delivery Pilot",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "scoping",
      },
      error: null,
    });
    projectSelectMock.mockReturnValue({ single: projectSingleMock });
    projectInsertMock.mockReturnValue({ select: projectSelectMock });

    fromMock.mockImplementation((table: string) => {
      if (table === "projects") {
        return { insert: projectInsertMock };
      }
      // A workspace/member insert here would be the reintroduced fork.
      throw new Error(`Unexpected table: ${table}`);
    });

    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: CURRENT_WORKSPACE, role: "owner" },
      workspace: { name: "My Workspace" },
    });
    checkWorkspaceMembershipMock.mockResolvedValue({ ok: true, role: "owner" });
  });

  it("returns 400 for invalid payload", async () => {
    const response = await postProject(jsonRequest({ summary: "no name" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid input" });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const response = await postProject(jsonRequest({ projectName: "CA Safety Delivery Pilot" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("creates the project in the caller's current workspace, without forking a workspace", async () => {
    const response = await postProject(jsonRequest({ projectName: "CA Safety Delivery Pilot" }));

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      projectRecordId: string;
      workspaceId: string;
      projectRecord: { id: string; name: string; status: string; planType: string; deliveryPhase: string };
    };

    expect(payload.projectRecordId).toBe(PROJECT_RECORD_ID);
    // The project belongs to the CALLER's workspace — it is not a new one.
    expect(payload.workspaceId).toBe(CURRENT_WORKSPACE);
    expect(payload.projectRecord).toMatchObject({
      id: PROJECT_RECORD_ID,
      name: "CA Safety Delivery Pilot",
      status: "active",
      planType: "corridor_plan",
      deliveryPhase: "scoping",
    });

    // The insert targets the current workspace and never touches workspaces /
    // workspace_members (the fromMock throws on those tables).
    expect(projectInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: CURRENT_WORKSPACE,
        name: "CA Safety Delivery Pilot",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "scoping",
        created_by: USER_ID,
      })
    );
    expect(fromMock).not.toHaveBeenCalledWith("workspaces");
    expect(fromMock).not.toHaveBeenCalledWith("workspace_members");
  });

  it("returns 409 when the account has no workspace attached", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });
    const response = await postProject(jsonRequest({ projectName: "CA Safety Delivery Pilot" }));
    expect(response.status).toBe(409);
    expect(projectInsertMock).not.toHaveBeenCalled();
  });

  it("honors an explicit workspaceId the caller belongs to", async () => {
    const response = await postProject(
      jsonRequest({ projectName: "CA Safety Delivery Pilot", workspaceId: OTHER_WORKSPACE })
    );

    expect(response.status).toBe(201);
    expect(checkWorkspaceMembershipMock).toHaveBeenCalledWith(expect.anything(), USER_ID, OTHER_WORKSPACE);
    // Explicit target skips the current-workspace resolver.
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
    expect(projectInsertMock.mock.calls[0]![0]).toMatchObject({ workspace_id: OTHER_WORKSPACE });
  });

  it("returns 404 when targeting a workspace the caller is not a member of", async () => {
    checkWorkspaceMembershipMock.mockResolvedValue({ ok: false, kind: "not_member", message: "Workspace not found" });
    const response = await postProject(
      jsonRequest({ projectName: "CA Safety Delivery Pilot", workspaceId: OTHER_WORKSPACE })
    );
    expect(response.status).toBe(404);
    expect(projectInsertMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the project insert fails", async () => {
    projectSingleMock.mockResolvedValue({ data: null, error: { message: "project insert failed", code: "XX002" } });
    const response = await postProject(jsonRequest({ projectName: "CA Safety Delivery Pilot" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to create project" });
  });
});
