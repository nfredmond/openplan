import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A FAILED READ MAY NOT BE RENDERED AS AN ANSWER — the county-models lane.
 *
 * `const { data } = await supabase…` yields `null` for both "there is nothing
 * here" and "this query failed", so both of these pages had a sentence written
 * for the first case that stated the second one as fact:
 *
 *   - /models rendered "No models yet — create the first model record", i.e. a
 *     workspace being told its own catalog is empty, on the strength of a broken
 *     query; and every row's "0 reports · 0 runs" plus its readiness verdict come
 *     out of ONE `model_links` read, so a single 400 there claimed the planner
 *     had linked nothing to anything;
 *   - /county-runs/[id] read the run's own row only for its name, and a failed
 *     read left the CEQA VMT screen labelling its scenario by the raw run id with
 *     no explanation — an evidence surface quietly losing the identifier a
 *     reviewer would check it by.
 *
 * The third assertion in each pair is the one that makes the other two mean
 * something: when the read SUCCEEDS and there is genuinely nothing, the ordinary
 * empty state must still appear. Without it a page that always shouted "could not
 * be read" would pass.
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
 * Every chainable method returns the builder and the builder is a thenable, so
 * the shape of the chain does not matter — only which table was asked.
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
const loadBehavioralOnrampKpisForWorkspaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
  // ModelCreator is rendered for real below, and it calls useRouter on mount.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
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

vi.mock("@/lib/models/behavioral-onramp-kpis", () => ({
  loadBehavioralOnrampKpisForWorkspace: (...args: unknown[]) =>
    loadBehavioralOnrampKpisForWorkspaceMock(...args),
}));

// ModelCreator is NOT stubbed. Its two option pickers are the surface under
// test in the "creator picker" block below, and a stub would prove only that
// the page passes a prop — not that a planner is told the list is incomplete.

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

// The detail client owns its own loading and error states over a separate API
// call; this file is about the SERVER page's reads, so it is stubbed out.
vi.mock("@/components/county-runs/county-run-detail-client", () => ({
  CountyRunDetailClient: () => <div data-testid="county-run-detail-client" />,
}));

vi.mock("@/app/(app)/county-runs/[countyRunId]/_components/county-run-behavioral-kpis", () => ({
  CountyRunBehavioralKpisSection: () => <div data-testid="county-run-behavioral-kpis" />,
}));

import CountyRunDetailPage from "@/app/(app)/county-runs/[countyRunId]/page";
import ModelsPage from "@/app/(app)/models/page";

const COUNTY_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function modelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "model-1",
    workspace_id: "workspace-1",
    project_id: null,
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
  loadBehavioralOnrampKpisForWorkspaceMock.mockResolvedValue({
    kpis: [],
    rejectedCountyRunIds: [],
    caveatGateReason: null,
    error: null,
  });
});

