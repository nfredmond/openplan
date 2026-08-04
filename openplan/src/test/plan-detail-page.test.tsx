import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A FAILED READ MAY NOT BE RENDERED AS AN ANSWER — plan detail page.
 *
 * `const { data } = await supabase…` hands back `null` for both "there is
 * nothing here" and "this query failed". This page's empty states were written
 * for the first case, so a broken query made it say "No scenario sets linked",
 * "No campaigns linked", "No reports linked", "No model support linked yet" — a
 * plan record publicly disowning basis it actually has, and a readiness
 * checklist full of gaps a planner would then go and try to fill.
 *
 * The tests below drive the REAL page component with the REAL loading code and
 * only the Supabase client doubled, because a test that stubs the loader tests
 * the renderer. Each failing-read case asserts three things: the false absence
 * sentence is GONE, the disclosure is PRESENT, and — the assertion that makes
 * the other two mean anything — the ordinary empty state still appears when the
 * read succeeds and there is genuinely nothing.
 */

const createClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});

const authGetUserMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const planMaybeSingleMock = vi.fn();
const planEqMock = vi.fn((column: string) => {
  if (column === "id") return { maybeSingle: planMaybeSingleMock };
  throw new Error(`Unexpected plans eq column: ${column}`);
});
const plansSelectMock = vi.fn(() => ({ eq: planEqMock }));

const projectsWorkspaceOrderMock = vi.fn();
const projectsMaybeSingleMock = vi.fn();
const projectsInMock = vi.fn();
const projectsEqMock = vi.fn((column: string) => {
  if (column === "workspace_id") return { order: projectsWorkspaceOrderMock };
  if (column === "id") return { maybeSingle: projectsMaybeSingleMock };
  throw new Error(`Unexpected projects eq column: ${column}`);
});
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock, in: projectsInMock }));

const planLinksEqMock = vi.fn();
const planLinksSelectMock = vi.fn(() => ({ eq: planLinksEqMock }));

const scenariosProjectOrderMock = vi.fn();
const scenariosInMock = vi.fn();
const scenariosEqMock = vi.fn((column: string) => {
  if (column === "project_id") return { order: scenariosProjectOrderMock };
  throw new Error(`Unexpected scenario_sets eq column: ${column}`);
});
const scenariosSelectMock = vi.fn(() => ({ eq: scenariosEqMock, in: scenariosInMock }));

const campaignsProjectOrderMock = vi.fn();
const campaignsInMock = vi.fn();
const campaignsEqMock = vi.fn((column: string) => {
  if (column === "project_id") return { order: campaignsProjectOrderMock };
  throw new Error(`Unexpected engagement_campaigns eq column: ${column}`);
});
const campaignsSelectMock = vi.fn(() => ({ eq: campaignsEqMock, in: campaignsInMock }));

const reportsProjectOrderMock = vi.fn();
const reportsInMock = vi.fn();
const reportsEqMock = vi.fn((column: string) => {
  if (column === "project_id") return { order: reportsProjectOrderMock };
  throw new Error(`Unexpected reports eq column: ${column}`);
});
const reportsSelectMock = vi.fn(() => ({ eq: reportsEqMock, in: reportsInMock }));

const modelsProjectOrderMock = vi.fn();
const modelsInMock = vi.fn();
const modelsEqMock = vi.fn((column: string) => {
  if (column === "project_id") return { order: modelsProjectOrderMock };
  throw new Error(`Unexpected models eq column: ${column}`);
});
const modelsSelectMock = vi.fn(() => ({ eq: modelsEqMock, in: modelsInMock }));

/** `.eq("link_type", "plan").eq("linked_id", planId)` — two chained eq calls. */
const modelLinksLinkedIdEqMock = vi.fn();
const modelLinksInMock = vi.fn();
const modelLinksEqMock = vi.fn((column: string) => {
  if (column === "link_type") return { eq: modelLinksLinkedIdEqMock };
  throw new Error(`Unexpected model_links eq column: ${column}`);
});
const modelLinksSelectMock = vi.fn(() => ({ eq: modelLinksEqMock, in: modelLinksInMock }));

const scenarioEntriesInMock = vi.fn();
const scenarioEntriesSelectMock = vi.fn(() => ({ in: scenarioEntriesInMock }));
const engagementCategoriesInMock = vi.fn();
const engagementCategoriesSelectMock = vi.fn(() => ({ in: engagementCategoriesInMock }));
const engagementItemsInMock = vi.fn();
const engagementItemsSelectMock = vi.fn(() => ({ in: engagementItemsInMock }));
const reportRunsInMock = vi.fn();
const reportRunsSelectMock = vi.fn(() => ({ in: reportRunsInMock }));
const reportSectionsInMock = vi.fn();
const reportSectionsSelectMock = vi.fn(() => ({ in: reportSectionsInMock }));
const reportArtifactsInMock = vi.fn();
const reportArtifactsSelectMock = vi.fn(() => ({ in: reportArtifactsInMock }));

