import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * ASSIGNING PROJECT WORK TO A TEAMMATE — the write half, end to end through the
 * real route handlers.
 *
 * Four things are being proven, and each of them has a specific way of shipping
 * broken that a shallower test would not see:
 *
 * 1. THE ASSIGNEE THE PLANNER CHOSE IS THE ASSIGNEE THAT GETS WRITTEN. Every
 *    case below varies the binding — two different assignee ids, on two
 *    different record types, in two different workspaces — because a single
 *    fixture cannot tell "threads the value through" apart from "writes a
 *    constant". That distinction is a recorded defect in this repository: sixty
 *    tests once passed a hardcode mutation.
 * 2. MEMBERSHIP IS CHECKED THROUGH THE SERVICE-ROLE ROSTER. The RLS client
 *    cannot answer "is this OTHER person a member" — members_read_own returns
 *    one row — so a route that checked with it would refuse every teammate but
 *    the caller. That exact bug shipped on /api/invoicing/staff, which is why
 *    the assertion here is that the service client did the read.
 * 3. A FAILED ROSTER READ IS NOT A NON-MEMBER. It answers 500, not 400: telling
 *    a planner their colleague "is not a member of this workspace" because a
 *    query broke is the reassuring, wrong direction.
 * 4. THE PLANNER AGENT CANNOT ASSIGN ANYONE. `create_project_record` carries no
 *    assignee in its payload, and the approval hash is over the action the
 *    route rebuilds — so a request carrying the approved fields PLUS an
 *    assignee would hash identically to what the planner saw.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "1111aaaa-1111-4111-8111-111111111111";
const CALLER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_WORKSPACE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEAMMATE_A = "33333333-3333-4333-8333-333333333333";
const TEAMMATE_B = "44444444-4444-4444-8444-444444444444";
const OUTSIDER = "55555555-5555-4555-8555-555555555555";
const RECORD_ID = "66666666-6666-4666-8666-666666666666";

/** Which project each project id resolves to, so a case can vary the workspace. */
const PROJECTS: Record<string, { id: string; workspace_id: string; name: string }> = {
  [PROJECT_ID]: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Downtown Mobility Plan" },
  [OTHER_PROJECT_ID]: { id: OTHER_PROJECT_ID, workspace_id: OTHER_WORKSPACE_ID, name: "County Safety Plan" },
};

/** Roster by workspace — the fake's membership truth, varied per case. */
const ROSTERS: Record<string, string[]> = {
  [WORKSPACE_ID]: [CALLER_ID, TEAMMATE_A],
  [OTHER_WORKSPACE_ID]: [CALLER_ID, TEAMMATE_B],
};

let rosterReadError: { message: string } | null = null;

/** Every insert/update the RLS client was asked to perform, in order. */
const writes: Array<{ table: string; op: "insert" | "update"; row: Record<string, unknown> }> = [];
/** Every workspace_members read the SERVICE client performed. */
const serviceRosterReads: string[] = [];

let requestedProjectId = PROJECT_ID;

function recordRow(table: string) {
  return {
    id: RECORD_ID,
    title: "Draft board-ready safety memo",
    status: "in_progress",
    owner_label: "Consultant",
    assignee_user_id: null,
    created_at: "2026-08-11T07:00:00.000Z",
    table,
  };
}

function rlsClient() {
  return {
    auth: { getUser: authGetUserMock },
    from(table: string) {
      if (table === "projects") {
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              single: async () => ({ data: PROJECTS[value] ?? null, error: PROJECTS[value] ? null : { message: "not found" } }),
            }),
          }),
        };
      }

      if (table === "workspace_members") {
        // The write gate's own read: the CALLER's role, through RLS. This is
        // the read members_read_own permits, and it is not the roster.
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "member" }, error: null }) }) }) }),
        };
      }

      if (table === "assistant_action_executions") {
        return { insert: async () => ({ error: null }) };
      }

      return {
        insert: (row: Record<string, unknown>) => {
          writes.push({ table, op: "insert", row });
          return { select: () => ({ single: async () => ({ data: recordRow(table), error: null }) }) };
        },
        update: (row: Record<string, unknown>) => {
          writes.push({ table, op: "update", row });
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle: async () => ({ data: recordRow(table), error: null }) }),
              }),
            }),
          };
        },
      };
    },
  };
}

