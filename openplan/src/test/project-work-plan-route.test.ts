import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/projects/[projectId]/work-plan — applying a work-plan template.
 *
 * WHAT THIS PROVES, in the order the risks rank:
 *
 *   1. The rows written carry the dates the PLANNER'S anchor produces, and the
 *      binding is exercised with TWO different anchors — one fixture cannot tell
 *      "threads the anchor through" from "hardcodes a date".
 *   2. No insert names a person. Not `assignee_user_id`, not `owner_label`.
 *   3. A viewer cannot apply one (the record tables' RLS write policies are
 *      role-blind, so the gate is the route's).
 *   4. A Planner Agent execution is refused outright — no action is registered
 *      for this endpoint, and the route says so rather than relying on the
 *      absence of an action to keep one away.
 *   5. A FAILED read of the project's existing records refuses the whole apply
 *      rather than treating the project as empty, which would duplicate
 *      everything already there.
 *
 * MUTATION-VERIFIED (2026-08-11), each reverted after; see the report.
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const authGetUserMock = vi.fn();
const projectsSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();

const deliverableTitlesMock = vi.fn();
const milestoneTitlesMock = vi.fn();
const deliverableInsertMock = vi.fn();
const milestoneInsertMock = vi.fn();

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** `.select(...).eq(...).limit(...)` for the existing-title scans; `.insert(rows).select(...)` for writes. */
type AnyMock = (...args: never[]) => unknown;

function recordTable(titlesMock: AnyMock, insertMock: AnyMock) {
  return {
    select: (columns: string) => ({
      eq: () => ({ limit: () => (titlesMock as (c: string) => unknown)(columns) }),
    }),
    insert: (rows: unknown) => ({ select: () => (insertMock as (r: unknown) => unknown)(rows) }),
  };
}

const fromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return { select: () => ({ eq: () => ({ single: projectsSingleMock }) }) };
  }
  if (table === "workspace_members") {
    return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }) }) };
  }
  if (table === "project_deliverables") return recordTable(deliverableTitlesMock, deliverableInsertMock);
  if (table === "project_milestones") return recordTable(milestoneTitlesMock, milestoneInsertMock);
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: () => ({ serviceRole: true }),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST } from "@/app/api/projects/[projectId]/work-plan/route";

