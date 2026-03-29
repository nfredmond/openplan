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

const stageGateDecisionsLimitMock = vi.fn();
const stageGateDecisionsOrderMock = vi.fn(() => ({ limit: stageGateDecisionsLimitMock }));
const stageGateDecisionsEqMock = vi.fn(() => ({ order: stageGateDecisionsOrderMock }));
const stageGateDecisionsSelectMock = vi.fn(() => ({ eq: stageGateDecisionsEqMock }));

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

const scenarioEntriesInMock = vi.fn();
const scenarioEntriesSelectMock = vi.fn(() => ({ in: scenarioEntriesInMock }));

const scenarioSetsInMock = vi.fn();
const scenarioSetsSelectMock = vi.fn(() => ({ in: scenarioSetsInMock }));

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

  if (table === "stage_gate_decisions") {
    return {
      select: stageGateDecisionsSelectMock,
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

  if (table === "scenario_entries") {
    return {
      select: scenarioEntriesSelectMock,
    };
  }

  if (table === "scenario_sets") {
    return {
      select: scenarioSetsSelectMock,
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
    stageGateDecisionsLimitMock.mockResolvedValue({ data: [], error: null });

    deliverablesLimitMock.mockResolvedValue({ data: [], error: null });
    risksLimitMock.mockResolvedValue({ data: [], error: null });
    issuesLimitMock.mockResolvedValue({ data: [], error: null });
    decisionsLimitMock.mockResolvedValue({ data: [], error: null });
    meetingsLimitMock.mockResolvedValue({ data: [], error: null });

    const runRowsById = new Map([
      [
        "55555555-5555-4555-8555-555555555555",
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
      [
        "66666666-6666-4666-8666-666666666666",
        {
          id: "66666666-6666-4666-8666-666666666666",
          title: "Existing conditions baseline",
          query_text: "Assess current conditions",
          summary_text: "Baseline summary",
          ai_interpretation: "Baseline interpretation",
          metrics: {
            overallScore: 74,
            confidence: "medium",
          },
          created_at: "2026-03-10T00:00:00.000Z",
        },
      ],
    ]);

    runsInMock.mockImplementation(async (_column: string, ids: string[]) => ({
      data: ids
        .map((id) => runRowsById.get(id))
        .filter((value): value is NonNullable<ReturnType<typeof runRowsById.get>> => Boolean(value)),
      error: null,
    }));

    scenarioEntriesInMock.mockImplementation(async (column: string) => {
      if (column === "attached_run_id") {
        return {
          data: [
            {
              id: "scenario-entry-alt",
              scenario_set_id: "scenario-set-1",
              entry_type: "alternative",
              label: "Protected bike package",
              attached_run_id: "55555555-5555-4555-8555-555555555555",
              sort_order: 1,
              created_at: "2026-03-09T00:00:00.000Z",
              updated_at: "2026-03-14T01:30:00.000Z",
            },
          ],
          error: null,
        };
      }

      if (column === "scenario_set_id") {
        return {
          data: [
            {
              id: "scenario-entry-baseline",
              scenario_set_id: "scenario-set-1",
              entry_type: "baseline",
              label: "Existing conditions",
              attached_run_id: "66666666-6666-4666-8666-666666666666",
              sort_order: 0,
              created_at: "2026-03-08T00:00:00.000Z",
              updated_at: "2026-03-14T01:00:00.000Z",
            },
            {
              id: "scenario-entry-alt",
              scenario_set_id: "scenario-set-1",
              entry_type: "alternative",
              label: "Protected bike package",
              attached_run_id: "55555555-5555-4555-8555-555555555555",
              sort_order: 1,
              created_at: "2026-03-09T00:00:00.000Z",
              updated_at: "2026-03-14T01:30:00.000Z",
            },
          ],
          error: null,
        };
      }

      throw new Error(`Unexpected scenario_entries lookup column: ${column}`);
    });

    scenarioSetsInMock.mockResolvedValue({
      data: [
        {
          id: "scenario-set-1",
          title: "Downtown alternatives",
          baseline_entry_id: "scenario-entry-baseline",
          updated_at: "2026-03-14T01:15:00.000Z",
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

  it("persists compact project-record provenance in artifact metadata and html", async () => {
    deliverablesLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "deliverable-1",
          title: "ADA curb ramp package",
          summary: "Bundle for near-term accessibility fixes.",
          status: "in_progress",
          due_date: "2026-03-20T00:00:00.000Z",
          created_at: "2026-03-14T00:00:00.000Z",
        },
      ],
      error: null,
    });
    risksLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "risk-1",
          title: "Grant match exposure",
          description: "Funding share remains unresolved.",
          status: "open",
          created_at: "2026-03-18T15:30:00.000Z",
        },
      ],
      error: null,
    });
    issuesLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "issue-1",
          title: "Signal timing conflict",
          description: "Peak phasing needs revision.",
          status: "open",
          created_at: "2026-03-19T09:45:00.000Z",
        },
      ],
      error: null,
    });
    decisionsLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "decision-1",
          title: "Advance quick-build crosswalk package",
          rationale: "Near-term safety benefit is high.",
          status: "approved",
          decided_at: "2026-03-17T18:00:00.000Z",
          created_at: "2026-03-16T12:00:00.000Z",
        },
      ],
      error: null,
    });
    meetingsLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "meeting-1",
          title: "Operations review",
          notes: "Confirmed striping sequencing.",
          meeting_at: "2026-03-15T17:00:00.000Z",
          created_at: "2026-03-15T17:00:00.000Z",
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
          sourceContext: expect.objectContaining({
            projectRecordsSnapshot: {
              deliverables: {
                count: 1,
                latestTitle: "ADA curb ramp package",
                latestAt: "2026-03-20T00:00:00.000Z",
              },
              risks: {
                count: 1,
                latestTitle: "Grant match exposure",
                latestAt: "2026-03-18T15:30:00.000Z",
              },
              issues: {
                count: 1,
                latestTitle: "Signal timing conflict",
                latestAt: "2026-03-19T09:45:00.000Z",
              },
              decisions: {
                count: 1,
                latestTitle: "Advance quick-build crosswalk package",
                latestAt: "2026-03-17T18:00:00.000Z",
              },
              meetings: {
                count: 1,
                latestTitle: "Operations review",
                latestAt: "2026-03-15T17:00:00.000Z",
              },
            },
          }),
          htmlContent: expect.stringContaining("Project records provenance"),
        }),
      })
    );

    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = generatedArtifact?.metadata_json?.htmlContent;

    expect(generatedHtml).toContain("ADA curb ramp package");
    expect(generatedHtml).toContain("Grant match exposure");
    expect(generatedHtml).toContain("Signal timing conflict");
    expect(generatedHtml).toContain("Advance quick-build crosswalk package");
    expect(generatedHtml).toContain("Operations review");
    expect(generatedHtml).toContain('/projects/44444444-4444-4444-8444-444444444444#project-deliverables');
    expect(generatedHtml).toContain('/projects/44444444-4444-4444-8444-444444444444#project-risks');
  });

  it("persists a compact stage-gate snapshot in artifact metadata and html", async () => {
    stageGateDecisionsLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "stage-gate-1",
          gate_id: "G01_INITIATION_AUTHORIZATION",
          decision: "PASS",
          rationale: "Charter is approved.",
          decided_at: "2026-03-13T16:00:00.000Z",
          missing_artifacts: [],
        },
        {
          id: "stage-gate-2",
          gate_id: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
          decision: "HOLD",
          rationale: "Civil rights plan is still missing.",
          decided_at: "2026-03-14T01:00:00.000Z",
          missing_artifacts: ["G02_E03"],
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
          sourceContext: expect.objectContaining({
            stageGateSnapshot: expect.objectContaining({
              templateId: "ca_stage_gates_v0_1",
              templateVersion: "0.1.0",
              passCount: 1,
              holdCount: 1,
              notStartedCount: 7,
              blockedGate: expect.objectContaining({
                gateId: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
                name: "Agreements, Procurement, and Civil Rights Setup",
                missingArtifacts: ["G02_E03"],
              }),
              nextGate: expect.objectContaining({
                gateId: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
              }),
              controlHealth: expect.objectContaining({
                totalOperatorControlEvidenceCount: expect.any(Number),
                gatesWithOperatorControlsCount: expect.any(Number),
              }),
            }),
          }),
          htmlContent: expect.stringContaining("Governance and stage-gate provenance"),
        }),
      })
    );

    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = generatedArtifact?.metadata_json?.htmlContent;

    expect(generatedHtml).toContain("ca_stage_gates_v0_1");
    expect(generatedHtml).toContain("1 pass");
    expect(generatedHtml).toContain("1 hold");
    expect(generatedHtml).toContain("Civil rights plan is still missing.");
    expect(generatedHtml).toContain("Missing artifacts: G02_E03.");
    expect(generatedHtml).toContain("G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS");
    expect(generatedHtml).toContain('/projects/44444444-4444-4444-8444-444444444444#project-governance');
  });

  it("persists scenario-set provenance derived from linked report runs", async () => {
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
          sourceContext: expect.objectContaining({
            scenarioSetLinkCount: 1,
            scenarioSetLinks: [
              expect.objectContaining({
                scenarioSetId: "scenario-set-1",
                scenarioSetTitle: "Downtown alternatives",
                baselineLabel: "Existing conditions",
                baselineRunTitle: "Existing conditions baseline",
                comparisonSummary: expect.objectContaining({
                  label: "Ready to compare",
                  readyAlternatives: 1,
                }),
                matchedEntries: [
                  expect.objectContaining({
                    label: "Protected bike package",
                    entryType: "alternative",
                    comparisonLabel: "Ready to compare",
                    comparisonReady: true,
                  }),
                ],
              }),
            ],
          }),
          htmlContent: expect.stringContaining("Scenario basis"),
        }),
      })
    );

    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = generatedArtifact?.metadata_json?.htmlContent;

    expect(generatedHtml).toContain("Downtown alternatives");
    expect(generatedHtml).toContain("Baseline: <strong>Existing conditions</strong> • Existing conditions baseline");
    expect(generatedHtml).toContain("Protected bike package");
    expect(generatedHtml).toContain('/scenarios/scenario-set-1');
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

    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = generatedArtifact?.metadata_json?.htmlContent;

    expect(generatedHtml).toContain("Report origin: Engagement Campaign Handoff");
    expect(generatedHtml).toContain(
      "Created from an engagement campaign to preserve handoff-ready public input context for project reporting."
    );
    expect(generatedHtml).toContain("Handoff snapshot: 9 ready for handoff • 14 total items");
    expect(generatedHtml).toContain("Current live campaign counts: 1 ready for handoff • 1 total items.");
  });
});
