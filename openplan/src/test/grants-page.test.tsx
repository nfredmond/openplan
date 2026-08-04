import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
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
// The column list is a recorded argument, not a detail: a Supabase select string
// is never checked against the schema, so a column this page stops asking for
// simply arrives as `undefined` with nothing failing anywhere.
const fundingAwardsSelectMock = vi.fn((_columns: string) => ({ eq: fundingAwardsEqMock }));

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

const bcaScreeningsEqMock = vi.fn(async () => ({ data: [], error: null }));
const bcaScreeningsSelectMock = vi.fn(() => ({ eq: bcaScreeningsEqMock }));

// The engagement query chain: .eq(workspace).not(...).neq(...).order(...)
const engagementCampaignsOrderMock = vi.fn(async () => ({ data: [], error: null }));
const engagementCampaignsNeqMock = vi.fn(() => ({ order: engagementCampaignsOrderMock }));
const engagementCampaignsNotMock = vi.fn(() => ({ neq: engagementCampaignsNeqMock }));
const engagementCampaignsEqMock = vi.fn(() => ({ not: engagementCampaignsNotMock }));
const engagementCampaignsSelectMock = vi.fn(() => ({ eq: engagementCampaignsEqMock }));

// Crash-evidence chain: .eq(workspace).eq(status).not(project_id, is, null).order(...)
const safetyIngestsOrderMock = vi.fn(async () => ({ data: [], error: null }));
const safetyIngestsNotMock = vi.fn(() => ({ order: safetyIngestsOrderMock }));
const safetyIngestsEqStatusMock = vi.fn(() => ({ not: safetyIngestsNotMock }));
const safetyIngestsEqMock = vi.fn(() => ({ eq: safetyIngestsEqStatusMock }));
const safetyIngestsSelectMock = vi.fn(() => ({ eq: safetyIngestsEqMock }));

const scenarioSetsInMock = vi.fn(async () => ({ data: [], error: null }));
const scenarioSetsSelectMock = vi.fn(() => ({ in: scenarioSetsInMock }));
const scenarioComparisonSummaryInMock = vi.fn(async () => ({ data: [], error: null }));
const scenarioComparisonSummarySelectMock = vi.fn(() => ({ in: scenarioComparisonSummaryInMock }));

