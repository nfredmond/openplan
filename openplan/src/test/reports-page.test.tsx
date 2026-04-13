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

const reportsOrderMock = vi.fn();
const reportsSelectMock = vi.fn(() => ({ order: reportsOrderMock }));

const projectsOrderMock = vi.fn();
const projectsSelectMock = vi.fn(() => ({ order: projectsOrderMock }));

const runsLimitMock = vi.fn();
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsSelectMock = vi.fn(() => ({ order: runsOrderMock }));

const reportArtifactsOrderMock = vi.fn();
const reportArtifactsInMock = vi.fn(() => ({ order: reportArtifactsOrderMock }));
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "projects") {
    return { select: projectsSelectMock };
  }
  if (table === "runs") {
    return { select: runsSelectMock };
  }
  if (table === "report_artifacts") {
    return { select: reportArtifactsSelectMock };
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

vi.mock("@/components/reports/report-creator", () => ({
  ReportCreator: () => <div data-testid="report-creator" />,
}));

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: () => <div data-testid="workspace-command-board" />,
}));

import ReportsPage from "@/app/(app)/reports/page";

async function renderPage() {
  render(await ReportsPage({ searchParams: Promise.resolve({}) }));
}

describe("ReportsPage", () => {
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
      },
      workspace: {
        id: "workspace-1",
        name: "OpenPlan QA",
      },
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      nextCommand: null,
      nextActions: [],
    });

    reportsOrderMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          workspace_id: "workspace-1",
          project_id: "project-1",
          rtp_cycle_id: null,
          title: "Artifact-backed report",
          report_type: "project_status",
          status: "generated",
          summary: "Report with a real packet artifact.",
          generated_at: null,
          latest_artifact_kind: "html",
          created_at: "2026-03-28T18:00:00.000Z",
          updated_at: "2026-03-28T21:10:00.000Z",
          projects: {
            id: "project-1",
            name: "Downtown Mobility Plan",
          },
          rtp_cycles: null,
        },
      ],
      error: null,
    });

    projectsOrderMock.mockResolvedValue({
      data: [
        {
          id: "project-1",
          workspace_id: "workspace-1",
          name: "Downtown Mobility Plan",
        },
      ],
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
              evidenceChainSummary: {
                linkedRunCount: 2,
                scenarioSetLinkCount: 1,
                projectRecordGroupCount: 2,
                totalProjectRecordCount: 4,
                engagementLabel: "Active",
                engagementItemCount: 3,
                engagementReadyForHandoffCount: 2,
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

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("keeps artifact-backed reports in regenerate posture when report generated_at is null", async () => {
    await renderPage();

    expect(screen.getAllByText(/Artifact-backed report/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Refresh recommended/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Action Next action: open this report and regenerate the packet\./i).length
    ).toBeGreaterThan(0);

    const reportLink = screen.getAllByText(/Artifact-backed report/i)[0]?.closest("a");
    expect(reportLink).toHaveAttribute("href", "/reports/report-1#drift-since-generation");
    expect(screen.queryByText(/Action Next action: open this report and generate the first packet\./i)).not.toBeInTheDocument();
  });
});
