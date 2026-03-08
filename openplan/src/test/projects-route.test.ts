import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const authGetUserMock = vi.fn();
const workspaceInsertMock = vi.fn();
const workspaceSelectMock = vi.fn();
const workspaceSingleMock = vi.fn();
const memberInsertMock = vi.fn();
const fromMock = vi.fn();

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

    workspaceSelectMock.mockReturnValue({ single: workspaceSingleMock });
    workspaceInsertMock.mockReturnValue({ select: workspaceSelectMock });
    memberInsertMock.mockResolvedValue({ error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === "workspaces") {
        return { insert: workspaceInsertMock };
      }

      if (table === "workspace_members") {
        return { insert: memberInsertMock };
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
      slug: string;
      plan: string;
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
});
