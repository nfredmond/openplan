import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const routerRefreshMock = vi.fn();

const reportMaybeSingleMock = vi.fn();
const reportEqMock = vi.fn(() => ({ maybeSingle: reportMaybeSingleMock }));
const reportSelectMock = vi.fn(() => ({ eq: reportEqMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn((_columns: string) => ({ eq: workspaceEqMock }));

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

// model_runs: cited-run resolution (.in) and the attach-picker's succeeded-run
// listing (.eq(...).eq(...).order(...).limit(...)).
const modelRunsInMock = vi.fn(async () => ({ data: [], error: null }));
const modelRunsLimitMock = vi.fn(async () => ({ data: [], error: null }));
const modelRunsOrderMock = vi.fn(() => ({ limit: modelRunsLimitMock }));
const modelRunsEqStatusMock = vi.fn(() => ({ order: modelRunsOrderMock }));
const modelRunsEqMock = vi.fn(() => ({ eq: modelRunsEqStatusMock }));
const modelRunsSelectMock = vi.fn(() => ({ eq: modelRunsEqMock, in: modelRunsInMock }));

const countyRunsInMock = vi.fn(async () => ({ data: [], error: null }));
const countyRunsSelectMock = vi.fn(() => ({ in: countyRunsInMock }));

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

const dataDatasetLinksOrderMock = vi.fn();
const dataDatasetLinksEqMock = vi.fn(() => ({ order: dataDatasetLinksOrderMock }));
const dataDatasetLinksSelectMock = vi.fn(() => ({ eq: dataDatasetLinksEqMock }));

const dataDatasetsInMock = vi.fn();
const dataDatasetsSelectMock = vi.fn(() => ({ in: dataDatasetsInMock }));

const dataRefreshJobsOrderMock = vi.fn();
const dataRefreshJobsInMock = vi.fn(() => ({ order: dataRefreshJobsOrderMock }));
const dataRefreshJobsSelectMock = vi.fn(() => ({ in: dataRefreshJobsInMock }));

// The live gate board is read workspace AND project scoped: the packet's frozen
// gate snapshot is only comparable against decisions recorded on the same
// project, and a neighbouring project's verdict would otherwise show up as this
// packet's drift.
const stageGateLimitMock = vi.fn();
const stageGateOrderMock = vi.fn(() => ({ limit: stageGateLimitMock }));
const stageGateEqProjectMock = vi.fn(() => ({ order: stageGateOrderMock }));
const stageGateEqWorkspaceMock = vi.fn(() => ({ eq: stageGateEqProjectMock }));
const stageGateSelectMock = vi.fn((_columns: string) => ({ eq: stageGateEqWorkspaceMock }));

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
  if (table === "model_runs") {
    return { select: modelRunsSelectMock };
  }
  if (table === "county_runs") {
    return { select: countyRunsSelectMock };
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
  if (table === "data_dataset_project_links") {
    return { select: dataDatasetLinksSelectMock };
  }
  if (table === "data_datasets") {
    return { select: dataDatasetsSelectMock };
  }
  if (table === "data_refresh_jobs") {
    return { select: dataRefreshJobsSelectMock };
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
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
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

function expectLinkByHref(name: RegExp, href: string) {
  const link = screen
    .getAllByRole("link", { name })
    .find((element) => element.getAttribute("href") === href);

  expect(link).toBeDefined();
  expect(link).toHaveAttribute("href", href);
}

/**
 * The 5000ms default is not enough budget for this file, and the reason is not
 * the page. Measured on an idle box: awaiting the server component costs ~1ms
 * and rendering it ~40ms, but the packet page produces an ~80KB DOM, and the
 * FIRST accessible-name query against a freshly rendered tree of that size
 * costs ~400ms on its own — `getByRole("link", { name })` and friends, whose
 * name computation walks the tree and hits jsdom's per-element style
 * resolution. Every later one against the same DOM costs ~15ms, because that
 * pass is cached; `getByText` never triggers it at all.
 *
 * So ~400ms is a floor per rendered page, not a cost that splitting removes —
 * each new test pays it again on its own fresh render. Under contention that
 * floor was measured over 4s. The budget is raised here rather than in
 * vitest.config.ts so it applies to this one heavy page and nothing else: a
 * genuine hang anywhere else in the suite must still fail in five seconds.
 *
 * Do not "fix" the cost by trading `getByRole("link", { name })` for text
 * lookups. That would drop the accessible-name assertion, which is the part a
 * screen-reader user depends on, to make a test faster.
 */
describe("ReportDetailPage", { timeout: 15_000 }, () => {
  beforeEach(() => {
    // resetAllMocks, NOT clearAllMocks: clearing drains recorded calls but
    // leaves an unconsumed `mockResolvedValueOnce` sitting at the head of the
    // queue, where it outranks everything this hook re-arms below and answers
    // the NEXT test's first read instead. Proven by the pair of tests at the
    // end of this file.
    vi.resetAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      posture: "under control",
      headline: "Workspace clear",
      detail: "No workspace command pressure is visible in the report-detail fixture.",
      nextCommand: null,
      nextActions: [],
      commandQueue: [],
      fullCommandQueue: [],
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 1,
        queueDepth: 0,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        reportPacketCurrent: 1,
        rtpFundingReviewPackets: 0,
        comparisonBackedReports: 0,
        fundingOpportunities: 0,
        openFundingOpportunities: 0,
        closingSoonFundingOpportunities: 0,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        overdueDecisionFundingOpportunities: 0,
        aerialMissions: 0,
        aerialActiveMissions: 0,
        aerialReadyPackages: 0,
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
        // Bound EXPLICITLY to the CA template, with CA geography, so the live
        // drift board must render CA's gate vocabulary even when the
        // registry's interim default is a DIFFERENT template. The
        // bound-not-default wiring test below leans on this fixture.
        stage_gate_template_id: "ca_stage_gates_v0_1",
        home_geography_source: "tigerweb",
        home_country_code: "US",
        home_subdivision_code: "CA",
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
              aerialEvidenceSourceContext: {
                metadataSchemaVersion: "2026-05-aerial-report-source-context",
                missionCount: 1,
                packageCount: 1,
                orphanPackageCount: 0,
                attachmentReadyPackageCount: 1,
                sourceContextPackageCount: 1,
                readiness: "ready",
                label: "Aerial evidence source context attached",
                detail: "1 operator-reviewed aerial package can be cited after human report review.",
                readyUses: ["project", "grant", "report", "public_response"],
                blockedUses: [],
                sourceContext:
                  "Downtown shoulder inventory source context: Drone photo QA notes. Operator-assisted aerial evidence only; attach the cited package and human review notes before using it in a grant, report, or public comment response. No autonomous photogrammetry, regulatory compliance, or survey-grade certification is implied.",
                blockers: [],
                caveat:
                  "Operator-assisted aerial evidence only; attach the cited package and human review notes before using it in a grant, report, or public comment response. No autonomous photogrammetry, regulatory compliance, or survey-grade certification is implied.",
                operatorAssisted: true,
                autonomousPhotogrammetryClaim: false,
                regulatoryComplianceClaim: false,
                surveyGradeCertificationClaim: false,
                missionSummaries: [
                  {
                    missionId: "mission-1",
                    title: "Downtown shoulder inventory",
                    status: "complete",
                    missionType: "corridor_survey",
                    updatedAt: "2026-03-28T17:30:00.000Z",
                    packageCount: 1,
                    readiness: "ready",
                    label: "Ready for project, grant, report, and public response support",
                    detail:
                      "1 operator-reviewed aerial package can be cited after human review.",
                    sourceContext:
                      "Downtown shoulder inventory source context: Drone photo QA notes. Operator-assisted aerial evidence only; attach the cited package and human review notes before using it in a grant, report, or public comment response. No autonomous photogrammetry, regulatory compliance, or survey-grade certification is implied.",
                    attachmentReadyPackageCount: 1,
                    sourceContextPackageCount: 1,
                    readyUses: ["project", "grant", "report", "public_response"],
                    blockers: [],
                  },
                ],
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
    projectFundingProfileMaybeSingleMock.mockResolvedValue({
      data: {
        id: "profile-1",
        funding_need_amount: 1000000,
        local_match_need_amount: 100000,
        notes: null,
        updated_at: "2026-03-28T15:00:00.000Z",
      },
      error: null,
    });
    fundingAwardsOrderMock.mockResolvedValue({
      data: [
        {
          id: "award-1",
          awarded_amount: 700000,
          match_amount: 100000,
          risk_flag: null,
          obligation_due_at: "2026-06-30T00:00:00.000Z",
          updated_at: "2026-03-28T15:15:00.000Z",
          created_at: "2026-03-28T15:00:00.000Z",
        },
      ],
      error: null,
    });
    fundingOpportunitiesOrderMock.mockResolvedValue({
      data: [
        {
          id: "opportunity-1",
          expected_award_amount: 350000,
          decision_state: "pursue",
          opportunity_status: "open",
          closes_at: "2026-04-30T00:00:00.000Z",
          updated_at: "2026-03-28T15:20:00.000Z",
          created_at: "2026-03-28T15:10:00.000Z",
        },
      ],
      error: null,
    });
    billingInvoicesOrderMock.mockResolvedValue({ data: [], error: null });
    dataDatasetLinksOrderMock.mockResolvedValue({
      data: [
        {
          dataset_id: "dataset-1",
          project_id: "project-1",
          relationship_type: "analysis_source",
          linked_at: "2026-03-28T14:00:00.000Z",
        },
      ],
      error: null,
    });
    dataDatasetsInMock.mockResolvedValue({
      data: [
        {
          id: "dataset-1",
          name: "Downtown safety indicators",
          status: "ready",
          geography_scope: "corridor",
          geometry_attachment: "analysis_corridor",
          thematic_metric_key: "crash_rate",
          citation_text: "Local safety inventory and TIMS extract.",
          source_url: "https://example.test/safety",
          license_label: "Public agency data",
          vintage_label: "2026",
          schema_version: "v1",
          checksum: "checksum-1",
          row_count: 128,
          last_refreshed_at: "2026-03-28T13:00:00.000Z",
        },
      ],
      error: null,
    });
    dataRefreshJobsOrderMock.mockResolvedValue({
      data: [
        {
          dataset_id: "dataset-1",
          status: "succeeded",
          started_at: "2026-03-28T12:50:00.000Z",
          completed_at: "2026-03-28T13:00:00.000Z",
          created_at: "2026-03-28T12:45:00.000Z",
        },
      ],
      error: null,
    });

    stageGateLimitMock.mockResolvedValue({

      data: [
        {
          id: "gate-decision-1",
          project_id: "project-1",
          gate_id: "G01",
          decision: "pass",
          rationale: "Ready",
          decided_at: "2026-03-28T16:00:00.000Z",
          missing_artifacts: [],
        },
        {
          id: "gate-decision-2",
          project_id: "project-1",
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

  /**
   * These seven tests were one test carrying ~120 assertions, which took 1197ms
   * on an idle box and failed at 5216ms under a contended one — passing in
   * isolation every time anyone looked at it.
   *
   * Splitting is not only about the clock. A single failing assertion in that
   * test reported "this page is wrong" and left you to find out which of seven
   * panels broke; each of these names the panel it covers, so the failure says
   * where to look. Keep new assertions in the group they belong to rather than
   * appending them to whichever test is nearest.
   */
  it("renders the packet page without emitting a NaN warning", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

      expect(
        consoleErrorSpy.mock.calls.some((call) =>
          call.some((part) => String(part).includes("Received NaN"))
        )
      ).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("shows the engagement source, its public page access, and why the report exists", async () => {
    render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

    expect(screen.getByText("Engagement source")).toBeInTheDocument();
    expect(screen.getByText("Downtown listening campaign")).toBeInTheDocument();
    expect(
      screen.getByText(/Capture walking and crossing feedback from residents and corridor users\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Public page available/i)).toBeInTheDocument();
    expect(screen.getByText(/Submissions open/i)).toBeInTheDocument();
    expect(screen.getByText("Report origin")).toBeInTheDocument();
    expect(screen.getByText("Engagement Campaign Handoff")).toBeInTheDocument();
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
  });

  it("shows the governance and stage-gate provenance frozen into the packet", async () => {
    render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

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
  });

  it("shows the project records and scenario basis the packet was built from", async () => {
    render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

    expect(screen.getByText("Project records provenance")).toBeInTheDocument();
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
  });

  it("shows the evidence chain summary with the aerial source context and its caveat", async () => {
    render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

    expect(screen.getByText("Evidence chain summary")).toBeInTheDocument();
    expect(screen.getByText(/Quick scan of the source surfaces captured in the latest packet\./i)).toBeInTheDocument();
    expect(screen.getByText("Aerial evidence")).toBeInTheDocument();
    expect(screen.getByText("Aerial evidence source context attached")).toBeInTheDocument();
    expect(screen.getByText(/1 mission · 1 package · 1 source-context package/i)).toBeInTheDocument();
    expect(screen.getByText(/No autonomous photogrammetry, regulatory compliance, or survey-grade certification is implied/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open aerial mission/i })).toHaveAttribute(
      "href",
      "/aerial/missions/mission-1"
    );
  });

  it("shows the release review with its readiness, funding, lineage and grant posture", async () => {
    render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

    expect(screen.getByText("Packet release review")).toBeInTheDocument();
    expect(screen.getByText("Carry this packet through readiness")).toBeInTheDocument();
    expect(screen.getByText("Pre-generation readiness")).toBeInTheDocument();
    expect(screen.getAllByText("Generation readiness blocked").length).toBeGreaterThan(0);
    expect(screen.getByText("Packet source context")).toBeInTheDocument();
    expect(screen.getByText("Funding profile scan")).toBeInTheDocument();
    expect(screen.getByText("Data lineage")).toBeInTheDocument();
    expect(screen.getByText(/1 output-ready/i)).toBeInTheDocument();
    expect(screen.getByText(/Data lineage scan: 1\/1 project-linked datasets output-ready · 4 dependent output checks passed\./i)).toBeInTheDocument();
    expect(screen.getByText(/Funding profile has blockers/i)).toBeInTheDocument();
    expect(screen.getByText(/Funding target: Likely covered\./i)).toBeInTheDocument();
    expect(screen.getAllByText(/still uninvoiced/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Review changed source areas and regenerate/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Project or county context/i })).toHaveAttribute(
      "href",
      "/projects/project-1"
    );
    expect(screen.getByRole("link", { name: /Engagement signal/i })).toHaveAttribute(
      "href",
      "/engagement/campaign-1"
    );
    expectLinkByHref(/Packet assembly/i, "/reports/report-1");
    expect(screen.getByRole("button", { name: /Generate packet/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Current surface/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Analysis behind a grant case")).toBeInTheDocument();
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
  });

  it("shows what drifted between the frozen packet and the live sources", async () => {
    render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

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

  it("reads the live gate board for this report's project, not the whole workspace", async () => {
    // The drift row compares this packet's frozen gate snapshot against the
    // live board. Unscoped, a gate that passed on a NEIGHBOURING project in the
    // same workspace would show up as this packet's own gate posture — in a
    // document an agency sends to a funder.
    const page = await ReportDetailPage({
      params: Promise.resolve({ reportId: "report-1" }),
    });

    render(page);

    expect(stageGateEqWorkspaceMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
    expect(stageGateEqProjectMock).toHaveBeenCalledWith("project_id", "project-1");
    expect(stageGateSelectMock.mock.calls[0]?.[0]).toContain("project_id");
  });

  it("does not report an unreadable live gate log as a packet that still matches", async () => {
    stageGateLimitMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table "stage_gate_decisions"' },
    });

    const page = await ReportDetailPage({
      params: Promise.resolve({ reportId: "report-1" }),
    });

    render(page);

    // The drift row is withheld rather than rendered as a comparison that never
    // happened: an unreadable board has zero passes because the counts are
    // unknown, so comparing them would have read as gates lost since generation.
    expect(screen.queryByText(/Snapshot 1 pass/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Review counts and next steps still match the saved report snapshot/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/No live source drift is currently visible/i)
    ).not.toBeInTheDocument();
    // And the gap is named, with the database's own reason, so the reader knows
    // which check did not run.
    expect(
      screen.getAllByText(/live stage-gate board could not be checked/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/permission denied for table "stage_gate_decisions"/i).length
    ).toBeGreaterThan(0);
  });

  it("builds the live drift board on the template the workspace is BOUND to, not the registry default", async () => {
    // The fixture workspace stores ca_stage_gates_v0_1 with CA geography. The
    // live decisions staged here mirror the frozen snapshot ON CA GATE IDS, so
    // under the bound template the drift row reports "still match" — while a
    // board built on any OTHER registered template would drop both decisions
    // (its gate ids match neither) and report gates lost since generation.
    stageGateLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "gate-decision-1",
          project_id: "project-1",
          gate_id: "G01_INITIATION_AUTHORIZATION",
          decision: "PASS",
          rationale: "Charter approved.",
          decided_at: "2026-03-28T16:00:00.000Z",
          missing_artifacts: [],
        },
        {
          id: "gate-decision-2",
          project_id: "project-1",
          gate_id: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
          decision: "HOLD",
          rationale: "Civil rights plan is still missing.",
          decided_at: "2026-03-28T18:12:00.000Z",
          missing_artifacts: ["G02_E03"],
        },
      ],
      error: null,
    });

    render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

    // The workspaces read carried the binding columns (import-derived, never
    // retyped) — without them the page could not resolve the binding at all.
    expect(workspaceSelectMock.mock.calls[0]?.[0]).toContain("stage_gate_template_id");
    expect(workspaceSelectMock.mock.calls[0]?.[0]).toContain("home_subdivision_code");
    expect(
      screen.getByText(/Review counts and next steps still match the saved report snapshot/i)
    ).toBeInTheDocument();
  });

  it("renders a DIFFERENTLY-bound workspace's board under ITS template, so no caller can hardcode one", async () => {
    // The sibling test above proves the page does not use the registry
    // DEFAULT. On its own that is not enough: a caller that ignored the
    // resolved binding entirely and passed the literal "ca_stage_gates_v0_1"
    // would satisfy it too — verified by mutation, which left all 22 tests in
    // this file green. This case is the other half of the pincer. Same live
    // decisions on CA gate ids, but a workspace bound to the federal-aid
    // template: its gate_order contains none of those ids, so the board drops
    // both decisions and the drift row must STOP reporting a match. Only a
    // caller that actually threads each workspace's own binding can satisfy
    // both tests at once.
    workspaceMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "workspace-1",
        name: "OpenPlan QA",
        plan: "starter",
        slug: "openplan-qa",
        stage_gate_template_id: "us_federal_aid_stage_gates_v0_1",
        home_geography_source: "tigerweb",
        home_country_code: "US",
        home_subdivision_code: "TX",
      },
      error: null,
    });
    stageGateLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "gate-decision-1",
          project_id: "project-1",
          gate_id: "G01_INITIATION_AUTHORIZATION",
          decision: "PASS",
          rationale: "Charter approved.",
          decided_at: "2026-03-28T16:00:00.000Z",
          missing_artifacts: [],
        },
        {
          id: "gate-decision-2",
          project_id: "project-1",
          gate_id: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
          decision: "HOLD",
          rationale: "Civil rights plan is still missing.",
          decided_at: "2026-03-28T18:12:00.000Z",
          missing_artifacts: ["G02_E03"],
        },
      ],
      error: null,
    });

    render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

    expect(
      screen.queryByText(/Review counts and next steps still match the saved report snapshot/i)
    ).not.toBeInTheDocument();
  });

  it("reports the stage-gate check uncovered when the workspace binding cannot be read, instead of rendering default gates", async () => {
    workspaceMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table workspaces" },
    });

    render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

    // No confident verdict in either direction...
    expect(screen.queryByText(/Review counts and next steps still match/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No live source drift is currently visible/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Snapshot 1 pass/i)).not.toBeInTheDocument();
    // ...and the gap is named: the BINDING row is what failed, not the log.
    expect(screen.getAllByText(/live stage-gate board could not be checked/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/workspace row that names the bound stage-gate template could not be read/i)
        .length
    ).toBeGreaterThan(0);
  });

  it("refuses to render default gates when the workspace names a template this deployment does not register", async () => {
    workspaceMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "workspace-1",
        name: "OpenPlan QA",
        slug: "openplan-qa",
        stage_gate_template_id: "not_a_registered_template_v9",
        home_geography_source: "tigerweb",
        home_country_code: "US",
        home_subdivision_code: "CA",
      },
      error: null,
    });

    render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

    // Substituting any registered template would compare the packet's frozen
    // snapshot against a gate vocabulary nobody bound this workspace to.
    expect(screen.queryByText(/Review counts and next steps still match/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/live stage-gate board could not be checked/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not_a_registered_template_v9/).length).toBeGreaterThan(0);
  });

  /**
   * A READ THAT FAILED MAY NOT BE RENDERED AS AN ANSWER.
   *
   * `const { data } = await supabase…` gives `null` for both "there is nothing
   * here" and "this query failed", so every empty-state sentence written for the
   * first case states the second one as fact. On this page the sentence is
   * "No packet / Generate the first packet before treating this report as
   * release-review evidence" — told to a planner whose packet may well exist,
   * and told because a query broke.
   *
   * The three assertions below are one set on purpose: disclosure is only
   * meaningful if the ORDINARY empty state still appears when the read succeeds
   * and there genuinely is nothing. Without that third case a page that always
   * shows a warning would pass.
   */
  describe("a failed read is not rendered as an answer", () => {
    it("still says No packet when the artifact read SUCCEEDS and there genuinely is none", async () => {
      reportMaybeSingleMock.mockResolvedValueOnce({
        data: {
          id: "report-1",
          workspace_id: "workspace-1",
          project_id: "project-1",
          title: "Downtown Safety Packet",
          report_type: "project_status",
          status: "draft",
          summary: "Report packet summarizing planning evidence and engagement handoff.",
          generated_at: null,
          latest_artifact_url: null,
          latest_artifact_kind: null,
          created_at: "2026-03-28T17:00:00.000Z",
          updated_at: "2026-03-28T18:05:00.000Z",
        },
        error: null,
      });
      artifactsOrderMock.mockResolvedValueOnce({ data: [], error: null });

      render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

      expect(screen.getAllByText(/^No packet$/i).length).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/Generate the first packet before treating this report/i).length
      ).toBeGreaterThan(0);
      // And nothing is disclosed, because nothing failed.
      expect(screen.queryByText(/Part of this report could not be read/i)).not.toBeInTheDocument();
    });

    it("does not answer No packet when the artifact read FAILED", async () => {
      reportMaybeSingleMock.mockResolvedValueOnce({
        data: {
          id: "report-1",
          workspace_id: "workspace-1",
          project_id: "project-1",
          title: "Downtown Safety Packet",
          report_type: "project_status",
          status: "draft",
          summary: "Report packet summarizing planning evidence and engagement handoff.",
          generated_at: null,
          latest_artifact_url: null,
          latest_artifact_kind: null,
          created_at: "2026-03-28T17:00:00.000Z",
          updated_at: "2026-03-28T18:05:00.000Z",
        },
        error: null,
      });
      artifactsOrderMock.mockResolvedValueOnce({
        data: null,
        error: { message: 'permission denied for table "report_artifacts"' },
      });

      render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

      // (a) the false absence is gone — and so is its opposite, because
      // certifying the packet against a snapshot never read is the same defect
      // pointing the other way.
      // Anchored: the honest replacement DETAIL contains the words "no packet
      // exists", so an unanchored match would pass on the very sentence that
      // fixes this and prove nothing.
      expect(screen.queryAllByText(/^No packet$/i)).toHaveLength(0);
      expect(
        screen.queryAllByText(/Generate the first packet before treating this report/i)
      ).toHaveLength(0);
      expect(screen.queryAllByText(/No live source drift is currently visible/i)).toHaveLength(0);

      // (b) the failure is disclosed, by name and with the database's own
      // message — this is an internal page, so the reader is the person who can
      // act on it.
      expect(
        screen.getAllByText(/Part of this report could not be read/i).length
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/this report's generated packets/i).length
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/permission denied for table "report_artifacts"/i).length
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/could not be read, so neither the latest packet nor its freshness/i)
          .length
      ).toBeGreaterThan(0);
    });

    it("does not report an unreadable live deliverables read as records lost since generation", async () => {
      deliverablesOrderMock.mockResolvedValueOnce({
        data: null,
        error: { message: 'permission denied for table "project_deliverables"' },
      });

      render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

      // The snapshot recorded 2 deliverables. An unread live table has zero, so
      // the un-guarded page published "Deliverables: 2 -> 0" — an outage
      // reported to a funder as work deleted since the packet was generated.
      expect(screen.queryByText(/Deliverables: 2 -> 0/i)).not.toBeInTheDocument();
      expect(
        screen.getAllByText(/This comparison did not cover deliverables/i).length
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/this project's live deliverables/i).length
      ).toBeGreaterThan(0);
    });

    it("renders an honest error instead of a 404 when the report row could not be read", async () => {
      reportMaybeSingleMock.mockResolvedValueOnce({
        data: null,
        error: { message: 'permission denied for table "reports"' },
      });

      render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

      // `if (!data) notFound()` is the same defect wearing a different face: it
      // tells a planner the report does not exist when the truth is that it
      // could not be read.
      expect(notFoundMock).not.toHaveBeenCalled();
      expect(screen.getByText(/The report record could not be read/i)).toBeInTheDocument();
      expect(
        screen.getByText(/not a finding that the report was deleted or that it never existed/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/permission denied for table "reports"/i)
      ).toBeInTheDocument();
    });

    /**
     * The STANDARD branch's funding-posture drift row, which compares the packet's
     * frozen funding snapshot against the project's live funding board.
     *
     * `loadProjectFundingSourceRows` keeps `?? []` on failure — deliberately, so
     * one broken panel does not 500 the page — which means an unread awards table
     * arrives at the comparison as a project holding no money. The row it
     * published was denominated in dollars: "Committed awards: $8,000,000 -> $0."
     * on a report an agency sends to its funder.
     *
     * A minimal artifact is substituted here because the shared fixture carries no
     * `projectFundingSnapshot`, and without a stored side there is no comparison
     * to make at all.
     */
    const FUNDING_ARTIFACT = {
      id: "artifact-1",
      artifact_kind: "html",
      generated_at: "2026-03-28T18:00:00.000Z",
      metadata_json: {
        sourceContext: {
          projectFundingSnapshot: {
            awardCount: 3,
            pursuedOpportunityCount: 1,
            reimbursementPacketCount: 0,
            committedFundingAmount: 8000000,
            unfundedAfterLikelyAmount: 1000000,
            uninvoicedAwardAmount: 0,
            label: "Mostly funded",
            pipelineLabel: "Pipeline healthy",
            reimbursementLabel: "Reimbursement current",
            latestSourceUpdatedAt: "2026-03-28T15:15:00.000Z",
          },
        },
      },
    };

    it("publishes the funding-posture drift row when the live funding reads SUCCEED", async () => {
      artifactsOrderMock.mockResolvedValueOnce({ data: [FUNDING_ARTIFACT], error: null });

      render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

      // The control case. The live board genuinely holds one award worth
      // $700,000 against a snapshot of three worth $8,000,000, so this is an
      // honest comparison and it must still be told.
      expect(
        screen.getAllByText(/Committed awards: \$8,000,000 -> \$700,000/i).length
      ).toBeGreaterThan(0);
      expect(screen.queryByText(/Part of this report could not be read/i)).not.toBeInTheDocument();
    });

    it("withholds the funding-posture drift row when the live funding reads FAILED", async () => {
      artifactsOrderMock.mockResolvedValueOnce({ data: [FUNDING_ARTIFACT], error: null });
      fundingAwardsOrderMock.mockResolvedValueOnce({
        data: null,
        error: { message: 'permission denied for table "funding_awards"' },
      });

      render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

      // (a) The fabricated dollar delta is gone — and so is "unchanged", which
      // would certify the packet's funding against a board never read.
      expect(screen.queryByText(/Committed awards: \$8,000,000 -> \$0/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Awards: 3 -> 0/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Funding counts, posture labels, and reimbursement state still match/i)
      ).not.toBeInTheDocument();

      // (b) Disclosed by name, with the database's own message — internal page.
      expect(
        screen.getAllByText(/this project's live funding awards, opportunities and invoices/i).length
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(/permission denied for table "funding_awards"/i).length
      ).toBeGreaterThan(0);
    });

    it("still 404s on a genuine absence", async () => {
      reportMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

      await expect(
        ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) })
      ).rejects.toThrow("notFound");
      expect(notFoundMock).toHaveBeenCalled();
    });
  });

  /**
   * ONE TEST'S FAILURE FIXTURE MAY NOT ANSWER THE NEXT TEST'S READ.
   *
   * Nearly every test above stages a broken read with `mockResolvedValueOnce`,
   * which pushes onto a queue that outranks the `mockResolvedValue` defaults the
   * `beforeEach` re-arms. `vi.clearAllMocks()` empties the recorded CALLS but
   * not that queue — only `mockReset` does — so a once-value the page happened
   * not to consume survives into the following test and answers its first read
   * instead. Nothing declares that; the next test simply sees a report that
   * cannot be read, or a 404, for no reason visible in its own body.
   *
   * The two tests below are one set and must stay adjacent and in this order:
   * the first deliberately leaves a queued value behind, the second proves the
   * shared fixture — not that leftover — is what it gets.
   */
  describe("a staged failure does not leak into the next test", () => {
    it("leaves an unconsumed once-value queued behind it", async () => {
      reportMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
      reportMaybeSingleMock.mockResolvedValueOnce({
        data: null,
        error: { message: 'permission denied for table "reports"' },
      });

      await expect(
        ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) })
      ).rejects.toThrow("notFound");

      // Exactly one of the two queued values was consumed, so the second is
      // still sitting at the head of the queue as this test ends. Without this
      // the pair proves nothing, because there would be nothing to leak.
      expect(reportMaybeSingleMock).toHaveBeenCalledTimes(1);
    });

    it("reads the shared fixture, not the previous test's leftover", async () => {
      render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));

      expect(screen.getByText("Downtown Safety Packet")).toBeInTheDocument();
      expect(notFoundMock).not.toHaveBeenCalled();
      expect(screen.queryByText(/The report record could not be read/i)).not.toBeInTheDocument();
    });
  });
});
