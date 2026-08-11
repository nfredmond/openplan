import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * CREATING A MISSION, OR CHANGING ITS STATUS, REFRESHES THE PROJECT'S POSTURE.
 *
 * THE DEFECT. `rebuildAerialProjectPosture` was called only from the
 * evidence-package POST and the processing callback. Creating a mission — which
 * changes the very counts the posture stores (missions by status) — left
 * `aerial_project_posture` stale, and so did flipping a mission from planned to
 * complete. The mission page even admitted it: "Will populate after the first
 * evidence-package mutation."
 *
 * WHAT THESE PIN. The mission POST rebuilds posture for the project the mission
 * was created under; the PATCH rebuilds it when — and only when — the status
 * actually changes (a rename or a same-status write is a posture no-op); a
 * mission with no project rebuilds nothing; and a PATCH cannot move a mission
 * between projects, so exactly one project's posture is ever affected. The
 * project binding is read off the recorded call and VARIED across tests, so a
 * route that hardcoded either id fails here.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const rebuildAerialProjectPostureMock = vi.fn();
const loadProjectAccessMock = vi.fn();

const authGetUserMock = vi.fn();
const missionInsertSingleMock = vi.fn();
const missionMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const missionUpdateSingleMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") {
    return {
      // POST inserts; PATCH loads then updates. One builder answers all three.
      insert: () => ({
        select: () => ({
          single: missionInsertSingleMock,
        }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: missionMaybeSingleMock,
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: missionUpdateSingleMock,
          }),
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

vi.mock("@/lib/programs/api", () => ({
  loadProjectAccess: (...args: unknown[]) => loadProjectAccessMock(...args),
}));

import { POST as postMission } from "@/app/api/aerial/missions/route";
import { PATCH as patchMission } from "@/app/api/aerial/missions/[missionId]/route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const MISSION_ID = "99999999-9999-4999-8999-999999999999";
const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ONE = "11111111-1111-4111-8111-111111111111";
const PROJECT_TWO = "22222222-2222-4222-8222-222222222222";

function createRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/aerial/missions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/aerial/missions/${MISSION_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const patchContext = { params: Promise.resolve({ missionId: MISSION_ID }) };

function recordedRebuildCall() {
  return rebuildAerialProjectPostureMock.mock.calls[0]?.[0] as {
    projectId: string;
    workspaceId: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: fromMock,
  });
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  membershipMaybeSingleMock.mockResolvedValue({ data: { role: "editor" }, error: null });
  rebuildAerialProjectPostureMock.mockResolvedValue({
    posture: {
      missionCount: 1,
      activeMissionCount: 1,
      completeMissionCount: 0,
      readyPackageCount: 0,
      verificationReadiness: "pending",
    },
    updatedAt: "2026-08-11T00:00:00.000Z",
    error: null,
  });
  missionInsertSingleMock.mockResolvedValue({
    data: { id: MISSION_ID, status: "planned", title: "Overflight" },
    error: null,
  });
  missionUpdateSingleMock.mockResolvedValue({
    data: { id: MISSION_ID, status: "active", title: "Overflight", geography_label: null, updated_at: "2026-08-11T00:00:00.000Z" },
    error: null,
  });
});

describe("POST /api/aerial/missions rebuilds the project's aerial posture", () => {
  it("rebuilds posture for the project the mission was created under", async () => {
    loadProjectAccessMock.mockResolvedValue({
      project: { id: PROJECT_ONE, workspace_id: WORKSPACE_A },
      membership: { role: "editor" },
      allowed: true,
      error: null,
    });

    const response = await postMission(
      createRequest({ projectId: PROJECT_ONE, title: "Overflight" })
    );

    expect(response.status).toBe(201);
    expect(rebuildAerialProjectPostureMock).toHaveBeenCalledTimes(1);
    expect(recordedRebuildCall().projectId).toBe(PROJECT_ONE);
    expect(recordedRebuildCall().workspaceId).toBe(WORKSPACE_A);
  });

  it("threads a different project and workspace through, and survives a rebuild failure", async () => {
    // Binding varied: a route that hardcoded PROJECT_ONE / WORKSPACE_A above
    // fails on this pair.
    loadProjectAccessMock.mockResolvedValue({
      project: { id: PROJECT_TWO, workspace_id: WORKSPACE_B },
      membership: { role: "editor" },
      allowed: true,
      error: null,
    });
    rebuildAerialProjectPostureMock.mockResolvedValue({
      posture: null,
      updatedAt: null,
      error: { message: "upsert failed", code: "42501" },
    });

    const response = await postMission(
      createRequest({ projectId: PROJECT_TWO, title: "Overflight" })
    );

    // The mission row is already real; the posture is a cache. A failed rebuild
    // is disclosed in the audit log, not converted into a failed create.
    expect(response.status).toBe(201);
    expect(recordedRebuildCall().projectId).toBe(PROJECT_TWO);
    expect(recordedRebuildCall().workspaceId).toBe(WORKSPACE_B);
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "aerial_posture_rebuild_failed",
      expect.objectContaining({ projectId: PROJECT_TWO, message: "upsert failed" })
    );
  });
});

