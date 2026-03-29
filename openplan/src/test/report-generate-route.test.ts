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

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const sectionsOrderMock = vi.fn();
const sectionsEqMock = vi.fn(() => ({ order: sectionsOrderMock }));
const sectionsSelectMock = vi.fn(() => ({ eq: sectionsEqMock }));

const reportRunsOrderMock = vi.fn();
const reportRunsEqMock = vi.fn(() => ({ order: reportRunsOrderMock }));
const reportRunsSelectMock = vi.fn(() => ({ eq: reportRunsEqMock }));

const deliverablesLimitMock = vi.fn();
const deliverablesOrderMock = vi.fn(() => ({ limit: deliverablesLimitMock }));
const deliverablesEqMock = vi.fn(() => ({ order: deliverablesOrderMock }));
const deliverablesSelectMock = vi.fn(() => ({ eq: deliverablesEqMock }));

const risksLimitMock = vi.fn();
const risksOrderMock = vi.fn(() => ({ limit: risksLimitMock }));
const risksEqMock = vi.fn(() => ({ order: risksOrderMock }));
const risksSelectMock = vi.fn(() => ({ eq: risksEqMock }));

const issuesLimitMock = vi.fn();
const issuesOrderMock = vi.fn(() => ({ limit: issuesLimitMock }));
const issuesEqMock = vi.fn(() => ({ order: issuesOrderMock }));
const issuesSelectMock = vi.fn(() => ({ eq: issuesEqMock }));

const decisionsLimitMock = vi.fn();
const decisionsOrderMock = vi.fn(() => ({ limit: decisionsLimitMock }));
const decisionsEqMock = vi.fn(() => ({ order: decisionsOrderMock }));
const decisionsSelectMock = vi.fn(() => ({ eq: decisionsEqMock }));

const meetingsLimitMock = vi.fn();
const meetingsOrderMock = vi.fn(() => ({ limit: meetingsLimitMock }));
const meetingsEqMock = vi.fn(() => ({ order: meetingsOrderMock }));
const meetingsSelectMock = vi.fn(() => ({ eq: meetingsEqMock }));

const runsInMock = vi.fn();
const runsSelectMock = vi.fn(() => ({ in: runsInMock }));

const engagementCampaignMaybeSingleMock = vi.fn();
const engagementCampaignEqIdMock = vi.fn(() => ({ maybeSingle: engagementCampaignMaybeSingleMock }));
const engagementCampaignEqWorkspaceMock = vi.fn(() => ({ eq: engagementCampaignEqIdMock }));
const engagementCampaignSelectMock = vi.fn(() => ({ eq: engagementCampaignEqWorkspaceMock }));

const engagementCategoriesOrderCreatedMock = vi.fn();
const engagementCategoriesOrderSortMock = vi.fn(() => ({ order: engagementCategoriesOrderCreatedMock }));
const engagementCategoriesEqCampaignMock = vi.fn(() => ({ order: engagementCategoriesOrderSortMock }));
const engagementCategoriesSelectMock = vi.fn(() => ({ eq: engagementCategoriesEqCampaignMock }));

const engagementItemsOrderMock = vi.fn();
const engagementItemsEqCampaignMock = vi.fn(() => ({ order: engagementItemsOrderMock }));
const engagementItemsSelectMock = vi.fn(() => ({ eq: engagementItemsEqCampaignMock }));