// The workspace home-geography read that drives the reimbursement-profile
// resolution for the /grants composer.
const workspacesMaybeSingleMock = vi.fn();
const workspacesEqMock = vi.fn(() => ({ maybeSingle: workspacesMaybeSingleMock }));
const workspacesSelectMock = vi.fn(() => ({ eq: workspacesEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "funding_opportunities") return { select: fundingOpportunitiesSelectMock };
  if (table === "projects") return { select: projectsSelectMock };
  if (table === "programs") return { select: programsSelectMock };
  if (table === "funding_awards") return { select: fundingAwardsSelectMock };
  if (table === "billing_invoice_records") return { select: invoiceRecordsSelectMock };
  if (table === "project_funding_profiles") return { select: projectFundingProfilesSelectMock };
  if (table === "project_bca_screenings_latest") return { select: bcaScreeningsSelectMock };
  if (table === "reports") return { select: reportsSelectMock };
  if (table === "report_artifacts") return { select: reportArtifactsSelectMock };
  if (table === "engagement_campaigns") return { select: engagementCampaignsSelectMock };
  if (table === "scenario_sets") return { select: scenarioSetsSelectMock };
  if (table === "scenario_comparison_summary") return { select: scenarioComparisonSummarySelectMock };
  if (table === "safety_crash_ingests") return { select: safetyIngestsSelectMock };
  if (table === "workspaces") return { select: workspacesSelectMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
  // The awards lane now renders the award close-out control, a client component
  // that calls useRouter().refresh() after a close-out lands. Rendering the page
  // reaches that hook, so the navigation mock has to answer it.
  useRouter: () => ({ refresh: () => {} }),
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

vi.mock("@/components/invoicing/invoice-triage-link-copy", () => ({
  InvoiceTriageLinkCopy: () => <div data-testid="billing-triage-link-copy" />,
}));

vi.mock("@/components/invoicing/invoice-funding-award-linker", () => ({
  InvoiceFundingAwardLinker: () => <div data-testid="invoice-funding-award-linker" />,
}));

const invoiceRecordComposerMock = vi.fn();
vi.mock("@/components/invoicing/invoice-record-composer", () => ({
  InvoiceRecordComposer: (props: Record<string, unknown>) => {
    invoiceRecordComposerMock(props);
    return <div data-testid="invoice-record-composer" />;
  },
}));

vi.mock("@/components/invoicing/invoice-status-advance-button", () => ({
  InvoiceStatusAdvanceButton: () => <div data-testid="invoice-status-advance-button" />,
}));

vi.mock("@/components/programs/funding-opportunity-creator", () => ({
  FundingOpportunityCreator: () => <div data-testid="funding-opportunity-creator" />,
}));

vi.mock("@/components/grants/program-catalog-section", () => ({
  GrantsProgramCatalogSection: (props: { trackedTitles: string[] }) => (
    <div data-testid="grants-program-catalog-section" data-tracked-count={props.trackedTitles.length} />
  ),
}));

vi.mock("@/components/grants/grants-gov-live-section", () => ({
  GrantsGovLiveSection: (props: { trackedTitles: string[] }) => (
    <div data-testid="grants-gov-live-section" data-tracked-count={props.trackedTitles.length} />
  ),
}));

vi.mock("@/components/grants/grants-bca-screening-section", () => ({
  GrantsBcaScreeningSection: (props: { projects: unknown[]; canSave: boolean }) => (
    <div
      data-testid="grants-bca-screening-section"
      data-project-count={props.projects.length}
      data-can-save={String(props.canSave)}
    />
  ),
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
import {
  INTERIM_DEFAULT_RATIONALE,
  resolveReimbursementProfile,
} from "@/lib/invoicing/reimbursement-profile-binding";

async function renderPage() {
  render(await GrantsPage({ searchParams: Promise.resolve({}) }));
}

/**
 * One closed award, as the two paths that can close one actually record it.
 * `closure_basis` is what tells an earned close-out from one a workspace
 * asserted while importing its history; the rest of the row is the same either
 * way, which is exactly the problem the column exists to solve.
 */
function seedClosedAward(closure: {
  closure_basis?: string;
  closed_at?: string | null;
  closure_note?: string | null;
  reopened_at?: string | null;
}) {
  fundingAwardsOrderMock.mockResolvedValue({
    data: [
      {
        id: "award-1",
        funding_opportunity_id: null,
        project_id: "project-1",
        program_id: null,
        title: "Safety corridor construction award",
        awarded_amount: 250000,
        match_amount: 0,
        obligation_due_at: null,
        spending_status: "fully_spent",
        risk_flag: "none",
        notes: null,
        updated_at: "2026-04-14T18:00:00.000Z",
        created_at: "2026-04-01T18:00:00.000Z",
        funding_opportunities: null,
        programs: null,
        projects: { id: "project-1", name: "Main Street Safety" },
        ...closure,
      },
    ],
    error: null,
  });
}

/** One committed award with no invoices → a "not started" reimbursement stack, so the composer mounts. */
function seedComposerStackAward() {
  fundingAwardsOrderMock.mockResolvedValue({
    data: [
      {
        id: "award-1",
        funding_opportunity_id: null,
        project_id: "project-1",
        program_id: null,
        title: "Safety corridor construction award",
        awarded_amount: 250000,
        match_amount: 0,
        obligation_due_at: null,
        spending_status: "not_started",
        risk_flag: "none",
        notes: null,
        updated_at: "2026-04-14T18:00:00.000Z",
        created_at: "2026-04-01T18:00:00.000Z",
        funding_opportunities: null,
        programs: null,
        projects: { id: "project-1", name: "Main Street Safety" },
      },
    ],
    error: null,
  });
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

    // No home geography stated → the labeled interim default profile applies.
    workspacesMaybeSingleMock.mockResolvedValue({
      data: {
        home_geography_source: null,
        home_geography_kind: null,
        home_geography_ref: null,
        home_country_code: null,
        home_subdivision_code: null,
      },
      error: null,
    });

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
      screen.getByText(/Within the same grant timing and decision status, opportunities with modeling support that appears decision-ready rise ahead of refresh-recommended, thin, or unsupported work/i)
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

  it("passes the workspace's tracked opportunity titles into the program catalog section", async () => {
    await renderPage();

    const catalogSection = screen.getByTestId("grants-program-catalog-section");
    expect(catalogSection).toHaveAttribute("data-tracked-count", "4");
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

  it("threads the workspace-resolved reimbursement profile into the composer, disclosing the interim default", async () => {
    // The /grants reimbursement composer must offer the same posture select as
    // /invoicing: the binding is resolved server-side from the workspace's own
    // home geography and handed to the composer, never assumed client-side.
    seedComposerStackAward();

    const expectedResolution = resolveReimbursementProfile({ workspaceJurisdiction: null });
    if (expectedResolution.kind !== "resolved") {
      throw new Error("expected the built-in registry to resolve an interim-default binding");
    }

    await renderPage();

    expect(screen.getByTestId("invoice-record-composer")).toBeInTheDocument();
    expect(invoiceRecordComposerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reimbursementProfile: expect.objectContaining({
          profileId: expectedResolution.binding.profileId,
          selection: "interim_unconfigured_default",
          postureOptions: expectedResolution.binding.postureOptions,
        }),
      })
    );
    // A posture vocabulary nobody chose is disclosed, never presented as chosen.
    expect(screen.getByText(new RegExp(INTERIM_DEFAULT_RATIONALE.slice(0, 40)))).toBeInTheDocument();
  });

  it("offers award close-out to a member, the role the close-out route already accepts", async () => {
    // The control shipped with no caller passing its permission prop, so the
    // section fell back to `invoices.write` (owner/admin) for an action
    // `POST /api/funding-awards/[awardId]/closeout` authorizes on
    // `programs.write` (owner/admin/member). Every member on every workspace
    // saw an award they were entitled to close with no way to close it, and
    // nothing failed loudly enough to notice. This test is the alarm: it goes
    // red the moment the page stops handing this section the close-out
    // permission it computes.
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: "workspace-1", role: "member" },
      workspace: { id: "workspace-1", name: "OpenPlan QA" },
    });
    seedComposerStackAward();

    await renderPage();

    expect(screen.getByRole("button", { name: "Close out award" })).toBeInTheDocument();
  });

  it("withholds award close-out from a viewer, the role the close-out route refuses", async () => {
    // The other direction of the same gate: the fix must be the real
    // `programs.write` answer, not a constant `true` that would offer a
    // read-only member a button the server is going to refuse.
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: "workspace-1", role: "viewer" },
      workspace: { id: "workspace-1", name: "OpenPlan QA" },
    });
    seedComposerStackAward();

    await renderPage();

    expect(screen.queryByRole("button", { name: "Close out award" })).toBeNull();
    // Withheld, and said so as a fact about this view rather than about the
    // reader — the route is still the authority on who may close an award.
    expect(screen.getByText(/this view is not offering it/)).toBeInTheDocument();
  });

  it("asks the database how each closed award was closed, and repeats the answer verbatim", async () => {
    // The regression this pins: the closure-provenance columns
    // (20260729000001) existed, the API wrote them, and the close-out control
    // knew how to render them — but this page's select never asked for them, so
    // its honest "Closure basis not loaded" was what every planner saw about
    // every closed award, permanently. Nothing type-checks a select string, so
    // the omission failed nowhere.
    seedClosedAward({
      closure_basis: "recorded_on_import",
      closed_at: "2026-05-01T18:00:00.000Z",
      closure_note: "Closed in the agency ledger years before this workspace existed.",
    });

    await renderPage();

    const [awardColumns] = fundingAwardsSelectMock.mock.calls[0];
    for (const column of ["closure_basis", "closed_at", "closure_note", "reopened_at"]) {
      expect(awardColumns, `the funding_awards select must name ${column}`).toContain(column);
    }

    expect(screen.getByText("Recorded as closed on import")).toBeInTheDocument();
    expect(screen.getByText(/No invoice coverage was checked/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Closed in the agency ledger years before this workspace existed\./i)
    ).toBeInTheDocument();
    // An assertion never gets to wear the finding's words.
    expect(screen.queryByText("Closed out on invoice coverage")).toBeNull();
    expect(screen.queryByText(/Paid invoices covered the full awarded amount/i)).toBeNull();
  });

  it("keeps the award lane when the closure columns are not deployed yet, and says the basis is unknown", async () => {
    // This read used to drop its error, so a schema that rejected the select
    // left every award lane on the page reading "none" — an absence rendered as
    // a fact. A deployment behind the migration now gets its awards back from
    // the legacy column list, with the basis reported as not loaded rather than
    // assumed.
    fundingAwardsOrderMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'column funding_awards.closure_basis does not exist' },
    });
    seedClosedAward({});

    await renderPage();

    expect(fundingAwardsSelectMock).toHaveBeenCalledTimes(2);
    const [retryColumns] = fundingAwardsSelectMock.mock.calls[1];
    expect(retryColumns).not.toContain("closure_basis");

    expect(screen.getByText("Safety corridor construction award")).toBeInTheDocument();
    expect(screen.getByText("Closure basis not loaded")).toBeInTheDocument();
    expect(screen.queryByText("Closed out on invoice coverage")).toBeNull();
  });

  it("resolves a jurisdiction-matched profile for the composer from the workspace's own home geography", async () => {
    seedComposerStackAward();
    workspacesMaybeSingleMock.mockResolvedValue({
      data: {
        home_geography_source: "tigerweb",
        home_geography_kind: "county",
        home_geography_ref: "06057",
        home_country_code: "US",
        home_subdivision_code: "CA",
      },
      error: null,
    });

    const expectedResolution = resolveReimbursementProfile({
      workspaceJurisdiction: { country: "US", subdivision: "CA" },
    });
    if (expectedResolution.kind !== "resolved") {
      throw new Error("expected the built-in registry to resolve a jurisdiction-matched binding");
    }

    await renderPage();

    expect(invoiceRecordComposerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reimbursementProfile: expect.objectContaining({
          profileId: expectedResolution.binding.profileId,
          selection: "jurisdiction_matched",
        }),
      })
    );
    // A profile the workspace's own geography selected is not an interim
    // default, so no interim-default disclosure appears.
    expect(screen.queryByText(new RegExp(INTERIM_DEFAULT_RATIONALE.slice(0, 40)))).toBeNull();
  });

  /**
   * GRANTS IS THE MONEY SURFACE. Every lane here counts, totals or ranks
   * something an agency is pursuing or has won, and six of the page's reads used
   * to arrive as a bare `{ data }` — so a revoked grant or a changed policy
   * became an empty array and the page reported it as a finding. "0 awards" is a
   * sentence about an agency's funding; a query that failed cannot say it.
   *
   * The two money reads retry when a COLUMN is pending on an older deployment —
   * a classified failure with a truer thing to say. Everything the classifier
   * does not own must be collected, which is what these assert.
   */
  it("discloses a failed project read instead of reporting an empty portfolio", async () => {
    projectsOrderMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table projects" },
    });

    await renderPage();

    expect(screen.getByText(/could not read this workspace's projects/i)).toBeInTheDocument();
    expect(screen.getByText(/would not mean the records are absent/i)).toBeInTheDocument();
  });

  it("discloses a failed award read, which the pending-column retry does not own", async () => {
    fundingAwardsOrderMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table funding_awards" },
    });

    await renderPage();

    expect(screen.getByText(/could not read this workspace's funding awards/i)).toBeInTheDocument();
  });

  it("stays silent when every read succeeded", async () => {
    await renderPage();

    expect(screen.queryByText(/This page could not read/i)).toBeNull();
  });
});