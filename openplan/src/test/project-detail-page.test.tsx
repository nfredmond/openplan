import { render, screen, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});

const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const projectSingleMock = vi.fn();
// maybeSingle serves the budget loader's tolerant projects.budget_amount read.
const projectBudgetMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ single: projectSingleMock, maybeSingle: projectBudgetMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const workspaceSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ single: workspaceSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const runsLimitMock = vi.fn();
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsEqMock = vi.fn(() => ({ order: runsOrderMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock }));

const modelRunsLimitMock = vi.fn(() => Promise.resolve({ data: [], error: null }));
const modelRunsOrderMock = vi.fn(() => ({ limit: modelRunsLimitMock }));
const modelRunsStatusEqMock = vi.fn(() => ({ order: modelRunsOrderMock }));
// The evidence-picker chain is select→eq(ws)→eq(status)→order→limit; the
// project-provenance count is select→eq(project_id)→limit.
const modelRunsProjectLimitMock = vi.fn(() => Promise.resolve({ data: [], error: null }));
const modelRunsWsEqMock = vi.fn(() => ({ eq: modelRunsStatusEqMock, limit: modelRunsProjectLimitMock }));
// The evidence-disclosure loader resolves cited runs not in the picker window
// via select→in("id", …).
const modelRunsByIdInMock = vi.fn(() =>
  Promise.resolve({
    data: [{ id: "run-9", run_title: "Cited run", engine_key: "aequilibrae", status: "succeeded" }],
    error: null,
  })
);
const modelRunsSelectMock = vi.fn(() => ({ eq: modelRunsWsEqMock, in: modelRunsByIdInMock }));
const claimDecisionsInMock = vi.fn(() => Promise.resolve({ data: [], error: null }));
const claimDecisionsSelectMock = vi.fn(() => ({ in: claimDecisionsInMock }));
const modelRunKpisInKpiMock = vi.fn(() => Promise.resolve({ data: [], error: null }));
const modelRunKpisInRunMock = vi.fn(() => ({ in: modelRunKpisInKpiMock }));
const modelRunKpisSelectMock = vi.fn((_columns: string) => ({ in: modelRunKpisInRunMock }));

const reportsLimitMock = vi.fn();
const reportsOrderMock = vi.fn(() => ({ limit: reportsLimitMock }));
const reportsEqMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsSelectMock = vi.fn(() => ({ eq: reportsEqMock }));

const scenarioSetsLimitMock = vi.fn();
const scenarioSetsOrderMock = vi.fn(() => ({ limit: scenarioSetsLimitMock }));
const scenarioSetsEqMock = vi.fn(() => ({ order: scenarioSetsOrderMock }));
const scenarioSetsSelectMock = vi.fn(() => ({ eq: scenarioSetsEqMock }));

const scenarioEntriesInMock = vi.fn();
const scenarioEntriesSelectMock = vi.fn(() => ({ in: scenarioEntriesInMock }));

const reportArtifactsOrderMock = vi.fn();
const reportArtifactsInMock = vi.fn(() => ({ order: reportArtifactsOrderMock }));
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const reportRunsInMock = vi.fn();
const reportRunsSelectMock = vi.fn(() => ({ in: reportRunsInMock }));

const engagementCampaignsLimitMock = vi.fn();
const engagementCampaignsOrderMock = vi.fn(() => ({ limit: engagementCampaignsLimitMock }));
const engagementCampaignsEqMock = vi.fn(() => ({ order: engagementCampaignsOrderMock }));
const engagementCampaignsSelectMock = vi.fn(() => ({ eq: engagementCampaignsEqMock }));

const engagementItemsLimitMock = vi.fn();
const engagementItemsOrderMock = vi.fn(() => ({ limit: engagementItemsLimitMock }));
const engagementItemsInMock = vi.fn(() => ({ order: engagementItemsOrderMock }));
const engagementItemsSelectMock = vi.fn(() => ({ in: engagementItemsInMock }));

const stageGateLimitMock = vi.fn();
const stageGateOrderMock = vi.fn(() => ({ limit: stageGateLimitMock }));
// Two `.eq()` links: workspace_id, then project_id. Gate decisions became
// project-scoped in 20260728000011 — a workspace-wide read put one project's
// recorded verdicts on every other project's board.
const stageGateEqProjectMock = vi.fn(() => ({ order: stageGateOrderMock }));
const stageGateEqMock = vi.fn(() => ({ eq: stageGateEqProjectMock, order: stageGateOrderMock }));
const stageGateSelectMock = vi.fn(() => ({ eq: stageGateEqMock }));

const milestonesLimitMock = vi.fn();
const milestonesOrderMock = vi.fn(() => ({ limit: milestonesLimitMock }));
const milestonesEqMock = vi.fn(() => ({ order: milestonesOrderMock }));
const milestonesSelectMock = vi.fn(() => ({ eq: milestonesEqMock }));

const submittalsLimitMock = vi.fn();
const submittalsOrderMock = vi.fn(() => ({ limit: submittalsLimitMock }));
const submittalsEqMock = vi.fn(() => ({ order: submittalsOrderMock }));
const submittalsSelectMock = vi.fn(() => ({ eq: submittalsEqMock }));

const deliverablesLimitMock = vi.fn();
const deliverablesOrderMock = vi.fn(() => ({ limit: deliverablesLimitMock }));
const deliverablesEqMock = vi.fn(() => ({ order: deliverablesOrderMock }));
const deliverablesSelectMock = vi.fn(() => ({ eq: deliverablesEqMock }));

const spendEntriesLimitMock = vi.fn();
const spendEntriesOrderMock = vi.fn(() => ({ limit: spendEntriesLimitMock }));
const spendEntriesEqMock = vi.fn(() => ({ order: spendEntriesOrderMock }));
const spendEntriesSelectMock = vi.fn(() => ({ eq: spendEntriesEqMock }));

// Budget loader chain: select→eq(project)→in(status sent/paid)→limit.
const clientInvoicesLimitMock = vi.fn();
const clientInvoicesInMock = vi.fn(() => ({ limit: clientInvoicesLimitMock }));
const clientInvoicesEqMock = vi.fn(() => ({ in: clientInvoicesInMock }));
const clientInvoicesSelectMock = vi.fn(() => ({ eq: clientInvoicesEqMock }));

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

