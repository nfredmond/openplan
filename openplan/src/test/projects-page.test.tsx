import { render, screen } from "@testing-library/react";
import { within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const projectsOrderMock = vi.fn();
const projectsEqMock = vi.fn(() => ({ order: projectsOrderMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

const reportsOrderMock = vi.fn();
const reportsInMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsSelectMock = vi.fn(() => ({ in: reportsInMock }));

const projectRtpLinksInMock = vi.fn();
const projectRtpLinksSelectMock = vi.fn(() => ({ in: projectRtpLinksInMock }));

const reportArtifactsOrderMock = vi.fn();
const reportArtifactsInMock = vi.fn(() => ({ order: reportArtifactsOrderMock }));
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const aerialMissionsInMock = vi.fn();
const aerialMissionsSelectMock = vi.fn(() => ({ in: aerialMissionsInMock }));

const aerialPackagesInMock = vi.fn();
const aerialPackagesSelectMock = vi.fn(() => ({ in: aerialPackagesInMock }));

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
  if (table === "aerial_missions") {
    return { select: aerialMissionsSelectMock };
  }
  if (table === "aerial_evidence_packages") {
    return { select: aerialPackagesSelectMock };
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

vi.mock("@/components/workspaces/workspace-membership-required", () => ({
  WorkspaceMembershipRequired: () => <div data-testid="workspace-membership-required" />,
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

import ProjectsPage from "@/app/(app)/projects/page";

async function renderPage() {
  render(await ProjectsPage({ searchParams: Promise.resolve({}) }));
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

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: "workspace-1", role: "owner" },
      workspace: { id: "workspace-1", name: "OpenPlan QA", plan: "pilot" },
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
    aerialMissionsInMock.mockResolvedValue({ data: [], error: null });
    aerialPackagesInMock.mockResolvedValue({ data: [], error: null });

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


  it("scopes the project registry to the helper-selected current workspace", async () => {
    await renderPage();

    expect(loadCurrentWorkspaceMembershipMock).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(projectsEqMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
  });

  it("shows the supervised pilot workspace gate when no membership exists", async () => {
    loadCurrentWorkspaceMembershipMock.mockResolvedValueOnce({ membership: null, workspace: null });

    await renderPage();

    expect(screen.getByTestId("workspace-membership-required")).toBeInTheDocument();
    expect(projectsEqMock).not.toHaveBeenCalled();
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
      screen.getAllByText(/operators should refresh the supporting packet before leaning on it for final pursue language/i).length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Grant release review/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Suggested Monitor/i)).toBeInTheDocument();
    expect(screen.getByText(/Suggested Pursue/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/not proof of award likelihood or a replacement for funding-source review/i).length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/No report records linked yet\./i).length).toBeGreaterThan(0);
  });

  /**
   * A READ THAT FAILED MAY NOT BE RENDERED AS AN ANSWER.
   *
   * `const { data: projectsData } = await supabase…` gave `null` for both "this
   * workspace has no projects" and "the query failed", and the registry then
   * rendered "No project records yet. Create your first project" — an agency
   * being told it has no portfolio, and invited to duplicate work that already
   * exists — on the strength of a broken query.
   *
   * The success-with-nothing case is asserted alongside each failure, because
   * without it a page that always warns would pass every assertion here.
   */
  describe("a failed read is disclosed, never rendered as an answer", () => {
    it("does not say 'No project records yet' when the portfolio read FAILED", async () => {
      projectsOrderMock.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied for table projects" },
      });

      await renderPage();

      expect(screen.queryByText(/No project records yet\./i)).toBeNull();
      expect(
        screen.getByText(/The project registry could not be read, so this list is unavailable/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/Part of this page could not be read/i)).toBeInTheDocument();
      expect(screen.getByText(/This page could not read project records\./i)).toBeInTheDocument();
      // Internal page: the operator gets the database's own message.
      expect(screen.getByText(/permission denied for table projects/i)).toBeInTheDocument();
    });

    it("still says 'No project records yet' when the read SUCCEEDS and the workspace is empty", async () => {
      projectsOrderMock.mockResolvedValueOnce({ data: [], error: null });

      await renderPage();

      expect(screen.getByText(/No project records yet\./i)).toBeInTheDocument();
      // No disclosure anywhere — otherwise the banner above proves nothing.
      expect(screen.queryByText(/Part of this page could not be read/i)).toBeNull();
      expect(screen.queryByText(/could not be read, so this list is unavailable/i)).toBeNull();
    });

    it("does not say 'No report records linked yet' when the reports read FAILED", async () => {
      reportsOrderMock.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied for table reports" },
      });

      await renderPage();

      expect(screen.queryAllByText(/No report records linked yet\./i)).toEqual([]);
      expect(
        screen.getAllByText(/Linked report records could not be read for this project/i).length
      ).toBeGreaterThan(0);
      expect(screen.getByText(/could not read linked report records\./i)).toBeInTheDocument();
      // The Reports chip must not assert zero either.
      expect(screen.queryByText("First action: create the first report packet")).toBeNull();
    });

    /**
     * THE HEADER TILES ARE THE LOUDEST CLAIM ON THE PAGE.
     *
     * Fixing the empty-state SENTENCE is only half of it. When the portfolio
     * read fails, `projects` is `[]`, and the summary grid at the top of the
     * page renders "Projects 0", "Active 0", "Plan types 0" and a row of zeroed
     * chips — eight confident numbers about an agency's portfolio, in the
     * largest type on the screen, derived from rows that never arrived. A
     * planner who reads "0" stops looking; that is the reassuring direction of
     * the error. The detail page already renders its unreadable counts as "—",
     * and these must do the same.
     */
    /**
     * "Projects" also appears in the breadcrumb and the intro copy, so the tile
     * has to be located by the label element the summary grid actually uses
     * rather than by the first text match.
     */
    function summaryTile(label: string): HTMLElement {
      const labelNode = screen
        .getAllByText(label)
        .find((node) => node.className.includes("module-summary-label"));
      if (!labelNode) throw new Error(`no summary tile labelled ${label}`);
      return labelNode.closest("div") as HTMLElement;
    }

    function recordChip(label: string): HTMLElement {
      const labelNode = screen
        .getAllByText(label)
        .find((node) => node.closest("div")?.className.includes("module-record-chip"));
      if (!labelNode) throw new Error(`no record chip labelled ${label}`);
      return labelNode.closest("div") as HTMLElement;
    }

    it("shows the portfolio tiles as unknown, not as zero, when the projects read FAILED", async () => {
      projectsOrderMock.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied for table projects" },
      });

      await renderPage();

      for (const label of ["Projects", "Active", "Plan types"]) {
        const tile = summaryTile(label);
        expect(within(tile).getByText("—")).toBeInTheDocument();
        expect(within(tile).queryByText("0")).toBeNull();
      }

      expect(within(recordChip("RTP-linked")).getByText("—")).toBeInTheDocument();
    });

    it("still shows a real zero in the tiles when the read SUCCEEDS and the workspace is empty", async () => {
      projectsOrderMock.mockResolvedValueOnce({ data: [], error: null });

      await renderPage();

      const tile = summaryTile("Projects");
      expect(within(tile).getByText("0")).toBeInTheDocument();
      expect(within(tile).queryByText("—")).toBeNull();
    });

    it("does not zero the report chips when the REPORTS read failed", async () => {
      reportsOrderMock.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied for table reports" },
      });

      await renderPage();

      for (const label of ["Report attention", "Evidence-backed", "Comparison-backed", "Governance hold"]) {
        const chip = recordChip(label);
        expect(within(chip).getByText("—")).toBeInTheDocument();
        expect(within(chip).queryByText("0")).toBeNull();
      }
    });

    it("does not tell a planner to generate a packet when the ARTIFACT read failed", async () => {
      // Every packet looks ungenerated when the artifact list cannot be read,
      // which the freshness rules turn into "First action: generate <report>" —
      // an instruction to redo work that may already exist.
      reportArtifactsOrderMock.mockResolvedValueOnce({
        data: null,
        error: { message: "permission denied for table report_artifacts" },
      });

      await renderPage();

      expect(screen.getByText(/Part of this page could not be read/i)).toBeInTheDocument();
      expect(
        screen.getByText(/could not read report packet artifacts\./i)
      ).toBeInTheDocument();
    });
  });
});
