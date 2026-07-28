import { render, screen } from "@testing-library/react";
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
  }: {
    workspaceId: string;
    canManage: boolean;
  }) => (
    <div
      data-testid="workspace-integration-keys-panel"
      data-workspace-id={workspaceId}
      data-can-manage={String(canManage)}
    />
  ),
}));

import DashboardPage from "@/app/(app)/dashboard/page";

async function renderPage() {
  render(await DashboardPage());
}

function expectLinkByHref(name: RegExp, href: string) {
  const link = screen
    .getAllByRole("link", { name })
    .find((element) => element.getAttribute("href") === href);

  expect(link).toBeDefined();
  expect(link).toHaveAttribute("href", href);
}

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
        moduleLabel: "Grants OS",
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
          moduleLabel: "Grants OS",
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
          moduleLabel: "Grants OS",
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

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("surfaces grants-routed RTP follow-through as the lead dashboard action", async () => {
    await renderPage();

    const quickAction = screen.getByRole("link", { name: /Open RTP grants follow-through/i });
    expect(quickAction).toHaveAttribute("href", "/grants#grants-gap-resolution-lane");
    expect(screen.getAllByText(/Grants OS follow-through/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Current RTP packet work is now a Grants OS follow-through lane/i)).toBeInTheDocument();
    expect(screen.getByText(/Analysis API accepts schema-checked corridor scoring requests/i)).toBeInTheDocument();
    expect(screen.queryByText(/validated corridor scoring requests/i)).not.toBeInTheDocument();
    expect(screen.getByText("Workflow spine")).toBeInTheDocument();
    expect(
      screen.getByText("The shortest complete path through OpenPlan — from context to a board-ready packet.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/supervised pilot/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Project or county context/i })).toHaveAttribute("href", "/projects");
    expectLinkByHref(/Packet assembly/i, "/reports");
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
    expect(screen.getByRole("link", { name: /Open Reports Surface/i })).toHaveAttribute("href", "/reports");
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
        moduleLabel: "Grants OS",
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
          moduleLabel: "Grants OS",
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
          moduleLabel: "Grants OS",
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
    expect(screen.getByRole("link", { name: /Open Grants Surface/i })).toHaveAttribute(
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
    await renderPage();

    const panel = screen.getByTestId("workspace-integration-keys-panel");
    expect(panel).toHaveAttribute("data-workspace-id", "workspace-1");
    expect(panel).toHaveAttribute("data-can-manage", "true");
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
});