describe("PATCH /api/aerial/missions/[missionId] and the posture writeback", () => {
  it("rebuilds posture when the status actually changes", async () => {
    missionMaybeSingleMock.mockResolvedValue({
      data: { id: MISSION_ID, workspace_id: WORKSPACE_A, project_id: PROJECT_ONE, status: "planned" },
      error: null,
    });

    const response = await patchMission(patchRequest({ status: "active" }), patchContext);

    expect(response.status).toBe(200);
    expect(rebuildAerialProjectPostureMock).toHaveBeenCalledTimes(1);
    expect(recordedRebuildCall().projectId).toBe(PROJECT_ONE);
    expect(recordedRebuildCall().workspaceId).toBe(WORKSPACE_A);
  });

  it("threads the mission's own project through the rebuild", async () => {
    // Binding varied against the test above.
    missionMaybeSingleMock.mockResolvedValue({
      data: { id: MISSION_ID, workspace_id: WORKSPACE_B, project_id: PROJECT_TWO, status: "active" },
      error: null,
    });

    const response = await patchMission(patchRequest({ status: "complete" }), patchContext);

    expect(response.status).toBe(200);
    expect(recordedRebuildCall().projectId).toBe(PROJECT_TWO);
    expect(recordedRebuildCall().workspaceId).toBe(WORKSPACE_B);
  });

  it("does not rebuild when the PATCH changes only the title", async () => {
    missionMaybeSingleMock.mockResolvedValue({
      data: { id: MISSION_ID, workspace_id: WORKSPACE_A, project_id: PROJECT_ONE, status: "planned" },
      error: null,
    });

    const response = await patchMission(patchRequest({ title: "Renamed overflight" }), patchContext);

    // Posture counts missions by status; a rename cannot move it.
    expect(response.status).toBe(200);
    expect(rebuildAerialProjectPostureMock).not.toHaveBeenCalled();
  });

  it("does not rebuild when the PATCH writes the status the mission already has", async () => {
    missionMaybeSingleMock.mockResolvedValue({
      data: { id: MISSION_ID, workspace_id: WORKSPACE_A, project_id: PROJECT_ONE, status: "active" },
      error: null,
    });

    const response = await patchMission(patchRequest({ status: "active" }), patchContext);

    expect(response.status).toBe(200);
    expect(rebuildAerialProjectPostureMock).not.toHaveBeenCalled();
  });

  it("does not rebuild for a mission with no linked project", async () => {
    missionMaybeSingleMock.mockResolvedValue({
      data: { id: MISSION_ID, workspace_id: WORKSPACE_A, project_id: null, status: "planned" },
      error: null,
    });

    const response = await patchMission(patchRequest({ status: "complete" }), patchContext);

    expect(response.status).toBe(200);
    expect(rebuildAerialProjectPostureMock).not.toHaveBeenCalled();
  });

  it("refuses a PATCH that only tries to move the mission to another project", async () => {
    missionMaybeSingleMock.mockResolvedValue({
      data: { id: MISSION_ID, workspace_id: WORKSPACE_A, project_id: PROJECT_ONE, status: "planned" },
      error: null,
    });

    // The schema has no projectId field and strips unknown keys, so this body
    // is empty after parsing and is refused. This is the executable form of
    // "a PATCH cannot move a mission between projects" — the reason the
    // writeback only ever refreshes one project.
    const response = await patchMission(patchRequest({ projectId: PROJECT_TWO }), patchContext);

    expect(response.status).toBe(400);
    expect(rebuildAerialProjectPostureMock).not.toHaveBeenCalled();
  });
});
