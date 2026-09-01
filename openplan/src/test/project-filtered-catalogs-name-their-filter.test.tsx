import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * A catalog narrowed by `?projectId=` may not describe the workspace.
 *
 * The project spine board links into /scenarios, /models and /engagement with a
 * project id attached. Each of those pages applied the filter and then went on
 * talking as though it had listed the whole workspace: a filtered zero rendered
 * "No scenario sets yet — create the first one", the headings still claimed
 * workspace scope, the status tabs reported workspace-wide counts, and picking a
 * status rebuilt the href from scratch and dropped the project on the way. The
 * planner could not tell what they were looking at, why it was short, or how to
 * widen it on purpose.
 *
 * These tests pin the three things that fixes it: the scope is stated and the
 * filter is named, an empty filtered list is never offered as an absence, and
 * every tab carries the filters the reader arrived with.
 */

type TableResult = { data: unknown[] | null; error: { message: string } | null };

const tableResults = new Map<string, TableResult>();

function setTable(table: string, result: TableResult) {
  tableResults.set(table, result);
}

function resultFor(table: string): TableResult {
  return tableResults.get(table) ?? { data: [], error: null };
}

/**
 * A query builder that answers whatever `setTable` registered for its table.
 *
 * Every chainable method returns the builder, and the builder is a thenable, so
 * both `await from(t).select(c)` and `await from(t).select(c).order(x).in(y, z)`
 * resolve to the same registered result — which is all these pages need, since
 * none of them depends on the shape of the chain.
 */
function builderFor(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "order", "in", "eq", "limit", "or", "not", "range"]) {
    builder[method] = vi.fn(chain);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(resultFor(table)));
  builder.single = vi.fn(() => Promise.resolve(resultFor(table)));
  builder.then = (onFulfilled: unknown, onRejected: unknown) =>
    Promise.resolve(resultFor(table)).then(onFulfilled as never, onRejected as never);
  return builder;
}

const fromMock = vi.fn((table: string) => builderFor(table));
const authGetUserMock = vi.fn();
const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

vi.mock("@/components/scenarios/scenario-set-creator", () => ({
  ScenarioSetCreator: () => <div data-testid="scenario-set-creator" />,
}));

vi.mock("@/components/models/model-creator", () => ({
  ModelCreator: () => <div data-testid="model-creator" />,
}));

vi.mock("@/components/engagement/engagement-campaign-creator", () => ({
  EngagementCampaignCreator: () => <div data-testid="engagement-campaign-creator" />,
}));

vi.mock("@/app/(app)/models/_components/network-packages-panel", () => ({
  NetworkPackagesPanel: () => <div data-testid="network-packages-panel" />,
}));

vi.mock("@/components/cartographic/cartographic-selection-link", () => ({
  CartographicSelectionLink: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    selection?: unknown;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import EngagementPage from "@/app/(app)/engagement/page";
import ModelsPage from "@/app/(app)/models/page";
import ScenariosPage from "@/app/(app)/scenarios/page";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-000000000002";

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    workspace_id: "workspace-1",
    name: "Downtown Corridor",
    ...overrides,
  };
}

function scenarioSetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "scenario-set-1",
    workspace_id: "workspace-1",
    project_id: OTHER_PROJECT_ID,
    title: "Baseline versus build",
    summary: null,
    planning_question: null,
    status: "draft",
    baseline_entry_id: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    projects: null,
    ...overrides,
  };
}

function modelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "model-1",
    workspace_id: "workspace-1",
    project_id: OTHER_PROJECT_ID,
    scenario_set_id: null,
    title: "Regional travel demand",
    model_family: "travel_demand",
    status: "draft",
    config_version: null,
    owner_label: null,
    horizon_label: null,
    assumptions_summary: null,
    input_summary: null,
    output_summary: null,
    summary: null,
    last_validated_at: null,
    last_run_recorded_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    projects: null,
    scenario_sets: null,
    ...overrides,
  };
}

function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign-1",
    workspace_id: "workspace-1",
    project_id: OTHER_PROJECT_ID,
    title: "Downtown listening",
    summary: null,
    status: "active",
    engagement_type: "comment_collection",
    share_token: null,
    allow_public_submissions: false,
    submissions_closed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    projects: null,
    ...overrides,
  };
}