function serviceClient() {
  return {
    from(table: string) {
      if (table === "assistant_action_executions") {
        return { insert: async () => ({ error: null }) };
      }
      if (table !== "workspace_members") throw new Error(`Unexpected service table: ${table}`);

      let workspaceId = "";
      const query = {
        eq(column: string, value: string) {
          if (column === "workspace_id") workspaceId = value;
          return query;
        },
        order: () => query,
        async maybeSingle() {
          // The helper's caller-membership check.
          if (rosterReadError) return { data: null, error: rosterReadError };
          return {
            data: (ROSTERS[workspaceId] ?? []).includes(CALLER_ID) ? { user_id: CALLER_ID } : null,
            error: null,
          };
        },
        async limit() {
          serviceRosterReads.push(workspaceId);
          if (rosterReadError) return { data: null, error: rosterReadError };
          return {
            data: (ROSTERS[workspaceId] ?? []).map((userId) => ({ user_id: userId, role: "member" })),
            error: null,
          };
        },
      };
      return { select: () => query };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: null } } }) } },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postRecord } from "@/app/api/projects/[projectId]/records/route";
import { PATCH as patchRecord } from "@/app/api/projects/[projectId]/records/[recordId]/route";

function post(payload: unknown, headers: Record<string, string> = {}) {
  return postRecord(
    new NextRequest(`http://localhost/api/projects/${requestedProjectId}/records`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ projectId: requestedProjectId }) }
  );
}

