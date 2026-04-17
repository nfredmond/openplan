import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const rebuildAerialProjectPostureMock = vi.fn();

const authGetUserMock = vi.fn();
const missionMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const packageInsertSingleMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: missionMaybeSingleMock,
        }),
      }),
    };
  }

  if (table === "workspace_members") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: membershipMaybeSingleMock,
          }),
        }),
      }),
    };
  }

  if (table === "aerial_evidence_packages") {
    return {
      insert: () => ({
        select: () => ({
          single: packageInsertSingleMock,
        }),
      }),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/aerial/posture-writeback", () => ({
  rebuildAerialProjectPosture: (...args: unknown[]) => rebuildAerialProjectPostureMock(...args),
}));

import { POST as postEvidencePackage } from "@/app/api/aerial/evidence-packages/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/aerial/evidence-packages", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/aerial/evidence-packages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    authGetUserMock.mockResolvedValue({
      data: {
        user: { id: "00000000-0000-4000-8000-000000000001" },
      },
    });
    membershipMaybeSingleMock.mockResolvedValue({
      data: { role: "editor" },
      error: null,
    });
    packageInsertSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        mission_id: "22222222-2222-4222-8222-222222222222",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        title: "Ortho",
        package_type: "measurable_output",
        status: "ready",
        verification_readiness: "ready",
        notes: null,
        created_at: "2026-04-16T12:00:00Z",
        updated_at: "2026-04-16T12:00:00Z",
      },
      error: null,
    });
    rebuildAerialProjectPostureMock.mockResolvedValue({
      posture: {
        missionCount: 1,
        activeMissionCount: 0,
        completeMissionCount: 1,
        readyPackageCount: 1,
        verificationReadiness: "ready",
      },
      updatedAt: "2026-04-16T12:00:00.000Z",
      error: null,
    });
  });

  it("rebuilds aerial project posture after evidence package is created when mission is linked to a project", async () => {
    missionMaybeSingleMock.mockResolvedValue({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
      },
      error: null,
    });

    const response = await postEvidencePackage(
      request({
        missionId: "22222222-2222-4222-8222-222222222222",
        title: "Ortho",
        packageType: "measurable_output",
        status: "ready",
        verificationReadiness: "ready",
      })
    );

    expect(response.status).toBe(201);
    expect(rebuildAerialProjectPostureMock).toHaveBeenCalledTimes(1);
    const call = rebuildAerialProjectPostureMock.mock.calls[0]?.[0] as {
      projectId: string;
      workspaceId: string;
    };
    expect(call.projectId).toBe("44444444-4444-4444-8444-444444444444");
    expect(call.workspaceId).toBe("33333333-3333-4333-8333-333333333333");
    expect(mockAudit.info).toHaveBeenCalledWith(
      "aerial_posture_rebuilt",
      expect.objectContaining({
        packageId: "11111111-1111-4111-8111-111111111111",
        projectId: "44444444-4444-4444-8444-444444444444",
        verificationReadiness: "ready",
      })
    );
  });

  it("skips posture rebuild when mission has no linked project", async () => {
    missionMaybeSingleMock.mockResolvedValue({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: null,
      },
      error: null,
    });

    const response = await postEvidencePackage(
      request({
        missionId: "22222222-2222-4222-8222-222222222222",
        title: "Ortho",
      })
    );

    expect(response.status).toBe(201);
    expect(rebuildAerialProjectPostureMock).not.toHaveBeenCalled();
  });

  it("warns but still returns 201 when posture rebuild fails", async () => {
    missionMaybeSingleMock.mockResolvedValue({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
      },
      error: null,
    });
    rebuildAerialProjectPostureMock.mockResolvedValue({
      posture: null,
      updatedAt: null,
      error: { message: "update failed", code: "23505" },
    });

    const response = await postEvidencePackage(
      request({
        missionId: "22222222-2222-4222-8222-222222222222",
        title: "Ortho",
      })
    );

    expect(response.status).toBe(201);
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "aerial_posture_rebuild_failed",
      expect.objectContaining({
        projectId: "44444444-4444-4444-8444-444444444444",
        message: "update failed",
      })
    );
  });
});