const selectByTable: Record<string, ReturnType<typeof vi.fn>> = {
  plans: plansSelectMock,
  projects: projectsSelectMock,
  plan_links: planLinksSelectMock,
  scenario_sets: scenariosSelectMock,
  engagement_campaigns: campaignsSelectMock,
  reports: reportsSelectMock,
  models: modelsSelectMock,
  model_links: modelLinksSelectMock,
  scenario_entries: scenarioEntriesSelectMock,
  engagement_categories: engagementCategoriesSelectMock,
  engagement_items: engagementItemsSelectMock,
  report_runs: reportRunsSelectMock,
  report_sections: reportSectionsSelectMock,
  report_artifacts: reportArtifactsSelectMock,
};

const fromMock = vi.fn((table: string) => {
  const select = selectByTable[table];
  if (!select) throw new Error(`Unexpected table: ${table}`);
  return { select };
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

vi.mock("@/components/plans/plan-detail-controls", () => ({
  PlanDetailControls: () => <div data-testid="plan-detail-controls" />,
}));

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: () => <div data-testid="workspace-command-board" />,
}));

import PlanDetailPage from "@/app/(app)/plans/[planId]/page";

async function renderPage() {
  render(await PlanDetailPage({ params: Promise.resolve({ planId: "plan-1" }) }));
}

const EMPTY = { data: [], error: null };