const artifactsSingleMock = vi.fn();
const artifactsInsertSelectMock = vi.fn(() => ({ single: artifactsSingleMock }));
const artifactsInsertMock = vi.fn(() => ({ select: artifactsInsertSelectMock }));

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

  if (table === "workspaces") {
    return {
      select: workspaceSelectMock,
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
    };
  }

  if (table === "report_runs") {
    return {
      select: reportRunsSelectMock,
    };
  }

  if (table === "project_deliverables") {
    return {
      select: deliverablesSelectMock,
    };
  }

  if (table === "project_risks") {
    return {
      select: risksSelectMock,
    };
  }

  if (table === "project_issues") {
    return {
      select: issuesSelectMock,
    };
  }

  if (table === "project_decisions") {
    return {
      select: decisionsSelectMock,
    };
  }

  if (table === "project_meetings") {
    return {
      select: meetingsSelectMock,
    };
  }

  if (table === "runs") {
    return {
      select: runsSelectMock,
    };
  }

  if (table === "engagement_campaigns") {
    return {
      select: engagementCampaignSelectMock,
    };
  }

  if (table === "engagement_categories") {
    return {
      select: engagementCategoriesSelectMock,
    };
  }

  if (table === "engagement_items") {
    return {
      select: engagementItemsSelectMock,
    };
  }

  if (table === "report_artifacts") {
    return {
      insert: artifactsInsertMock,
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

import { POST as postGenerate } from "@/app/api/reports/[reportId]/generate/route";

describe("POST /api/reports/[reportId]/generate", () => {
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
        summary: "Packet summary",
        report_type: "project_status",
        status: "draft",
        created_at: "2026-03-14T00:00:00.000Z",
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

    workspaceMaybeSingleMock.mockResolvedValue({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Nevada County Safety Action Program",
        plan: "pilot",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        name: "Nevada County Safety Action Program",
        summary: "Project summary",
        status: "active",
        plan_type: "safety_plan",
        delivery_phase: "analysis",
        created_at: "2026-03-13T00:00:00.000Z",
        updated_at: "2026-03-14T01:00:00.000Z",
      },
      error: null,
    });

    sectionsOrderMock.mockResolvedValue({
      data: [{ id: "section-1", section_key: "project_overview", title: "Project overview", enabled: true, sort_order: 0, config_json: {} }],
      error: null,
    });

    reportRunsOrderMock.mockResolvedValue({
      data: [{ id: "report-run-1", run_id: "55555555-5555-4555-8555-555555555555", sort_order: 0 }],
      error: null,
    });

    deliverablesLimitMock.mockResolvedValue({ data: [], error: null });
    risksLimitMock.mockResolvedValue({ data: [], error: null });
    issuesLimitMock.mockResolvedValue({ data: [], error: null });
    decisionsLimitMock.mockResolvedValue({ data: [], error: null });
    meetingsLimitMock.mockResolvedValue({ data: [], error: null });

    runsInMock.mockResolvedValue({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          title: "Run A",
          query_text: "Assess corridor",
          summary_text: "Run summary",
          ai_interpretation: "AI interpretation",
          metrics: {
            overallScore: 81,
            confidence: "high",
            sourceSnapshots: {
              census: { fetchedAt: "2026-03-12T00:00:00.000Z" },
              transit: { fetchedAt: "2026-03-12T00:00:00.000Z" },
              crashes: { fetchedAt: "2026-03-12T00:00:00.000Z" },
            },
            dataQuality: {
              censusAvailable: true,
              crashDataAvailable: true,
              lodesSource: "lodes",
              equitySource: "cejst-proxy-census",
            },
          },
          created_at: "2026-03-12T00:00:00.000Z",
        },
      ],
      error: null,
    });

    engagementCampaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: "99999999-9999-4999-8999-999999999999",
        title: "Downtown listening campaign",
        summary: "Capture walking and crossing feedback.",
        status: "active",
        engagement_type: "comment_collection",
        updated_at: "2026-03-14T02:30:00.000Z",
      },
      error: null,
    });

    engagementCategoriesOrderCreatedMock.mockResolvedValue({
      data: [
        {
          id: "category-1",
          label: "Safety",
          slug: "safety",
          description: "Crossings and vehicle behavior",
          sort_order: 0,
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-13T00:00:00.000Z",
        },
      ],
      error: null,
    });

    engagementItemsOrderMock.mockResolvedValue({
      data: [
        {
          id: "item-1",
          campaign_id: "99999999-9999-4999-8999-999999999999",
          category_id: "category-1",
          status: "approved",
          source_type: "public",
          latitude: 34.1,
          longitude: -118.3,
          moderation_notes: "Verified in workshop.",
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-14T03:00:00.000Z",
        },
      ],
      error: null,
    });

    artifactsSingleMock.mockResolvedValue({
      data: {
        id: "artifact-1",
        report_id: "11111111-1111-4111-8111-111111111111",
        artifact_kind: "html",
        generated_at: "2026-03-14T02:00:00.000Z",
        metadata_json: {},
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 501 for pdf generation requests", async () => {
    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "pdf" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(501);
  });

  it("returns 403 when workspace role is unsupported", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "viewer",
      },
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("persists an html artifact and updates report status", async () => {
    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reportId: "11111111-1111-4111-8111-111111111111",
      artifactId: "artifact-1",
      format: "html",
    });
    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        report_id: "11111111-1111-4111-8111-111111111111",
        artifact_kind: "html",
        generated_by: "22222222-2222-4222-8222-222222222222",
        metadata_json: expect.objectContaining({
          generationMode: "structured_html_packet",
          sourceContext: expect.objectContaining({
            linkedRunCount: 1,
          }),
        }),
      })
    );
    expect(reportUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "generated",
        latest_artifact_kind: "html",
      })
    );
  });

  it("includes configured engagement handoff context when the section is enabled", async () => {
    sectionsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "section-1",
          section_key: "engagement_summary",
          title: "Engagement campaign summary",
          enabled: true,
          sort_order: 0,
          config_json: {
            campaignId: "99999999-9999-4999-8999-999999999999",
            provenance: {
              origin: "engagement_campaign_handoff",
              reason:
                "Created from an engagement campaign to preserve handoff-ready public input context for project reporting.",
              capturedAt: "2026-03-14T01:45:00.000Z",
              campaign: {
                id: "99999999-9999-4999-8999-999999999999",
                projectId: "44444444-4444-4444-8444-444444444444",
                title: "Downtown listening campaign",
                summary: "Capture walking and crossing feedback.",
                status: "active",
                engagementType: "comment_collection",
                createdAt: "2026-03-01T00:00:00.000Z",
                updatedAt: "2026-03-14T01:30:00.000Z",
              },
              counts: {
                totalItems: 14,
                readyForHandoffCount: 9,
                actionableCount: 2,
                uncategorizedItems: 1,
              },
            },
          },
        },
      ],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata_json: expect.objectContaining({
          htmlContent: expect.stringContaining("Downtown listening campaign"),
          sourceContext: expect.objectContaining({
            reportOrigin: "engagement_campaign_handoff",
            reportReason:
              "Created from an engagement campaign to preserve handoff-ready public input context for project reporting.",
            engagementCampaignId: "99999999-9999-4999-8999-999999999999",
            engagementSnapshotCapturedAt: "2026-03-14T01:45:00.000Z",
            engagementCampaignSnapshot: expect.objectContaining({
              title: "Downtown listening campaign",
              engagementType: "comment_collection",
              updatedAt: "2026-03-14T01:30:00.000Z",
            }),
            engagementCountsSnapshot: expect.objectContaining({
              totalItems: 14,
              readyForHandoffCount: 9,
              actionableCount: 2,
              uncategorizedItems: 1,
            }),
            engagementCampaignCurrent: expect.objectContaining({
              status: "active",
              engagementType: "comment_collection",
            }),
            engagementItemCount: 1,
            engagementReadyForHandoffCount: 1,
          }),
        }),
      })
    );
  });
});