/** Every href rendered inside the status-tab row. */
function tabHrefs(): string[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a")).map((anchor) =>
    anchor.getAttribute("href") ?? ""
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();

  authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: "workspace-1", role: "member" },
    workspace: { id: "workspace-1", name: "Workspace" },
  });
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: fromMock,
  });
});

describe("scenarios catalog opened for one project", () => {
  async function renderScenarios(filters: { projectId?: string; status?: string }) {
    render(await ScenariosPage({ searchParams: Promise.resolve(filters) }));
  }

  it("does not offer a filtered zero as proof the workspace has no scenario sets", async () => {
    setTable("scenario_sets", { data: [scenarioSetRow()], error: null });
    setTable("projects", { data: [projectRow()], error: null });

    await renderScenarios({ projectId: PROJECT_ID });

    expect(screen.queryByText("No scenario sets yet")).toBeNull();
    expect(screen.getByText("No scenario sets match these filters")).toBeInTheDocument();
    expect(screen.getByText(/filtered to project Downtown Corridor/i)).toBeInTheDocument();
  });

  it("states the project it was narrowed to, and how to widen it again", async () => {
    setTable("scenario_sets", { data: [scenarioSetRow({ project_id: PROJECT_ID })], error: null });
    setTable("projects", { data: [projectRow()], error: null });

    await renderScenarios({ projectId: PROJECT_ID });

    expect(screen.getByText(/Showing only scenario sets for Downtown Corridor/)).toBeInTheDocument();
    expect(screen.getByText("Show every scenario set in this workspace")).toHaveAttribute("href", "/scenarios");
    expect(screen.queryByText("Scenario sets in this workspace")).toBeNull();
  });

  it("still tells an unfiltered workspace that it has none", async () => {
    setTable("scenario_sets", { data: [], error: null });
    setTable("projects", { data: [projectRow()], error: null });

    await renderScenarios({});

    expect(screen.getByText("No scenario sets yet")).toBeInTheDocument();
    expect(screen.queryByText(/Showing only scenario sets/)).toBeNull();
  });

  it("keeps the project when a status tab is chosen", async () => {
    setTable("scenario_sets", { data: [scenarioSetRow({ project_id: PROJECT_ID })], error: null });
    setTable("projects", { data: [projectRow()], error: null });

    await renderScenarios({ projectId: PROJECT_ID });

    expect(tabHrefs()).toContain(`/scenarios?projectId=${PROJECT_ID}&status=active`);
    expect(tabHrefs()).toContain(`/scenarios?projectId=${PROJECT_ID}`);
    expect(tabHrefs()).not.toContain("/scenarios?status=active");
  });

  it("names the filter by id when the project list cannot name it", async () => {
    setTable("scenario_sets", { data: [], error: null });
    setTable("projects", { data: [], error: null });

    await renderScenarios({ projectId: PROJECT_ID });

    expect(screen.getByText(new RegExp(`the project with id ${PROJECT_ID}`))).toBeInTheDocument();
    expect(screen.getByText(/No project with that id appears in this workspace/)).toBeInTheDocument();
  });

  it("does not blame the project when the project list is what failed to load", async () => {
    setTable("scenario_sets", { data: [], error: null });
    setTable("projects", { data: null, error: { message: "permission denied for table projects" } });

    await renderScenarios({ projectId: PROJECT_ID });

    expect(screen.getByText(/project list could not be read/)).toBeInTheDocument();
    expect(screen.queryByText(/No project with that id appears in this workspace/)).toBeNull();
  });
});