describe("PlanDetailPage — a failed read may not be rendered as an answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    planMaybeSingleMock.mockResolvedValue({
      data: {
        id: "plan-1",
        workspace_id: "workspace-1",
        project_id: "project-1",
        title: "Downtown Corridor Plan",
        plan_type: "corridor_plan",
        status: "active",
        geography_label: "Study area",
        horizon_year: 2045,
        summary: "Corridor access and safety.",
        created_at: "2026-03-28T18:00:00.000Z",
        updated_at: "2026-03-28T21:10:00.000Z",
      },
      error: null,
    });

    projectsWorkspaceOrderMock.mockResolvedValue({
      data: [{ id: "project-1", name: "Downtown Mobility" }],
      error: null,
    });
    projectsMaybeSingleMock.mockResolvedValue({
      data: {
        id: "project-1",
        workspace_id: "workspace-1",
        name: "Downtown Mobility",
        summary: "Corridor safety and access.",
        status: "active",
        plan_type: "corridor_plan",
        delivery_phase: "analysis",
        updated_at: "2026-03-28T20:00:00.000Z",
      },
      error: null,
    });
    projectsInMock.mockResolvedValue(EMPTY);

    planLinksEqMock.mockResolvedValue(EMPTY);
    scenariosProjectOrderMock.mockResolvedValue(EMPTY);
    scenariosInMock.mockResolvedValue(EMPTY);
    campaignsProjectOrderMock.mockResolvedValue(EMPTY);
    campaignsInMock.mockResolvedValue(EMPTY);
    reportsProjectOrderMock.mockResolvedValue(EMPTY);
    reportsInMock.mockResolvedValue(EMPTY);
    modelsProjectOrderMock.mockResolvedValue(EMPTY);
    modelsInMock.mockResolvedValue(EMPTY);
    modelLinksLinkedIdEqMock.mockResolvedValue(EMPTY);
    modelLinksInMock.mockResolvedValue(EMPTY);
    scenarioEntriesInMock.mockResolvedValue(EMPTY);
    engagementCategoriesInMock.mockResolvedValue(EMPTY);
    engagementItemsInMock.mockResolvedValue(EMPTY);
    reportRunsInMock.mockResolvedValue(EMPTY);
    reportSectionsInMock.mockResolvedValue(EMPTY);
    reportArtifactsInMock.mockResolvedValue(EMPTY);

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      nextCommand: null,
      nextActions: [],
      commandQueue: [],
      fullCommandQueue: [],
    });

    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
  });

  /**
   * THE CONTROL. Without this the two tests below prove nothing — a page that
   * printed the disclosure unconditionally would pass them both.
   */
  it("still shows the ordinary empty states when every read SUCCEEDS and there is genuinely nothing", async () => {
    await renderPage();

    expect(screen.getByText("No scenario sets linked")).toBeInTheDocument();
    expect(screen.getByText("No campaigns linked")).toBeInTheDocument();
    expect(screen.getByText("No reports linked")).toBeInTheDocument();
    expect(screen.getByText("No model support linked yet")).toBeInTheDocument();
    expect(screen.getByText("No explicit links yet")).toBeInTheDocument();

    expect(screen.queryByText("Part of this page could not be read")).not.toBeInTheDocument();
    expect(screen.queryByText("Scenario links could not be read")).not.toBeInTheDocument();
  });

  it("replaces the scenario empty state with a disclosure when the scenario read fails, and leaves the other sections alone", async () => {
    scenariosProjectOrderMock.mockResolvedValue({
      data: null,
      error: { message: 'column scenario_sets.planning_question does not exist' },
    });

    await renderPage();

    // (a) the false absence sentence is gone
    expect(screen.queryByText("No scenario sets linked")).not.toBeInTheDocument();

    // (b) the disclosure is present, by name, with the operator detail an
    //     internal page is allowed to show
    expect(screen.getByText("Part of this page could not be read")).toBeInTheDocument();
    expect(screen.getByText("Scenario links could not be read")).toBeInTheDocument();
    expect(
      screen.getByText(/scenario sets on the primary project: column scenario_sets\.planning_question does not exist/)
    ).toBeInTheDocument();

    // (c) the sections whose reads SUCCEEDED still say what is true about them —
    //     the page discloses, it does not blanket-warn
    expect(screen.getByText("No campaigns linked")).toBeInTheDocument();
    expect(screen.getByText("No reports linked")).toBeInTheDocument();
  });

  it("withholds the readiness verdict rather than reporting gaps that came from a failed read", async () => {
    campaignsProjectOrderMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table engagement_campaigns" },
    });

    await renderPage();

    expect(screen.queryByText("No campaigns linked")).not.toBeInTheDocument();
    expect(screen.getByText("Campaign links could not be read")).toBeInTheDocument();
    expect(screen.getByText("Readiness cannot be assessed right now")).toBeInTheDocument();
    expect(
      screen.getByText(/Readiness, coverage and workflow posture are withheld/)
    ).toBeInTheDocument();
  });

  it("loses the link set honestly: no 'No explicit links yet', and the ledger count is unknown rather than zero", async () => {
    planLinksEqMock.mockResolvedValue({
      data: null,
      error: { message: "relation plan_links does not exist" },
    });

    await renderPage();

    expect(screen.queryByText("No explicit links yet")).not.toBeInTheDocument();
    expect(screen.queryByText("No explicit links stored on the plan yet.")).not.toBeInTheDocument();
    expect(screen.getByText("The plan's link set could not be read")).toBeInTheDocument();
    expect(
      screen.getByText(/The plan's link set could not be read, so the number of stored links is unknown/)
    ).toBeInTheDocument();
  });

  /**
   * The 404-on-a-failed-read face of the same defect. `notFound()` tells the
   * planner this plan does not exist; a broken query is not evidence of that.
   */
  it("does not 404 when the plan itself could not be READ — it raises instead", async () => {
    planMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table plans" },
    });

    await expect(renderPage()).rejects.toThrow(/Could not read this plan: permission denied for table plans/);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("still 404s when the plan genuinely is not there", async () => {
    planMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    await expect(renderPage()).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalled();
  });

  /**
   * THE SECOND-ORDER FACE OF THE DEFECT, one level below the section gates.
   *
   * The supporting-models section has its own gate, but it does not cover the
   * models' OWN link sets — a separate read. When that one fails the model
   * records still load, so the section renders; but `buildModelWorkspaceSummary`
   * is handed `modelLinksByModel.get(id) ?? []`, and an empty link set from a
   * failed read comes back out as "0 datasets · 0 runs · 0 reports" and a
   * per-model "Missing basis: …". That is a readiness verdict about records the
   * page never saw, and it is precisely what `ReadFailureLog.describe()` promises
   * the page will not do ("shown as unavailable rather than as zero").
   */
  const SUPPORTING_MODEL = {
    id: "model-1",
    project_id: "project-1",
    scenario_set_id: null,
    title: "Corridor screening model",
    model_family: "sketch_abm",
    status: "active",
    config_version: "v3",
    owner_label: "Modeling desk",
    summary: "Screening-grade corridor model.",
    last_validated_at: null,
    last_run_recorded_at: null,
    updated_at: "2026-03-28T19:00:00.000Z",
  };

  it("does not report a model's readiness or linkage counts when the model's link set could not be read", async () => {
    modelsProjectOrderMock.mockResolvedValue({ data: [SUPPORTING_MODEL], error: null });
    modelLinksInMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table model_links" },
    });

    await renderPage();

    // The model itself loaded, so it is still shown — the fix discloses, it
    // does not withhold records the planner is entitled to see.
    expect(screen.getByText("Corridor screening model")).toBeInTheDocument();

    // But no count and no verdict derived from the failed read.
    expect(screen.queryByText(/0 datasets/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Missing basis:/)).not.toBeInTheDocument();
    expect(screen.getByText(/linkage counts unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/No readiness verdict is shown for this model/)).toBeInTheDocument();

    // And the aggregate built from the same verdicts is withheld too.
    expect(
      screen.getByText(/How many pass every readiness check is unknown/)
    ).toBeInTheDocument();
    expect(screen.getByText("Part of this page could not be read")).toBeInTheDocument();
  });

  /** The control: with the link set readable, the counts and verdict come back. */
  it("still reports model linkage counts when the model's link set reads cleanly", async () => {
    modelsProjectOrderMock.mockResolvedValue({ data: [SUPPORTING_MODEL], error: null });
    modelLinksInMock.mockResolvedValue({ data: [], error: null });

    await renderPage();

    expect(screen.getByText("Corridor screening model")).toBeInTheDocument();
    expect(screen.getByText(/0 datasets/)).toBeInTheDocument();
    expect(screen.queryByText(/linkage counts unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No readiness verdict is shown for this model/)).not.toBeInTheDocument();
    expect(screen.queryByText("Part of this page could not be read")).not.toBeInTheDocument();
  });
});
