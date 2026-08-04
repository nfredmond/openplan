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

const programsOrderMock = vi.fn();
const programsEqMock = vi.fn(() => ({ order: programsOrderMock }));
const programsSelectMock = vi.fn(() => ({ eq: programsEqMock }));

const projectsOrderMock = vi.fn();
const projectsEqMock = vi.fn(() => ({ order: projectsOrderMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

const fundingOpportunitiesOrderMock = vi.fn();
const fundingOpportunitiesEqMock = vi.fn(() => ({ order: fundingOpportunitiesOrderMock }));
const fundingOpportunitiesSelectMock = vi.fn(() => ({ eq: fundingOpportunitiesEqMock }));

const workspacePlansOrderMock = vi.fn();
const workspacePlansEqMock = vi.fn(() => ({ order: workspacePlansOrderMock }));
const plansInMock = vi.fn();
const plansSelectMock = vi.fn(() => ({ order: workspacePlansOrderMock, eq: workspacePlansEqMock, in: plansInMock }));

const workspaceReportsOrderMock = vi.fn();
const workspaceReportsEqMock = vi.fn(() => ({ order: workspaceReportsOrderMock }));
const reportsInMock = vi.fn();
const reportsSelectMock = vi.fn(() => ({ order: workspaceReportsOrderMock, eq: workspaceReportsEqMock, in: reportsInMock }));

const projectFundingProfilesEqMock = vi.fn();
const projectFundingProfilesInMock = vi.fn();
const projectFundingProfilesSelectMock = vi.fn(() => ({ eq: projectFundingProfilesEqMock, in: projectFundingProfilesInMock }));

const programLinksInMock = vi.fn();
const programLinksSelectMock = vi.fn(() => ({ in: programLinksInMock }));

const campaignsInMock = vi.fn();
const campaignsSelectMock = vi.fn(() => ({ in: campaignsInMock }));

const reportArtifactsOrderMock = vi.fn();
const reportArtifactsInMock = vi.fn(() => ({ order: reportArtifactsOrderMock }));
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "programs") {
    return { select: programsSelectMock };
  }
  if (table === "projects") {
    return { select: projectsSelectMock };
  }
  if (table === "funding_opportunities") {
    return { select: fundingOpportunitiesSelectMock };
  }
  if (table === "program_links") {
    return { select: programLinksSelectMock };
  }
  if (table === "plans") {
    return { select: plansSelectMock };
  }
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "engagement_campaigns") {
    return { select: campaignsSelectMock };
  }
  if (table === "project_funding_profiles") {
    return { select: projectFundingProfilesSelectMock };
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

vi.mock("@/components/programs/program-creator", () => ({
  ProgramCreator: () => <div data-testid="program-creator" />,
}));

vi.mock("@/components/programs/funding-opportunity-creator", () => ({
  FundingOpportunityCreator: () => <div data-testid="funding-opportunity-creator" />,
}));

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: () => <div data-testid="workspace-command-board" />,
}));

import ProgramsPage from "@/app/(app)/programs/page";