describe("/models when a read fails", () => {
  async function renderModels(filters: Record<string, string> = {}) {
    render(await ModelsPage({ searchParams: Promise.resolve(filters) }));
  }

  it("does not tell a workspace it has no models when the catalog query failed", async () => {
    setTable("models", { data: null, error: { message: "permission denied for table models" } });

    await renderModels();

    expect(screen.queryByText("No models yet")).toBeNull();
    expect(screen.getByTestId("models-catalog-unreadable")).toBeInTheDocument();
    expect(screen.getByTestId("models-read-failures")).toHaveTextContent(
      /could not read your models/i
    );
    // The operator detail belongs on an internal page.
    expect(screen.getByTestId("models-read-failures")).toHaveTextContent(
      /permission denied for table models/
    );
  });

  it("reports no count it cannot stand behind when the catalog query failed", async () => {
    setTable("models", { data: null, error: { message: "permission denied for table models" } });

    await renderModels();

    expect(screen.queryByText("0 total")).toBeNull();
    expect(screen.getByText("Total unavailable")).toBeInTheDocument();
    expect(screen.queryByText("All (0)")).toBeNull();
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  it("still tells a genuinely empty workspace that it has no models", async () => {
    setTable("models", { data: [], error: null });

    await renderModels();

    expect(screen.getByText("No models yet")).toBeInTheDocument();
    expect(screen.queryByTestId("models-read-failures")).toBeNull();
    expect(screen.queryByTestId("models-catalog-unreadable")).toBeNull();
    expect(screen.getByText("0 total")).toBeInTheDocument();
  });

  it("does not report a model as unlinked when the model_links query failed", async () => {
    setTable("models", { data: [modelRow()], error: null });
    setTable("model_links", { data: null, error: { message: "column model_links.linked_id missing" } });

    await renderModels();

    expect(screen.queryByText(/0 reports · 0 runs/)).toBeNull();
    expect(screen.getByText(/Readiness and links unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/^Missing:/)).toBeNull();
    expect(screen.getByTestId("models-read-failures")).toHaveTextContent(/what each model is connected to/i);
  });

  it("still reports a genuinely unlinked model as unlinked", async () => {
    setTable("models", { data: [modelRow()], error: null });
    setTable("model_links", { data: [], error: null });

    await renderModels();

    expect(screen.getByText(/0 reports · 0 runs/)).toBeInTheDocument();
    expect(screen.getByText(/^Missing:/)).toBeInTheDocument();
    expect(screen.queryByTestId("models-read-failures")).toBeNull();
  });

  /**
   * The creator's pickers are a DECISION surface, and they were the gap the
   * page-level banner did not close: a failed `projects` read reaches the
   * `<select>` as `[]`, which renders identically to a workspace that has no
   * projects. The planner picks "No primary project", and the catalog then
   * reports the resulting model as having a readiness gap.
   *
   * ModelCreator is deliberately NOT stubbed in this file, so these assertions
   * run against the real dropdown a planner sees.
   *
   * The pickers moved into a guided flow, so getting to them now means doing
   * what a planner does: press the button, then walk to the step the pickers
   * are on. `openTheModelCreator` is that walk, and it is deliberately NOT a
   * shortcut past the flow — a disclosure a planner cannot reach is the defect
   * this block exists to catch.
   */
  async function openTheModelCreator() {
    fireEvent.click(screen.getByTestId("model-creator-open"));
    // The flow will not walk past its own required answer, which is the point
    // of it — so this types one, exactly as a planner would.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A model" } });
    fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
    await waitFor(() => expect(screen.getByLabelText(/Primary project/i)).toBeInTheDocument());
  }

  it("does not present an unreadable project list as a workspace with no projects", async () => {
    setTable("projects", { data: null, error: { message: "permission denied for table projects" } });

    await renderModels();
    await openTheModelCreator();

    // The picker itself is rendered for real, and it says the list is incomplete.
    expect(screen.getByTestId("model-creator-projects-unreadable")).toHaveTextContent(
      /does not mean there are none/i
    );
    // And it is still usable — disclosure, not restriction.
    expect(screen.getByLabelText(/Primary project/i)).not.toBeDisabled();
  });

  it("does not present an unreadable scenario set list as a workspace with no scenario sets", async () => {
    setTable("scenario_sets", {
      data: null,
      error: { message: "permission denied for table scenario_sets" },
    });

    await renderModels();
    await openTheModelCreator();

    expect(screen.getByTestId("model-creator-scenario-sets-unreadable")).toHaveTextContent(
      /does not mean there are none/i
    );
    expect(screen.getByLabelText(/Primary scenario set/i)).not.toBeDisabled();
  });

  it("says nothing about the pickers when both option lists read cleanly", async () => {
    setTable("projects", { data: [{ id: "project-1", name: "Corridor study" }], error: null });
    setTable("scenario_sets", { data: [{ id: "set-1", title: "2050 baseline" }], error: null });

    await renderModels();
    await openTheModelCreator();

    expect(screen.queryByTestId("model-creator-projects-unreadable")).toBeNull();
    expect(screen.queryByTestId("model-creator-scenario-sets-unreadable")).toBeNull();
    // The options that did load are offered.
    expect(screen.getByRole("option", { name: "Corridor study" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2050 baseline" })).toBeInTheDocument();
  });
});

describe("/county-runs/[countyRunId] when the run's own row cannot be read", () => {
  async function renderCountyRun() {
    render(
      await CountyRunDetailPage({
        params: Promise.resolve({ countyRunId: COUNTY_RUN_ID }),
        searchParams: Promise.resolve({}),
      })
    );
  }

  it("discloses the failure instead of silently falling back to the run id", async () => {
    setTable("county_runs", { data: null, error: { message: "permission denied for table county_runs" } });

    await renderCountyRun();

    expect(screen.getByTestId("county-run-read-failures")).toHaveTextContent(
      /could not read this county run's record/i
    );
    expect(screen.getByTestId("county-run-read-failures")).toHaveTextContent(
      /permission denied for table county_runs/
    );
    expect(screen.getByTestId("ceqa-vmt-run-name-read-error")).toHaveTextContent(
      /has not been shown to be unnamed/i
    );
  });

  it("says nothing about a read failure when the row simply is not there", async () => {
    setTable("county_runs", { data: null, error: null });

    await renderCountyRun();

    expect(screen.queryByTestId("county-run-read-failures")).toBeNull();
    expect(screen.queryByTestId("ceqa-vmt-run-name-read-error")).toBeNull();
    expect(screen.getByTestId("ceqa-vmt-screen")).toBeInTheDocument();
  });
});
