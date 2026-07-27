import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

// workspace_members
const membersMaybeSingleMock = vi.fn();
const membersEqUserMock = vi.fn(() => ({ maybeSingle: membersMaybeSingleMock }));
const membersEqWorkspaceMock = vi.fn(() => ({ eq: membersEqUserMock }));
const membersSelectMock = vi.fn(() => ({ eq: membersEqWorkspaceMock }));

// invoicing_staff
const staffLookupSingleMock = vi.fn();
const staffLookupEqMock = vi.fn(() => ({ single: staffLookupSingleMock }));
const staffSelectMock = vi.fn(() => ({ eq: staffLookupEqMock }));
const staffInsertSingleMock = vi.fn();
const staffInsertSelectMock = vi.fn(() => ({ single: staffInsertSingleMock }));
const staffInsertMock = vi.fn(() => ({ select: staffInsertSelectMock }));

// invoicing_engagements
const engagementSingleMock = vi.fn();
const engagementEqMock = vi.fn(() => ({ single: engagementSingleMock }));
const engagementSelectMock = vi.fn(() => ({ eq: engagementEqMock }));

// invoicing_time_entries
const timeEntryLookupSingleMock = vi.fn();
// The list route chains select().eq().[eq()/is()]….order().limit(); the detail
// routes chain select().eq().single(). One self-returning chain serves both.
const timeEntryListLimitMock = vi.fn();
type TimeEntryQueryChain = {
  eq: (...args: unknown[]) => TimeEntryQueryChain;
  is: (...args: unknown[]) => TimeEntryQueryChain;
  order: (...args: unknown[]) => { limit: typeof timeEntryListLimitMock };
  single: typeof timeEntryLookupSingleMock;
};
const timeEntryQueryChain: TimeEntryQueryChain = {
  eq: () => timeEntryQueryChain,
  is: () => timeEntryQueryChain,
  order: () => ({ limit: timeEntryListLimitMock }),
  single: timeEntryLookupSingleMock,
};
const timeEntrySelectMock = vi.fn(() => timeEntryQueryChain);
const timeEntryInsertSingleMock = vi.fn();
const timeEntryInsertSelectMock = vi.fn(() => ({ single: timeEntryInsertSingleMock }));
const timeEntryInsertMock = vi.fn(() => ({ select: timeEntryInsertSelectMock }));
const timeEntryUpdateSingleMock = vi.fn();
const timeEntryUpdateSelectMock = vi.fn(() => ({ single: timeEntryUpdateSingleMock }));
const timeEntryUpdateEqMock = vi.fn(() => ({ select: timeEntryUpdateSelectMock }));
const timeEntryUpdateMock = vi.fn(() => ({ eq: timeEntryUpdateEqMock }));
const timeEntryDeleteEqMock = vi.fn();
const timeEntryDeleteMock = vi.fn(() => ({ eq: timeEntryDeleteEqMock }));

// invoicing_rate_tables
const rateTableLookupSingleMock = vi.fn();
const rateTableLookupEqMock = vi.fn(() => ({ single: rateTableLookupSingleMock }));
const rateTableSelectMock = vi.fn(() => ({ eq: rateTableLookupEqMock }));
const rateTableUpdateSingleMock = vi.fn();
const rateTableUpdateSelectMock = vi.fn(() => ({ single: rateTableUpdateSingleMock }));
const rateTableUpdateEqMock = vi.fn(() => ({ select: rateTableUpdateSelectMock }));
const rateTableUpdateMock = vi.fn(() => ({ eq: rateTableUpdateEqMock }));

