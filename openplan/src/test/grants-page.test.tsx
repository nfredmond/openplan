import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn(() => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();
const fundingOpportunityDecisionControlsMock = vi.fn();

const fundingOpportunitiesOrderMock = vi.fn();
const fundingOpportunitiesEqMock = vi.fn(() => ({ order: fundingOpportunitiesOrderMock }));
const fundingOpportunitiesSelectMock = vi.fn(() => ({ eq: fundingOpportunitiesEqMock }));

const projectsOrderMock = vi.fn();
const projectsEqMock = vi.fn(() => ({ order: projectsOrderMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

const programsOrderMock = vi.fn();
const programsEqMock = vi.fn(() => ({ order: programsOrderMock }));
const programsSelectMock = vi.fn(() => ({ eq: programsEqMock }));

const fundingAwardsOrderMock = vi.fn();
const fundingAwardsEqMock = vi.fn(() => ({ order: fundingAwardsOrderMock }));
const fundingAwardsSelectMock = vi.fn(() => ({ eq: fundingAwardsEqMock }));

const invoiceRecordsOrderMock = vi.fn();
const invoiceRecordsEqMock = vi.fn(() => ({ order: invoiceRecordsOrderMock }));
const invoiceRecordsSelectMock = vi.fn(() => ({ eq: invoiceRecordsEqMock }));

const projectFundingProfilesEqMock = vi.fn();
const projectFundingProfilesSelectMock = vi.fn(() => ({ eq: projectFundingProfilesEqMock }));

const reportsOrderMock = vi.fn();
const reportsInMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsSelectMock = vi.fn(() => ({ in: reportsInMock }));

const reportArtifactsOrderMock = vi.fn();
const reportArtifactsInMock = vi.fn(() => ({ order: reportArtifactsOrderMock }));
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "funding_opportunities") return { select: fundingOpportunitiesSelectMock };
  if (table === "projects") return { select: projectsSelectMock };
  if (table === "programs") return { select: programsSelectMock };
  if (table === "funding_awards") return { select: fundingAwardsSelectMock };
  if (table === "billing_invoice_records") return { select: invoiceRecordsSelectMock };
  if (table === "project_funding_profiles") return { select: projectFundingProfilesSelectMock };
  if (table === "reports") return { select: reportsSelectMock };
  if (table === "report_artifacts") return { select: reportArtifactsSelectMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
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

vi.mock("@/components/billing/billing-triage-link-copy", () => ({
  BillingTriageLinkCopy: () => <div data-testid="billing-triage-link-copy" />,
}));

vi.mock("@/components/billing/invoice-funding-award-linker", () => ({
  InvoiceFundingAwardLinker: () => <div data-testid="invoice-funding-award-linker" />,
}));

vi.mock("@/components/billing/invoice-record-composer", () => ({
  InvoiceRecordComposer: () => <div data-testid="invoice-record-composer" />,
}));

vi.mock("@/components/billing/invoice-status-advance-button", () => ({
  InvoiceStatusAdvanceButton: () => <div data-testid="invoice-status-advance-button" />,
}));

vi.mock("@/components/programs/funding-opportunity-creator", () => ({
  FundingOpportunityCreator: () => <div data-testid="funding-opportunity-creator" />,
}));

vi.mock("@/components/programs/funding-opportunity-decision-controls", () => ({
  FundingOpportunityDecisionControls: (props: unknown) => {
    fundingOpportunityDecisionControlsMock(props);
    return <div data-testid="funding-opportunity-decision-controls" />;
  },
}));

vi.mock("@/components/projects/project-funding-award-creator", () => ({
  ProjectFundingAwardCreator: () => <div data-testid="project-funding-award-creator" />,
}));

vi.mock("@/components/projects/project-funding-profile-editor", () => ({
  ProjectFundingProfileEditor: () => <div data-testid="project-funding-profile-editor" />,
}));

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

import GrantsPage from "@/app/(app)/grants/page";

async function renderPage() {
  render(await GrantsPage({ searchParams: Promise.resolve({}) }));
}

describe("GrantsPage", () => {
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
      membership: {
        workspace_id: "workspace-1",
        role: "owner",
      },
      workspace: {
        id: "workspace-1",
        name: "OpenPlan QA",
      },
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      counts: {
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        comparisonBackedReports: 3,
      },
      fullCommandQueue: [],
    });

    fundingOpportunitiesOrderMock.mockResolvedValue({
      data: [
        {
          id: "opp-1",
          workspace_id: "workspace-1",
          project_id: "project-1",
          program_id: null,
          title: "SS4A 2027",
          opportunity_status: "open",
          decision_state: "pursue",
          agency_name: "USDOT",
          owner_label: "A. Planner",
          cadence_label: "Annual",
          expected_award_amount: 250000,
          opens_at: "2026-04-01T18:00:00.000Z",
          closes_at: null,
          decision_due_at: null,
          fit_notes: "Good policy fit.",
          readiness_notes: "Need implementation narrative.",
          decision_rationale: "Strong local match.",
          decided_at: null,
          summary: "Priority safety application.",
          updated_at: "2026-04-14T18:00:00.000Z",
          created_at: "2026-04-01T18:00:00.000Z",
          programs: null,
          projects: {
            id: "project-1",
            name: "Main Street Safety",
          },
        },
        {
          id: "opp-2",
          workspace_id: "workspace-1",
          project_id: "project-2",
          program_id: null,
          title: "ATP 2027",
          opportunity_status: "open",
          decision_state: "pursue",
          agency_name: "Caltrans",
          owner_label: "B. Planner",
          cadence_label: "Annual",
          expected_award_amount: 400000,
          opens_at: "2026-04-01T18:00:00.000Z",
          closes_at: null,
          decision_due_at: null,
          fit_notes: "Needs refreshed packet.",
          readiness_notes: "Packet drift noted.",
          decision_rationale: "Refresh before final pursue call.",
          decided_at: null,
          summary: "Active bike safety application.",
          updated_at: "2026-04-14T21:00:00.000Z",
          created_at: "2026-04-01T18:00:00.000Z",
          programs: null,
          projects: {
            id: "project-2",
            name: "River Trail",
          },
        },
        {
          id: "opp-3",
          workspace_id: "workspace-1",
          project_id: "project-3",
          program_id: null,
          title: "CMAQ 2027",
          opportunity_status: "open",
          decision_state: "pursue",
          agency_name: "Air District",
          owner_label: "C. Planner",
          cadence_label: "Annual",
          expected_award_amount: 300000,
          opens_at: "2026-04-01T18:00:00.000Z",
          closes_at: null,
          decision_due_at: null,
          fit_notes: "Support is still thin.",
          readiness_notes: "Comparison exists but is not ready.",
          decision_rationale: "Needs more evidence.",
          decided_at: null,
          summary: "Fleet electrification concept.",
          updated_at: "2026-04-14T22:00:00.000Z",
          created_at: "2026-04-01T18:00:00.000Z",
          programs: null,
          projects: {
            id: "project-3",
            name: "Clean Fleet",
          },
        },
        {
          id: "opp-4",
          workspace_id: "workspace-1",
          project_id: "project-4",
          program_id: null,
          title: "RAISE 2027",
          opportunity_status: "open",
          decision_state: "pursue",
          agency_name: "USDOT",
          owner_label: "D. Planner",
          cadence_label: "Annual",
          expected_award_amount: 900000,
          opens_at: "2026-04-01T18:00:00.000Z",
          closes_at: null,
          decision_due_at: null,
          fit_notes: "No visible packet yet.",
          readiness_notes: "Need modeling basis.",
          decision_rationale: "Too early without support.",
          decided_at: null,
          summary: "Bridge modernization application.",
          updated_at: "2026-04-14T23:00:00.000Z",
          created_at: "2026-04-01T18:00:00.000Z",
          programs: null,
          projects: {
            id: "project-4",
            name: "Broadway Bridge",
          },
        },
      ],
      error: null,
    });

    projectsOrderMock.mockResolvedValue({
      data: [
        { id: "project-1", name: "Main Street Safety" },
        { id: "project-2", name: "River Trail" },
        { id: "project-3", name: "Clean Fleet" },
        { id: "project-4", name: "Broadway Bridge" },
      ],
      error: null,
    });
    programsOrderMock.mockResolvedValue({ data: [], error: null });
    fundingAwardsOrderMock.mockResolvedValue({ data: [], error: null });
    invoiceRecordsOrderMock.mockResolvedValue({ data: [], error: null });
    projectFundingProfilesEqMock.mockResolvedValue({ data: [], error: null });

    reportsOrderMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          project_id: "project-1",
          title: "Mobility Grant Packet",
          updated_at: "2026-04-14T18:00:00.000Z",
          generated_at: "2026-04-14T18:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-2",
          project_id: "project-2",
          title: "Trail Grant Packet",
          updated_at: "2026-04-14T21:00:00.000Z",
          generated_at: "2026-04-10T18:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-3",
          project_id: "project-3",
          title: "Fleet Grant Packet",
          updated_at: "2026-04-14T22:00:00.000Z",
          generated_at: "2026-04-14T22:00:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      error: null,
    });

    reportArtifactsOrderMock.mockResolvedValue({
      data: [
        {
          report_id: "report-1",
          generated_at: "2026-04-14T18:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [
                    {
                      status: "ready",
                      indicatorDeltaCount: 3,
                      updatedAt: "2026-04-14T17:30:00.000Z",
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          report_id: "report-2",
          generated_at: "2026-04-10T18:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [
                    {
                      status: "ready",
                      indicatorDeltaCount: 2,
                      updatedAt: "2026-04-10T17:30:00.000Z",
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          report_id: "report-3",
          generated_at: "2026-04-14T22:00:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  comparisonSnapshots: [
                    {
                      status: "blocked",
                      indicatorDeltaCount: 0,
                      updatedAt: "2026-04-14T21:30:00.000Z",
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("surfaces project-specific modeling evidence on funding opportunity cards", async () => {
    await renderPage();

    const renderedDecisionControlProps = fundingOpportunityDecisionControlsMock.mock.calls.map(
      ([props]) => props
    );

    expect(
      screen.getByText(/See where grant modeling support looks strongest, thin, or stale/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Within the same grant timing and decision posture, opportunities with modeling support that appears decision-ready rise ahead of refresh-recommended, thin, or unsupported work/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText("Project modeling evidence").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Mobility Grant Packet carries current comparison-backed planning support with ready saved comparisons and visible indicator deltas/i).length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Modeling-backed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Appears decision-ready").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 ready comparison").length).toBeGreaterThan(0);
    expect(screen.getByText("3 indicator deltas")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open supporting packet/i })[0]).toHaveAttribute(
      "href",
      "/reports/report-1#packet-release-review"
    );
    expect(fundingOpportunityDecisionControlsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelingSupport: expect.objectContaining({
          title: "Mobility Grant Packet",
          summary: expect.stringContaining("planning support only, not proof of award likelihood"),
          readinessNoteSuggestion: expect.stringContaining("advance this opportunity to pursue now"),
          decisionRationaleSuggestion: expect.stringContaining("appears decision-ready"),
          recommendedNextActionTitle: "Advance to pursue now",
          recommendedDecisionState: "pursue",
        }),
      })
    );
    expect(renderedDecisionControlProps).toContainEqual(
      expect.objectContaining({
        opportunityId: "opp-4",
        modelingSupport: expect.objectContaining({
          title: "Broadway Bridge modeling posture",
          recommendedNextActionTitle: "Keep monitoring or add support first",
          recommendedDecisionState: "monitor",
          recommendedNextActionSummary: expect.stringContaining(
            "No visible modeling-backed packet is linked yet"
          ),
        }),
      })
    );
  });

  it("orders similarly staged opportunities by modeling readiness before recency", async () => {
    await renderPage();

    const renderedOpportunityTitles = Array.from(
      document.querySelectorAll('[id^="funding-opportunity-"] .module-record-title')
    ).map((node) => node.textContent);

    expect(renderedOpportunityTitles).toEqual([
      "SS4A 2027",
      "ATP 2027",
      "CMAQ 2027",
      "RAISE 2027",
    ]);
  });
});
