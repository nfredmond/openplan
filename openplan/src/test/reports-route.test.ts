import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const reportsOrderMock = vi.fn();
const reportsSelectMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsSingleMock = vi.fn();
const reportsInsertSelectMock = vi.fn(() => ({ single: reportsSingleMock }));
const reportsInsertMock = vi.fn(() => ({ select: reportsInsertSelectMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const runsInMock = vi.fn();
const runsEqMock = vi.fn(() => ({ in: runsInMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock }));

const countyRunMaybeSingleMock = vi.fn();
const countyRunEqMock = vi.fn(() => ({ maybeSingle: countyRunMaybeSingleMock }));
const countyRunSelectMock = vi.fn(() => ({ eq: countyRunEqMock }));

const reportSectionsInsertMock = vi.fn();
const reportRunsInsertMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "reports") {
    return {
      select: reportsSelectMock,
      insert: reportsInsertMock,
    };
  }

  if (table === "projects") {
    return {
      select: projectSelectMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "runs") {
    return {
      select: runsSelectMock,
    };
  }

  if (table === "county_runs") {
    return {
      select: countyRunSelectMock,
    };
  }

  if (table === "report_sections") {
    return {
      insert: reportSectionsInsertMock,
    };
  }

  if (table === "report_runs") {
    return {
      insert: reportRunsInsertMock,
    };
  }

  if (table === "assistant_action_executions") {
    return {
      insert: vi.fn().mockResolvedValue({ error: null }),
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

import { GET as getReports, POST as postReports } from "@/app/api/reports/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("/api/reports", () => {
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

    reportsOrderMock.mockResolvedValue({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Nevada County Status Packet",
        },
      ],
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        workspace_id: "44444444-4444-4444-8444-444444444444",
        name: "Nevada County Safety Action Program",
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "44444444-4444-4444-8444-444444444444",
        role: "member",
      },
      error: null,
    });

    runsInMock.mockResolvedValue({
      data: [{ id: "55555555-5555-4555-8555-555555555555" }],
      error: null,
    });
    countyRunMaybeSingleMock.mockResolvedValue({
      data: {
        id: "77777777-7777-4777-8777-777777777777",
        workspace_id: "44444444-4444-4444-8444-444444444444",
      },
      error: null,
    });

    reportsSingleMock.mockResolvedValue({
      data: {
        id: "66666666-6666-4666-8666-666666666666",
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: "33333333-3333-4333-8333-333333333333",
        title: "Nevada County Safety Action Program Project Status",
        report_type: "project_status",
        status: "draft",
      },
      error: null,
    });

    reportSectionsInsertMock.mockResolvedValue({ error: null });
    reportRunsInsertMock.mockResolvedValue({ error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("GET returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await getReports(new NextRequest("http://localhost/api/reports"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("GET returns the current report catalog", async () => {
    const response = await getReports(new NextRequest("http://localhost/api/reports"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reports: [expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111" })],
    });
  });

  it("POST returns 400 for invalid payload", async () => {
    const response = await postReports(jsonRequest({ reportType: "project_status" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid input" });
  });

  it("POST returns 403 when workspace role is unsupported", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "44444444-4444-4444-8444-444444444444",
        role: "viewer",
      },
      error: null,
    });

    const response = await postReports(
      jsonRequest({
        projectId: "33333333-3333-4333-8333-333333333333",
        reportType: "project_status",
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("POST creates a report scaffold with linked runs", async () => {
    const response = await postReports(
      jsonRequest({
        projectId: "33333333-3333-4333-8333-333333333333",
        reportType: "project_status",
        runIds: ["55555555-5555-4555-8555-555555555555"],
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      reportId: "66666666-6666-4666-8666-666666666666",
    });
    expect(reportsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "44444444-4444-4444-8444-444444444444",
        project_id: "33333333-3333-4333-8333-333333333333",
        created_by: "22222222-2222-4222-8222-222222222222",
      })
    );
    expect(reportSectionsInsertMock).toHaveBeenCalled();
    expect(reportRunsInsertMock).toHaveBeenCalledWith([
      {
        report_id: "66666666-6666-4666-8666-666666666666",
        run_id: "55555555-5555-4555-8555-555555555555",
        sort_order: 0,
      },
    ]);
  });

  it("POST attaches an explicit modeling county run when it belongs to the target workspace", async () => {
    const response = await postReports(
      jsonRequest({
        projectId: "33333333-3333-4333-8333-333333333333",
        reportType: "project_status",
        modelingCountyRunId: "77777777-7777-4777-8777-777777777777",
      })
    );

    expect(response.status).toBe(201);
    expect(reportsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modeling_county_run_id: "77777777-7777-4777-8777-777777777777",
      })
    );
  });

  it("POST rejects a modeling county run outside the target workspace", async () => {
    countyRunMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "77777777-7777-4777-8777-777777777777",
        workspace_id: "99999999-9999-4999-8999-999999999999",
      },
      error: null,
    });

    const response = await postReports(
      jsonRequest({
        projectId: "33333333-3333-4333-8333-333333333333",
        reportType: "project_status",
        modelingCountyRunId: "77777777-7777-4777-8777-777777777777",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Modeling county run not found" });
    expect(reportsInsertMock).not.toHaveBeenCalled();
  });

  it("POST preserves engagement handoff provenance in seeded section config", async () => {
    const response = await postReports(
      jsonRequest({
        projectId: "33333333-3333-4333-8333-333333333333",
        reportType: "project_status",
        sections: [
          {
            sectionKey: "status_snapshot",
            title: "Campaign and project snapshot",
            enabled: true,
            sortOrder: 1,
            configJson: {
              campaignId: "77777777-7777-4777-8777-777777777777",
              provenance: {
                origin: "engagement_campaign_handoff",
                reason: "Created from an engagement campaign to preserve handoff-ready public input context for project reporting.",
                capturedAt: "2026-03-28T15:00:00.000Z",
                campaign: {
                  id: "77777777-7777-4777-8777-777777777777",
                  projectId: "33333333-3333-4333-8333-333333333333",
                  title: "Downtown listening campaign",
                  summary: "Collect downtown safety feedback.",
                  status: "active",
                  engagementType: "comment_collection",
                  createdAt: "2026-03-01T09:00:00.000Z",
                  updatedAt: "2026-03-28T14:45:00.000Z",
                },
                counts: {
                  totalItems: 18,
                  readyForHandoffCount: 11,
                  actionableCount: 3,
                  uncategorizedItems: 2,
                },
              },
            },
          },
          {
            sectionKey: "engagement_summary",
            title: "Engagement campaign summary",
            enabled: true,
            sortOrder: 2,
            configJson: {
              campaignId: "77777777-7777-4777-8777-777777777777",
            },
          },
        ],
      })
    );

    expect(response.status).toBe(201);
    expect(reportSectionsInsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          section_key: "status_snapshot",
          config_json: expect.objectContaining({
            campaignId: "77777777-7777-4777-8777-777777777777",
            provenance: expect.objectContaining({
              origin: "engagement_campaign_handoff",
              capturedAt: "2026-03-28T15:00:00.000Z",
              campaign: expect.objectContaining({
                title: "Downtown listening campaign",
                status: "active",
              }),
              counts: expect.objectContaining({
                readyForHandoffCount: 11,
                uncategorizedItems: 2,
              }),
            }),
          }),
        }),
      ])
    );
  });
});
