import { render, screen } from "@testing-library/react";
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
          generated_at: "2026-03-28T20:00:00.000Z",
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
      ],
      error: null,
    });

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

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("surfaces report packet health on project cards", async () => {
    await renderPage();

    expect(screen.getByText(/1 project with report attention/i)).toBeInTheDocument();
    expect(
      screen.getByText(/1 project with evidence-backed packets/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 governance hold surfaced/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Report packet posture/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Downtown Safety Packet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Next action: open this report and regenerate the packet\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Blocked gate: G02/i)).toBeInTheDocument();
    expect(screen.getByText(/No report records linked yet\./i)).toBeInTheDocument();
  });
});