const invoicesLimitMock = vi.fn();
const invoicesOrderMock = vi.fn(() => ({ limit: invoicesLimitMock }));
const invoicesEqMock = vi.fn(() => ({ order: invoicesOrderMock }));
// The award-scoped claim-progress read of the same table goes .select().in(),
// not .select().eq(): it is deliberately not capped by the recent-invoices
// query, so an award with a long history cannot show an understated
// claimed-to-date. It only runs when the project HAS awards, which is why the
// harness needed this branch the moment an award was seeded.
const awardInvoicesLimitMock = vi.fn(async () => ({ data: [], error: null }));
const awardInvoicesOrderMock = vi.fn(() => ({ limit: awardInvoicesLimitMock }));
const awardInvoicesInMock = vi.fn(() => ({ order: awardInvoicesOrderMock }));
const invoicesSelectMock = vi.fn(() => ({ eq: invoicesEqMock, in: awardInvoicesInMock }));

const datasetLinksOrderMock = vi.fn();
const datasetLinksEqMock = vi.fn(() => ({ order: datasetLinksOrderMock }));
const datasetLinksSelectMock = vi.fn(() => ({ eq: datasetLinksEqMock }));

const projectRtpLinksOrderMock = vi.fn();
const projectRtpLinksEqMock = vi.fn(() => ({ order: projectRtpLinksOrderMock }));
const projectRtpLinksSelectMock = vi.fn(() => ({ eq: projectRtpLinksEqMock }));

const rtpCyclesOrderMock = vi.fn();
const rtpCyclesEqMock = vi.fn(() => ({ order: rtpCyclesOrderMock }));
const rtpCyclesInMock = vi.fn();
const rtpCyclesSelectMock = vi.fn(() => ({ eq: rtpCyclesEqMock, in: rtpCyclesInMock }));

const projectFundingProfileMaybeSingleMock = vi.fn();
const projectFundingProfileLimitMock = vi.fn();
const projectFundingProfileEqMock = vi.fn(() => ({ maybeSingle: projectFundingProfileMaybeSingleMock, limit: projectFundingProfileLimitMock }));
const projectFundingProfileSelectMock = vi.fn(() => ({ eq: projectFundingProfileEqMock }));

const fundingAwardsLimitMock = vi.fn();
const fundingAwardsOrderMock = vi.fn(() => ({ limit: fundingAwardsLimitMock }));
const fundingAwardsEqMock = vi.fn(() => ({ order: fundingAwardsOrderMock }));
// The column list is a recorded argument, not a detail: a Supabase select string
// is never checked against the schema, so a column this page stops asking for
// simply arrives as `undefined` with nothing failing anywhere.
const fundingAwardsSelectMock = vi.fn((_columns: string) => ({ eq: fundingAwardsEqMock }));

const fundingOpportunitiesLimitMock = vi.fn();
const fundingOpportunitiesOrderMock = vi.fn(() => ({ limit: fundingOpportunitiesLimitMock }));
const fundingOpportunitiesEqMock = vi.fn(() => ({ order: fundingOpportunitiesOrderMock }));
const fundingOpportunitiesSelectMock = vi.fn(() => ({ eq: fundingOpportunitiesEqMock }));

const datasetsInMock = vi.fn();
const datasetsSelectMock = vi.fn(() => ({ in: datasetsInMock }));

const connectorsInMock = vi.fn();
const connectorsSelectMock = vi.fn(() => ({ in: connectorsInMock }));

const aerialMissionsOrderMock = vi.fn();
const aerialMissionsEqMock = vi.fn(() => ({ order: aerialMissionsOrderMock }));
const aerialMissionsSelectMock = vi.fn(() => ({ eq: aerialMissionsEqMock }));

const aerialPackagesOrderMock = vi.fn();
const aerialPackagesInMock = vi.fn(() => ({ order: aerialPackagesOrderMock }));
const aerialPackagesSelectMock = vi.fn(() => ({ in: aerialPackagesInMock }));

const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const buildProjectControlsSummaryMock = vi.fn();
const summarizeBillingInvoiceRecordsMock = vi.fn();
const buildProjectStageGateSummaryMock = vi.fn();

const fromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return { select: projectSelectMock };
  }
  if (table === "workspaces") {
    return { select: workspaceSelectMock };
  }
  if (table === "runs") {
    return { select: runsSelectMock };
  }
  if (table === "model_runs") {
    return { select: modelRunsSelectMock };
  }
  if (table === "modeling_claim_decisions") {
    return { select: claimDecisionsSelectMock };
  }
  if (table === "kb_documents") {
    // Head-count of project-linked knowledge-base documents.
    return { select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ count: 0, error: null })) })) };
  }
  if (table === "model_run_kpis") {
    return { select: modelRunKpisSelectMock };
  }
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "scenario_sets") {
    return { select: scenarioSetsSelectMock };
  }
  if (table === "scenario_entries") {
    return { select: scenarioEntriesSelectMock };
  }
  if (table === "report_artifacts") {
    return { select: reportArtifactsSelectMock };
  }
  if (table === "report_runs") {
    return { select: reportRunsSelectMock };
  }
  if (table === "engagement_campaigns") {
    return { select: engagementCampaignsSelectMock };
  }
  if (table === "engagement_items") {
    return { select: engagementItemsSelectMock };
  }
  if (table === "stage_gate_decisions") {
    return { select: stageGateSelectMock };
  }
  if (table === "project_milestones") {
    return { select: milestonesSelectMock };
  }
  if (table === "project_submittals") {
    return { select: submittalsSelectMock };
  }
  if (table === "project_deliverables") {
    return { select: deliverablesSelectMock };
  }
  if (table === "project_spend_entries") {
    return { select: spendEntriesSelectMock };
  }
  if (table === "client_invoices") {
    return { select: clientInvoicesSelectMock };
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
  if (table === "billing_invoice_records") {
    return { select: invoicesSelectMock };
  }
  if (table === "data_dataset_project_links") {
    return { select: datasetLinksSelectMock };
  }
  if (table === "project_rtp_cycle_links") {
    return { select: projectRtpLinksSelectMock };
  }
  if (table === "rtp_cycles") {
    return { select: rtpCyclesSelectMock };
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
  if (table === "data_datasets") {
    return { select: datasetsSelectMock };
  }
  if (table === "data_connectors") {
    return { select: connectorsSelectMock };
  }
  if (table === "aerial_missions") {
    return { select: aerialMissionsSelectMock };
  }
  if (table === "aerial_evidence_packages") {
    return { select: aerialPackagesSelectMock };
  }
  if (table === "aerial_project_posture") {
    // Cached posture now lives in its own aerial-owned table; no cached row here.
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    };
  }
  if (table === "kb_documents") {
    // Head-count of project-linked Knowledge Base documents.
    return {
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({ count: 0, error: null })),
      })),
    };
  }
  if (table === "safety_crash_ingests") {
    // Project-linked crash acquisitions feeding the safety evidence lane.
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
      })),
    };
  }
  if (table === "project_corridors") {
    // Corridors drawn on the cartographic backdrop for this project.
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (...args: unknown[]) => redirectMock(...args),
  // The project record editor is a client component mounted on this page and
  // navigates after a delete, so rendering the page needs a router.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

vi.mock("@/components/workspaces/workspace-membership-required", () => ({
  WorkspaceMembershipRequired: () => <div data-testid="workspace-membership-required" />,
}));

vi.mock("@/components/projects/project-record-composer", () => ({
  ProjectRecordComposer: () => <div data-testid="project-record-composer" />,
}));

vi.mock("@/components/projects/project-rtp-linker", () => ({
  ProjectRtpLinker: () => <div data-testid="project-rtp-linker" />,
}));

vi.mock("@/components/projects/project-funding-profile-editor", () => ({
  ProjectFundingProfileEditor: () => <div data-testid="project-funding-profile-editor" />,
}));

// Carries a Mapbox picker and a router; the panel's own behavior is covered by
// src/test/project-map-presence-routes.test.ts and the local spine smoke.
vi.mock("@/components/projects/project-map-presence", () => ({
  ProjectMapPresence: () => <div data-testid="project-map-presence" />,
}));

vi.mock("@/components/projects/project-funding-award-creator", () => ({
  ProjectFundingAwardCreator: () => <div data-testid="project-funding-award-creator" />,
}));

vi.mock("@/components/projects/project-spend-entry-form", () => ({
  ProjectSpendEntryForm: () => <div data-testid="project-spend-entry-form" />,
}));

vi.mock("@/components/aerial/aerial-mission-creator", () => ({
  AerialMissionCreator: () => <div data-testid="aerial-mission-creator" />,
}));

vi.mock("@/components/aerial/aerial-evidence-package-creator", () => ({
  AerialEvidencePackageCreator: () => <div data-testid="aerial-evidence-package-creator" />,
}));

vi.mock("@/components/aerial/aerial-mission-status-editor", () => ({
  AerialMissionStatusEditor: ({ currentStatus }: { currentStatus: string }) => (
    <div data-testid="aerial-mission-status-editor">{currentStatus}</div>
  ),
}));

vi.mock("@/components/programs/funding-opportunity-decision-controls", () => ({
  FundingOpportunityDecisionControls: () => <div data-testid="funding-opportunity-decision-controls" />,
}));

vi.mock("@/lib/projects/controls", () => ({
  buildProjectControlsSummary: (...args: unknown[]) => buildProjectControlsSummaryMock(...args),
}));

vi.mock("@/lib/invoicing/invoice-records", async () => {
  // Partial mock: the budget lib pulls parseCurrencyAmount from this module
  // and must get the real one; only the invoice summarizer is stubbed.
  const actual = await vi.importActual<typeof import("@/lib/invoicing/invoice-records")>(
    "@/lib/invoicing/invoice-records"
  );
  return {
    ...actual,
    summarizeBillingInvoiceRecords: (...args: unknown[]) => summarizeBillingInvoiceRecordsMock(...args),
  };
});

vi.mock("@/lib/stage-gates/summary", () => ({
  buildProjectStageGateSummary: (...args: unknown[]) => buildProjectStageGateSummaryMock(...args),
}));

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>("@/lib/operations/workspace-summary");
  return {
    ...actual,
    loadWorkspaceOperationsSummaryForWorkspace: (...args: unknown[]) =>
      loadWorkspaceOperationsSummaryForWorkspaceMock(...args),
  };
});

import ProjectDetailPage from "@/app/(app)/projects/[projectId]/page";

async function renderPage() {
  render(
    await ProjectDetailPage({
      params: Promise.resolve({ projectId: "project-1" }),
    })
  );
}

