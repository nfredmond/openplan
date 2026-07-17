import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const projectsSingleMock = vi.fn();

const projectMilestonesMaybeSingleMock = vi.fn();
const projectMilestonesSelectMock = vi.fn(() => ({ maybeSingle: projectMilestonesMaybeSingleMock }));
const projectMilestonesEqProjectMock = vi.fn(() => ({ select: projectMilestonesSelectMock }));
const projectMilestonesEqIdMock = vi.fn(() => ({ eq: projectMilestonesEqProjectMock }));
const projectMilestonesUpdateMock = vi.fn(() => ({ eq: projectMilestonesEqIdMock }));

const projectSubmittalsMaybeSingleMock = vi.fn();
const projectSubmittalsSelectMock = vi.fn(() => ({ maybeSingle: projectSubmittalsMaybeSingleMock }));
const projectSubmittalsEqProjectMock = vi.fn(() => ({ select: projectSubmittalsSelectMock }));
const projectSubmittalsEqIdMock = vi.fn(() => ({ eq: projectSubmittalsEqProjectMock }));
const projectSubmittalsUpdateMock = vi.fn(() => ({ eq: projectSubmittalsEqIdMock }));

const projectsSelectEqMock = vi.fn(() => ({ single: projectsSingleMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsSelectEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return { select: projectsSelectMock };
  }

  if (table === "project_milestones") {
    return { update: projectMilestonesUpdateMock };
  }

  if (table === "project_submittals") {
    return { update: projectSubmittalsUpdateMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

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

import { PATCH as patchRecord } from "@/app/api/projects/[projectId]/records/[recordId]/route";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MILESTONE_ID = "aaaa1111-3333-4333-8333-333333333333";
const SUBMITTAL_ID = "bbbb1111-3333-4333-8333-333333333333";

function jsonRequest(recordId: string, payload: unknown) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/records/${recordId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function routeContext(recordId: string) {
  return { params: Promise.resolve({ projectId: PROJECT_ID, recordId }) };
}

describe("PATCH /api/projects/[projectId]/records/[recordId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });

    projectsSingleMock.mockResolvedValue({
      data: {
        id: PROJECT_ID,
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Nevada County Safety Action Program",
      },
      error: null,
    });

    projectMilestonesMaybeSingleMock.mockResolvedValue({
      data: {
        id: MILESTONE_ID,
        title: "LAPM authorization packet ready",
        summary: null,
        milestone_type: "authorization",
        phase_code: "initiation",
        status: "complete",
        owner_label: "Elena",
        target_date: "2026-03-20",
        actual_date: null,
        notes: null,
        created_at: "2026-03-13T07:00:00.000Z",
        updated_at: "2026-07-17T18:00:00.000Z",
      },
      error: null,
    });

    projectSubmittalsMaybeSingleMock.mockResolvedValue({
      data: {
        id: SUBMITTAL_ID,
        title: "Invoice backup packet",
        submittal_type: "invoice_backup",
        status: "accepted",
        agency_label: "Caltrans D3 Local Assistance",
        reference_number: "INV-7",
        due_date: "2026-03-18",
        submitted_at: null,
        review_cycle: 2,
        notes: null,
        created_at: "2026-03-13T07:05:00.000Z",
        updated_at: "2026-07-17T18:05:00.000Z",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await patchRecord(
      jsonRequest(MILESTONE_ID, { recordType: "milestone", status: "complete" }),
      routeContext(MILESTONE_ID)
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
    expect(projectMilestonesUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the project is not visible to the caller", async () => {
    projectsSingleMock.mockResolvedValueOnce({ data: null, error: { message: "not found" } });

    const response = await patchRecord(
      jsonRequest(MILESTONE_ID, { recordType: "milestone", status: "complete" }),
      routeContext(MILESTONE_ID)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Project not found" });
    expect(projectMilestonesUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid status", async () => {
    const response = await patchRecord(
      jsonRequest(MILESTONE_ID, { recordType: "milestone", status: "done" }),
      routeContext(MILESTONE_ID)
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid input" });
    expect(projectMilestonesUpdateMock).not.toHaveBeenCalled();
  });

  it("marks a milestone complete", async () => {
    const response = await patchRecord(
      jsonRequest(MILESTONE_ID, { recordType: "milestone", status: "complete" }),
      routeContext(MILESTONE_ID)
    );

    expect(response.status).toBe(200);
    expect(projectMilestonesUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "complete",
        updated_at: expect.any(String),
      })
    );
    expect(projectMilestonesEqIdMock).toHaveBeenCalledWith("id", MILESTONE_ID);
    expect(projectMilestonesEqProjectMock).toHaveBeenCalledWith("project_id", PROJECT_ID);

    expect(await response.json()).toMatchObject({
      recordType: "milestone",
      record: {
        id: MILESTONE_ID,
        title: "LAPM authorization packet ready",
        status: "complete",
      },
    });
  });

  it("updates a submittal status with a note", async () => {
    const response = await patchRecord(
      jsonRequest(SUBMITTAL_ID, {
        recordType: "submittal",
        status: "accepted",
        note: "Accepted by Caltrans D3 on second review cycle.",
      }),
      routeContext(SUBMITTAL_ID)
    );

    expect(response.status).toBe(200);
    expect(projectSubmittalsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "accepted",
        notes: "Accepted by Caltrans D3 on second review cycle.",
        updated_at: expect.any(String),
      })
    );
    expect(projectSubmittalsEqIdMock).toHaveBeenCalledWith("id", SUBMITTAL_ID);
    expect(projectSubmittalsEqProjectMock).toHaveBeenCalledWith("project_id", PROJECT_ID);

    expect(await response.json()).toMatchObject({
      recordType: "submittal",
      record: {
        id: SUBMITTAL_ID,
        title: "Invoice backup packet",
        status: "accepted",
      },
    });
  });

  it("returns 404 when the record does not belong to the project", async () => {
    projectMilestonesMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await patchRecord(
      jsonRequest(MILESTONE_ID, { recordType: "milestone", status: "complete" }),
      routeContext(MILESTONE_ID)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Milestone not found" });
  });
});
