import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const projectsSingleMock = vi.fn();

const projectDeliverablesSingleMock = vi.fn();
const projectDeliverablesSelectMock = vi.fn(() => ({ single: projectDeliverablesSingleMock }));
const projectDeliverablesInsertMock = vi.fn(() => ({ select: projectDeliverablesSelectMock }));

const projectIssuesSingleMock = vi.fn();
const projectIssuesSelectMock = vi.fn(() => ({ single: projectIssuesSingleMock }));
const projectIssuesInsertMock = vi.fn(() => ({ select: projectIssuesSelectMock }));

const projectsSelectEqMock = vi.fn(() => ({ single: projectsSingleMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsSelectEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return { select: projectsSelectMock };
  }

  if (table === "project_deliverables") {
    return { insert: projectDeliverablesInsertMock };
  }

  if (table === "project_issues") {
    return { insert: projectIssuesInsertMock };
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

import { POST as postRecord } from "@/app/api/projects/[projectId]/records/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/projects/11111111-1111-4111-8111-111111111111/records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/projects/[projectId]/records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });

    projectsSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Nevada County Safety Action Program",
      },
      error: null,
    });

    projectDeliverablesSingleMock.mockResolvedValue({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Draft board-ready safety memo",
        summary: "Summarize the recommended safety package.",
        owner_label: "Elena",
        due_date: "2026-03-20",
        status: "in_progress",
        created_at: "2026-03-13T07:00:00.000Z",
      },
      error: null,
    });

    projectIssuesSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Traffic count package still missing",
        description: "Need latest counts from field team.",
        severity: "high",
        status: "open",
        owner_label: "Priya",
        created_at: "2026-03-13T07:10:00.000Z",
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

    const response = await postRecord(
      jsonRequest({ recordType: "deliverable", title: "Draft board-ready safety memo" }),
      { params: Promise.resolve({ projectId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("creates a deliverable for an accessible project", async () => {
    const response = await postRecord(
      jsonRequest({
        recordType: "deliverable",
        title: "Draft board-ready safety memo",
        summary: "Summarize the recommended safety package.",
        ownerLabel: "Elena",
        dueDate: "2026-03-20",
        status: "in_progress",
      }),
      { params: Promise.resolve({ projectId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(201);
    expect(projectDeliverablesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "11111111-1111-4111-8111-111111111111",
        title: "Draft board-ready safety memo",
        summary: "Summarize the recommended safety package.",
        owner_label: "Elena",
        due_date: "2026-03-20",
        status: "in_progress",
        created_by: "22222222-2222-4222-8222-222222222222",
      })
    );

    expect(await response.json()).toMatchObject({
      recordType: "deliverable",
      record: {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Draft board-ready safety memo",
      },
    });
  });

  it("creates an issue for an accessible project", async () => {
    const response = await postRecord(
      jsonRequest({
        recordType: "issue",
        title: "Traffic count package still missing",
        description: "Need latest counts from field team.",
        severity: "high",
        status: "open",
        ownerLabel: "Priya",
      }),
      { params: Promise.resolve({ projectId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(201);
    expect(projectIssuesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "11111111-1111-4111-8111-111111111111",
        title: "Traffic count package still missing",
        description: "Need latest counts from field team.",
        severity: "high",
        status: "open",
        owner_label: "Priya",
        created_by: "22222222-2222-4222-8222-222222222222",
      })
    );

    expect(await response.json()).toMatchObject({
      recordType: "issue",
      record: {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Traffic count package still missing",
      },
    });
  });

  it("returns 404 when the project is not found", async () => {
    projectsSingleMock.mockResolvedValueOnce({ data: null, error: { message: "not found" } });

    const response = await postRecord(
      jsonRequest({ recordType: "deliverable", title: "Draft board-ready safety memo" }),
      { params: Promise.resolve({ projectId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Project not found" });
  });
});
