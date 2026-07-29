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

const projectDeliverablesMaybeSingleMock = vi.fn();
const projectDeliverablesSelectMock = vi.fn(() => ({ maybeSingle: projectDeliverablesMaybeSingleMock }));
const projectDeliverablesEqProjectMock = vi.fn(() => ({ select: projectDeliverablesSelectMock }));
const projectDeliverablesEqIdMock = vi.fn(() => ({ eq: projectDeliverablesEqProjectMock }));
const projectDeliverablesUpdateMock = vi.fn(() => ({ eq: projectDeliverablesEqIdMock }));

const projectsSelectEqMock = vi.fn(() => ({ single: projectsSingleMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsSelectEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipSelectMock = vi.fn(() => ({
  eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }),
}));

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

  if (table === "project_deliverables") {
    return { update: projectDeliverablesUpdateMock };
  }

  if (table === "workspace_members") {
    return { select: membershipSelectMock };
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
const DELIVERABLE_ID = "cccc1111-3333-4333-8333-333333333333";

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

    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "member" }, error: null });

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

    projectDeliverablesMaybeSingleMock.mockResolvedValue({
      data: {
        id: DELIVERABLE_ID,
        title: "Draft board-ready safety memo",
        summary: null,
        owner_label: "Elena",
        due_date: "2026-03-20",
        status: "in_progress",
        budget_amount: 25000,
        percent_complete: 40,
        created_at: "2026-03-13T07:00:00.000Z",
        updated_at: "2026-07-27T18:00:00.000Z",
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

  it("updates a deliverable's status, budget, and percent complete", async () => {
    const response = await patchRecord(
      jsonRequest(DELIVERABLE_ID, {
        recordType: "deliverable",
        status: "in_progress",
        budgetAmount: 25000,
        percentComplete: 40,
      }),
      routeContext(DELIVERABLE_ID)
    );

    expect(response.status).toBe(200);
    expect(projectDeliverablesUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "in_progress",
        budget_amount: 25000,
        percent_complete: 40,
        updated_at: expect.any(String),
      })
    );
    expect(projectDeliverablesEqIdMock).toHaveBeenCalledWith("id", DELIVERABLE_ID);
    expect(projectDeliverablesEqProjectMock).toHaveBeenCalledWith("project_id", PROJECT_ID);

    expect(await response.json()).toMatchObject({
      recordType: "deliverable",
      record: {
        id: DELIVERABLE_ID,
        title: "Draft board-ready safety memo",
        status: "in_progress",
        budget_amount: 25000,
        percent_complete: 40,
      },
    });
  });

  it("leaves budget columns untouched when the fields are not provided", async () => {
    const response = await patchRecord(
      jsonRequest(DELIVERABLE_ID, { recordType: "deliverable", status: "complete" }),
      routeContext(DELIVERABLE_ID)
    );

    expect(response.status).toBe(200);
    const updatePayload = (projectDeliverablesUpdateMock.mock.calls[0] as unknown[])?.[0] as Record<string, unknown>;
    expect("budget_amount" in updatePayload).toBe(false);
    expect("percent_complete" in updatePayload).toBe(false);
  });

  it("rejects a deliverable percent complete above 100", async () => {
    const response = await patchRecord(
      jsonRequest(DELIVERABLE_ID, {
        recordType: "deliverable",
        status: "in_progress",
        percentComplete: 101,
      }),
      routeContext(DELIVERABLE_ID)
    );

    expect(response.status).toBe(400);
    expect(projectDeliverablesUpdateMock).not.toHaveBeenCalled();
  });

  it("answers 404 'no such milestone' when the update matches no row", async () => {
    projectMilestonesMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await patchRecord(
      jsonRequest(MILESTONE_ID, { recordType: "milestone", status: "complete" }),
      routeContext(MILESTONE_ID)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "No such milestone" });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "project_record_update_matched_no_rows",
      expect.objectContaining({ recordId: MILESTONE_ID, recordType: "milestone" })
    );
  });

  it("answers 404 for a deliverable and a submittal that match no row", async () => {
    projectDeliverablesMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const deliverable = await patchRecord(
      jsonRequest(DELIVERABLE_ID, { recordType: "deliverable", status: "complete" }),
      routeContext(DELIVERABLE_ID)
    );

    expect(deliverable.status).toBe(404);
    expect(await deliverable.json()).toMatchObject({ error: "No such deliverable" });

    projectSubmittalsMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const submittal = await patchRecord(
      jsonRequest(SUBMITTAL_ID, { recordType: "submittal", status: "accepted" }),
      routeContext(SUBMITTAL_ID)
    );

    expect(submittal.status).toBe(404);
    expect(await submittal.json()).toMatchObject({ error: "No such submittal" });
  });

  // PostgREST reports zero matched rows two ways depending on how the query was
  // spelled; neither is a server fault, so neither may surface as a 500.
  it("treats a PGRST116 'no rows' error as a missing record, not a server failure", async () => {
    projectMilestonesMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });

    const response = await patchRecord(
      jsonRequest(MILESTONE_ID, { recordType: "milestone", status: "complete" }),
      routeContext(MILESTONE_ID)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "No such milestone" });
    expect(mockAudit.error).not.toHaveBeenCalled();
  });

  it("still 500s when the update fails for a real database reason", async () => {
    projectMilestonesMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied for table project_milestones" },
    });

    const response = await patchRecord(
      jsonRequest(MILESTONE_ID, { recordType: "milestone", status: "complete" }),
      routeContext(MILESTONE_ID)
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Failed to update milestone" });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "project_record_update_failed",
      expect.objectContaining({ recordType: "milestone" })
    );
  });

  it("refuses a viewer and updates nothing", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });

    const response = await patchRecord(
      jsonRequest(MILESTONE_ID, { recordType: "milestone", status: "complete" }),
      routeContext(MILESTONE_ID)
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Viewers have read-only access to this workspace",
    });
    expect(projectMilestonesUpdateMock).not.toHaveBeenCalled();
  });

  it("still updates for a member, an admin, and an owner", async () => {
    for (const role of ["member", "admin", "owner"]) {
      projectMilestonesUpdateMock.mockClear();
      membershipMaybeSingleMock.mockResolvedValue({ data: { role }, error: null });

      const response = await patchRecord(
        jsonRequest(MILESTONE_ID, { recordType: "milestone", status: "complete" }),
        routeContext(MILESTONE_ID)
      );

      expect(response.status, `${role} should still be able to advance a record`).toBe(200);
      expect(projectMilestonesUpdateMock).toHaveBeenCalledTimes(1);
    }
  });
});
