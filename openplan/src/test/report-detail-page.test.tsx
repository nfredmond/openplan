import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});

const reportMaybeSingleMock = vi.fn();
const reportEqMock = vi.fn(() => ({ maybeSingle: reportMaybeSingleMock }));
const reportSelectMock = vi.fn(() => ({ eq: reportEqMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const sectionsOrderMock = vi.fn();
const sectionsEqMock = vi.fn(() => ({ order: sectionsOrderMock }));
const sectionsSelectMock = vi.fn(() => ({ eq: sectionsEqMock }));

const reportRunsOrderMock = vi.fn();
const reportRunsEqMock = vi.fn(() => ({ order: reportRunsOrderMock }));
const reportRunsSelectMock = vi.fn(() => ({ eq: reportRunsEqMock }));

const artifactsOrderMock = vi.fn();
const artifactsEqMock = vi.fn(() => ({ order: artifactsOrderMock }));
const artifactsSelectMock = vi.fn(() => ({ eq: artifactsEqMock }));

const runsInMock = vi.fn();
const runsSelectMock = vi.fn(() => ({ in: runsInMock }));

const campaignMaybeSingleMock = vi.fn();
const campaignEqIdMock = vi.fn(() => ({ maybeSingle: campaignMaybeSingleMock }));
const campaignEqWorkspaceMock = vi.fn(() => ({ eq: campaignEqIdMock }));
const campaignSelectMock = vi.fn(() => ({ eq: campaignEqWorkspaceMock }));

const engagementCategoriesOrderCreatedMock = vi.fn();
const engagementCategoriesOrderSortMock = vi.fn(() => ({ order: engagementCategoriesOrderCreatedMock }));
const engagementCategoriesEqCampaignMock = vi.fn(() => ({ order: engagementCategoriesOrderSortMock }));
const engagementCategoriesSelectMock = vi.fn(() => ({ eq: engagementCategoriesEqCampaignMock }));

const engagementItemsOrderMock = vi.fn();
const engagementItemsEqCampaignMock = vi.fn(() => ({ order: engagementItemsOrderMock }));
const engagementItemsSelectMock = vi.fn(() => ({ eq: engagementItemsEqCampaignMock }));

const scenarioSetsInMock = vi.fn();
const scenarioSetsSelectMock = vi.fn(() => ({ in: scenarioSetsInMock }));

const scenarioAssumptionSetsInMock = vi.fn();
const scenarioAssumptionSetsSelectMock = vi.fn(() => ({ in: scenarioAssumptionSetsInMock }));

const scenarioDataPackagesInMock = vi.fn();
const scenarioDataPackagesSelectMock = vi.fn(() => ({ in: scenarioDataPackagesInMock }));

const scenarioIndicatorSnapshotsInMock = vi.fn();
const scenarioIndicatorSnapshotsSelectMock = vi.fn(() => ({ in: scenarioIndicatorSnapshotsInMock }));

const scenarioComparisonSnapshotsInMock = vi.fn();
const scenarioComparisonSnapshotsSelectMock = vi.fn(() => ({ in: scenarioComparisonSnapshotsInMock }));

const projectFundingProfileMaybeSingleMock = vi.fn();
const projectFundingProfileEqMock = vi.fn(() => ({ maybeSingle: projectFundingProfileMaybeSingleMock }));
const projectFundingProfileSelectMock = vi.fn(() => ({ eq: projectFundingProfileEqMock, in: vi.fn(async () => ({ data: [], error: null })) }));

const fundingAwardsOrderMock = vi.fn();
const fundingAwardsEqMock = vi.fn(() => ({ order: fundingAwardsOrderMock }));
const fundingAwardsSelectMock = vi.fn(() => ({ eq: fundingAwardsEqMock, in: vi.fn(async () => ({ data: [], error: null })) }));

const fundingOpportunitiesOrderMock = vi.fn();
const fundingOpportunitiesEqMock = vi.fn(() => ({ order: fundingOpportunitiesOrderMock }));
const fundingOpportunitiesSelectMock = vi.fn(() => ({ eq: fundingOpportunitiesEqMock, in: vi.fn(async () => ({ data: [], error: null })) }));

const billingInvoicesOrderMock = vi.fn();
const billingInvoicesEqMock = vi.fn(() => ({ order: billingInvoicesOrderMock }));
const billingInvoicesSelectMock = vi.fn(() => ({ eq: billingInvoicesEqMock, in: vi.fn(async () => ({ data: [], error: null })) }));

const stageGateLimitMock = vi.fn();
const stageGateOrderMock = vi.fn(() => ({ limit: stageGateLimitMock }));
const stageGateEqWorkspaceMock = vi.fn(() => ({ order: stageGateOrderMock }));
const stageGateSelectMock = vi.fn(() => ({ eq: stageGateEqWorkspaceMock }));

const deliverablesOrderMock = vi.fn();
const deliverablesEqProjectMock = vi.fn(() => ({ order: deliverablesOrderMock }));
const deliverablesSelectMock = vi.fn(() => ({ eq: deliverablesEqProjectMock }));

const risksOrderMock = vi.fn();
const risksEqProjectMock = vi.fn(() => ({ order: risksOrderMock }));
const risksSelectMock = vi.fn(() => ({ eq: risksEqProjectMock }));

const issuesOrderMock = vi.fn();
const issuesEqProjectMock = vi.fn(() => ({ order: issuesOrderMock }));
const issuesSelectMock = vi.fn(() => ({ eq: issuesEqProjectMock }));

const decisionsOrderMock = vi.fn();
const decisionsEqProjectMock = vi.fn(() => ({ order: decisionsOrderMock }));
const decisionsSelectMock = vi.fn(() => ({ eq: decisionsEqProjectMock }));

const meetingsOrderMock = vi.fn();
const meetingsEqProjectMock = vi.fn(() => ({ order: meetingsOrderMock }));
const meetingsSelectMock = vi.fn(() => ({ eq: meetingsEqProjectMock }));

const authGetUserMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const fromMock = vi.fn((table: string) => {
  if (table === "reports") {
    return { select: reportSelectMock };
  }
  if (table === "projects") {
    return { select: projectSelectMock };
  }
  if (table === "workspaces") {
    return { select: workspaceSelectMock };
  }
  if (table === "report_sections") {
    return { select: sectionsSelectMock };
  }
  if (table === "report_runs") {
    return { select: reportRunsSelectMock };
  }
  if (table === "report_artifacts") {
    return { select: artifactsSelectMock };
  }
  if (table === "runs") {
    return { select: runsSelectMock };
  }
  if (table === "engagement_campaigns") {
    return { select: campaignSelectMock };
  }
  if (table === "engagement_categories") {
    return { select: engagementCategoriesSelectMock };
  }
  if (table === "engagement_items") {
    return { select: engagementItemsSelectMock };
  }
  if (table === "scenario_sets") {
    return { select: scenarioSetsSelectMock };
  }
  if (table === "scenario_assumption_sets") {
    return { select: scenarioAssumptionSetsSelectMock };
  }
  if (table === "scenario_data_packages") {
    return { select: scenarioDataPackagesSelectMock };
  }
  if (table === "scenario_indicator_snapshots") {
    return { select: scenarioIndicatorSnapshotsSelectMock };
  }
  if (table === "scenario_comparison_snapshots") {
    return { select: scenarioComparisonSnapshotsSelectMock };
  }
  if (table === "project_funding_profiles") {
    return { select: projectFundingProfileSelectMock };
  }
  if (table === "funding_awards") {
    return { select: fundingAwardsSelectMock };
  }
  if (table === "funding_opportunities") {
    return { select: fundingOpportunitiesSelectMock };
  }
  if (table === "billing_invoice_records") {
    return { select: billingInvoicesSelectMock };
  }
  if (table === "stage_gate_decisions") {
    return { select: stageGateSelectMock };
  }
  if (table === "project_deliverables") {
    return { select: deliverablesSelectMock };
  }
  if (table === "project_risks") {
    return { select: risksSelectMock };
  }
  if (table === "project_issues") {
    return { select: issuesSelectMock };
  }
  if (table === "project_decisions") {
    return { select: decisionsSelectMock };
  }
  if (table === "project_meetings") {
    return { select: meetingsSelectMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>(
    "@/lib/operations/workspace-summary"
  );

  return {
    ...actual,
    loadWorkspaceOperationsSummaryForWorkspace: (...args: unknown[]) =>
      loadWorkspaceOperationsSummaryForWorkspaceMock(...args),
  };
});

vi.mock("@/components/reports/report-detail-controls", () => ({
  ReportDetailControls: () => <div data-testid="report-detail-controls" />,
}));

import ReportDetailPage from "@/app/(app)/reports/[reportId]/page";

describe("ReportDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      posture: "under control",
      nextCommand: null,
      nextActions: [],
      commandQueue: [],
      counts: {
        queueDepth: 0,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        rtpFundingReviewPackets: 0,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
      },
    });

    reportMaybeSingleMock.mockResolvedValue({
      data: {
        id: "report-1",
        workspace_id: "workspace-1",
        project_id: "project-1",
        title: "Downtown Safety Packet",
        report_type: "project_status",
        status: "generated",
        summary: "Report packet summarizing planning evidence and engagement handoff.",
        generated_at: "2026-03-28T18:00:00.000Z",
        latest_artifact_url: null,
        latest_artifact_kind: "html",
        created_at: "2026-03-28T17:00:00.000Z",
        updated_at: "2026-03-28T18:05:00.000Z",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Downtown Mobility Plan",
        summary: "Planning effort focused on corridor safety and access.",
        status: "active",
        plan_type: "corridor",
        delivery_phase: "analysis",
        updated_at: "2026-03-28T18:01:00.000Z",
      },
      error: null,
    });

    workspaceMaybeSingleMock.mockResolvedValue({
      data: {
        id: "workspace-1",
        name: "OpenPlan QA",
        plan: "starter",
        slug: "openplan-qa",
      },
      error: null,
    });

    sectionsOrderMock.mockResolvedValue({
      data: [
        {
          id: "section-1",
          section_key: "engagement_summary",
          title: "Engagement summary",
          enabled: true,
          sort_order: 0,
          config_json: { campaignId: "campaign-1" },
        },
      ],
      error: null,
    });

    reportRunsOrderMock.mockResolvedValue({
      data: [],
      error: null,
    });

    artifactsOrderMock.mockResolvedValue({
      data: [
        {
          id: "artifact-1",
          artifact_kind: "html",
          generated_at: "2026-03-28T18:00:00.000Z",
          metadata_json: {
            sourceContext: {
              linkedRunCount: 0,
              deliverableCount: 2,
              decisionCount: 1,
              projectUpdatedAt: "2026-03-28T18:01:00.000Z",
              stageGateSnapshot: {
                templateId: "ca_stage_gates_v0_1",
                templateVersion: "0.1.0",
                passCount: 1,
                holdCount: 1,
                notStartedCount: 7,
                blockedGate: {
                  gateId: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
                  sequence: 2,
                  name: "Agreements, Procurement, and Civil Rights Setup",
                  workflowState: "hold",
                  rationale: "Civil rights plan is still missing.",
                  missingArtifacts: ["G02_E03"],
                  requiredEvidenceCount: 4,
                  operatorControlEvidenceCount: 1,
                },
                nextGate: {
                  gateId: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
                  sequence: 2,
                  name: "Agreements, Procurement, and Civil Rights Setup",
                  workflowState: "hold",
                  rationale: "Civil rights plan is still missing.",
                  missingArtifacts: ["G02_E03"],
                  requiredEvidenceCount: 4,
                  operatorControlEvidenceCount: 1,
                },
                controlHealth: {
                  totalOperatorControlEvidenceCount: 3,
                  gatesWithOperatorControlsCount: 2,
                },
              },
              projectRecordsSnapshot: {
                deliverables: {
                  count: 2,
                  latestTitle: "ADA curb ramp package",
                  latestAt: "2026-03-27T12:00:00.000Z",
                },
                risks: {
                  count: 1,
                  latestTitle: "Grant match exposure",
                  latestAt: "2026-03-26T16:30:00.000Z",
                },
                issues: {
                  count: 1,
                  latestTitle: "Signal timing conflict",
                  latestAt: "2026-03-25T09:15:00.000Z",
                },
                decisions: {
                  count: 1,
                  latestTitle: "Advance quick-build crosswalk package",
                  latestAt: "2026-03-24T18:00:00.000Z",
                },
                meetings: {
                  count: 1,
                  latestTitle: "Operations review",
                  latestAt: "2026-03-23T17:00:00.000Z",
                },
              },
              scenarioSetLinks: [
                {
                  scenarioSetId: "scenario-set-1",
                  scenarioSetTitle: "Downtown alternatives",
                  baselineEntryId: "scenario-entry-baseline",
                  baselineLabel: "Existing conditions",
                  baselineRunId: "run-baseline",
                  baselineRunTitle: "Existing conditions baseline",
                  baselineRunCreatedAt: "2026-03-10T00:00:00.000Z",
                  matchedRunIds: ["run-alt"],
                  matchedEntries: [
                    {
                      entryId: "scenario-entry-alt",
                      entryType: "alternative",
                      label: "Protected bike package",
                      attachedRunId: "run-alt",
                      attachedRunTitle: "Protected bike package run",
                      comparisonStatus: "ready",
                      comparisonLabel: "Ready to compare",
                      comparisonReady: true,
                      entryUpdatedAt: "2026-03-28T17:40:00.000Z",
                      runCreatedAt: "2026-03-12T00:00:00.000Z",
                    },
                  ],
                  comparisonSummary: {
                    totalAlternatives: 1,
                    readyAlternatives: 1,
                    blockedAlternatives: 0,
                    baselineEntryPresent: true,
                    baselineRunPresent: true,
                    label: "Ready to compare",
                  },
                  scenarioSetUpdatedAt: "2026-03-28T17:35:00.000Z",
                  latestMatchedEntryUpdatedAt: "2026-03-28T17:40:00.000Z",
                  latestMatchedRunCreatedAt: "2026-03-12T00:00:00.000Z",
                  comparisonSnapshots: [
                    {
                      comparisonSnapshotId: "comparison-1",
                      candidateEntryId: "scenario-entry-alt",
                      candidateEntryLabel: "Protected bike package",
                      baselineEntryId: "scenario-entry-baseline",
                      label: "Protected bike package vs Existing conditions",
                      status: "ready",
                      updatedAt: "2026-03-28T17:42:00.000Z",
                      indicatorDeltaCount: 3,
                      summary: "Bike and crossing indicators improved against baseline.",
                    },
                  ],
                },
              ],
              reportOrigin: "engagement_campaign_handoff",
              reportReason:
                "Created from an engagement campaign to preserve handoff-ready public input context for project reporting.",
              engagementCampaignSnapshot: {
                id: "campaign-1",
                title: "Downtown listening campaign",
                status: "draft",
                updatedAt: "2026-03-28T17:45:00.000Z",
              },
              engagementReadyForHandoffCount: 4,
              engagementItemCount: 9,
              engagementSnapshotCapturedAt: "2026-03-28T17:45:00.000Z",
              engagementCountsSnapshot: {
                totalItems: 12,
                readyForHandoffCount: 7,
              },
            },
          },
        },
      ],
      error: null,
    });

    runsInMock.mockResolvedValue({
      data: [],
      error: null,
    });

    campaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: "campaign-1",
        title: "Downtown listening campaign",
        summary: "Capture walking and crossing feedback from residents and corridor users.",
        public_description: null,
        status: "active",
        engagement_type: "comment_collection",
        share_token: "share-token-12345",
        allow_public_submissions: true,
        submissions_closed_at: null,
        updated_at: "2026-03-28T17:50:00.000Z",
      },
      error: null,
    });

    engagementCategoriesOrderCreatedMock.mockResolvedValue({
      data: [
        {
          id: "category-1",
          label: "Safety",
          slug: "safety",
          description: "Crossings and speed management",
          sort_order: 0,
          created_at: "2026-03-20T10:00:00.000Z",
          updated_at: "2026-03-27T10:00:00.000Z",
        },
      ],
      error: null,
    });

    engagementItemsOrderMock.mockResolvedValue({
      data: [
        {
          id: "item-1",
          campaign_id: "campaign-1",
          category_id: "category-1",
          status: "approved",
          source_type: "map_pin",
          latitude: 39.12,
          longitude: -121.65,
          moderation_notes: null,
          created_at: "2026-03-28T17:20:00.000Z",
          updated_at: "2026-03-28T18:10:00.000Z",
        },
      ],
      error: null,
    });

    scenarioSetsInMock.mockResolvedValue({
      data: [{ id: "scenario-set-1", updated_at: "2026-03-28T18:20:00.000Z" }],
      error: null,
    });

    scenarioAssumptionSetsInMock.mockResolvedValue({ data: [], error: null });
    scenarioDataPackagesInMock.mockResolvedValue({ data: [], error: null });
    scenarioIndicatorSnapshotsInMock.mockResolvedValue({ data: [], error: null });
    scenarioComparisonSnapshotsInMock.mockResolvedValue({ data: [], error: null });
    projectFundingProfileMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    fundingAwardsOrderMock.mockResolvedValue({ data: [], error: null });
    fundingOpportunitiesOrderMock.mockResolvedValue({ data: [], error: null });
    billingInvoicesOrderMock.mockResolvedValue({ data: [], error: null });

    stageGateLimitMock.mockResolvedValue({
      data: [
        {
          gate_id: "G01",
          decision: "pass",
          rationale: "Ready",
          decided_at: "2026-03-28T16:00:00.000Z",
          missing_artifacts: [],
        },
        {
          gate_id: "G03",
          decision: "hold",
          rationale: "Contracting packet needs signature",
          decided_at: "2026-03-28T18:12:00.000Z",
          missing_artifacts: ["G03_E01"],
        },
      ],
      error: null,
    });

    deliverablesOrderMock.mockResolvedValue({
      data: [
        {
          id: "deliverable-1",
          title: "ADA curb ramp package",
          due_date: "2026-03-30T00:00:00.000Z",
          created_at: "2026-03-27T12:00:00.000Z",
        },
        {
          id: "deliverable-2",
          title: "Signal retiming memo",
          due_date: "2026-03-21T00:00:00.000Z",
          created_at: "2026-03-20T00:00:00.000Z",
        },
        {
          id: "deliverable-3",
          title: "Transit stop access packet",
          due_date: "2026-03-19T00:00:00.000Z",
          created_at: "2026-03-18T00:00:00.000Z",
        },
      ],
      error: null,
    });

    risksOrderMock.mockResolvedValue({
      data: [
        {
          id: "risk-1",
          title: "Grant match exposure",
          created_at: "2026-03-27T16:30:00.000Z",
        },
      ],
      error: null,
    });

    issuesOrderMock.mockResolvedValue({
      data: [
        {
          id: "issue-1",
          title: "Signal timing conflict",
          created_at: "2026-03-25T09:15:00.000Z",
        },
      ],
      error: null,
    });

    decisionsOrderMock.mockResolvedValue({
      data: [
        {
          id: "decision-1",
          title: "Advance quick-build crosswalk package",
          decided_at: "2026-03-28T19:00:00.000Z",
          created_at: "2026-03-24T18:00:00.000Z",
        },
      ],
      error: null,
    });

    meetingsOrderMock.mockResolvedValue({
      data: [
        {
          id: "meeting-1",
          title: "Operations review",
          meeting_at: "2026-03-29T09:00:00.000Z",
          created_at: "2026-03-23T17:00:00.000Z",
        },
      ],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("shows richer engagement traceability with public page access when available", async () => {
    const page = await ReportDetailPage({
      params: Promise.resolve({ reportId: "report-1" }),
    });

    render(page);

    expect(screen.getByText("Engagement source")).toBeInTheDocument();
    expect(screen.getByText("Downtown listening campaign")).toBeInTheDocument();
    expect(
      screen.getByText(/Capture walking and crossing feedback from residents and corridor users\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Public page available/i)).toBeInTheDocument();
    expect(screen.getByText(/Submissions open/i)).toBeInTheDocument();
    expect(screen.getByText("Report origin")).toBeInTheDocument();
    expect(screen.getByText("Engagement Campaign Handoff")).toBeInTheDocument();
    expect(screen.getByText("Project records provenance")).toBeInTheDocument();
    expect(
      screen.getByText("Governance and stage-gate provenance")
    ).toBeInTheDocument();
    expect(screen.getByText("ca_stage_gates_v0_1")).toBeInTheDocument();
    expect(screen.getByText(/Version 0.1.0/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS/i).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Civil rights plan is still missing\./i)).toBeInTheDocument();
    expect(screen.getByText(/Missing artifacts: G02_E03\./i)).toBeInTheDocument();
    expect(screen.getByText(/3 operator control evidence items/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review project settings/i })).toHaveAttribute(
      "href",
      "/projects/project-1#project-governance"
    );
    expect(screen.getByText(/ADA curb ramp package/i)).toBeInTheDocument();
    expect(screen.getByText(/Grant match exposure/i)).toBeInTheDocument();
    expect(screen.getByText(/Signal timing conflict/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Advance quick-build crosswalk package/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Operations review/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open deliverables/i })).toHaveAttribute(
      "href",
      "/projects/project-1#project-deliverables"
    );
    expect(screen.getByRole("link", { name: /Open risks/i })).toHaveAttribute(
      "href",
      "/projects/project-1#project-risks"
    );
    expect(screen.getAllByText("Scenario basis").length).toBeGreaterThan(0);
    expect(screen.getByText("Downtown alternatives")).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) =>
        element?.textContent?.includes("Baseline: Existing conditions") ?? false
      ).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Protected bike package")).toBeInTheDocument();
    expect(screen.getAllByText("Ready to compare").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open scenario set/i })).toHaveAttribute(
      "href",
      "/scenarios/scenario-set-1"
    );
    expect(
      screen.getByText(
        /Created from an engagement campaign to preserve handoff-ready public input context for project reporting\./i
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Snapshot captured/i)).toBeInTheDocument();
    expect(screen.getByText(/7 ready for handoff/i)).toBeInTheDocument();
    expect(screen.getAllByText(/12 items/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open engagement campaign/i })).toHaveAttribute(
      "href",
      "/engagement/campaign-1"
    );
    expect(screen.getByRole("link", { name: /Open public engagement page/i })).toHaveAttribute(
      "href",
      "/engage/share-token-12345"
    );
    expect(screen.getByText("Evidence chain summary")).toBeInTheDocument();
    expect(screen.getByText(/Quick scan of the source surfaces captured in the latest packet\./i)).toBeInTheDocument();
    expect(screen.getByText("Packet release review")).toBeInTheDocument();
    expect(screen.getByText("Grant planning posture")).toBeInTheDocument();
    expect(screen.getByText(/Refresh supporting packet before final pursue language/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/planning support only, not proof of award likelihood/i).length
    ).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open grant decisions/i })).toHaveAttribute(
      "href",
      "/grants?focusProjectId=project-1"
    );
    expect(screen.getByRole("link", { name: /Review packet controls/i })).toHaveAttribute(
      "href",
      "#report-controls"
    );
    expect(screen.queryByText(/0 linked set/i)).not.toBeInTheDocument();
    expect(screen.getByText(/1 linked set/i)).toBeInTheDocument();
    expect(screen.getByText(/7 ready for handoff/i)).toBeInTheDocument();
    expect(screen.getByText(/Hold present · 1 pass \/ 1 hold/i)).toBeInTheDocument();
    expect(screen.getByText("Drift since generation")).toBeInTheDocument();
    expect(screen.getByText("Engagement handoff")).toBeInTheDocument();
    expect(screen.getAllByText("Scenario basis").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Project records").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Stage gates").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/count changed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/gate changed/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Snapshot Draft · 7 ready \/ 12 items/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Downtown alternatives: 3\/28\/2026.*3\/28\/2026/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Deliverables: 2 -> 3\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Blocked .* -> .*\. Next .* -> .*\./i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review engagement source/i })).toHaveAttribute(
      "href",
      "/engagement/campaign-1"
    );
    expect(screen.getByRole("link", { name: /Review scenario set/i })).toHaveAttribute(
      "href",
      "/scenarios/scenario-set-1"
    );
    expect(screen.getByRole("link", { name: /Review project records/i })).toHaveAttribute(
      "href",
      "/projects/project-1"
    );
    expect(screen.getByRole("link", { name: /Review project settings/i })).toHaveAttribute(
      "href",
      "/projects/project-1#project-governance"
    );
  });

  it("shows latest artifact timing in the summary card when report generated_at is null", async () => {
    reportMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "report-1",
        workspace_id: "workspace-1",
        project_id: "project-1",
        title: "Downtown Safety Packet",
        report_type: "project_status",
        status: "generated",
        summary: "Report packet summarizing planning evidence and engagement handoff.",
        generated_at: null,
        latest_artifact_url: null,
        latest_artifact_kind: "html",
        created_at: "2026-03-28T17:00:00.000Z",
        updated_at: "2026-03-28T18:05:00.000Z",
      },
      error: null,
    });

    const page = await ReportDetailPage({
      params: Promise.resolve({ reportId: "report-1" }),
    });

    render(page);

    expect(screen.queryByText(/^Not yet$/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/3\/28\/2026/i).length).toBeGreaterThan(0);
  });
});