function request(payload: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/work-plan`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

const context = { params: Promise.resolve({ projectId: PROJECT_ID }) };

describe("POST /api/projects/[projectId]/work-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "member" }, error: null });
    projectsSingleMock.mockResolvedValue({
      data: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Corridor Rehabilitation" },
      error: null,
    });
    deliverableTitlesMock.mockResolvedValue({ data: [], error: null });
    milestoneTitlesMock.mockResolvedValue({ data: [], error: null });
    deliverableInsertMock.mockImplementation((rows: Array<unknown>) => ({
      data: rows.map((_, index) => ({ id: `d${index}` })),
      error: null,
    }));
    milestoneInsertMock.mockImplementation((rows: Array<unknown>) => ({
      data: rows.map((_, index) => ({ id: `m${index}` })),
      error: null,
    }));
  });

  async function apply(anchorDate: string) {
    const response = await POST(
      request({ templateId: "generic_project_v0.1", anchorDate }),
      { params: Promise.resolve({ projectId: PROJECT_ID }) }
    );
    return { response, body: await response.json() };
  }

  it("writes dates computed from the planner's anchor — varied across two anchors", async () => {
    const march = await apply("2026-03-02");
    expect(march.response.status).toBe(201);
    const marchDeliverables = deliverableInsertMock.mock.calls[0][0] as Array<{ title: string; due_date: string }>;
    expect(marchDeliverables.map((row) => row.due_date)).toEqual([
      "2026-03-23",
      "2026-05-31",
      "2026-09-28",
      "2026-12-27",
    ]);
    const marchMilestones = milestoneInsertMock.mock.calls[0][0] as Array<{ target_date: string }>;
    expect(marchMilestones[0].target_date).toBe("2026-03-02");

    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "member" }, error: null });
    projectsSingleMock.mockResolvedValue({
      data: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Corridor Rehabilitation" },
      error: null,
    });
    deliverableTitlesMock.mockResolvedValue({ data: [], error: null });
    milestoneTitlesMock.mockResolvedValue({ data: [], error: null });
    deliverableInsertMock.mockImplementation((rows: Array<unknown>) => ({ data: rows.map(() => ({ id: "x" })), error: null }));
    milestoneInsertMock.mockImplementation((rows: Array<unknown>) => ({ data: rows.map(() => ({ id: "y" })), error: null }));

    const july = await apply("2026-07-15");
    expect(july.response.status).toBe(201);
    const julyDeliverables = deliverableInsertMock.mock.calls[0][0] as Array<{ due_date: string }>;
    expect(julyDeliverables.map((row) => row.due_date)).toEqual([
      "2026-08-05",
      "2026-10-13",
      "2027-02-10",
      "2027-05-11",
    ]);
    expect(july.body.anchorDate).toBe("2026-07-15");
    expect(july.body.createdDeliverables).toBe(4);
    expect(july.body.createdMilestones).toBe(3);
  });

  it("never writes a person onto any row it creates", async () => {
    await apply("2026-03-02");
    const rows = [
      ...(deliverableInsertMock.mock.calls[0][0] as Array<Record<string, unknown>>),
      ...(milestoneInsertMock.mock.calls[0][0] as Array<Record<string, unknown>>),
    ];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("assignee_user_id");
      expect(Object.keys(row)).not.toContain("owner_label");
      expect(row.created_by).toBe(USER_ID);
    }
  });

  it("skips titles the project already has instead of duplicating them", async () => {
    deliverableTitlesMock.mockResolvedValue({
      data: [{ title: "Work plan and schedule" }, { title: "final PLAN document " }],
      error: null,
    });
    const { body } = await apply("2026-03-02");
    expect(body.createdDeliverables).toBe(2);
    expect(body.skippedDeliverableTitles).toEqual(["Work plan and schedule", "Final plan document"]);
  });

  it("refuses when the existing records could not be read, rather than duplicating them", async () => {
    deliverableTitlesMock.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const { response, body } = await apply("2026-03-02");
    expect(response.status).toBe(500);
    expect(body.error).toContain("could duplicate");
    expect(deliverableInsertMock).not.toHaveBeenCalled();
    expect(milestoneInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a viewer", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
    const { response } = await apply("2026-03-02");
    expect(response.status).toBe(403);
    expect(deliverableInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a Planner Agent execution outright, before it reads anything", async () => {
    const response = await POST(
      request(
        { templateId: "generic_project_v0.1", anchorDate: "2026-03-02" },
        { "x-openplan-assistant-execution-source": "planner_agent_quick_link" }
      ),
      context
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("not a Planner Agent action");
    expect(createClientMock).not.toHaveBeenCalled();
    expect(deliverableInsertMock).not.toHaveBeenCalled();
  });

  it("refuses an anchor date that is not a real calendar date", async () => {
    const { response, body } = await apply("2026-02-30");
    expect(response.status).toBe(400);
    expect(body.error).toContain("not a real calendar date");
    expect(deliverableInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a template id nothing is registered under", async () => {
    const response = await POST(
      request({ templateId: "corridor_study_v9", anchorDate: "2026-03-02" }),
      context
    );
    expect(response.status).toBe(404);
    expect(deliverableInsertMock).not.toHaveBeenCalled();
  });

  it("records the apply in the audit log", async () => {
    await apply("2026-03-02");
    expect(mockAudit.info).toHaveBeenCalledWith(
      "work_plan_applied",
      expect.objectContaining({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        templateId: "generic_project_v0.1",
        anchorDate: "2026-03-02",
        createdDeliverables: 4,
        createdMilestones: 3,
      })
    );
  });
});