async function renderPage(searchParams: { projectId?: string; programType?: string; status?: string } = {}) {
  render(await ProgramsPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("ProgramsPage", () => {
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

    programsOrderMock.mockResolvedValue({
      data: [
        {
          id: "program-1",
          workspace_id: "workspace-1",
          project_id: "project-1",
          title: "2027 RTIP",
          program_type: "rtip",
          status: "assembling",
          cycle_name: "2027 RTIP",
          funding_classification: "capital",
          sponsor_agency: "County",
          owner_label: "Planner",
          cadence_label: "Quarterly",
          fiscal_year_start: 2027,
          fiscal_year_end: 2029,
          nomination_due_at: null,
          adoption_target_at: null,
          summary: "Programming cycle for capital projects.",
          created_at: "2026-03-28T18:00:00.000Z",
          updated_at: "2026-03-28T21:10:00.000Z",
          projects: {
            id: "project-1",
            name: "Downtown Mobility Plan",
          },
        },
      ],
      error: null,
    });

    programLinksInMock.mockResolvedValue({ data: [], error: null });
    projectsOrderMock.mockResolvedValue({ data: [], error: null });
    fundingOpportunitiesOrderMock.mockResolvedValue({ data: [], error: null });
    workspacePlansOrderMock.mockResolvedValue({ data: [], error: null });
    workspaceReportsOrderMock.mockResolvedValue({ data: [], error: null });
    workspacePlansEqMock.mockReturnValue({ order: workspacePlansOrderMock });
    workspaceReportsEqMock.mockReturnValue({ order: workspaceReportsOrderMock });
    projectFundingProfilesEqMock.mockResolvedValue({ data: [], error: null });
    plansInMock.mockResolvedValue({ data: [], error: null });
    campaignsInMock.mockResolvedValue({ data: [], error: null });
    projectFundingProfilesInMock.mockResolvedValue({ data: [], error: null });

    reportsInMock.mockResolvedValueOnce({
      data: [
        {
          id: "report-1",
          project_id: "project-1",
          title: "Programming Packet",
          report_type: "board_packet",
          status: "generated",
          generated_at: null,
          latest_artifact_kind: "html",
          updated_at: "2026-03-28T21:10:00.000Z",
        },
      ],
      error: null,
    });

    reportsInMock.mockResolvedValueOnce({ data: [], error: null });

    reportArtifactsOrderMock.mockResolvedValue({
      data: [
        {
          report_id: "report-1",
          generated_at: "2026-03-28T20:00:00.000Z",
        },
      ],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("keeps artifact-backed linked reports in refresh posture when report generated_at is null", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: /^Programs$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Programming Packet/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Refresh Programming Packet/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Generate Programming Packet/i)).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/reports/report-1#drift-since-generation")
    ).toBe(true);
  });

  it("explains when filters hide existing programming cycles", async () => {
    await renderPage({ status: "programmed" });

    expect(screen.getByText("No programming cycles match these filters")).toBeInTheDocument();
    expect(
      screen.getByText(
        /The workspace has 1 programming cycle, but none match status Programmed/i
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("No programming cycles yet")).not.toBeInTheDocument();
  });

  /**
   * A FAILED READ MAY NOT BE RENDERED AS AN ANSWER.
   *
   * "No programming cycles yet. Create a program record…" is a claim about this
   * workspace. A Supabase result destructured down to its `data` half gives the
   * same `null` for a failed query as for an empty table, so a broken read made
   * this page tell an agency its programming registry was empty.
   *
   * The first test is the control: without a case where the read SUCCEEDS and
   * there is genuinely nothing, a page that printed the warning unconditionally
   * would pass every other assertion here.
   */
  describe("a failed read may not be rendered as an answer", () => {
    it("still shows the ordinary empty state when the catalog read SUCCEEDS and the workspace is genuinely empty", async () => {
      programsOrderMock.mockResolvedValue({ data: [], error: null });

      await renderPage();

      expect(screen.getByText("No programming cycles yet")).toBeInTheDocument();
      expect(screen.getByText("No funding opportunities logged yet")).toBeInTheDocument();
      expect(screen.queryByText("Part of this page could not be read")).not.toBeInTheDocument();
      expect(screen.queryByText("The programming-cycle catalog could not be read")).not.toBeInTheDocument();
    });

    it("does not tell an agency its programming registry is empty when the catalog read failed", async () => {
      programsOrderMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied for table programs" },
      });

      await renderPage();

      expect(screen.queryByText("No programming cycles yet")).not.toBeInTheDocument();
      expect(screen.getByText("The programming-cycle catalog could not be read")).toBeInTheDocument();
      expect(screen.getByText("Part of this page could not be read")).toBeInTheDocument();
      expect(
        screen.getByText(/the programming-cycle catalog: permission denied for table programs/)
      ).toBeInTheDocument();
    });

    it("does not claim no opportunities are logged when the opportunity read failed, and leaves the program catalog alone", async () => {
      fundingOpportunitiesOrderMock.mockResolvedValue({
        data: null,
        error: { message: "relation funding_opportunities does not exist" },
      });

      await renderPage();

      expect(screen.queryByText("No funding opportunities logged yet")).not.toBeInTheDocument();
      expect(screen.getByText("The funding-opportunity catalog could not be read")).toBeInTheDocument();

      // The program catalog read succeeded, so it still renders its real rows.
      expect(screen.getAllByText(/2027 RTIP/i).length).toBeGreaterThan(0);
      expect(screen.queryByText("The programming-cycle catalog could not be read")).not.toBeInTheDocument();
    });
  });
});
