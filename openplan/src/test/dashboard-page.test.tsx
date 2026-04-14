import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn(() => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const runsLimitMock = vi.fn();
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsEqMock = vi.fn(() => ({ order: runsOrderMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "runs") {
    return { select: runsSelectMock };
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

import DashboardPage from "@/app/(app)/dashboard/page";

async function renderPage() {
  render(await DashboardPage());
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
  });
});