describe("models catalog opened for one project", () => {
  async function renderModels(filters: {
    projectId?: string;
    modelFamily?: string;
    status?: string;
    readiness?: string;
    q?: string;
  }) {
    render(await ModelsPage({ searchParams: Promise.resolve(filters) }));
  }

  it("confines the model page to one shrinkable mobile grid track", async () => {
    setTable("models", { data: [], error: null });
    setTable("projects", { data: [projectRow()], error: null });

    await renderModels({ projectId: PROJECT_ID });

    expect(document.querySelector(".module-page")).toHaveClass(
      "min-w-0",
      "grid-cols-[minmax(0,1fr)]",
    );
  });

  it("keeps every active filter when a status tab is chosen", async () => {
    setTable("models", { data: [modelRow({ project_id: PROJECT_ID })], error: null });
    setTable("projects", { data: [projectRow()], error: null });

    await renderModels({ projectId: PROJECT_ID, readiness: "gaps", q: "corridor" });

    const hrefs = tabHrefs();
    const approvedTab = hrefs.find((href) => href.includes("status=approved"));
    expect(approvedTab).toBeDefined();
    expect(approvedTab).toContain(`projectId=${PROJECT_ID}`);
    expect(approvedTab).toContain("readiness=gaps");
    expect(approvedTab).toContain("q=corridor");
  });

  it("counts each status tab within the scope, not within the chosen status", async () => {
    setTable("models", {
      data: [
        modelRow({ id: "model-draft", project_id: PROJECT_ID, status: "draft" }),
        modelRow({ id: "model-approved", project_id: PROJECT_ID, status: "approved", title: "Approved model" }),
      ],
      error: null,
    });
    setTable("projects", { data: [projectRow()], error: null });

    await renderModels({ projectId: PROJECT_ID, status: "draft" });

    // Picking Draft must not report the Approved model as nonexistent.
    expect(screen.getByText("Approved (1)")).toBeInTheDocument();
    expect(screen.getByText("All (2)")).toBeInTheDocument();
  });

  it("never renders a filter sentence with nothing named in it", async () => {
    // `?readiness=` is the one filter that can hold an unrecognized value: only
    // "ready" and "gaps" narrow anything, so the label list can be empty while
    // the page still considers itself filtered. The sentence must not degrade to
    // "This catalog is filtered to ." — a filter named as a blank.
    setTable("models", { data: [], error: null });
    setTable("projects", { data: [projectRow()], error: null });

    await renderModels({ readiness: "partial" });

    expect(screen.getByText("No models match these filters")).toBeInTheDocument();
    expect(screen.queryByText(/filtered to \./)).toBeNull();
    expect(screen.getByText(/This list is filtered by the link it was opened with/)).toBeInTheDocument();
  });

  it("names the project a filtered empty catalog was narrowed to", async () => {
    setTable("models", { data: [modelRow()], error: null });
    setTable("projects", { data: [projectRow()], error: null });

    await renderModels({ projectId: PROJECT_ID });

    expect(screen.queryByText("No models yet")).toBeNull();
    expect(screen.getByText("No models match these filters")).toBeInTheDocument();
    expect(screen.getByText(/filtered to project Downtown Corridor/i)).toBeInTheDocument();
    expect(screen.getByText(/Showing only models for Downtown Corridor/)).toBeInTheDocument();
  });
});

describe("engagement catalog opened for one project", () => {
  async function renderEngagement(filters: { projectId?: string; status?: string }) {
    render(await EngagementPage({ searchParams: Promise.resolve(filters) }));
  }

  it("does not offer a filtered zero as proof the workspace has no campaigns", async () => {
    setTable("engagement_campaigns", { data: [campaignRow()], error: null });
    setTable("projects", { data: [projectRow()], error: null });

    await renderEngagement({ projectId: PROJECT_ID });

    expect(screen.queryByText("No campaigns yet")).toBeNull();
    expect(screen.getByText("No campaigns match these filters")).toBeInTheDocument();
    expect(screen.getByText(/filtered to project Downtown Corridor/i)).toBeInTheDocument();
  });

  it("counts the status tabs within the project it was opened for", async () => {
    setTable("engagement_campaigns", {
      data: [
        campaignRow({ id: "campaign-in", project_id: PROJECT_ID, status: "active" }),
        campaignRow({ id: "campaign-out", project_id: OTHER_PROJECT_ID, status: "active", title: "Other project" }),
      ],
      error: null,
    });
    setTable("projects", { data: [projectRow()], error: null });

    await renderEngagement({ projectId: PROJECT_ID });

    expect(screen.getByText("All (1)")).toBeInTheDocument();
    expect(screen.getByText("Active (1)")).toBeInTheDocument();
    expect(tabHrefs()).toContain(`/engagement?projectId=${PROJECT_ID}&status=closed`);
  });

  it("still tells an unfiltered workspace that it has none", async () => {
    setTable("engagement_campaigns", { data: [], error: null });
    setTable("projects", { data: [], error: null });

    await renderEngagement({});

    expect(screen.getByText("No campaigns yet")).toBeInTheDocument();
  });
});
