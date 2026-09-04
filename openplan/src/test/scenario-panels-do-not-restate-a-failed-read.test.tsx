import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests render server components in jsdom; keep their server loaders real.
vi.mock("server-only", () => ({}));

/**
 * THE PANELS THE SCENARIO PAGES RENDER MAY NOT RESTATE A FAILED READ AS AN ABSENCE.
 *
 * THE DEFECT THIS EXISTS FOR — a seam defect, invisible from inside either half.
 * The scenario detail page was taught to disclose its failed reads instead of
 * rendering them as findings, and its own copy was fixed: "No alternatives
 * registered yet" became "this set's entries could not be read". But the SAME
 * entries array is handed to `ScenarioEntryRegistry`, which renders in the same
 * page's right-hand column and kept saying "No baseline registered yet. Add one
 * before expecting alternative comparisons to become decision-ready." and "No
 * alternatives yet. Register one to start comparison tracking." The page
 * contradicted itself, and the half carrying the instruction was the wrong one.
 *
 * WHY NOTHING CAUGHT IT. `scenario-detail-page.test.tsx` mocks
 * `ScenarioEntryRegistry`, so every assertion that the sentence was gone was
 * true of the page and false of the screen — the CLAUDE.md corollary that a test
 * which stubs the thing it is named for cannot prove that thing.
 *
 * So this file mocks everything EXCEPT the panel under test, and drives the real
 * page. The seam — page reads, page classifies, panel renders — is the whole
 * subject, and stubbing either end would leave it untested again.
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
 * A thenable builder answering whatever `setTable` registered for its table.
 * Every chainable method returns the builder, so the SHAPE of the chain does not
 * matter — only which table was asked. That is deliberate: a hand-shaped mock
 * chain is how two of this page's three `model_runs` reads went unexercised for
 * months while looking covered.
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
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
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

// Everything EXCEPT the panel under test. `ScenarioEntryRegistry` and
// `ScenarioSetCreator` are deliberately absent from this list.
vi.mock("@/components/scenarios/scenario-entry-composer", () => ({
  ScenarioEntryComposer: () => <div data-testid="scenario-entry-composer" />,
}));

vi.mock("@/components/scenarios/scenario-set-controls", () => ({
  ScenarioSetControls: () => <div data-testid="scenario-set-controls" />,
}));

vi.mock("@/components/scenarios/scenario-spine-panel", () => ({
  ScenarioSpinePanel: () => <div data-testid="scenario-spine-panel" />,
}));

vi.mock("@/components/cartographic/cartographic-surface-wide", () => ({
  CartographicSurfaceWide: () => <div data-testid="cartographic-surface-wide" />,
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

import ScenarioSetDetailPage from "@/app/(app)/scenarios/[scenarioSetId]/page";
import ScenariosPage from "@/app/(app)/scenarios/page";

const WORKSPACE_ID = "00000000-0000-4000-8000-0000000000aa";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const SCENARIO_SET_ID = "00000000-0000-4000-8000-0000000000b1";

const SCENARIO_SET_ROW = {
  id: SCENARIO_SET_ID,
  workspace_id: WORKSPACE_ID,
  project_id: PROJECT_ID,
  title: "Downtown alternatives",
  summary: "Compare protected bike and signal timing options.",
  planning_question: "Which package improves safety without unacceptable delay?",
  status: "active",
  baseline_entry_id: null,
  created_at: "2026-03-28T18:00:00.000Z",
  updated_at: "2026-03-28T21:00:00.000Z",
};

const ALTERNATIVE_ENTRY_ROW = {
  id: "00000000-0000-4000-8000-0000000000d1",
  scenario_set_id: SCENARIO_SET_ID,
  entry_type: "alternative",
  label: "Protected bike lanes",
  slug: "protected-bike-lanes",
  summary: null,
  assumptions_json: {},
  attached_run_id: null,
  attached_model_run_id: null,
  status: "draft",
  sort_order: 1,
  created_at: "2026-03-28T18:05:00.000Z",
  updated_at: "2026-03-28T18:05:00.000Z",
};

async function renderDetailPage() {
  render(await ScenarioSetDetailPage({ params: Promise.resolve({ scenarioSetId: SCENARIO_SET_ID }) }));
}

async function renderCatalogPage() {
  render(await ScenariosPage({ searchParams: Promise.resolve({}) }));
}

describe("the scenario entry registry, rendered for real, never restates a failed read as an absence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResults.clear();

    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "owner", workspaces: { name: "Test Agency" } },
      workspace: { name: "Test Agency" },
    });

    setTable("scenario_sets", { data: [SCENARIO_SET_ROW], error: null });
    setTable("projects", { data: [{ id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Downtown Mobility Plan" }], error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not tell the planner to register a baseline when the entries could not be read", async () => {
    setTable("scenario_entries", {
      data: null,
      error: { message: "permission denied for table scenario_entries" },
    });

    await renderDetailPage();

    // The sentences a failed entries read cannot support — each one both a
    // finding and an instruction the planner would act on.
    expect(screen.queryByText(/No baseline registered yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No alternatives yet\. Register one/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No alternatives are registered yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Missing baseline$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Register a baseline entry before alternatives can compare/i)).not.toBeInTheDocument();

    // And what replaces them, inside the panel itself.
    // Matched on the clause only this PANEL carries — the page's own summary
    // tile shares the first half of the sentence, so a looser matcher would be
    // satisfied by the half that was already fixed.
    expect(screen.getByText(/Nothing\s+shown here means one is missing/i)).toBeInTheDocument();
    expect(screen.getByText(/An empty registry here\s+is a failed read/i)).toBeInTheDocument();
    expect(screen.getByText(/readiness cannot be counted\.\s+This is not a count of zero/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot say whether it has a baseline/i)).toBeInTheDocument();
  });

  it("does not say no model is anchored when the models read failed", async () => {
    setTable("scenario_entries", { data: [ALTERNATIVE_ENTRY_ROW], error: null });
    setTable("models", { data: null, error: { message: "permission denied for table models" } });

    await renderDetailPage();

    expect(screen.queryByText(/No model is anchored to this scenario set yet/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/models anchored to this scenario set could not be read/i)
    ).toBeInTheDocument();
  });

  it("does not say an entry has no linked reports when the reports read failed", async () => {
    setTable("scenario_entries", { data: [ALTERNATIVE_ENTRY_ROW], error: null });
    setTable("reports", { data: null, error: { message: "permission denied for table reports" } });

    await renderDetailPage();

    expect(screen.queryByText(/^No linked reports yet$/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Report linkage could not be read$/)).toBeInTheDocument();
  });

  /**
   * THE CONTROL. Every read succeeds and the scenario set is genuinely empty, so
   * the ordinary sentences must ALL come back and no disclosure may appear.
   * Without it, a panel that warned unconditionally would pass every test above.
   */
  it("keeps the ordinary empty states when every read succeeds and the set is genuinely empty", async () => {
    setTable("scenario_entries", { data: [], error: null });
    setTable("models", { data: [], error: null });
    setTable("reports", { data: [], error: null });

    await renderDetailPage();

    expect(screen.queryByText(/Part of this scenario set could not be read/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No baseline registered yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No alternatives yet\. Register one/i)).toBeInTheDocument();
    expect(screen.getByText(/No alternatives are registered yet/i)).toBeInTheDocument();
    expect(screen.getByText(/^Missing baseline$/)).toBeInTheDocument();
    expect(screen.queryByText(/whether a baseline is registered is unknown/i)).not.toBeInTheDocument();
  });
});

