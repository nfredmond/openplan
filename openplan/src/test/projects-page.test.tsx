import { render, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn(() => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();

const projectsOrderMock = vi.fn();
const projectsSelectMock = vi.fn(() => ({ order: projectsOrderMock }));

const reportsOrderMock = vi.fn();
const reportsInMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsSelectMock = vi.fn(() => ({ in: reportsInMock }));

const projectRtpLinksInMock = vi.fn();
const projectRtpLinksSelectMock = vi.fn(() => ({ in: projectRtpLinksInMock }));

const reportArtifactsOrderMock = vi.fn();
const reportArtifactsInMock = vi.fn(() => ({ order: reportArtifactsOrderMock }));
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return { select: projectsSelectMock };
  }
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "project_rtp_cycle_links") {
    return { select: projectRtpLinksSelectMock };
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

vi.mock("@/components/projects/project-workspace-creator", () => ({
  ProjectWorkspaceCreator: () => <div data-testid="project-workspace-creator" />,
}));

import ProjectsPage from "@/app/(app)/projects/page";

async function renderPage() {
  render(await ProjectsPage());
}

describe("ProjectsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    projectsOrderMock.mockResolvedValue({
      data: [
        {
          id: "project-1",
          workspace_id: "workspace-1",
          name: "Downtown Mobility Plan",
          summary: "Corridor safety and access package.",
          status: "active",
          plan_type: "corridor_plan",
          delivery_phase: "analysis",
          created_at: "2026-03-28T18:00:00.000Z",
          updated_at: "2026-03-28T21:10:00.000Z",
          workspaces: {
            name: "OpenPlan QA",
            plan: "starter",
            created_at: "2026-03-28T18:00:00.000Z",
          },
        },
        {
          id: "project-2",
          workspace_id: "workspace-2",
          name: "Uptown Access Study",
          summary: null,
          status: "draft",
          plan_type: "area_plan",
          delivery_phase: "scoping",
          created_at: "2026-03-27T18:00:00.000Z",
          updated_at: "2026-03-27T21:10:00.000Z",
          workspaces: {
            name: "OpenPlan Pilot",
            plan: "pilot",
            created_at: "2026-03-27T18:00:00.000Z",
          },
        },
        {
          id: "project-3",
          workspace_id: "workspace-3",
          name: "Eastside Funding Strategy",
          summary: "Candidate package with modeled alternatives already compared.",
          status: "active",
          plan_type: "grant_strategy",
          delivery_phase: "funding",
          created_at: "2026-03-26T18:00:00.000Z",
          updated_at: "2026-03-26T21:10:00.000Z",
          workspaces: {
            name: "OpenPlan Delivery",
            plan: "pilot",
            created_at: "2026-03-26T18:00:00.000Z",
          },
        },
      ],
      error: null,
    });

    reportsOrderMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          project_id: "project-1",
          title: "Downtown Safety Packet",
          status: "generated",
          updated_at: "2026-03-28T21:10:00.000Z",
          generated_at: null,
          latest_artifact_kind: "html",
        },
        {
          id: "report-2",
          project_id: "project-1",
          title: "Board Packet",
          status: "generated",
          updated_at: "2026-03-28T19:00:00.000Z",
          generated_at: "2026-03-28T19:00:00.000Z",
          latest_artifact_kind: "html",
        },
        {
          id: "report-3",
          project_id: "project-3",
          title: "Eastside Grant Packet",
          status: "generated",
          updated_at: "2026-03-26T21:10:00.000Z",
          generated_at: "2026-03-26T21:10:00.000Z",
          latest_artifact_kind: "html",
        },
      ],
      error: null,
    });

    projectRtpLinksInMock.mockResolvedValue({ data: [], error: null });

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
        {
          report_id: "report-3",
          generated_at: "2026-03-26T21:10:00.000Z",
          metadata_json: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  scenarioSetId: "scenario-set-2",
                  scenarioSetTitle: "Funding alternatives",
                  baselineLabel: "Current package",
                  comparisonSnapshots: [
                    {
                      comparisonSnapshotId: "comparison-2",
                      status: "ready",
                      candidateEntryLabel: "Bundled delivery scenario",
                      indicatorDeltaCount: 3,
                      updatedAt: "2026-03-26T20:55:00.000Z",
                    },
                  ],
                },
              ],
              evidenceChainSummary: {
                linkedRunCount: 1,
                scenarioSetLinkCount: 1,
                projectRecordGroupCount: 1,
                totalProjectRecordCount: 2,
                engagementLabel: "Active",
                engagementItemCount: 2,
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

  it("surfaces report packet health on project cards", async () => {
    await renderPage();

    const reportAttentionChip = screen.getAllByText("Report attention")[0]?.closest("div");
    const evidenceBackedChip = screen.getAllByText("Evidence-backed")[0]?.closest("div");
    const governanceHoldChip = screen.getAllByText("Governance hold")[0]?.closest("div");

    expect(reportAttentionChip).not.toBeNull();
    expect(evidenceBackedChip).not.toBeNull();
    expect(governanceHoldChip).not.toBeNull();

    expect(within(reportAttentionChip as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(within(evidenceBackedChip as HTMLElement).getByText("2")).toBeInTheDocument();
    expect(within(governanceHoldChip as HTMLElement).getByText("1")).toBeInTheDocument();

    expect(screen.getAllByText(/Portfolio packet command/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Downtown Safety Packet/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Next action: open this report and regenerate the packet\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Blocked gate: G02/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/saved comparison context that can support grant planning language or prioritization framing for this project/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/not proof of award likelihood or a replacement for funding-source review/i).length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/No report records linked yet\./i).length).toBeGreaterThan(0);
  });
});
