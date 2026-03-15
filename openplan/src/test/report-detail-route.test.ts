import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const reportMaybeSingleMock = vi.fn();
const reportEqMock = vi.fn(() => ({ maybeSingle: reportMaybeSingleMock }));
const reportSelectMock = vi.fn(() => ({ eq: reportEqMock }));
const reportUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const reportUpdateMock = vi.fn(() => ({ eq: reportUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const sectionsOrderMock = vi.fn();
const sectionsEqMock = vi.fn(() => ({ order: sectionsOrderMock }));
const sectionsSelectMock = vi.fn(() => ({ eq: sectionsEqMock }));
const sectionsDeleteEqMock = vi.fn().mockResolvedValue({ error: null });
const sectionsDeleteMock = vi.fn(() => ({ eq: sectionsDeleteEqMock }));
const sectionsInsertMock = vi.fn().mockResolvedValue({ error: null });

const reportRunsOrderMock = vi.fn();
const reportRunsEqMock = vi.fn(() => ({ order: reportRunsOrderMock }));
const reportRunsSelectMock = vi.fn(() => ({ eq: reportRunsEqMock }));
const reportRunsDeleteEqMock = vi.fn().mockResolvedValue({ error: null });
const reportRunsDeleteMock = vi.fn(() => ({ eq: reportRunsDeleteEqMock }));
const reportRunsInsertMock = vi.fn().mockResolvedValue({ error: null });

const runsInMock = vi.fn();
const runsEqMock = vi.fn(() => ({ in: runsInMock }));
const runsSelectMock = vi.fn(() => ({ in: runsInMock, eq: runsEqMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "reports") {
    return {
      select: reportSelectMock,
      update: reportUpdateMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "projects") {
    return {
      select: projectSelectMock,
    };
  }

  if (table === "report_sections") {
    return {
      select: sectionsSelectMock,
      delete: sectionsDeleteMock,
      insert: sectionsInsertMock,
    };
  }

  if (table === "report_runs") {
    return {
      select: reportRunsSelectMock,
      delete: reportRunsDeleteMock,
      insert: reportRunsInsertMock,
    };
  }

  if (table === "runs") {
    return {
      select: runsSelectMock,
    };
  }

  if (table === "report_artifacts") {
    return {
      select: () => ({
        eq: () => ({
          order: vi.fn().mockResolvedValue({
            data: [{ id: "artifact-1", artifact_kind: "html", generated_at: "2026-03-14T12:00:00.000Z", metadata_json: {} }],
            error: null,
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

import { GET as getReportDetail, PATCH as patchReportDetail } from "@/app/api/reports/[reportId]/route";

describe("/api/reports/[reportId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    reportMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        title: "Project Status Packet",
        status: "draft",
        report_type: "project_status",
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "member",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Nevada County Safety Action Program",
      },
      error: null,
    });

    sectionsOrderMock.mockResolvedValue({
      data: [{ id: "section-1", section_key: "project_overview", title: "Project overview", enabled: true, sort_order: 0 }],
      error: null,
    });

    reportRunsOrderMock.mockResolvedValue({
      data: [{ id: "report-run-1", run_id: "55555555-5555-4555-8555-555555555555", sort_order: 0 }],
      error: null,
    });

    runsInMock.mockResolvedValue({
      data: [{ id: "55555555-5555-4555-8555-555555555555", title: "Run A", query_text: "Assess corridor", created_at: "2026-03-13T00:00:00.000Z" }],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getReportDetail(new NextRequest("http://localhost/api/reports/1"), {
      params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(401);
  });

  it("GET returns report detail payload", async () => {
    const response = await getReportDetail(new NextRequest("http://localhost/api/reports/1"), {
      params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      report: {
        id: "11111111-1111-4111-8111-111111111111",
      },
      sections: [expect.objectContaining({ id: "section-1" })],
      runs: [expect.objectContaining({ id: "55555555-5555-4555-8555-555555555555" })],
      artifacts: [expect.objectContaining({ id: "artifact-1" })],
    });
  });

  it("PATCH returns 403 when workspace role is unsupported", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "viewer",
      },
      error: null,
    });

    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated packet" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("PATCH updates report metadata", async () => {
    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Updated packet",
          summary: "Revised basis",
          status: "archived",
          runIds: ["55555555-5555-4555-8555-555555555555"],
        }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(reportUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated packet",
        summary: "Revised basis",
        status: "archived",
      })
    );
    expect(reportRunsDeleteMock).toHaveBeenCalled();
    expect(reportRunsInsertMock).toHaveBeenCalledWith([
      {
        report_id: "11111111-1111-4111-8111-111111111111",
        run_id: "55555555-5555-4555-8555-555555555555",
        sort_order: 0,
      },
    ]);
  });

  it("PATCH rejects generated status without an artifact", async () => {
    const response = await patchReportDetail(
      new NextRequest("http://localhost/api/reports/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "generated" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Generate an artifact before marking this report as generated",
    });
  });
});
