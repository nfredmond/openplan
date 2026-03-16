import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();
const workspaceInsertMock = vi.fn();
const workspaceSelectMock = vi.fn();
const workspaceSingleMock = vi.fn();
const workspaceDeleteEqMock = vi.fn();
const workspaceDeleteMock = vi.fn();
const memberInsertMock = vi.fn();
const memberDeleteEqMock = vi.fn();
const memberDeleteMock = vi.fn();
const projectInsertMock = vi.fn();
const projectSelectMock = vi.fn();
const projectSingleMock = vi.fn();
const fromMock = vi.fn();

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

import { POST as postProject } from "@/app/api/projects/route";

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

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    workspaceSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "ca-safety-delivery-pilot",
        plan: "pilot",
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
      },
      error: null,
    });

    projectSingleMock.mockResolvedValue({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "CA Safety Delivery Pilot",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "scoping",
      },
      error: null,
    });

    workspaceSelectMock.mockReturnValue({ single: workspaceSingleMock });
    workspaceInsertMock.mockReturnValue({ select: workspaceSelectMock });
    workspaceDeleteEqMock.mockResolvedValue({ error: null });
    workspaceDeleteMock.mockReturnValue({ eq: workspaceDeleteEqMock });
    projectSelectMock.mockReturnValue({ single: projectSingleMock });
    projectInsertMock.mockReturnValue({ select: projectSelectMock });
    memberInsertMock.mockResolvedValue({ error: null });
    memberDeleteEqMock.mockResolvedValue({ error: null });
    memberDeleteMock.mockReturnValue({ eq: memberDeleteEqMock });

    fromMock.mockImplementation((table: string) => {
      if (table === "workspaces") {
        return { insert: workspaceInsertMock, delete: workspaceDeleteMock };
      }

      if (table === "workspace_members") {
        return { insert: memberInsertMock, delete: memberDeleteMock };
      }

      if (table === "projects") {
        return { insert: projectInsertMock };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });

    createServiceRoleClientMock.mockReturnValue({
      from: fromMock,
    });
  });

  it("returns 400 for invalid payload", async () => {
    const response = await postProject(jsonRequest({ plan: "pilot" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid input" });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postProject(
      jsonRequest({
        projectName: "CA Safety Delivery Pilot",
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 201 with canonical project-create stage-gate binding", async () => {
    const response = await postProject(
      jsonRequest({
        projectName: "CA Safety Delivery Pilot",
      })
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      projectId: string;
      workspaceId: string;
      projectRecordId: string;
      slug: string;
      plan: string;
      projectRecord: {
        id: string;
        name: string;
        status: string;
        planType: string;
        deliveryPhase: string;
      };
      stageGateTemplate: {
        id: string;
        version: string;
        jurisdiction: string;
        bindingMode: string;
        lapmFormIdsStatus: string;
      };
    };

    expect(payload.projectId).toBeDefined();
    expect(payload.workspaceId).toBe(payload.projectId);
    expect(payload.projectRecordId).toBe("33333333-3333-4333-8333-333333333333");
    expect(payload.projectRecord).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      name: "CA Safety Delivery Pilot",
      status: "active",
      planType: "corridor_plan",
      deliveryPhase: "scoping",
    });
    expect(payload.slug).toBe("ca-safety-delivery-pilot");
    expect(payload.plan).toBe("pilot");
    expect(payload.stageGateTemplate).toMatchObject({
      id: "ca_stage_gates_v0_1",
      version: "0.1.0",
      jurisdiction: "CA",
      bindingMode: "project_create_v0_2",
      lapmFormIdsStatus: "deferred_to_v0_2",
    });

    expect(workspaceInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
        stage_gate_binding_source: "project_create_v0_2",
      })
    );

    expect(projectInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "11111111-1111-4111-8111-111111111111",
        name: "CA Safety Delivery Pilot",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "scoping",
        created_by: "22222222-2222-4222-8222-222222222222",
      })
    );
  });

  it("returns 400 when unsupported stage-gate template is requested", async () => {
    const response = await postProject(
      jsonRequest({
        projectName: "CA Safety Delivery Pilot",
        stageGateTemplateId: "unsupported_template",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Unsupported stage-gate template" });
    expect(workspaceInsertMock).not.toHaveBeenCalled();
  });

  it("cleans up the provisioned workspace when project-record creation fails", async () => {
    projectSingleMock.mockResolvedValue({
      data: null,
      error: {
        message: "project insert failed",
        code: "XX002",
      },
    });

    const response = await postProject(
      jsonRequest({
        projectName: "CA Safety Delivery Pilot",
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to create project record" });
    expect(memberDeleteEqMock).toHaveBeenCalledWith(
      "workspace_id",
      "11111111-1111-4111-8111-111111111111"
    );
    expect(workspaceDeleteEqMock).toHaveBeenCalledWith(
      "id",
      "11111111-1111-4111-8111-111111111111"
    );
  });
});