function patch(payload: unknown) {
  return patchRecord(
    new NextRequest(`http://localhost/api/projects/${requestedProjectId}/records/${RECORD_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ projectId: requestedProjectId, recordId: RECORD_ID }) }
  );
}

describe("assigning a project record to a teammate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writes.length = 0;
    serviceRosterReads.length = 0;
    rosterReadError = null;
    requestedProjectId = PROJECT_ID;
    createApiAuditLoggerMock.mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    authGetUserMock.mockResolvedValue({ data: { user: { id: CALLER_ID } } });
    createClientMock.mockResolvedValue(rlsClient());
    createServiceRoleClientMock.mockImplementation(() => serviceClient());
  });

  /**
   * Every assignable record type, each written TWICE with a different assignee
   * in a different workspace.
   *
   * The pairing is the point, and it is not decoration: an earlier version of
   * this test varied the assignee ACROSS record types — deliverable to one
   * person, issue to another — and a mutation that hardcoded a constant assignee
   * inside the deliverable branch passed it green, because each branch only ever
   * saw one value. A binding is only proven varied when the SAME code path
   * carries two different values.
   */
  const ASSIGNABLE = [
    { recordType: "deliverable", table: "project_deliverables", title: "Draft board-ready safety memo" },
    { recordType: "milestone", table: "project_milestones", title: "LAPM authorization packet ready" },
    { recordType: "submittal", table: "project_submittals", title: "Invoice backup packet" },
    { recordType: "issue", table: "project_issues", title: "Traffic count package still missing" },
  ] as const;

  it.each(ASSIGNABLE)(
    "writes the assignee the request named on a $recordType, in that record's own workspace",
    async ({ recordType, table, title }) => {
      const first = await post({ recordType, title, ownerLabel: "Consultant", assigneeUserId: TEAMMATE_A });
      expect(first.status).toBe(201);

      // Same branch, different workspace, different teammate — who is NOT on
      // the first workspace's roster.
      requestedProjectId = OTHER_PROJECT_ID;
      const second = await post({ recordType, title, assigneeUserId: TEAMMATE_B });
      expect(second.status).toBe(201);

      expect(writes.map((write) => write.table)).toEqual([table, table]);
      expect(writes[0].row.assignee_user_id).toBe(TEAMMATE_A);
      expect(writes[1].row.assignee_user_id).toBe(TEAMMATE_B);
      // Each membership question was asked of the record's OWN workspace.
      expect(serviceRosterReads).toEqual([WORKSPACE_ID, OTHER_WORKSPACE_ID]);
    }
  );

  it("keeps the free-text owner lane beside the assignee rather than replacing it", async () => {
    const response = await post({
      recordType: "deliverable",
      title: "Draft board-ready safety memo",
      ownerLabel: "Consultant",
      assigneeUserId: TEAMMATE_A,
    });

    expect(response.status).toBe(201);
    expect(writes[0].row).toMatchObject({
      owner_label: "Consultant",
      assignee_user_id: TEAMMATE_A,
    });
  });

  it("never sends the column when nobody was named, and spends no lookup on it", async () => {
    // The key is ABSENT, not null — sending it to a deployment behind
    // 20260811000006 would fail the whole insert.
    const unassigned = await post({ recordType: "deliverable", title: "Memo" });

    expect(unassigned.status).toBe(201);
    expect("assignee_user_id" in writes[0].row).toBe(false);
    expect(serviceRosterReads).toEqual([]);
  });

  it("refuses an assignee who is not on this workspace's roster — and writes nothing", async () => {
    const response = await post({
      recordType: "deliverable",
      title: "Draft board-ready safety memo",
      assigneeUserId: OUTSIDER,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "The assignee is not a member of this project's workspace",
    });
    expect(writes).toEqual([]);
  });

  it("refuses a teammate of ANOTHER workspace, which is the case an RLS-client check gets wrong", async () => {
    // TEAMMATE_B is a real member — of the other workspace. The roster read has
    // to be scoped to this project's workspace for this to be refused.
    const response = await post({
      recordType: "deliverable",
      title: "Draft board-ready safety memo",
      assigneeUserId: TEAMMATE_B,
    });

    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("answers 500, not 400, when the roster could not be read", async () => {
    rosterReadError = { message: "permission denied for table workspace_members" };

    const response = await post({
      recordType: "deliverable",
      title: "Draft board-ready safety memo",
      assigneeUserId: TEAMMATE_A,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "Could not verify that the assignee is a member of this workspace",
    });
    expect(writes).toEqual([]);
  });

  it("reassigns through PATCH without being told the status", async () => {
    // Status was REQUIRED here until assignment arrived. Requiring it now would
    // make the reassignment control send whatever status it happened to be
    // holding, quietly reverting a teammate's concurrent advance.
    const response = await patch({ recordType: "deliverable", assigneeUserId: TEAMMATE_A });

    expect(response.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: "project_deliverables", op: "update" });
    expect(writes[0].row.assignee_user_id).toBe(TEAMMATE_A);
    expect("status" in writes[0].row).toBe(false);
  });

  it("still advances status alone, and can do both at once", async () => {
    const statusOnly = await patch({ recordType: "issue", status: "resolved" });
    expect(statusOnly.status).toBe(200);
    expect(writes[0].row).toMatchObject({ status: "resolved" });
    expect("assignee_user_id" in writes[0].row).toBe(false);

    requestedProjectId = OTHER_PROJECT_ID;
    const both = await patch({ recordType: "milestone", status: "blocked", assigneeUserId: TEAMMATE_B });
    expect(both.status).toBe(200);
    expect(writes[1].row).toMatchObject({ status: "blocked", assignee_user_id: TEAMMATE_B });
  });

  it("treats an explicit null as 'unassign', not as 'no instruction'", async () => {
    const response = await patch({ recordType: "submittal", assigneeUserId: null });

    expect(response.status).toBe(200);
    expect(writes[0].row.assignee_user_id).toBeNull();
    // Clearing names nobody, so no membership question is asked.
    expect(serviceRosterReads).toEqual([]);
  });

  it("refuses a reassignment to someone outside this project's workspace", async () => {
    // The same rule as first assignment, on the path that is easy to forget:
    // reassignment is a second write surface, and a membership check that
    // exists only on POST leaves the back door open.
    const outsider = await patch({ recordType: "deliverable", assigneeUserId: OUTSIDER });
    expect(outsider.status).toBe(400);
    expect(await outsider.json()).toMatchObject({
      error: "The assignee is not a member of this project's workspace",
    });

    // A real member — of the OTHER workspace.
    const wrongWorkspace = await patch({ recordType: "milestone", assigneeUserId: TEAMMATE_B });
    expect(wrongWorkspace.status).toBe(400);

    expect(writes).toEqual([]);
  });

  it("answers 500 on a PATCH whose roster read failed, rather than accusing a teammate", async () => {
    rosterReadError = { message: "permission denied for table workspace_members" };

    const response = await patch({ recordType: "issue", assigneeUserId: TEAMMATE_A });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "Could not verify that the assignee is a member of this workspace",
    });
    expect(writes).toEqual([]);
  });

  it("refuses a PATCH that would change nothing", async () => {
    const response = await patch({ recordType: "deliverable" });

    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("refuses a Planner Agent request that carries an assignee its action never had", async () => {
    const response = await post(
      {
        recordType: "submittal",
        title: "Invoice backup packet",
        submittalType: "reimbursement",
        assigneeUserId: TEAMMATE_A,
      },
      { "x-openplan-assistant-execution-source": "planner_agent_quick_link" }
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { details?: string };
    expect(body.details).toContain("assigneeUserId");
    expect(writes).toEqual([]);
  });
});
