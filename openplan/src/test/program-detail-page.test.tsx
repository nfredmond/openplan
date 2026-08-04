import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});

const authGetUserMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const programMaybeSingleMock = vi.fn();
const programEqMock = vi.fn((column: string) => {
  if (column === "id") {
    return { maybeSingle: programMaybeSingleMock };
  }

  if (column === "workspace_id") {
    return { order: workspaceProgramsOrderMock };
  }

  throw new Error(`Unexpected programs eq column: ${column}`);
});
const programSelectMock = vi.fn(() => ({ eq: programEqMock }));

const projectsMaybeSingleMock = vi.fn();
const projectsOrderMock = vi.fn();
const projectsInMock = vi.fn();
const projectsEqMock = vi.fn((column: string) => {
  if (column === "workspace_id") {
    return { order: projectsOrderMock };
  }

  if (column === "id") {
    return { maybeSingle: projectsMaybeSingleMock };
  }

  throw new Error(`Unexpected projects eq column: ${column}`);
});
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock, in: projectsInMock }));

const programLinksEqMock = vi.fn<() => Promise<{ data: unknown; error: { message: string } | null }>>();
const programLinksSelectMock = vi.fn(() => ({ eq: programLinksEqMock }));

const plansProjectOrderMock = vi.fn();
const plansWorkspaceOrderMock = vi.fn();
const plansInMock = vi.fn();
const plansEqMock = vi.fn((column: string) => {
  if (column === "project_id") {
    return { order: plansProjectOrderMock };
  }

  if (column === "workspace_id") {
    return { order: plansWorkspaceOrderMock };
  }

  throw new Error(`Unexpected plans eq column: ${column}`);
});
const plansSelectMock = vi.fn(() => ({ eq: plansEqMock, in: plansInMock }));

const reportsProjectOrderMock = vi.fn();
const reportsWorkspaceOrderMock = vi.fn();
const reportsInMock = vi.fn();
const reportsEqMock = vi.fn((column: string) => {
  if (column === "project_id") {
    return { order: reportsProjectOrderMock };
  }

  if (column === "workspace_id") {
    return { order: reportsWorkspaceOrderMock };
  }

  throw new Error(`Unexpected reports eq column: ${column}`);
});
const reportsSelectMock = vi.fn(() => ({ eq: reportsEqMock, in: reportsInMock }));

const campaignsProjectOrderMock = vi.fn();
const campaignsWorkspaceOrderMock = vi.fn();
const campaignsInMock = vi.fn();
const campaignsEqMock = vi.fn((column: string) => {
  if (column === "project_id") {
    return { order: campaignsProjectOrderMock };
  }

  if (column === "workspace_id") {
    return { order: campaignsWorkspaceOrderMock };
  }

  throw new Error(`Unexpected engagement_campaigns eq column: ${column}`);
});
const campaignsSelectMock = vi.fn(() => ({ eq: campaignsEqMock, in: campaignsInMock }));

const fundingOpportunitiesProgramOrderMock = vi.fn();
const fundingOpportunitiesWorkspaceOrderMock = vi.fn();
const fundingOpportunitiesEqMock = vi.fn((column: string) => {
  if (column === "program_id") {
    return { order: fundingOpportunitiesProgramOrderMock };
  }

  if (column === "workspace_id") {
    return { order: fundingOpportunitiesWorkspaceOrderMock };
  }

  throw new Error(`Unexpected funding_opportunities eq column: ${column}`);
});
const fundingOpportunitiesSelectMock = vi.fn(() => ({ eq: fundingOpportunitiesEqMock }));

const workspaceProgramsOrderMock = vi.fn();
const projectFundingProfilesEqMock = vi.fn();
const projectFundingProfilesSelectMock = vi.fn(() => ({ eq: projectFundingProfilesEqMock }));

