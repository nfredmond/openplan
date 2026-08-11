import { render, screen, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const runsLimitMock = vi.fn();
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsEqMock = vi.fn(() => ({ order: runsOrderMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock }));

const modelRunsRowsMock = vi.fn(() => ({ data: [] as unknown[], error: null }));

// The recent-actions audit feed the dashboard absorbed from the retired
// Command Center page (loadRecentActionExecutionsForWorkspace).
const actionLimitMock = vi.fn(() => ({ data: [] as unknown[], error: null }));
const actionOrderMock = vi.fn(() => ({ limit: actionLimitMock }));
const actionEqMock = vi.fn(() => ({ order: actionOrderMock }));
const actionSelectMock = vi.fn(() => ({ eq: actionEqMock }));

// The workspace's home geography, as the page reads it server-side. `null` is
// the honest unset state a fresh workspace is in.
const homeGeographyRowMock = vi.fn<() => { data: unknown; error: unknown }>(() => ({
  data: null,
  error: null,
}));
const workspacesSelectMock = vi.fn((columns: string) => {
  void columns;
  return { eq: () => ({ maybeSingle: async () => homeGeographyRowMock() }) };
});

const fromMock = vi.fn((table: string) => {
  if (table === "runs") {
    return { select: runsSelectMock };
  }

  // Deployment health observes this workspace's in-flight model runs to say
  // whether the modeling worker is picking work up.
  if (table === "model_runs") {
    return {
      select: () => ({ eq: () => ({ in: async () => modelRunsRowsMock() }) }),
    };
  }

  if (table === "workspaces") {
    return { select: workspacesSelectMock };
  }

  if (table === "assistant_action_executions") {
    return { select: actionSelectMock };
  }

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

// Whether an Anthropic key resolves for the workspace (stored key OR
// deployment env) — the page reads it through the SAME helper every AI route
// uses. The context wrapper is pass-through here so the resolution can be
// varied per test without a service-role client.
const hasAnthropicAccessMock = vi.fn(() => false);
vi.mock("@/lib/integrations/anthropic-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/anthropic-access")>(
    "@/lib/integrations/anthropic-access"
  );
  return { ...actual, hasAnthropicAccess: () => hasAnthropicAccessMock() };
});
vi.mock("@/lib/integrations/workspace-keys", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/workspace-keys")>(
    "@/lib/integrations/workspace-keys"
  );
  return {
    ...actual,
    withWorkspaceIntegrationContext: async (_workspaceId: string, fn: () => Promise<unknown>) =>
      fn(),
  };
});

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

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: ({ children }: { children?: ReactNode }) => (
    <div>
      <div data-testid="workspace-command-board" />
      {children}
    </div>
  ),
}));

vi.mock("@/components/runs/RunHistory", () => ({
  RunHistory: () => <div data-testid="run-history" />,
}));

vi.mock("@/components/workspaces/workspace-membership-required", () => ({
  WorkspaceMembershipRequired: () => <div data-testid="workspace-membership-required" />,
}));

