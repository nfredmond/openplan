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

import { POST as postBootstrap } from "@/app/api/workspaces/bootstrap/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/workspaces/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/workspaces/bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    workspaceSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "regional-planning-commission",
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
      },
      error: null,
    });

    workspaceSelectMock.mockReturnValue({ single: workspaceSingleMock });
    workspaceInsertMock.mockReturnValue({ select: workspaceSelectMock });
    workspaceDeleteEqMock.mockResolvedValue({ error: null });
    workspaceDeleteMock.mockReturnValue({ eq: workspaceDeleteEqMock });
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
    const response = await postBootstrap(jsonRequest({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid input" });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 200 with expected response shape on successful bootstrap", async () => {
    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      workspaceId: string;
      slug: string;
      stageGateTemplate: {
        id: string;
        version: string;
        jurisdiction: string;
        bindingMode: string;
        lapmFormIdsStatus: string;
      };
      onboardingChecklist: string[];
    };

    expect(payload.workspaceId).toBeDefined();
    expect(payload.slug).toBe("regional-planning-commission");
    expect(payload.stageGateTemplate).toMatchObject({
      id: "ca_stage_gates_v0_1",
      version: "0.1.0",
      jurisdiction: "CA",
      bindingMode: "workspace_bootstrap_interim",
      lapmFormIdsStatus: "deferred_to_v0_2",
    });
    expect(Array.isArray(payload.onboardingChecklist)).toBe(true);
    expect(payload.onboardingChecklist.length).toBeGreaterThan(0);

    /**
     * The first thing a new workspace reads may not assume a supervised pilot.
     *
     * The original list told every agency in the country to "set pilot success
     * metrics" and "schedule pilot readout and weekly KPI review cadence" —
     * steps that only made sense inside one county's supervised engagement. The
     * product is self-serve (non-negotiable #4), so nobody is running a readout
     * for the person reading this, and no place, agency, or program may be named
     * in it (non-negotiable #0).
     */
    const checklistText = payload.onboardingChecklist.join(" ");
    expect(checklistText).not.toMatch(/\bpilot\b/i);
    expect(checklistText).not.toMatch(/\breadout\b/i);
    expect(checklistText).not.toMatch(/\bKPI\b/);

    expect(workspaceInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
        stage_gate_binding_source: "workspace_bootstrap_interim",
      })
    );

    expect(createApiAuditLoggerMock).toHaveBeenCalledWith(
      "workspaces.bootstrap",
      expect.any(NextRequest)
    );
  });

  it("returns 400 when unsupported stage-gate template is requested", async () => {
    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
        stageGateTemplateId: "unsupported_template",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Unsupported stage-gate template" });
    expect(workspaceInsertMock).not.toHaveBeenCalled();
  });

  it("accepts explicit california stage-gate template selection", async () => {
    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
        stageGateTemplateId: "ca_stage_gates_v0_1",
      })
    );

    expect(response.status).toBe(200);
    expect(workspaceInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stage_gate_template_id: "ca_stage_gates_v0_1",
      })
    );
  });

  it("returns 500 when db insert fails", async () => {
    workspaceSingleMock.mockResolvedValue({
      data: null,
      error: {
        message: "insert failed",
        code: "XX000",
      },
    });

    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to bootstrap workspace" });
  });

  it("cleans up the partially created workspace when owner membership insert fails", async () => {
    memberInsertMock.mockResolvedValue({
      error: {
        message: "membership insert failed",
        code: "XX001",
      },
    });

    const response = await postBootstrap(
      jsonRequest({
        workspaceName: "Regional Planning Commission",
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to bootstrap workspace" });
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