// invoicing_rate_entries
const rateEntriesSnapshotEqMock = vi.fn();
const rateEntriesSnapshotSelectMock = vi.fn(() => ({ eq: rateEntriesSnapshotEqMock }));
const rateEntriesDeleteEqMock = vi.fn();
const rateEntriesDeleteMock = vi.fn(() => ({ eq: rateEntriesDeleteEqMock }));
const rateEntriesInsertSelectMock = vi.fn();
// The compensating restore awaits .insert(...) directly (no .select), which in
// supabase-js resolves the builder itself — so the mock is thenable too.
const rateEntriesRestoreResultMock = vi.fn(() => ({ error: null as { message: string } | null }));
const rateEntriesInsertMock = vi.fn(() => ({
  select: rateEntriesInsertSelectMock,
  then: (resolve: (value: { error: { message: string } | null }) => void) =>
    resolve(rateEntriesRestoreResultMock()),
}));

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: membersSelectMock };
  }
  if (table === "invoicing_staff") {
    return { select: staffSelectMock, insert: staffInsertMock };
  }
  if (table === "invoicing_engagements") {
    return { select: engagementSelectMock };
  }
  if (table === "invoicing_time_entries") {
    return {
      select: timeEntrySelectMock,
      insert: timeEntryInsertMock,
      update: timeEntryUpdateMock,
      delete: timeEntryDeleteMock,
    };
  }
  if (table === "invoicing_rate_tables") {
    return { select: rateTableSelectMock, update: rateTableUpdateMock };
  }
  if (table === "invoicing_rate_entries") {
    return {
      select: rateEntriesSnapshotSelectMock,
      delete: rateEntriesDeleteMock,
      insert: rateEntriesInsertMock,
    };
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

import { POST as postStaff } from "@/app/api/invoicing/staff/route";
import { GET as listTimeEntries, POST as postTimeEntry } from "@/app/api/invoicing/time-entries/route";
import {
  DELETE as deleteTimeEntry,
  PATCH as patchTimeEntry,
} from "@/app/api/invoicing/time-entries/[timeEntryId]/route";
import { PATCH as patchRateTable } from "@/app/api/invoicing/rate-tables/[rateTableId]/route";

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_WORKSPACE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const ENGAGEMENT = "44444444-4444-4444-8444-444444444444";
const TIME_ENTRY = "55555555-5555-4555-8555-555555555555";
const RATE_TABLE = "66666666-6666-4666-8666-666666666666";
const LINE_ITEM = "77777777-7777-4777-8777-777777777777";
const LINKED_USER = "88888888-8888-4888-8888-888888888888";

function jsonRequest(url: string, method: string, payload: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createApiAuditLoggerMock.mockReturnValue(mockAudit);

  authGetUserMock.mockResolvedValue({ data: { user: { id: USER } } });

  membersMaybeSingleMock.mockResolvedValue({
    data: { workspace_id: WORKSPACE, role: "owner" },
    error: null,
  });

  staffLookupSingleMock.mockResolvedValue({
    data: { id: STAFF, workspace_id: WORKSPACE, default_labor_category: "Senior Planner" },
    error: null,
  });
  staffInsertSingleMock.mockResolvedValue({
    data: { id: STAFF, workspace_id: WORKSPACE, name: "J. Doe", active: true },
    error: null,
  });

  engagementSingleMock.mockResolvedValue({
    data: { id: ENGAGEMENT, workspace_id: WORKSPACE },
    error: null,
  });

  timeEntryLookupSingleMock.mockResolvedValue({
    data: { id: TIME_ENTRY, workspace_id: WORKSPACE, billed_line_item_id: null },
    error: null,
  });
  timeEntryInsertSingleMock.mockResolvedValue({
    data: { id: TIME_ENTRY, workspace_id: WORKSPACE, hours: 7.5 },
    error: null,
  });
  timeEntryUpdateSingleMock.mockResolvedValue({
    data: { id: TIME_ENTRY, workspace_id: WORKSPACE, hours: 3 },
    error: null,
  });
  timeEntryDeleteEqMock.mockResolvedValue({ error: null });

  rateTableLookupSingleMock.mockResolvedValue({
    data: { id: RATE_TABLE, workspace_id: WORKSPACE },
    error: null,
  });
  rateTableUpdateSingleMock.mockResolvedValue({
    data: { id: RATE_TABLE, workspace_id: WORKSPACE, name: "2026 Rates" },
    error: null,
  });

  timeEntryListLimitMock.mockResolvedValue({ data: [], error: null });

  rateEntriesSnapshotEqMock.mockResolvedValue({ data: [], error: null });
  rateEntriesDeleteEqMock.mockResolvedValue({ error: null });
  rateEntriesRestoreResultMock.mockReturnValue({ error: null });
  rateEntriesInsertSelectMock.mockResolvedValue({
    data: [
      { id: "re-1", rate_table_id: RATE_TABLE, labor_category: "Senior Planner", hourly_rate: 195 },
      { id: "re-2", rate_table_id: RATE_TABLE, labor_category: "GIS Analyst", hourly_rate: 140 },
    ],
    error: null,
  });

  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: fromMock,
  });
});

