import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A FAILED READ MAY NOT BE RENDERED AS AN ANSWER — plans registry.
 *
 * "No plans yet. Create the first plan record" is a claim about this workspace.
 * A Supabase result destructured down to its `data` half gives the same `null`
 * for a failed query as for an empty table, so a broken read made this page tell
 * an agency its plan registry was empty — and the per-row "Missing basis: …"
 * line sent planners off to re-link work that was already linked.
 *
 * These drive the real page with the real loading code and only the Supabase
 * client doubled. The first test is the control: without a case where the read
 * SUCCEEDS and there is genuinely nothing, a page that printed the warning
 * unconditionally would pass everything else here.
 */

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const plansOrderMock = vi.fn();
const plansEqMock = vi.fn(() => ({ order: plansOrderMock }));
const plansSelectMock = vi.fn(() => ({ eq: plansEqMock }));

const projectsOrderMock = vi.fn();
const projectsEqMock = vi.fn(() => ({ order: projectsOrderMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

const planLinksInMock = vi.fn();
const planLinksSelectMock = vi.fn(() => ({ in: planLinksInMock }));

const scenariosInMock = vi.fn();
const scenariosSelectMock = vi.fn(() => ({ in: scenariosInMock }));

const campaignsInMock = vi.fn();
const campaignsSelectMock = vi.fn(() => ({ in: campaignsInMock }));

const reportsInMock = vi.fn();
const reportsSelectMock = vi.fn(() => ({ in: reportsInMock }));

const selectByTable: Record<string, ReturnType<typeof vi.fn>> = {
  plans: plansSelectMock,
  projects: projectsSelectMock,
  plan_links: planLinksSelectMock,
  scenario_sets: scenariosSelectMock,
  engagement_campaigns: campaignsSelectMock,
  reports: reportsSelectMock,
};

const fromMock = vi.fn((table: string) => {
  const select = selectByTable[table];
  if (!select) throw new Error(`Unexpected table: ${table}`);
  return { select };
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

vi.mock("@/components/plans/plan-creator", () => ({
  PlanCreator: () => <div data-testid="plan-creator" />,
}));

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: () => <div data-testid="workspace-command-board" />,
}));

import PlansPage from "@/app/(app)/plans/page";

async function renderPage(searchParams: { projectId?: string; planType?: string; status?: string } = {}) {
  render(await PlansPage({ searchParams: Promise.resolve(searchParams) }));
}

const EMPTY = { data: [], error: null };

const PLAN_ROW = {
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
  projects: { id: "project-1", name: "Downtown Mobility" },
};

describe("PlansPage — a failed read may not be rendered as an answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: "workspace-1" },
      workspace: { id: "workspace-1", name: "OpenPlan QA" },
    });
    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      nextCommand: null,
      nextActions: [],
    });

    plansOrderMock.mockResolvedValue({ data: [PLAN_ROW], error: null });
    projectsOrderMock.mockResolvedValue({
      data: [{ id: "project-1", workspace_id: "workspace-1", name: "Downtown Mobility", status: "active", delivery_phase: "analysis", updated_at: "2026-03-28T20:00:00.000Z" }],
      error: null,
    });
    planLinksInMock.mockResolvedValue(EMPTY);
    scenariosInMock.mockResolvedValue(EMPTY);
    campaignsInMock.mockResolvedValue(EMPTY);
    reportsInMock.mockResolvedValue(EMPTY);

    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
  });

  it("still shows the ordinary empty state when the catalog read SUCCEEDS and the workspace is genuinely empty", async () => {
    plansOrderMock.mockResolvedValue({ data: [], error: null });

    await renderPage();

    expect(screen.getByText("No plans yet")).toBeInTheDocument();
    expect(screen.queryByText("Part of this page could not be read")).not.toBeInTheDocument();
    expect(screen.queryByText("Your plans could not be read")).not.toBeInTheDocument();
  });

  it("does not tell an agency its plan registry is empty when the catalog read failed", async () => {
    plansOrderMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table plans" },
    });

    await renderPage();

    expect(screen.queryByText("No plans yet")).not.toBeInTheDocument();
    expect(screen.getByText("Your plans could not be read")).toBeInTheDocument();
    expect(screen.getByText("Part of this page could not be read")).toBeInTheDocument();
    expect(screen.getByText(/your plans: permission denied for table plans/)).toBeInTheDocument();
  });

  it("withholds the per-row readiness verdict when the linkage reads failed, and still renders the plans that loaded", async () => {
    scenariosInMock.mockResolvedValue({
      data: null,
      error: { message: "column scenario_sets.project_id does not exist" },
    });

    await renderPage();

    // The plan itself loaded, so it is still on screen — the page renders what
    // it has and discloses the rest.
    expect(screen.getAllByText("Downtown Corridor Plan").length).toBeGreaterThan(0);
    expect(screen.getByText("Part of this page could not be read")).toBeInTheDocument();

    // But "Missing basis: …" would be a fact about the failed read, not the plan.
    expect(screen.queryByText(/^Missing basis:/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Readiness withheld — the linked records it is computed from could not be read.")
    ).toBeInTheDocument();
  });

  it("shows the real per-row readiness line when every linkage read succeeds", async () => {
    await renderPage();

    expect(
      screen.queryByText("Readiness withheld — the linked records it is computed from could not be read.")
    ).not.toBeInTheDocument();
    expect(screen.getByText(/^Missing basis:/)).toBeInTheDocument();
  });
});