const reportArtifactsOrderMock = vi.fn();
const reportArtifactsInMock = vi.fn(() => ({ order: reportArtifactsOrderMock }));
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const modelsProjectOrderMock = vi.fn();
const modelsInMock = vi.fn();
const modelsEqMock = vi.fn((column: string) => {
  if (column === "project_id") {
    return { order: modelsProjectOrderMock };
  }

  throw new Error(`Unexpected models eq column: ${column}`);
});
const modelsSelectMock = vi.fn(() => ({ eq: modelsEqMock, in: modelsInMock }));

/**
 * Two different reads land on `model_links`:
 *   `.eq("link_type","plan").in("linked_id", planIds)` — which models the
 *      program's plans point at; and
 *   `.in("model_id", modelIds)` — those models' OWN link sets, which is what
 *      the readiness verdict and the run/report counts are computed from.
 * They must be separately controllable, or a test cannot fail only the second.
 */
const planModelLinksInMock = vi.fn();
const supportingModelLinksInMock = vi.fn();
const modelLinksEqMock = vi.fn((column: string) => {
  if (column === "link_type") return { in: planModelLinksInMock };
  throw new Error(`Unexpected model_links eq column: ${column}`);
});
const modelLinksSelectMock = vi.fn(() => ({ eq: modelLinksEqMock, in: supportingModelLinksInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "programs") {
    return { select: programSelectMock };
  }
  if (table === "projects") {
    return { select: projectsSelectMock };
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
  if (table === "funding_opportunities") {
    return { select: fundingOpportunitiesSelectMock };
  }
  if (table === "project_funding_profiles") {
    return { select: projectFundingProfilesSelectMock };
  }
  if (table === "report_artifacts") {
    return { select: reportArtifactsSelectMock };
  }
  if (table === "models") {
    return { select: modelsSelectMock };
  }
  if (table === "model_links") {
    return { select: modelLinksSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
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

vi.mock("@/components/programs/program-detail-controls", () => ({
  ProgramDetailControls: () => <div data-testid="program-detail-controls" />,
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

import ProgramDetailPage from "@/app/(app)/programs/[programId]/page";

async function renderPage() {
  render(
    await ProgramDetailPage({
      params: Promise.resolve({ programId: "program-1" }),
    })
  );
}

describe("ProgramDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    programMaybeSingleMock.mockResolvedValue({
      data: {
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
      },
      error: null,
    });

    projectsOrderMock.mockResolvedValue({
      data: [{ id: "project-1", name: "Downtown Mobility Plan" }],
      error: null,
    });

    projectsMaybeSingleMock.mockResolvedValue({
      data: {
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Downtown Mobility Plan",
        summary: "Planning effort focused on corridor safety and access.",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "analysis",
        updated_at: "2026-03-28T20:00:00.000Z",
      },
      error: null,
    });

    programLinksEqMock.mockResolvedValue({ data: [], error: null });

    plansProjectOrderMock.mockResolvedValue({ data: [], error: null });
    plansWorkspaceOrderMock.mockResolvedValue({ data: [], error: null });

    reportsProjectOrderMock.mockResolvedValue({
      data: [
        {
          id: "report-1",
          project_id: "project-1",
          title: "Programming Packet",
          report_type: "board_packet",
          status: "generated",
          summary: "Packet with programming recommendations.",
          generated_at: null,
          latest_artifact_kind: "html",
          updated_at: "2026-03-28T21:10:00.000Z",
        },
      ],
      error: null,
    });
    reportsWorkspaceOrderMock.mockResolvedValue({ data: [], error: null });

    campaignsProjectOrderMock.mockResolvedValue({ data: [], error: null });
    campaignsWorkspaceOrderMock.mockResolvedValue({ data: [], error: null });

    fundingOpportunitiesProgramOrderMock.mockResolvedValue({ data: [], error: null });
    fundingOpportunitiesWorkspaceOrderMock.mockResolvedValue({ data: [], error: null });

    workspaceProgramsOrderMock.mockResolvedValue({ data: [], error: null });
    projectFundingProfilesEqMock.mockResolvedValue({ data: [], error: null });

    reportArtifactsOrderMock.mockResolvedValue({
      data: [
        {
          report_id: "report-1",
          generated_at: "2026-03-28T20:00:00.000Z",
        },
      ],
      error: null,
    });

    modelsProjectOrderMock.mockResolvedValue({ data: [], error: null });
    modelsInMock.mockResolvedValue({ data: [], error: null });
    planModelLinksInMock.mockResolvedValue({ data: [], error: null });
    supportingModelLinksInMock.mockResolvedValue({ data: [], error: null });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      nextCommand: null,
      nextActions: [],
      commandQueue: [],
      fullCommandQueue: [],
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("keeps artifact-backed linked reports in refresh posture when report generated_at is null", async () => {
    await renderPage();

    const reportLinks = screen.getAllByRole("link");
    expect(
      reportLinks.some((link) => link.getAttribute("href") === "/reports/report-1#drift-since-generation")
    ).toBe(true);
    expect(screen.getAllByText("Refresh recommended").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Not generated$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^Generated .*2026/i)).toBeInTheDocument();
  });

  /**
   * A FAILED READ MAY NOT BE RENDERED AS AN ANSWER.
   *
   * This page's empty states were written for "there is genuinely nothing here",
   * and a Supabase result destructured down to its `data` half gives the same
   * `null` for a failed query. So a broken read made a programming cycle say
   * "No plan basis linked" and "No funding opportunities linked yet" — a package
   * disowning basis it actually has, in front of the person assembling it for a
   * funder.
   *
   * These drive the real page with the real loading code and only the Supabase
   * client doubled. The first test is the control: without it, a page that
   * printed the warning unconditionally would pass all of the others.
   */
  describe("a failed read may not be rendered as an answer", () => {
    it("still shows the ordinary empty states when every read SUCCEEDS and there is genuinely nothing", async () => {
      await renderPage();

      expect(screen.getByText("No plan basis linked")).toBeInTheDocument();
      expect(screen.getByText("No engagement evidence linked")).toBeInTheDocument();
      expect(screen.getByText("No funding opportunities linked yet")).toBeInTheDocument();
      expect(screen.getByText("No supporting models visible")).toBeInTheDocument();

      expect(screen.queryByText("Part of this page could not be read")).not.toBeInTheDocument();
      expect(screen.queryByText("Plan links could not be read")).not.toBeInTheDocument();
    });

    it("replaces the plan empty state with a disclosure when the plan read fails, and leaves the other sections alone", async () => {
      plansProjectOrderMock.mockResolvedValue({
        data: null,
        error: { message: "column plans.horizon_year does not exist" },
      });

      await renderPage();

      // (a) the false absence sentence is gone
      expect(screen.queryByText("No plan basis linked")).not.toBeInTheDocument();

      // (b) the disclosure is present, by name, with the operator detail an
      //     internal page is allowed to show
      expect(screen.getByText("Part of this page could not be read")).toBeInTheDocument();
      expect(screen.getByText("Plan links could not be read")).toBeInTheDocument();
      expect(
        screen.getByText(/plans on the primary project: column plans\.horizon_year does not exist/)
      ).toBeInTheDocument();

      // (c) the sections whose reads SUCCEEDED still say what is true about them
      expect(screen.getByText("No engagement evidence linked")).toBeInTheDocument();
      expect(screen.getByText("No funding opportunities linked yet")).toBeInTheDocument();
    });

    it("does not claim a cycle has no funding opportunities when the opportunity read failed", async () => {
      fundingOpportunitiesProgramOrderMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied for table funding_opportunities" },
      });

      await renderPage();

      expect(screen.queryByText("No funding opportunities linked yet")).not.toBeInTheDocument();
      expect(screen.getByText("Funding opportunities could not be read")).toBeInTheDocument();
      // A dollar total is the most quotable number on the page; $0 from a failed
      // read would read as a finding about the cycle.
      expect(screen.queryByText("$0")).not.toBeInTheDocument();
      // The plan lane is untouched, so it still states its real emptiness.
      expect(screen.getByText("No plan basis linked")).toBeInTheDocument();
    });

    it("withholds the readiness verdict rather than reporting gaps that came from a failed read", async () => {
      programLinksEqMock.mockResolvedValue({
        data: null,
        error: { message: "relation program_links does not exist" },
      });

      await renderPage();

      expect(screen.getByText("Readiness cannot be assessed right now")).toBeInTheDocument();
      expect(screen.queryByText("No plan basis linked")).not.toBeInTheDocument();
      expect(screen.queryByText("No engagement evidence linked")).not.toBeInTheDocument();
      expect(screen.queryByText("No project links yet")).not.toBeInTheDocument();
    });

    /**
     * The 404-on-a-failed-read face of the same defect. `notFound()` tells the
     * planner this program does not exist; a broken query is not evidence of that.
     */
    it("does not 404 when the program itself could not be READ — it raises instead", async () => {
      programMaybeSingleMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied for table programs" },
      });

      await expect(renderPage()).rejects.toThrow(
        /Could not read this program: permission denied for table programs/
      );
      expect(notFoundMock).not.toHaveBeenCalled();
    });

    it("still 404s when the program genuinely is not there", async () => {
      programMaybeSingleMock.mockResolvedValue({ data: null, error: null });

      await expect(renderPage()).rejects.toThrow("notFound");
      expect(notFoundMock).toHaveBeenCalled();
    });

    /**
     * The second-order face, one level below the section gate. The supporting-
     * models gate does not cover the models' OWN link sets, so when only that
     * read fails the models still render — with "0 runs", "0 reports" and a
     * "Missing basis: …" verdict computed from records the page never saw.
     */
    const SUPPORTING_MODEL = {
      id: "model-1",
      project_id: "project-1",
      scenario_set_id: null,
      title: "Cycle screening model",
      model_family: "sketch_abm",
      status: "active",
      config_version: "v2",
      owner_label: "Modeling desk",
      summary: "Screening-grade model behind the cycle.",
      last_validated_at: null,
      last_run_recorded_at: null,
      updated_at: "2026-03-28T19:00:00.000Z",
    };

    it("does not report a model's readiness or run counts when the model's link set could not be read", async () => {
      modelsProjectOrderMock.mockResolvedValue({ data: [SUPPORTING_MODEL], error: null });
      supportingModelLinksInMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied for table model_links" },
      });

      await renderPage();

      // The model record itself read fine, so it is still shown.
      expect(screen.getByText("Cycle screening model")).toBeInTheDocument();

      expect(screen.queryByText("0 runs")).not.toBeInTheDocument();
      expect(screen.queryByText("0 reports")).not.toBeInTheDocument();
      expect(screen.queryByText(/^Missing basis:/)).not.toBeInTheDocument();
      expect(screen.getByText(/linkage counts unavailable/)).toBeInTheDocument();
      expect(screen.getByText(/No readiness verdict is shown for this model/)).toBeInTheDocument();
    });

    /** The control: readable link set, counts and verdict return. */
    it("still reports model run counts when the model's link set reads cleanly", async () => {
      modelsProjectOrderMock.mockResolvedValue({ data: [SUPPORTING_MODEL], error: null });
      supportingModelLinksInMock.mockResolvedValue({ data: [], error: null });

      await renderPage();

      expect(screen.getByText("Cycle screening model")).toBeInTheDocument();
      expect(screen.getByText("0 runs")).toBeInTheDocument();
      expect(screen.queryByText(/linkage counts unavailable/)).not.toBeInTheDocument();
      expect(screen.queryByText(/No readiness verdict is shown for this model/)).not.toBeInTheDocument();
    });
  });
});