function expectLinkByHref(name: RegExp, href: string) {
  const link = screen
    .getAllByRole("link", { name })
    .find((element) => element.getAttribute("href") === href);

  expect(link).toBeDefined();
  expect(link).toHaveAttribute("href", href);
}

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: "workspace-1", role: "owner" },
      workspace: { id: "workspace-1", name: "OpenPlan QA", plan: "pilot" },
    });

    projectSingleMock.mockResolvedValue({
      data: {
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Downtown Mobility Plan",
        summary: "Planning effort focused on corridor safety and access.",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "analysis",
        created_at: "2026-03-28T18:00:00.000Z",
        updated_at: "2026-03-28T21:10:00.000Z",
      },
      error: null,
    });

    workspaceSingleMock.mockResolvedValue({
      data: {
        id: "workspace-1",
        name: "OpenPlan QA",
        plan: "starter",
        slug: "openplan-qa",
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
        created_at: "2026-03-28T18:00:00.000Z",
      },
      error: null,
    });

    runsLimitMock.mockResolvedValue({ data: [], error: null });
    reportArtifactsOrderMock.mockResolvedValue({
      data: [
        {
          report_id: "report-1",
          generated_at: "2026-03-28T20:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  scenarioSetId: "scenario-set-1",
                  scenarioSetTitle: "Downtown alternatives",
                  baselineLabel: "Existing conditions",
                  comparisonSnapshots: [
                    {
                      comparisonSnapshotId: "comparison-1",
                      status: "ready",
                      candidateEntryLabel: "Protected bike package",
                      indicatorDeltaCount: 4,
                      updatedAt: "2026-03-28T19:30:00.000Z",
                    },
                  ],
                },
              ],
              evidenceChainSummary: {
                linkedRunCount: 2,
                scenarioSetLinkCount: 1,
                projectRecordGroupCount: 3,
                totalProjectRecordCount: 5,
                engagementLabel: "Active",
                engagementItemCount: 9,
                engagementReadyForHandoffCount: 4,
                stageGateLabel: "Hold present",
                stageGatePassCount: 1,
                stageGateHoldCount: 1,
                stageGateBlockedGateLabel:
                  "G02 · Agreements, Procurement, and Civil Rights Setup",
              },
            },
          },
        },
        {
          report_id: "report-2",
          generated_at: "2026-03-28T19:00:00.000Z",
          metadata_json: {
            sourceContext: {
              evidenceChainSummary: {
                linkedRunCount: 1,
                scenarioSetLinkCount: 1,
                projectRecordGroupCount: 2,
                totalProjectRecordCount: 3,
                engagementLabel: "Active",
                engagementItemCount: 4,
                engagementReadyForHandoffCount: 4,
                stageGateLabel: "Complete",
                stageGatePassCount: 2,
                stageGateHoldCount: 0,
                stageGateBlockedGateLabel: null,
              },
            },
          },
        },
      ],
      error: null,
    });
    reportRunsInMock.mockResolvedValue({ data: [], error: null });
    engagementCampaignsLimitMock.mockResolvedValue({ data: [], error: null });
    engagementItemsLimitMock.mockResolvedValue({ data: [], error: null });
    stageGateLimitMock.mockResolvedValue({ data: [], error: null });
    milestonesLimitMock.mockResolvedValue({ data: [], error: null });
    submittalsLimitMock.mockResolvedValue({ data: [], error: null });
    deliverablesLimitMock.mockResolvedValue({ data: [], error: null });
    projectBudgetMaybeSingleMock.mockResolvedValue({ data: { budget_amount: null }, error: null });
    spendEntriesLimitMock.mockResolvedValue({ data: [], error: null });
    clientInvoicesLimitMock.mockResolvedValue({ data: [], error: null });
    risksLimitMock.mockResolvedValue({ data: [], error: null });
    issuesLimitMock.mockResolvedValue({ data: [], error: null });
    decisionsLimitMock.mockResolvedValue({ data: [], error: null });
    meetingsLimitMock.mockResolvedValue({ data: [], error: null });
    invoicesLimitMock.mockResolvedValue({ data: [], error: null });
    datasetLinksOrderMock.mockResolvedValue({ data: [], error: null });
    projectRtpLinksOrderMock.mockResolvedValue({ data: [], error: null });
    rtpCyclesOrderMock.mockResolvedValue({ data: [], error: null });
    rtpCyclesInMock.mockResolvedValue({ data: [], error: null });
    projectFundingProfileMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    projectFundingProfileLimitMock.mockResolvedValue({ data: [], error: null });
    fundingAwardsLimitMock.mockResolvedValue({ data: [], error: null });
    fundingOpportunitiesLimitMock.mockResolvedValue({ data: [], error: null });
    datasetsInMock.mockResolvedValue({ data: [], error: null });
    connectorsInMock.mockResolvedValue({ data: [], error: null });
    aerialMissionsOrderMock.mockResolvedValue({ data: [], error: null });
    aerialPackagesOrderMock.mockResolvedValue({ data: [], error: null });

    reportsLimitMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          title: "Downtown Safety Packet",
          summary: "Packet with corridor safety recommendations.",
          report_type: "project_status",
          status: "generated",
          updated_at: "2026-03-28T21:10:00.000Z",
          generated_at: "2026-03-28T20:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-2",
          title: "Board Packet",
          summary: null,
          report_type: "board_packet",
          status: "generated",
          updated_at: "2026-03-28T19:00:00.000Z",
          generated_at: "2026-03-28T19:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      count: 2,
      error: null,
    });

    scenarioSetsLimitMock.mockResolvedValue({
      data: [
        {
          id: "scenario-set-1",
          title: "Downtown alternatives",
          status: "active",
          planning_question: "Which safety package should advance?",
          updated_at: "2026-03-28T19:30:00.000Z",
        },
      ],
      error: null,
    });

    scenarioEntriesInMock.mockResolvedValue({
      data: [
        {
          id: "scenario-entry-1",
          scenario_set_id: "scenario-set-1",
          entry_type: "baseline",
          status: "ready",
          attached_run_id: "run-1",
        },
        {
          id: "scenario-entry-2",
          scenario_set_id: "scenario-set-1",
          entry_type: "alternative",
          status: "ready",
          attached_run_id: "run-2",
        },
      ],
      error: null,
    });

    buildProjectControlsSummaryMock.mockReturnValue({
      controlHealth: "attention",
      milestoneCount: 0,
      completedMilestoneCount: 0,
      blockedMilestoneCount: 0,
      pendingSubmittalCount: 0,
      overdueSubmittalCount: 0,
      overdueMilestoneCount: 0,
      nextMilestone: null,
      nextSubmittal: null,
      deadlineSummary: {
        totalCount: 0,
        overdueCount: 0,
        upcomingCount: 0,
        nextDeadline: null,
        items: [],
      },
      recommendedNextAction: {
        label: "No immediate controls action",
        detail: "Controls are clear right now.",
        tone: "info",
        targetId: null,
        targetRowId: null,
      },
      attentionSummary: {
        reportPackets: { count: 0, targetId: null, targetRowId: null },
        blockedMilestones: { count: 0, targetId: null, targetRowId: null },
        overdueMilestones: { count: 0, targetId: null, targetRowId: null },
        overdueSubmittals: { count: 0, targetId: null, targetRowId: null },
        overdueInvoices: { count: 0, targetId: null, targetRowId: null },
      },
    });

    summarizeBillingInvoiceRecordsMock.mockReturnValue({
      outstandingNetAmount: 0,
      submittedCount: 0,
      totalCount: 0,
      paidNetAmount: 0,
      overdueCount: 0,
      totalNetAmount: 0,
    });

    buildProjectStageGateSummaryMock.mockReturnValue({
      templateId: "ca_stage_gates_v0_1",
      templateName: "Test stage-gate template",
      templateVersion: "0.1.0",
      jurisdiction: "CA",
      jurisdictionLabel: "Test jurisdiction",
      totalGateCount: 0,
      passCount: 0,
      holdCount: 0,
      notStartedCount: 0,
      unknownCount: 0,
      // The board branches on this before printing any count: an unreadable
      // decision log must not render as zero recorded decisions.
      decisionsRead: { readable: true },
      nextGate: null,
      blockedGate: null,
      gates: [],
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      posture: "stable",
      headline: "Everything is queued correctly",
      detail: "No workspace-wide follow-up is currently blocking the project spine.",
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 2,
        reportRefreshRecommended: 1,
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
        queueDepth: 0,
      },
      nextCommand: null,
      commandQueue: [],
      fullCommandQueue: [],
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });


  it("renders a project that lives outside the newest-first current workspace", async () => {
    // The FIX: access is membership of the project's OWN workspace (enforced by
    // the projects_read RLS policy — here, the project select returning a row),
    // not equality with whichever workspace resolved as "current" newest-first.
    // The old equality gate stranded every project a member could read but that
    // was not their current workspace. project-1 lives in workspace-1; the
    // caller's current workspace is a different one they also belong to.
    loadCurrentWorkspaceMembershipMock.mockResolvedValueOnce({
      membership: { workspace_id: "workspace-other", role: "member" },
      workspace: { id: "workspace-other", name: "Other workspace", plan: "pilot" },
    });

    render(await ProjectDetailPage({ params: Promise.resolve({ projectId: "project-1" }) }));

    // It renders (no notFound), and the page scopes to the PROJECT's workspace.
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(workspaceEqMock).toHaveBeenCalledWith("id", "workspace-1");
  });

  it("asks the database for geometry_ref on model_run_kpis (the run-level filter's load-bearing column)", async () => {
    // The KPI read fires only when a link cites an evidence run, so seed one.
    projectRtpLinksOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "link-1",
          rtp_cycle_id: "cycle-1",
          portfolio_role: "constrained",
          priority_rationale: null,
          priority_scores: {},
          evidence_model_run_id: "run-9",
          created_at: "2026-07-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    render(await ProjectDetailPage({ params: Promise.resolve({ projectId: "project-1" }) }));

    // The mocked client returns the fixture whatever columns are asked for,
    // and `!row.geometry_ref` passes on undefined — so dropping the column
    // from the .select() publishes corridor-slice KPIs as run-level evidence
    // with the suite green. The projection string is the artifact under test
    // (2026-08-03 review, top finding; same assertion on the public plan
    // page in rtp-evidence-citation-disclosure.test.tsx).
    const kpiSelects = modelRunKpisSelectMock.mock.calls.map((call) => String(call[0]));
    expect(kpiSelects.length).toBeGreaterThan(0);
    for (const columns of kpiSelects) {
      expect(columns).toContain("geometry_ref");
    }
  });

  it("says the stage-gate template was assumed when the workspace has stated no geography", async () => {
    // The default fixture is a trigger-provisioned workspace: it holds the
    // stage_gate_template_id the migration's DEFAULT gave it and has no home
    // geography. The header must not present that as a choice.
    await renderPage();

    expect(
      screen.getByText(/Interim default gates — not your jurisdiction's/)
    ).toBeInTheDocument();
    expect(screen.getByText(/has not stated where it works/)).toBeInTheDocument();
    expect(screen.getByText(/not authoritative for this agency/)).toBeInTheDocument();
  });

  it("does not cry assumption when the workspace's own jurisdiction registered the template", async () => {
    workspaceSingleMock.mockResolvedValueOnce({
      data: {
        id: "workspace-1",
        name: "OpenPlan QA",
        slug: "openplan-qa",
        stage_gate_template_id: "ca_stage_gates_v0_1",
        stage_gate_template_version: "0.1.0",
        created_at: "2026-03-28T18:00:00.000Z",
        home_geography_source: "tigerweb",
        home_geography_kind: "county",
        home_geography_ref: "06057",
        home_country_code: "US",
        home_subdivision_code: "CA",
      },
      error: null,
    });

    await renderPage();

    expect(screen.queryByText(/Interim default gates/)).toBeNull();
    expect(
      screen.getByText(/template registered for this workspace's own jurisdiction/)
    ).toBeInTheDocument();
  });

  it("notFounds when the project is not readable (RLS blocks a non-member)", async () => {
    // A caller who is not a member of the project's workspace gets no row back
    // from the RLS-scoped select, which is the only access gate that remains.
    projectSingleMock.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      ProjectDetailPage({ params: Promise.resolve({ projectId: "project-1" }) })
    ).rejects.toThrow("notFound");

    expect(notFoundMock).toHaveBeenCalled();
    expect(workspaceSingleMock).not.toHaveBeenCalled();
  });

  it("shows the supervised membership gate when the account has no workspace", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValueOnce({ membership: null, workspace: null });

    render(
      await ProjectDetailPage({ params: Promise.resolve({ projectId: "project-1" }) })
    );

    expect(screen.getByTestId("workspace-membership-required")).toBeInTheDocument();
    expect(workspaceSingleMock).not.toHaveBeenCalled();
  });
  it("labels each project invoice's posture from the row's OWN recorded profile, not the DB default", async () => {
    invoicesLimitMock.mockResolvedValue({
      data: [
        {
          // A row written through the profile seam: its own profile id selects
          // the vocabulary that labels its recorded posture.
          id: "invoice-1",
          funding_award_id: null,
          invoice_number: "INV-100",
          consultant_name: null,
          billing_basis: "time_and_materials",
          status: "draft",
          invoice_date: null,
          due_date: null,
          amount: 1000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 1000,
          supporting_docs_status: "pending",
          submitted_to: null,
          caltrans_posture: "deferred_exact_forms",
          reimbursement_profile_id: "us_ca_lapm_reimbursement_v1",
          reimbursement_posture: "local_agency_consulting",
          reimbursement_profile_selection: "jurisdiction_matched",
          notes: null,
          created_at: "2026-04-01T18:00:00.000Z",
          funding_awards: null,
        },
        {
          // An un-backfilled row (no profile columns — e.g. the legacy-select
          // retry path): its raw legacy value is humanized, never read through
          // a resolved profile's vocabulary.
          id: "invoice-2",
          funding_award_id: null,
          invoice_number: "INV-101",
          consultant_name: null,
          billing_basis: "time_and_materials",
          status: "draft",
          invoice_date: null,
          due_date: null,
          amount: 2000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 2000,
          supporting_docs_status: "pending",
          submitted_to: null,
          caltrans_posture: "federal_aid_candidate",
          notes: null,
          created_at: "2026-04-02T18:00:00.000Z",
          funding_awards: null,
        },
      ],
      error: null,
    });

    await renderPage();

    // The registered profile's own label for the recorded posture — the fix
    // for every new invoice showing the DB default's vocabulary instead.
    expect(screen.getByText(/Local-agency consulting/)).toBeInTheDocument();
    // The un-backfilled row's legacy value, humanized via titleize.
    expect(screen.getByText(/Federal Aid Candidate/)).toBeInTheDocument();
    // Neither row shows the DB default's label.
    expect(screen.queryByText(/Deferred Exact Forms/)).toBeNull();
    expect(screen.queryByText(/Exact forms deferred/)).toBeNull();
  });

  it("surfaces project-linked report freshness guidance", async () => {
    await renderPage();

    expect(screen.getByText(/Packet freshness and regeneration cues/i)).toBeInTheDocument();
    expect(screen.getByText(/Downtown Safety Packet needs attention/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Next action: open this report and regenerate the packet, then review the governance hold before release reuse\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 need attention/i)).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 most recent report records/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^2$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Reports that still need packet updates or governance review/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Evidence-backed/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Governance holds/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Blocked gate: G02/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        /Saved comparison context from Downtown Safety Packet can support grant planning language or prioritization framing for this funding stack\./i
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Packet release review/i)).toBeInTheDocument();
    expect(screen.getByText(/Linked outputs across this project/i)).toBeInTheDocument();
    expect(screen.getByText(/RTP links, project reports, scenario sets/i)).toBeInTheDocument();
    expect(screen.getByText(/Shared project spine/i)).toBeInTheDocument();
    expect(screen.getByText(/Regeneration needed/i)).toBeInTheDocument();
    expect(screen.getByText(/Scenario basis visible/i)).toBeInTheDocument();
    expect(screen.getByText(/1 scenario set · 1 active · 1 baseline · 1 ready alternative/i)).toBeInTheDocument();
    expect(screen.getByText(/Review the scenario set, then confirm downstream report packets reference the same comparison basis/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Scenario evidence is planning-support context only/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Funding target missing/i)).toBeInTheDocument();
    expect(screen.getByText(/Set the funding need and local match target before using this project in RTP or grant tables/i)).toBeInTheDocument();
    expect(screen.getAllByText(/not an award commitment, eligibility opinion, or reimbursement approval/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Moderation\/handoff pending/i)).toBeInTheDocument();
    expect(screen.getByText(/Source context linked/i)).toBeInTheDocument();
    expect(screen.getAllByText(/No aerial evidence/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/4\/9 items ready for report handoff/i)).toBeInTheDocument();
    expect(screen.getByText(/Screening\/source-context posture only/i)).toBeInTheDocument();
    expect(screen.getByText("Continue this pilot story")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Project or county context/i })).toHaveAttribute(
      "href",
      "/projects/project-1"
    );
    expect(screen.getByRole("link", { name: /Engagement signal/i })).toHaveAttribute(
      "href",
      "/engagement?projectId=project-1"
    );
    expectLinkByHref(/Packet assembly/i, "/reports");
    expect(screen.getAllByText(/Refresh recommended/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Suggested Monitor/i)).toBeInTheDocument();
    expect(
      screen.getByText(/operators should refresh the supporting packet before leaning on it for final pursue language/i)
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/not proof of award likelihood/i).length
    ).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open packet review/i })).toHaveAttribute(
      "href",
      "/reports/report-1#drift-since-generation"
    );
    expect(screen.getAllByRole("link", { name: /Open Grants OS/i })[0]).toHaveAttribute(
      "href",
      "/grants?focusProjectId=project-1"
    );
    expect(screen.getAllByRole("link", { name: /^Open report$/i })[0]).toHaveAttribute(
      "href",
      "/reports/report-1#drift-since-generation"
    );
    expectLinkByHref(/Downtown Safety Packet/i, "/reports/report-1#drift-since-generation");
  }, 10000);

  it("prioritizes a governance-only report hold over a newer clean current packet", async () => {
    projectSingleMock.mockResolvedValueOnce({
      data: {
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Downtown Mobility Plan",
        summary: "Planning effort focused on corridor safety and access.",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "analysis",
        created_at: "2026-03-28T18:00:00.000Z",
        updated_at: "2026-03-28T18:30:00.000Z",
      },
      error: null,
    });
    reportsLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "report-2",
          title: "Board Packet",
          summary: null,
          report_type: "board_packet",
          status: "generated",
          updated_at: "2026-03-28T21:00:00.000Z",
          generated_at: "2026-03-28T21:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-1",
          title: "Downtown Safety Packet",
          summary: "Packet with corridor safety recommendations.",
          report_type: "project_status",
          status: "generated",
          updated_at: "2026-03-28T19:00:00.000Z",
          generated_at: "2026-03-28T20:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      count: 2,
      error: null,
    });
    reportArtifactsOrderMock.mockResolvedValueOnce({
      data: [
        {
          report_id: "report-2",
          generated_at: "2026-03-28T21:30:00.000Z",
          metadata_json: {
            sourceContext: {
              evidenceChainSummary: {
                linkedRunCount: 1,
                scenarioSetLinkCount: 1,
                projectRecordGroupCount: 2,
                totalProjectRecordCount: 3,
                engagementLabel: "Active",
                engagementItemCount: 4,
                engagementReadyForHandoffCount: 4,
                stageGateLabel: "Complete",
                stageGatePassCount: 2,
                stageGateHoldCount: 0,
                stageGateBlockedGateLabel: null,
              },
            },
          },
        },
        {
          report_id: "report-1",
          generated_at: "2026-03-28T20:00:00.000Z",
          metadata_json: {
            sourceContext: {
              evidenceChainSummary: {
                linkedRunCount: 2,
                scenarioSetLinkCount: 1,
                projectRecordGroupCount: 3,
                totalProjectRecordCount: 5,
                engagementLabel: "Active",
                engagementItemCount: 9,
                engagementReadyForHandoffCount: 4,
                stageGateLabel: "Hold present",
                stageGatePassCount: 1,
                stageGateHoldCount: 1,
                stageGateBlockedGateLabel:
                  "G02 · Agreements, Procurement, and Civil Rights Setup",
              },
            },
          },
        },
      ],
      error: null,
    });

    await renderPage();

    expect(screen.getByText(/Downtown Safety Packet needs attention/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Next action: open this report and review the governance hold before release reuse\./i)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Blocked gate: G02/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 need attention/i).length).toBeGreaterThan(0);
  });

  it("keeps artifact-backed linked reports in current-packet posture when report generated_at is null", async () => {
    reportsLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "report-1",
          title: "Downtown Safety Packet",
          summary: "Packet with corridor safety recommendations.",
          report_type: "project_status",
          status: "generated",
          updated_at: "2026-03-28T21:10:00.000Z",
          generated_at: "2026-03-28T20:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-2",
          title: "Board Packet",
          summary: null,
          report_type: "board_packet",
          status: "generated",
          updated_at: "2026-03-28T19:00:00.000Z",
          generated_at: null,
          latest_artifact_kind: "html",
        },
      ],
      count: 2,
      error: null,
    });

    await renderPage();

    const boardPacketCard = screen
      .getAllByText("Board Packet")
      .map((node) => node.closest("a"))
      .find((node) => node?.getAttribute("href") === "/reports/report-2#packet-release-review");

    expect(boardPacketCard).not.toBeNull();
    expect(boardPacketCard).toHaveAttribute("href", "/reports/report-2#packet-release-review");
    expect(screen.getAllByText(/Packet current/i).length).toBeGreaterThan(0);
  });

  it("surfaces deliverable budget chips and honest coverage copy", async () => {
    deliverablesLimitMock.mockResolvedValue({
      data: [
        {
          id: "deliverable-1",
          title: "Existing Conditions Memo",
          summary: null,
          owner_label: null,
          due_date: null,
          status: "in_progress",
          created_at: "2026-03-28T18:00:00.000Z",
          budget_amount: 1000,
          percent_complete: 50,
        },
        {
          id: "deliverable-2",
          title: "Corridor Map Set",
          summary: null,
          owner_label: null,
          due_date: null,
          status: "not_started",
          created_at: "2026-03-28T18:00:00.000Z",
          budget_amount: null,
          percent_complete: null,
        },
      ],
      error: null,
    });
    spendEntriesLimitMock.mockResolvedValue({
      data: [
        {
          id: "spend-1",
          deliverable_id: "deliverable-1",
          entry_date: "2026-07-01",
          amount: 500,
          description: "Traffic counts subconsultant",
          vendor_label: null,
          created_at: "2026-07-01T18:00:00.000Z",
        },
      ],
      error: null,
    });

    await renderPage();

    // Chip on the deliverable row AND the budget panel row: burn 50% at 50%
    // complete is on pace; the unbudgeted deliverable gets the honest refusal.
    expect(screen.getAllByText("On pace").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No budget entered").length).toBeGreaterThan(0);
    // Coverage copy names the partial basis instead of implying a total.
    expect(screen.getByText(/1 of 2 deliverables budgeted\./i)).toBeInTheDocument();
    expect(screen.getByText(/Burn against entered budgets/i)).toBeInTheDocument();
    expect(screen.getByTestId("project-spend-entry-form")).toBeInTheDocument();
  });

  /**
   * The delivery board is where the deliverable status, budget and
   * percent-complete controls live. Nothing above pins it: every assertion
   * this file makes about deliverables ("On pace", "No budget entered") is
   * satisfied by the budget PANEL alone, so removing `<ProjectDeliveryBoard>`
   * from the page would fail no test and silently take four write controls off
   * the screen. These anchors are rendered only by the board.
   */
  it("mounts the delivery board, which is the only surface carrying the record write controls", async () => {
    await renderPage();

    expect(document.querySelector("#project-deliverables")).not.toBeNull();
    expect(document.querySelector("#project-milestones")).not.toBeNull();
    expect(document.querySelector("#project-submittals")).not.toBeNull();
    expect(screen.getByText("Outputs to ship")).toBeInTheDocument();
  });

  it("shows an empty reporting state when no reports are linked", async () => {
    reportsLimitMock.mockResolvedValueOnce({ data: [], count: 0, error: null });

    await renderPage();

    expect(
      screen.getByText(/No reports are linked to this project yet\./i)
    ).toBeInTheDocument();
  });

  it("says a closed award was ASSERTED on import rather than earned against invoices", async () => {
    // The regression this pins: the closure-provenance columns
    // (20260729000001) existed, the API wrote them, and the panel knew how to
    // render them — but this page's select never asked for them, so every
    // closed award reached a planner as an unexplained green "Fully spent".
    // Nothing type-checks a select string, so the whole distinction was lost
    // silently, everywhere, permanently.
    fundingAwardsLimitMock.mockResolvedValue({
      data: [
        {
          id: "award-1",
          project_id: "project-1",
          program_id: null,
          funding_opportunity_id: null,
          title: "Legacy ATP construction award",
          awarded_amount: 250000,
          match_amount: 0,
          match_posture: "secured",
          obligation_due_at: null,
          spending_status: "fully_spent",
          closure_basis: "recorded_on_import",
          closed_at: "2026-05-01T18:00:00.000Z",
          closure_note: "Closed in the agency ledger years before this workspace existed.",
          reopened_at: null,
          risk_flag: "none",
          notes: null,
          updated_at: "2026-05-02T18:00:00.000Z",
          created_at: "2026-04-01T18:00:00.000Z",
          funding_opportunities: null,
          programs: null,
        },
      ],
      error: null,
    });

    await renderPage();

    const [awardColumns] = fundingAwardsSelectMock.mock.calls[0];
    for (const column of ["closure_basis", "closed_at", "closure_note", "reopened_at"]) {
      expect(awardColumns, `the funding_awards select must name ${column}`).toContain(column);
    }

    // The same vocabulary the /grants close-out control uses — one language for
    // one fact, sourced from the programs catalog by both surfaces.
    expect(screen.getByText("Recorded as closed on import")).toBeInTheDocument();
    expect(screen.getByText(/No invoice coverage was checked/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Closed in the agency ledger years before this workspace existed\./i)
    ).toBeInTheDocument();
    // And never the finding it is not.
    expect(screen.queryByText("Closed out on invoice coverage")).toBeNull();
    expect(screen.queryByText(/Paid invoices covered the full awarded amount/i)).toBeNull();
  });

  it("does not claim a closure basis it was never given", async () => {
    // The honest degrade has to keep working: a page that stops selecting the
    // columns must say it does not know, rather than fall back to the reassuring
    // reading. This is the state the whole app was stuck in before the select
    // was fixed, and it is still the right answer whenever the columns are
    // genuinely absent.
    fundingAwardsLimitMock.mockResolvedValue({
      data: [
        {
          id: "award-2",
          project_id: "project-1",
          program_id: null,
          funding_opportunity_id: null,
          title: "Award read without its provenance columns",
          awarded_amount: 100000,
          match_amount: 0,
          match_posture: "secured",
          obligation_due_at: null,
          spending_status: "fully_spent",
          risk_flag: "none",
          notes: null,
          updated_at: "2026-05-02T18:00:00.000Z",
          created_at: "2026-04-01T18:00:00.000Z",
          funding_opportunities: null,
          programs: null,
        },
      ],
      error: null,
    });

    await renderPage();

    expect(screen.getByText("Closure basis not loaded")).toBeInTheDocument();
    expect(screen.getByText(/is not recorded in what was loaded here/i)).toBeInTheDocument();
    expect(screen.queryByText("Closed out on invoice coverage")).toBeNull();
  });

  it("discloses a database behind the closure migration instead of reporting no awards", async () => {
    // Adding a column to a select buys a new failure mode: PostgREST answers a
    // select naming a column the deployed schema lacks with `column
    // funding_awards.closure_basis does not exist` (42703), the read returns
    // `data: null`, and the award lane collapses to its empty state — "No
    // funding awards are recorded for this project yet." over a project that
    // has several. That is an absence stated as a fact, and it is caused by the
    // page asking for more, so the page owes the disclosure.
    fundingAwardsLimitMock.mockResolvedValue({
      data: null,
      error: { message: "column funding_awards.closure_basis does not exist" },
    });

    await renderPage();

    expect(
      screen.getByText(/award records will appear after the funding award migrations are applied/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/No funding awards are recorded for this project yet\./i)).toBeNull();
  });

  /**
   * A READ THAT FAILED MAY NOT BE RENDERED AS AN ANSWER.
   *
   * `const { data } = await supabase…` hands back `null` for both "there is
   * nothing here" and "this query failed", and this page had five of them. The
   * four record lanes below each printed "No X recorded yet." — a claim about
   * the project — on the strength of a broken query, and the project read
   * itself answered notFound(), telling a planner their project did not exist.
   *
   * Each case is asserted three ways on purpose: the false sentence is gone,
   * the disclosure is present, AND the ordinary empty state still appears when
   * the read SUCCEEDS with nothing. Without that third assertion a page that
   * always warns would pass.
   */
  describe("a failed read is disclosed, never rendered as an answer", () => {
    it("does not 404 when the project read FAILS — that is not the same fact as absent", async () => {
      projectSingleMock.mockResolvedValueOnce({
        data: null,
        error: { code: "42703", message: 'column projects.place_set_at does not exist' },
      });

      render(await ProjectDetailPage({ params: Promise.resolve({ projectId: "project-1" }) }));

      expect(notFoundMock).not.toHaveBeenCalled();
      expect(screen.getByText(/This project could not be read/i)).toBeInTheDocument();
      // The honest half: it must NOT claim the project is missing.
      expect(
        screen.getByText(/not a statement that the project is missing/i)
      ).toBeInTheDocument();
      // Internal page, so the operator detail is shown rather than hidden.
      expect(screen.getByText(/column projects\.place_set_at does not exist/i)).toBeInTheDocument();
    });

    it("still 404s on PostgREST's real 'no row matched', which IS an absence", async () => {
      projectSingleMock.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
      });

      await expect(
        ProjectDetailPage({ params: Promise.resolve({ projectId: "project-1" }) })
      ).rejects.toThrow("notFound");
      expect(notFoundMock).toHaveBeenCalled();
    });

    it("says the risk register could not be read instead of 'No risks recorded yet.'", async () => {
      risksLimitMock.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied for table project_risks" },
      });

      await renderPage();

      expect(screen.queryByText(/No risks recorded yet\./i)).toBeNull();
      expect(screen.getByText(/Project risks could not be read/i)).toBeInTheDocument();
      // The page-level disclosure names the lane and disowns the empty panels.
      expect(screen.getByText(/This page could not read project risks\./i)).toBeInTheDocument();
      expect(
        screen.getByText(/permission denied for table project_risks/i)
      ).toBeInTheDocument();
      // And the header count is unknown, not zero — a 0 here reads as "no open
      // risks on this project", which is the reassuring direction of the error.
      const openRisks = screen.getByText("Open risks").closest("div") as HTMLElement;
      expect(within(openRisks).getByText("—")).toBeInTheDocument();
      expect(within(openRisks).queryByText("0")).toBeNull();
      expect(within(openRisks).getByText(/Risk count unavailable/i)).toBeInTheDocument();
    });

    it("says the issue log could not be read instead of 'No issues logged yet.'", async () => {
      issuesLimitMock.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied for table project_issues" },
      });

      await renderPage();

      expect(screen.queryByText(/No issues logged yet\./i)).toBeNull();
      expect(screen.getByText(/Project issues could not be read/i)).toBeInTheDocument();
      const openIssues = screen.getByText("Open issues").closest("div") as HTMLElement;
      expect(within(openIssues).getByText("—")).toBeInTheDocument();
      expect(within(openIssues).getByText(/Issue count unavailable/i)).toBeInTheDocument();
    });

    it("says the decision and meeting logs could not be read, and names both", async () => {
      decisionsLimitMock.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied for table project_decisions" },
      });
      meetingsLimitMock.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied for table project_meetings" },
      });

      await renderPage();

      expect(screen.queryByText(/No decisions logged yet\./i)).toBeNull();
      expect(screen.queryByText(/No meetings logged yet\./i)).toBeNull();
      expect(screen.getByText(/Project decisions could not be read/i)).toBeInTheDocument();
      expect(screen.getByText(/Project meetings could not be read/i)).toBeInTheDocument();
      expect(
        screen.getByText(/could not read project decisions and project meetings\./i)
      ).toBeInTheDocument();
    });

    /**
     * CLASSIFY FIRST, THEN COLLECT WHAT IS LEFT.
     *
     * Most reads on this page are written
     * `looksLikePendingSchema(x.error?.message) ? [] : (x.data ?? [])`, which
     * looks like error handling but classifies exactly ONE failure — a database
     * behind a migration. Every other error (a revoked grant, an RLS policy
     * change, a dropped connection) fails that test, falls into the else branch,
     * and becomes `[]` — an answer. The award lane then states "No funding
     * awards are recorded for this project yet." over an agency's real money,
     * and the summary tiles above it total that money to $0.
     *
     * The pending-migration case is already covered above; this is the other,
     * larger half of the same read.
     */
    it("does not report an empty award stack when the award read failed for a reason that is NOT a pending migration", async () => {
      fundingAwardsLimitMock.mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied for table funding_awards" },
      });

      await renderPage();

      expect(
        screen.queryByText(/No funding awards are recorded for this project yet\./i)
      ).toBeNull();
      expect(screen.getByText(/could not read project funding awards/i)).toBeInTheDocument();
    });

    it("keeps the ordinary empty states when the reads SUCCEED and there is genuinely nothing", async () => {
      // The default harness returns `{ data: [], error: null }` for all four.
      await renderPage();

      expect(screen.getByText(/No risks recorded yet\./i)).toBeInTheDocument();
      expect(screen.getByText(/No issues logged yet\./i)).toBeInTheDocument();
      expect(screen.getByText(/No decisions logged yet\./i)).toBeInTheDocument();
      expect(screen.getByText(/No meetings logged yet\./i)).toBeInTheDocument();
      // And no disclosure at all — otherwise the banner proves nothing.
      expect(screen.queryByText(/Part of this page could not be read/i)).toBeNull();
      expect(screen.queryByText(/could not be read, so this panel is unavailable/i)).toBeNull();
      const openRisks = screen.getByText("Open risks").closest("div") as HTMLElement;
      expect(within(openRisks).getByText("0")).toBeInTheDocument();
    });
  });
});