// Reachability guard. The workspace home geography had a schema, an API, and
// four readers before it had any way to be SET — see
// src/test/workspace-geography-panel.test.tsx. Recording the props here means a
// future refactor cannot quietly unmount the setter and re-dark that spine.
vi.mock("@/components/workspaces/workspace-geography-panel", () => ({
  WorkspaceGeographyPanel: ({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) => (
    <div
      data-testid="workspace-geography-panel"
      data-workspace-id={workspaceId}
      data-can-manage={String(canManage)}
    />
  ),
}));

vi.mock("@/components/workspaces/workspace-team-panel", () => ({
  WorkspaceTeamPanel: ({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) => (
    <div
      data-testid="workspace-team-panel"
      data-workspace-id={workspaceId}
      data-can-manage={String(canManage)}
    />
  ),
}));

vi.mock("@/components/workspaces/workspace-integration-keys-panel", () => ({
  WorkspaceIntegrationKeysPanel: ({
    workspaceId,
    canManage,
    providerIds,
  }: {
    workspaceId: string;
    canManage: boolean;
    providerIds?: string[];
  }) => (
    <div
      data-testid="workspace-integration-keys-panel"
      data-workspace-id={workspaceId}
      data-can-manage={String(canManage)}
      data-provider-ids={providerIds ? providerIds.join(",") : "all"}
    />
  ),
}));

import DashboardPage from "@/app/(app)/dashboard/page";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";

async function renderPage(searchParams?: Record<string, string | string[] | undefined>) {
  render(
    await DashboardPage(searchParams ? { searchParams: Promise.resolve(searchParams) } : {})
  );
}

/**
 * The operations summary a workspace with exactly two rows produces — one
 * `workspaces` row and one `workspace_members` row, which is what the
 * handle_new_user trigger leaves behind at sign-up. Built by the real builder
 * from empty source rows rather than hand-written zeros, so the fixture cannot
 * drift from what an actually-empty workspace yields.
 */
function emptyWorkspaceSummary() {
  return buildWorkspaceOperationsSummaryFromSourceRows({
    projects: [],
    plans: [],
    programs: [],
    reports: [],
    fundingOpportunities: [],
  });
}

/**
 * Developer changelog lines that used to be rendered as workspace content under
 * a "Baseline" heading. They described the repository, not the workspace, and
 * at least one of them ("Core layers now use GTFS, crashes, Census, and LODES
 * inputs.") was flatly untrue of an empty workspace with no Census key. They
 * are deleted; this list keeps them deleted.
 */
const RETIRED_BASELINE_CHANGELOG_LINES = [
  /Supabase auth flow is live for sign-up, sign-in, and protected routes/i,
  /Analysis API accepts schema-checked corridor scoring requests/i,
  /Runs persist and reload cleanly at workspace scope/i,
  /Report endpoint returns structured HTML \/ PDF-ready output/i,
  /Core layers now use GTFS, crashes, Census, and LODES inputs/i,
  /KPI instrumentation tracks completion, reporting, and time-to-first-result/i,
];

describe("DashboardPage", () => {
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
        plan: "pilot",
        created_at: "2026-04-01T18:00:00.000Z",
      },
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      posture: "attention",
      headline: "Run release review on current packets",
      detail: "A current RTP packet still carries linked-project funding follow-up.",
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 1,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        reportPacketCurrent: 1,
        rtpFundingReviewPackets: 1,
        comparisonBackedReports: 0,
        fundingOpportunities: 1,
        openFundingOpportunities: 1,
        closingSoonFundingOpportunities: 0,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        queueDepth: 1,
      },
      nextCommand: {
        key: "review-current-report-packets",
        moduleKey: "grants",
        moduleLabel: "Grants",
        title: "Run release review on current packets",
        detail: "1 current RTP packet still carries funding follow-up from linked projects.",
        href: "/grants#grants-gap-resolution-lane",
        tone: "warning",
        priority: 2.5,
        badges: [
          { label: "Current", value: 1 },
          { label: "Funding review", value: 1 },
        ],
      },
      commandQueue: [
        {
          key: "review-current-report-packets",
          moduleKey: "grants",
          moduleLabel: "Grants",
          title: "Run release review on current packets",
          detail: "1 current RTP packet still carries funding follow-up from linked projects.",
          href: "/grants#grants-gap-resolution-lane",
          tone: "warning",
          priority: 2.5,
          badges: [
            { label: "Current", value: 1 },
            { label: "Funding review", value: 1 },
          ],
        },
      ],
      fullCommandQueue: [
        {
          key: "review-current-report-packets",
          moduleKey: "grants",
          moduleLabel: "Grants",
          title: "Run release review on current packets",
          detail: "1 current RTP packet still carries funding follow-up from linked projects.",
          href: "/grants#grants-gap-resolution-lane",
          tone: "warning",
          priority: 2.5,
          badges: [
            { label: "Current", value: 1 },
            { label: "Funding review", value: 1 },
          ],
        },
      ],
    });

    runsLimitMock.mockResolvedValue({ data: [], error: null });
    homeGeographyRowMock.mockReturnValue({ data: null, error: null });
    // Default: no Anthropic key resolves — the honest state of a fresh
    // deployment with no env key and no stored workspace key.
    hasAnthropicAccessMock.mockReturnValue(false);

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  /**
   * FINDING (2026-08-10): the checklist used to require zero
   * projects/plans/programs/reports/runs, so creating ONE project removed it
   * permanently — even with the home geography, the one setting the rest of
   * the app reads, still unset. Activity is not the same as being set up.
   */
  it("keeps the getting-started checklist on an active workspace whose geography is unset", async () => {
    // The default beforeEach summary has 1 project and 1 report — real
    // activity — and the default geography row is null (unset).
    await renderPage();

    expect(screen.getByText("Tell OpenPlan where you work")).toBeInTheDocument();
    expect(screen.getByText("Start here")).toBeInTheDocument();
    // Quick actions still render for an active workspace; the checklist and
    // the workspace's real lead actions are not mutually exclusive.
    expect(screen.getByText("Quick actions")).toBeInTheDocument();
  });

  it("links the getting-started card to the Help page", async () => {
    await renderPage();

    expect(screen.getByRole("link", { name: /Help page/ })).toHaveAttribute("href", "/help");
  });

  it("shows the recent-actions audit feed absorbed from the retired Command Center", async () => {
    await renderPage();

    expect(screen.getByText("Assistant action activity")).toBeInTheDocument();
    expect(actionEqMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
  });

  describe("sign-up intent", () => {
    it("adds the public-comment-campaign step for an engagement arrival", async () => {
      await renderPage({ intent: "engagement" });

      expect(screen.getByText("Start a public comment campaign")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Open Engagement/ })).toHaveAttribute(
        "href",
        "/engagement"
      );
    });

    it("shows no engagement step without the intent, and ignores unknown intents", async () => {
      await renderPage({ intent: "sell-me-something" });

      expect(screen.queryByText("Start a public comment campaign")).not.toBeInTheDocument();
    });
  });

  it("surfaces grants-routed RTP follow-through as the lead dashboard action", async () => {
    await renderPage();

    const quickAction = screen.getByRole("link", { name: /Open RTP grants follow-through/i });
    expect(quickAction).toHaveAttribute("href", "/grants#grants-gap-resolution-lane");
    expect(screen.getAllByText(/funding sorted out in Grants/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/An RTP packet being current is not the same as being finished/i)).toBeInTheDocument();
    expect(screen.queryByText(/supervised pilot/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Projects Module/i })).toHaveAttribute("href", "/projects");
  });

  it("no longer renders the developer changelog lines as workspace content", async () => {
    await renderPage();

    for (const line of RETIRED_BASELINE_CHANGELOG_LINES) {
      expect(screen.queryByText(line)).not.toBeInTheDocument();
    }
    expect(screen.queryByText("Baseline")).not.toBeInTheDocument();
  });

  it("no longer renders the static workflow-spine ladder alongside quick actions", async () => {
    await renderPage();

    // The four-step spine was a fixed tour whose destinations quick actions
    // already cover, and unlike quick actions it could not name this
    // workspace's real lead action. PilotWorkflowHandoff itself survives on
    // project and report detail pages, where it carries a real record id.
    expect(screen.queryByText("Workflow spine")).not.toBeInTheDocument();
    expect(
      screen.queryByText("The shortest complete path through OpenPlan — from context to a board-ready packet.")
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Project or county context/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Packet assembly/i })).not.toBeInTheDocument();

    expect(screen.getByText("Quick actions")).toBeInTheDocument();
  });

  it("surfaces comparison-backed report posture as planning support in dashboard copy", async () => {
    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValueOnce({
      posture: "active",
      headline: "Review comparison-backed packet posture",
      detail: "Comparison-backed packet posture is visible in the workspace queue.",
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 1,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        reportPacketCurrent: 0,
        rtpFundingReviewPackets: 0,
        comparisonBackedReports: 1,
        fundingOpportunities: 1,
        openFundingOpportunities: 1,
        closingSoonFundingOpportunities: 0,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        queueDepth: 1,
      },
      nextCommand: {
        key: "review-comparison-backed-reports",
        title: "Review comparison-backed packet posture",
        detail:
          "1 report carries saved comparison context that can support grant planning language or prioritization framing while shaping refresh and narrative choices. Treat it as planning support, not proof of award likelihood or a replacement for funding-source review.",
        href: "/reports?posture=comparison-backed",
        tone: "info",
        priority: 9,
        badges: [{ label: "Comparison-backed", value: 1 }],
      },
      commandQueue: [
        {
          key: "review-comparison-backed-reports",
          title: "Review comparison-backed packet posture",
          detail:
            "1 report carries saved comparison context that can support grant planning language or prioritization framing while shaping refresh and narrative choices. Treat it as planning support, not proof of award likelihood or a replacement for funding-source review.",
          href: "/reports?posture=comparison-backed",
          tone: "info",
          priority: 9,
          badges: [{ label: "Comparison-backed", value: 1 }],
        },
      ],
      fullCommandQueue: [
        {
          key: "review-comparison-backed-reports",
          title: "Review comparison-backed packet posture",
          detail:
            "1 report carries saved comparison context that can support grant planning language or prioritization framing while shaping refresh and narrative choices. Treat it as planning support, not proof of award likelihood or a replacement for funding-source review.",
          href: "/reports?posture=comparison-backed",
          tone: "info",
          priority: 9,
          badges: [{ label: "Comparison-backed", value: 1 }],
        },
      ],
    });

    await renderPage();

    expect(
      screen.getAllByText(/comparison-backed report packet can support grant planning language or prioritization framing/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/not proof of award likelihood or a replacement for funding-source review/i).length
    ).toBeGreaterThan(0);
    // Pins the planner-voiced title: starts with "Open Reports" and is not the
    // old dev-voiced "Open Reports Surface".
    expect(screen.getByRole("link", { name: /^Open Reports\b(?! Surface)/ })).toHaveAttribute("href", "/reports");
  });

  it("explains why modeling-ready grant decisions are rising from the dashboard overview", async () => {
    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValueOnce({
      posture: "attention",
      headline: "Advance project funding decisions",
      detail: "Modeled funding decisions are rising in the grants queue.",
      counts: {
        projects: 2,
        activeProjects: 2,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 1,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        reportPacketCurrent: 1,
        rtpFundingReviewPackets: 0,
        comparisonBackedReports: 1,
        fundingOpportunities: 2,
        openFundingOpportunities: 2,
        closingSoonFundingOpportunities: 1,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 1,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        queueDepth: 1,
      },
      grantModelingSummary: {
        breakdown: {
          decisionReady: 1,
          refreshRecommended: 0,
          thin: 0,
          noVisibleSupport: 1,
        },
        breakdownSummary:
          "2 opportunity-linked projects: 1 appears decision-ready, 0 refresh recommended, 0 appears thin, 1 without visible support.",
        operatorDetail:
          "Within grant decision work, opportunity-linked projects with modeling support that appears decision-ready rise ahead of refresh-recommended, thin, or unsupported work. Across 2 opportunity-linked projects: 1 appears decision-ready, 0 refresh recommended, 0 appears thin, 1 without visible support. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.",
        leadDecisionDetail:
          "ATP Cycle 8 for Modeled Project is rising because modeling posture appears decision-ready. Grant Strategy Packet is the lead packet to review. Recommended next move: Advance to pursue now. Grant Strategy Packet appears decision-ready, so operators can advance this opportunity to pursue now while the packet is current. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.",
      },
      nextCommand: {
        key: "advance-project-funding-decisions",
        moduleKey: "grants",
        moduleLabel: "Grants",
        title: "Advance project funding decisions",
        detail: "1 project funding stack has linked opportunities but nothing marked pursue yet.",
        href: "/projects/project-1#project-funding-opportunities",
        targetProjectId: "project-1",
        targetProjectName: "Modeled Project",
        targetOpportunityId: "opp-1",
        tone: "warning",
        priority: 5,
        badges: [
          { label: "Decision gaps", value: 1 },
          { label: "Modeling", value: "Appears decision-ready" },
          { label: "Next move", value: "Advance to pursue now" },
        ],
      },
      commandQueue: [
        {
          key: "advance-project-funding-decisions",
          moduleKey: "grants",
          moduleLabel: "Grants",
          title: "Advance project funding decisions",
          detail: "1 project funding stack has linked opportunities but nothing marked pursue yet.",
          href: "/projects/project-1#project-funding-opportunities",
          targetProjectId: "project-1",
          targetProjectName: "Modeled Project",
          targetOpportunityId: "opp-1",
          tone: "warning",
          priority: 5,
          badges: [
            { label: "Decision gaps", value: 1 },
            { label: "Modeling", value: "Appears decision-ready" },
            { label: "Next move", value: "Advance to pursue now" },
          ],
        },
      ],
      fullCommandQueue: [
        {
          key: "advance-project-funding-decisions",
          moduleKey: "grants",
          moduleLabel: "Grants",
          title: "Advance project funding decisions",
          detail: "1 project funding stack has linked opportunities but nothing marked pursue yet.",
          href: "/projects/project-1#project-funding-opportunities",
          targetProjectId: "project-1",
          targetProjectName: "Modeled Project",
          targetOpportunityId: "opp-1",
          tone: "warning",
          priority: 5,
          badges: [
            { label: "Decision gaps", value: 1 },
            { label: "Modeling", value: "Appears decision-ready" },
            { label: "Next move", value: "Advance to pursue now" },
          ],
        },
      ],
    });

    await renderPage();

    expect(
      screen.getByText(/opportunity-linked projects with modeling support that appears decision-ready rise ahead of refresh-recommended, thin, or unsupported work/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ATP Cycle 8 for Modeled Project is rising because modeling posture appears decision-ready/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Recommended next move: Advance to pursue now/i)).toBeInTheDocument();
    // Pins the planner-voiced title: starts with "Open Grants" and is not the
    // old dev-voiced "Open Grants Surface".
    expect(screen.getByRole("link", { name: /^Open Grants\b(?! Surface)/ })).toHaveAttribute(
      "href",
      "/grants?focusOpportunityId=opp-1#funding-opportunity-opp-1"
    );
  });

  it("mounts a home-geography setter so the geography spine is reachable", async () => {
    await renderPage();

    const panel = screen.getByTestId("workspace-geography-panel");
    expect(panel).toHaveAttribute("data-workspace-id", "workspace-1");
    expect(panel).toHaveAttribute("data-can-manage", "true");
  });

  it("mounts the integration-keys setup panel so keys can actually be configured", async () => {
    // Default state resolves no AI key, so the panel is mounted twice: the
    // Anthropic row hoisted into the checklist's AI step, and the remaining
    // providers in the config row. Every mount carries the workspace binding.
    await renderPage();

    const panels = screen.getAllByTestId("workspace-integration-keys-panel");
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) {
      expect(panel).toHaveAttribute("data-workspace-id", "workspace-1");
      expect(panel).toHaveAttribute("data-can-manage", "true");
    }
  });

  it("tells an owner which capabilities configuration has switched off", async () => {
    // The test environment sets no Mapbox token, so maps are unavailable — the
    // panel must say so rather than leaving blank maps unexplained.
    await renderPage();

    expect(screen.getByLabelText(/deployment configuration/i)).toBeInTheDocument();
    expect(
      screen.getByText(/settings of this OpenPlan deployment, not limits of your data or your area/i)
    ).toBeInTheDocument();
  });

  it("does not offer geography or team management to a plain member", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValueOnce({
      membership: { workspace_id: "workspace-1", role: "member" },
      workspace: {
        id: "workspace-1",
        name: "OpenPlan QA",
        plan: "pilot",
        created_at: "2026-04-01T18:00:00.000Z",
      },
    });

    await renderPage();

    // The panel is still rendered — a member must be able to SEE the workspace's
    // geography, because an unset one changes every map they look at — but the
    // write affordance is withheld here and refused by the API.
    expect(screen.getByTestId("workspace-geography-panel")).toHaveAttribute("data-can-manage", "false");
    expect(screen.getByTestId("workspace-team-panel")).toHaveAttribute("data-can-manage", "false");
    expect(screen.getByTestId("workspace-integration-keys-panel")).toHaveAttribute("data-can-manage", "false");
    // Deployment configuration is operator information a member cannot act on.
    expect(screen.queryByLabelText(/deployment configuration/i)).not.toBeInTheDocument();
  });

  /**
   * First run: a workspace with exactly two rows — one `workspaces` row and one
   * `workspace_members` row — which is what sign-up leaves behind. Everything
   * the dashboard says in this state has to be true of it.
   */
  describe("first run", () => {
    const SET_HOME_GEOGRAPHY_ROW = {
      home_geography_source: "tigerweb",
      home_geography_kind: "county",
      home_geography_ref: "00000",
      home_geography_label: "Example County, Example State",
      home_country_code: "US",
    };

    async function renderFirstRun(options?: { role?: string; homeGeographyRow?: unknown }) {
      loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValueOnce(emptyWorkspaceSummary());

      if (options?.role) {
        loadCurrentWorkspaceMembershipMock.mockResolvedValueOnce({
          membership: { workspace_id: "workspace-1", role: options.role },
          workspace: {
            id: "workspace-1",
            name: "OpenPlan QA",
            created_at: "2026-04-01T18:00:00.000Z",
          },
        });
      }

      if (options?.homeGeographyRow !== undefined) {
        homeGeographyRowMock.mockReturnValueOnce({ data: options.homeGeographyRow, error: null });
      }

      await renderPage();
    }

    function firstRunHero(): HTMLElement {
      const hero = screen.getByRole("heading", { name: /Set up OpenPlan QA/ }).closest("div");
      expect(hero).not.toBeNull();
      return hero as HTMLElement;
    }

    it("shows the geography step and hoists its setter when no place is set", async () => {
      await renderFirstRun();

      // The geography step is outstanding and says so. (Emphasis sits on the
      // AI-key step, which is also outstanding and comes first.)
      expect(screen.getByText("Tell OpenPlan where you work")).toBeInTheDocument();
      expect(screen.getByText("Start here")).toBeInTheDocument();
      expect(
        screen.getByText(/Not set\. Choose the county, city, CDP, or metro area you plan for, below\./)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Maps, jurisdiction rules, equity data, and study-area defaults across OpenPlan all read this one setting/)
      ).toBeInTheDocument();

      // The setter itself sits inside the first-run hero, next to the step that
      // asks for it — and is mounted EXACTLY once, because it self-fetches.
      const panels = screen.getAllByTestId("workspace-geography-panel");
      expect(panels).toHaveLength(1);
      expect(within(firstRunHero()).getByTestId("workspace-geography-panel")).toBe(panels[0]);
    });

    it("reads only the home-geography identity columns, never the stored boundary polygon", async () => {
      await renderFirstRun();

      expect(workspacesSelectMock).toHaveBeenCalled();
      const columns = workspacesSelectMock.mock.calls[0]?.[0] ?? "";
      expect(columns).toContain("home_geography_source");
      expect(columns).toContain("home_geography_label");
      // The polygon can be megabytes and nothing on this page draws it.
      expect(columns).not.toContain("home_geometry_geojson");
    });

    it("marks the geography step done with the resolved label and returns the panel to the config row", async () => {
      hasAnthropicAccessMock.mockReturnValue(true);
      await renderFirstRun({ homeGeographyRow: SET_HOME_GEOGRAPHY_ROW });

      // AI key and geography are both done; nothing outstanding is emphasized.
      expect(screen.getAllByText("Done")).toHaveLength(2);
      expect(screen.getByText("Set to Example County, Example State.")).toBeInTheDocument();
      expect(screen.queryByText("Start here")).not.toBeInTheDocument();

      // Still exactly one mount, and no longer inside the hero.
      const panels = screen.getAllByTestId("workspace-geography-panel");
      expect(panels).toHaveLength(1);
      expect(within(firstRunHero()).queryByTestId("workspace-geography-panel")).toBeNull();
    });

    it("does not claim a geography is set when the row carries no resolvable source", async () => {
      // A stray label with no source is not a geography — the migration's
      // coherence CHECK says the same thing. It must read as unset.
      await renderFirstRun({
        homeGeographyRow: { home_geography_label: "Example County, Example State" },
      });

      expect(screen.getByText("Start here")).toBeInTheDocument();
      expect(screen.queryByText(/^Set to /)).not.toBeInTheDocument();
    });

    it("leads with the AI step and hoists the Anthropic key row while no key resolves", async () => {
      await renderFirstRun();

      const step = screen.getByText("Turn on your AI assistant").closest("li");
      expect(step).not.toBeNull();
      // First incomplete step in display order carries the one emphasis.
      expect(step!.textContent).toContain("Start here");
      expect(step!.textContent).toMatch(
        /Without a key, the Planner Agent, AI synthesis of public comments, narrative drafting, and comment translation are unavailable/
      );

      // The Anthropic key row is hoisted into the hero, filtered to that one
      // provider; the main panel below keeps the rest, so each provider row is
      // mounted exactly once.
      const hoisted = within(firstRunHero()).getAllByTestId("workspace-integration-keys-panel");
      expect(hoisted).toHaveLength(1);
      expect(hoisted[0]).toHaveAttribute("data-provider-ids", "anthropic");

      const panels = screen.getAllByTestId("workspace-integration-keys-panel");
      expect(panels).toHaveLength(2);
      const main = panels.find((panel) => panel !== hoisted[0]);
      expect(main).toBeDefined();
      expect(main!.getAttribute("data-provider-ids")).not.toBe("all");
      expect(main!.getAttribute("data-provider-ids")).not.toContain("anthropic");
    });

    it("marks the AI step done when a key resolves, with one unfiltered keys panel", async () => {
      hasAnthropicAccessMock.mockReturnValue(true);
      await renderFirstRun();

      const step = screen.getByText("Turn on your AI assistant").closest("li");
      expect(step!.textContent).toContain("Done");
      expect(
        screen.getByText("On — an AI key is available to this workspace.")
      ).toBeInTheDocument();

      const panels = screen.getAllByTestId("workspace-integration-keys-panel");
      expect(panels).toHaveLength(1);
      expect(panels[0]).toHaveAttribute("data-provider-ids", "all");
      expect(within(firstRunHero()).queryByTestId("workspace-integration-keys-panel")).toBeNull();
    });

    it("points the screening step at Corridor Analysis and reports that no runs exist", async () => {
      await renderFirstRun();

      expect(screen.getByText("Run your first screening")).toBeInTheDocument();
      expect(screen.getByText("No analysis runs yet.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Open Corridor Analysis/ })).toHaveAttribute("href", "/explore");
    });

    it("offers the invite step to an owner only", async () => {
      await renderFirstRun();

      expect(screen.getByText("Invite your team")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Open the team panel/ })).toHaveAttribute(
        "href",
        "#workspace-team"
      );
      // The page cannot read who else is in the workspace (workspace_members
      // RLS is own-row only), so the step must not carry a completion claim.
      expect(screen.getByText("Optional")).toBeInTheDocument();
    });

    it("hides the invite step from a plain member, who cannot invite anyone", async () => {
      await renderFirstRun({ role: "member" });

      expect(screen.getByText("Tell OpenPlan where you work")).toBeInTheDocument();
      expect(screen.queryByText("Invite your team")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Open the team panel/ })).not.toBeInTheDocument();
      // A member still sees the state and is told who can change it.
      expect(screen.getByText(/Not set\. A workspace owner or admin can set it\./)).toBeInTheDocument();
    });

    it("shows one path, not four: no goal cards, no quick actions, no changelog", async () => {
      await renderFirstRun();

      // The four navigation goal cards that only called router.push().
      expect(screen.queryByText("Model any place")).not.toBeInTheDocument();
      expect(screen.queryByText("Collect community input")).not.toBeInTheDocument();
      expect(screen.queryByText("Find & write grants")).not.toBeInTheDocument();
      expect(screen.queryByText("Build an RTP")).not.toBeInTheDocument();

      // The second ladder and the third entry-point set.
      expect(screen.queryByText("Workflow spine")).not.toBeInTheDocument();
      expect(screen.queryByText("Quick actions")).not.toBeInTheDocument();

      for (const line of RETIRED_BASELINE_CHANGELOG_LINES) {
        expect(screen.queryByText(line)).not.toBeInTheDocument();
      }
    });
  });
});