describe("the scenario set creator, rendered for real, never restates a failed read as an absence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResults.clear();

    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "owner", workspaces: { name: "Test Agency" } },
      workspace: { name: "Test Agency" },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not tell the planner to create a project when the project list could not be read", async () => {
    setTable("scenario_sets", { data: [], error: null });
    setTable("projects", { data: null, error: { message: "permission denied for table projects" } });

    await renderCatalogPage();

    // The instruction that would send a planner to duplicate a project they
    // already have.
    expect(screen.queryByText(/^No projects available$/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Create a project before opening a scenario set/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText(/^Projects could not be read$/)).toBeInTheDocument();
    expect(screen.getByText(/do not create a duplicate project on the strength of it/i)).toBeInTheDocument();
  });

  it("keeps the ordinary empty state when the project read succeeds and there are none", async () => {
    setTable("scenario_sets", { data: [], error: null });
    setTable("projects", { data: [], error: null });

    await renderCatalogPage();

    expect(screen.getByText(/^No projects available$/)).toBeInTheDocument();
    expect(screen.getByText(/Create a project before opening a scenario set/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Projects could not be read$/)).not.toBeInTheDocument();
  });
});

describe("the catalog's counts are not restated as zero after a failed read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResults.clear();

    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "owner", workspaces: { name: "Test Agency" } },
      workspace: { name: "Test Agency" },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows no total and no per-status tab counts when the scenario-set list could not be read", async () => {
    setTable("scenario_sets", { data: null, error: { message: "permission denied for table scenario_sets" } });

    await renderCatalogPage();

    // "0 total" and "All (0) · Draft (0) · Active (0) · Archived (0)" are five
    // separate statements about the workspace, all of them produced by a query
    // that never returned.
    expect(screen.queryByText(/0 total/)).not.toBeInTheDocument();
    expect(screen.getByText(/Total unreadable/i)).toBeInTheDocument();
    expect(screen.queryByText(/All \(0\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Draft \(0\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Active \(0\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Archived \(0\)/)).not.toBeInTheDocument();
  });

  it("keeps the counts when the read succeeds and the workspace is genuinely empty", async () => {
    setTable("scenario_sets", { data: [], error: null });
    setTable("projects", { data: [], error: null });

    await renderCatalogPage();

    expect(screen.getByText(/0 total/)).toBeInTheDocument();
    expect(screen.getByText(/All \(0\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Total unreadable/i)).not.toBeInTheDocument();
  });
});