describe("POST /api/invoicing/staff", () => {
  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postStaff(
      jsonRequest("http://localhost/api/invoicing/staff", "POST", { workspaceId: WORKSPACE, name: "J. Doe" })
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 when a member-role user attempts an invoicing write", async () => {
    membersMaybeSingleMock.mockResolvedValueOnce({
      data: { workspace_id: WORKSPACE, role: "member" },
      error: null,
    });

    const response = await postStaff(
      jsonRequest("http://localhost/api/invoicing/staff", "POST", { workspaceId: WORKSPACE, name: "J. Doe" })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Owner or admin role required for invoice writes" });
  });

  it("creates a staff record", async () => {
    const response = await postStaff(
      jsonRequest("http://localhost/api/invoicing/staff", "POST", {
        workspaceId: WORKSPACE,
        name: "J. Doe",
        title: "Principal",
        defaultLaborCategory: "Senior Planner",
      })
    );

    expect(response.status).toBe(201);
    expect(staffInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE,
        name: "J. Doe",
        title: "Principal",
        default_labor_category: "Senior Planner",
        active: true,
        created_by: USER,
      })
    );
  });

  it("refuses linking a user who is not a member of the workspace", async () => {
    // First workspace_members call: the caller's own membership; second: the link target.
    membersMaybeSingleMock
      .mockResolvedValueOnce({ data: { workspace_id: WORKSPACE, role: "owner" }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const response = await postStaff(
      jsonRequest("http://localhost/api/invoicing/staff", "POST", {
        workspaceId: WORKSPACE,
        name: "J. Doe",
        userId: LINKED_USER,
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Linked user is not a member of the requested workspace",
    });
    expect(staffInsertMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/invoicing/time-entries", () => {
  const payload = {
    workspaceId: WORKSPACE,
    staffId: STAFF,
    engagementId: ENGAGEMENT,
    entryDate: "2026-07-20",
    hours: 7.5,
  };

  it("rejects a staff record from another workspace", async () => {
    staffLookupSingleMock.mockResolvedValueOnce({
      data: { id: STAFF, workspace_id: OTHER_WORKSPACE, default_labor_category: null },
      error: null,
    });

    const response = await postTimeEntry(
      jsonRequest("http://localhost/api/invoicing/time-entries", "POST", payload)
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Staff record is not available in the requested workspace",
    });
    expect(timeEntryInsertMock).not.toHaveBeenCalled();
  });

  it("rejects an engagement from another workspace", async () => {
    engagementSingleMock.mockResolvedValueOnce({
      data: { id: ENGAGEMENT, workspace_id: OTHER_WORKSPACE },
      error: null,
    });

    const response = await postTimeEntry(
      jsonRequest("http://localhost/api/invoicing/time-entries", "POST", payload)
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Engagement is not available in the requested workspace",
    });
    expect(timeEntryInsertMock).not.toHaveBeenCalled();
  });

  it("creates a time entry, defaulting the labor category from the staff record", async () => {
    const response = await postTimeEntry(
      jsonRequest("http://localhost/api/invoicing/time-entries", "POST", payload)
    );

    expect(response.status).toBe(201);
    expect(timeEntryInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE,
        staff_id: STAFF,
        engagement_id: ENGAGEMENT,
        entry_date: "2026-07-20",
        hours: 7.5,
        billable: true,
        labor_category: "Senior Planner",
        created_by: USER,
      })
    );
  });

  it("rejects out-of-range hours before touching the database", async () => {
    const response = await postTimeEntry(
      jsonRequest("http://localhost/api/invoicing/time-entries", "POST", { ...payload, hours: 25 })
    );

    expect(response.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/invoicing/time-entries — truncation disclosure", () => {
  it("reports hasMore: false on a page under the 500-row cap", async () => {
    timeEntryListLimitMock.mockResolvedValueOnce({
      data: [{ id: TIME_ENTRY, workspace_id: WORKSPACE, hours: 2 }],
      error: null,
    });

    const response = await listTimeEntries(
      new NextRequest(`http://localhost/api/invoicing/time-entries?workspaceId=${WORKSPACE}`)
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.timeEntries).toHaveLength(1);
    expect(body.hasMore).toBe(false);
  });

  it("reports hasMore: true when the page sits exactly at the cap", async () => {
    timeEntryListLimitMock.mockResolvedValueOnce({
      data: Array.from({ length: 500 }, (_, index) => ({ id: `entry-${index}` })),
      error: null,
    });

    const response = await listTimeEntries(
      new NextRequest(`http://localhost/api/invoicing/time-entries?workspaceId=${WORKSPACE}`)
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.timeEntries).toHaveLength(500);
    expect(body.hasMore).toBe(true);
  });
});

describe("PATCH & DELETE /api/invoicing/time-entries/[timeEntryId] — billed-entry refusal", () => {
  const context = { params: Promise.resolve({ timeEntryId: TIME_ENTRY }) };

  it("refuses to edit a billed time entry", async () => {
    timeEntryLookupSingleMock.mockResolvedValueOnce({
      data: { id: TIME_ENTRY, workspace_id: WORKSPACE, billed_line_item_id: LINE_ITEM },
      error: null,
    });

    const response = await patchTimeEntry(
      jsonRequest(`http://localhost/api/invoicing/time-entries/${TIME_ENTRY}`, "PATCH", {
        workspaceId: WORKSPACE,
        hours: 3,
      }),
      context
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("already billed"),
    });
    expect(timeEntryUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses to delete a billed time entry", async () => {
    timeEntryLookupSingleMock.mockResolvedValueOnce({
      data: { id: TIME_ENTRY, workspace_id: WORKSPACE, billed_line_item_id: LINE_ITEM },
      error: null,
    });

    const response = await deleteTimeEntry(
      new NextRequest(`http://localhost/api/invoicing/time-entries/${TIME_ENTRY}?workspaceId=${WORKSPACE}`, {
        method: "DELETE",
      }),
      context
    );

    expect(response.status).toBe(409);
    expect(timeEntryDeleteMock).not.toHaveBeenCalled();
  });

  it("edits an unbilled time entry", async () => {
    const response = await patchTimeEntry(
      jsonRequest(`http://localhost/api/invoicing/time-entries/${TIME_ENTRY}`, "PATCH", {
        workspaceId: WORKSPACE,
        hours: 3,
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(timeEntryUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ hours: 3 }));
  });

  it("deletes an unbilled time entry", async () => {
    const response = await deleteTimeEntry(
      new NextRequest(`http://localhost/api/invoicing/time-entries/${TIME_ENTRY}?workspaceId=${WORKSPACE}`, {
        method: "DELETE",
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true });
    expect(timeEntryDeleteEqMock).toHaveBeenCalledWith("id", TIME_ENTRY);
  });

  it("hides a time entry from another workspace as not found", async () => {
    timeEntryLookupSingleMock.mockResolvedValueOnce({
      data: { id: TIME_ENTRY, workspace_id: OTHER_WORKSPACE, billed_line_item_id: null },
      error: null,
    });

    const response = await patchTimeEntry(
      jsonRequest(`http://localhost/api/invoicing/time-entries/${TIME_ENTRY}`, "PATCH", {
        workspaceId: WORKSPACE,
        hours: 3,
      }),
      context
    );

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/invoicing/rate-tables/[rateTableId]", () => {
  const context = { params: Promise.resolve({ rateTableId: RATE_TABLE }) };

  it("replaces the whole entry set when entries are provided", async () => {
    const response = await patchRateTable(
      jsonRequest(`http://localhost/api/invoicing/rate-tables/${RATE_TABLE}`, "PATCH", {
        workspaceId: WORKSPACE,
        name: "2026 Rates",
        entries: [
          { laborCategory: "Senior Planner", hourlyRate: 195 },
          { laborCategory: "GIS Analyst", hourlyRate: 140 },
        ],
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(rateEntriesDeleteEqMock).toHaveBeenCalledWith("rate_table_id", RATE_TABLE);
    expect(rateEntriesInsertMock).toHaveBeenCalledWith([
      { rate_table_id: RATE_TABLE, labor_category: "Senior Planner", hourly_rate: 195 },
      { rate_table_id: RATE_TABLE, labor_category: "GIS Analyst", hourly_rate: 140 },
    ]);

    const body = await response.json();
    expect(body.rateTable.entries).toHaveLength(2);
  });

  it("rejects an hourly rate beyond NUMERIC(10,2) before any delete can run", async () => {
    const response = await patchRateTable(
      jsonRequest(`http://localhost/api/invoicing/rate-tables/${RATE_TABLE}`, "PATCH", {
        workspaceId: WORKSPACE,
        entries: [{ laborCategory: "Senior Planner", hourlyRate: 100_000_000 }],
      }),
      context
    );

    expect(response.status).toBe(400);
    // Zod refuses the payload before the route touches the database at all —
    // the previous entry set is never at risk from an over-cap rate.
    expect(fromMock).not.toHaveBeenCalled();
    expect(rateEntriesDeleteMock).not.toHaveBeenCalled();
  });

  it("restores the previous entry set when the replacement insert fails", async () => {
    rateEntriesSnapshotEqMock.mockResolvedValueOnce({
      data: [
        { labor_category: "Senior Planner", hourly_rate: 185 },
        { labor_category: "GIS Analyst", hourly_rate: 130 },
      ],
      error: null,
    });
    rateEntriesInsertSelectMock.mockResolvedValueOnce({
      data: null,
      error: { message: "numeric field overflow", code: "22003" },
    });

    const response = await patchRateTable(
      jsonRequest(`http://localhost/api/invoicing/rate-tables/${RATE_TABLE}`, "PATCH", {
        workspaceId: WORKSPACE,
        entries: [{ laborCategory: "Senior Planner", hourlyRate: 205 }],
      }),
      context
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("previous entries were restored"),
    });

    // Snapshot → delete → failed insert of the new set → compensating
    // re-insert of the snapshot.
    expect(rateEntriesDeleteEqMock).toHaveBeenCalledWith("rate_table_id", RATE_TABLE);
    expect(rateEntriesInsertMock).toHaveBeenCalledTimes(2);
    expect(rateEntriesInsertMock).toHaveBeenLastCalledWith([
      { rate_table_id: RATE_TABLE, labor_category: "Senior Planner", hourly_rate: 185 },
      { rate_table_id: RATE_TABLE, labor_category: "GIS Analyst", hourly_rate: 130 },
    ]);
  });

  it("answers honestly when the compensating restore also fails", async () => {
    rateEntriesSnapshotEqMock.mockResolvedValueOnce({
      data: [{ labor_category: "Senior Planner", hourly_rate: 185 }],
      error: null,
    });
    rateEntriesInsertSelectMock.mockResolvedValueOnce({
      data: null,
      error: { message: "numeric field overflow", code: "22003" },
    });
    rateEntriesRestoreResultMock.mockReturnValueOnce({ error: { message: "connection lost" } });

    const response = await patchRateTable(
      jsonRequest(`http://localhost/api/invoicing/rate-tables/${RATE_TABLE}`, "PATCH", {
        workspaceId: WORKSPACE,
        entries: [{ laborCategory: "Senior Planner", hourlyRate: 205 }],
      }),
      context
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("restoring the previous entries also failed"),
    });
  });

  it("refuses to touch the entry set when the snapshot itself cannot be loaded", async () => {
    rateEntriesSnapshotEqMock.mockResolvedValueOnce({
      data: null,
      error: { message: "connection lost" },
    });

    const response = await patchRateTable(
      jsonRequest(`http://localhost/api/invoicing/rate-tables/${RATE_TABLE}`, "PATCH", {
        workspaceId: WORKSPACE,
        entries: [{ laborCategory: "Senior Planner", hourlyRate: 205 }],
      }),
      context
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("nothing was changed"),
    });
    expect(rateEntriesDeleteMock).not.toHaveBeenCalled();
    expect(rateEntriesInsertMock).not.toHaveBeenCalled();
  });

  it("refuses duplicate labor categories in a replacement set", async () => {
    const response = await patchRateTable(
      jsonRequest(`http://localhost/api/invoicing/rate-tables/${RATE_TABLE}`, "PATCH", {
        workspaceId: WORKSPACE,
        entries: [
          { laborCategory: "Senior Planner", hourlyRate: 195 },
          { laborCategory: "senior planner", hourlyRate: 210 },
        ],
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(rateEntriesDeleteMock).not.toHaveBeenCalled();
  });

  it("hides a rate table from another workspace as not found", async () => {
    rateTableLookupSingleMock.mockResolvedValueOnce({
      data: { id: RATE_TABLE, workspace_id: OTHER_WORKSPACE },
      error: null,
    });

    const response = await patchRateTable(
      jsonRequest(`http://localhost/api/invoicing/rate-tables/${RATE_TABLE}`, "PATCH", {
        workspaceId: WORKSPACE,
        name: "2026 Rates",
      }),
      context
    );

    expect(response.status).toBe(404);
    expect(rateTableUpdateMock).not.toHaveBeenCalled();
  });
});
