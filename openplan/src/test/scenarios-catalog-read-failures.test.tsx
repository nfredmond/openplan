import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE SCENARIO CATALOG MAY NOT RENDER A FAILED READ AS AN ABSENCE.
 *
 * `const { data } = await supabase…` yields `null` for both "there is nothing
 * here" and "this query failed". This page destructured only `data` for its
 * scenario sets and for the entries behind every baseline badge, so a broken
 * query rendered "No scenario sets yet — create the first one" and turned every
 * surviving row's badge into "Baseline missing". Both are findings about the
 * planner's work that the render had no evidence for.
 *
 * It drives the REAL page, not a stub of its loader, because the defect lives in
 * the seam between the query and the sentence.
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
 * A thenable builder that answers whatever `setTable` registered for its table.
 * Every chainable method returns the builder, so the shape of the chain does not
 * matter — only which table was asked.
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

import ScenariosPage from "@/app/(app)/scenarios/page";

const WORKSPACE_ID = "00000000-0000-4000-8000-0000000000aa";

const SCENARIO_SET_ROW = {
  id: "00000000-0000-4000-8000-0000000000b1",
  workspace_id: WORKSPACE_ID,
  project_id: "00000000-0000-4000-8000-0000000000c1",
  title: "Downtown alternatives",
  summary: "Compare protected bike and signal timing options.",
  planning_question: "Which package improves safety without unacceptable delay?",
  status: "active",
  baseline_entry_id: null,
  created_at: "2026-03-28T18:00:00.000Z",
  updated_at: "2026-03-28T21:00:00.000Z",
  projects: { id: "00000000-0000-4000-8000-0000000000c1", name: "Downtown Mobility Plan" },
};

async function renderPage() {
  render(await ScenariosPage({ searchParams: Promise.resolve({}) }));
}

describe("the scenario catalog discloses a failed read instead of claiming an absence", () => {
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

  it("does not say the workspace has no scenario sets when the list could not be read", async () => {
    setTable("scenario_sets", { data: null, error: { message: "permission denied for table scenario_sets" } });

    await renderPage();

    expect(screen.getByText(/Part of this catalog could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/could not read this workspace's scenario sets/i)).toBeInTheDocument();
    // Internal page: the operator detail is shown, because whoever reads it can act on it.
    expect(screen.getByText(/permission denied for table scenario_sets/i)).toBeInTheDocument();

    // The sentence that would now be a lie, and what replaces it.
    expect(screen.queryByText(/No scenario sets yet/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Create the first scenario set to establish a baseline-versus-alternatives registry/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText(/^This catalog could not be read$/)).toBeInTheDocument();
    expect(screen.getByText(/That is a failed read, not an empty workspace/i)).toBeInTheDocument();
  });

  it("does not brand every set 'Baseline missing' when the entries read failed", async () => {
    setTable("scenario_sets", { data: [SCENARIO_SET_ROW], error: null });
    setTable("scenario_entries", {
      data: null,
      error: { message: "permission denied for table scenario_entries" },
    });

    await renderPage();

    expect(screen.getByText(/could not read scenario entries/i)).toBeInTheDocument();
    expect(screen.getByText(/Downtown alternatives/i)).toBeInTheDocument();
    // The row still renders — what loaded is shown — but the badge stops making
    // a claim the entries read never supported.
    expect(screen.queryByText(/Baseline missing/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Baseline unreadable/i)).toBeInTheDocument();
    expect(screen.getAllByText(/alternatives unreadable/i).length).toBeGreaterThan(0);
  });

  /**
   * THE CONTROL, and the assertion that makes the two above mean anything:
   * without it a page that warned unconditionally would pass them both.
   */
  it("keeps the ordinary empty state when the reads succeed and the workspace is genuinely empty", async () => {
    setTable("scenario_sets", { data: [], error: null });
    setTable("projects", { data: [], error: null });

    await renderPage();

    expect(screen.queryByText(/Part of this catalog could not be read/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^This catalog could not be read$/)).not.toBeInTheDocument();
    expect(screen.getByText(/No scenario sets yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Create the first scenario set to establish a baseline-versus-alternatives registry/i)
    ).toBeInTheDocument();
  });

  it("keeps the ordinary baseline badge when the entries read succeeds and there is no baseline", async () => {
    setTable("scenario_sets", { data: [SCENARIO_SET_ROW], error: null });
    setTable("scenario_entries", {
      data: [{ scenario_set_id: SCENARIO_SET_ROW.id, entry_type: "alternative" }],
      error: null,
    });

    await renderPage();

    expect(screen.queryByText(/Part of this catalog could not be read/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Baseline missing/i)).toBeInTheDocument();
    expect(screen.queryByText(/Baseline unreadable/i)).not.toBeInTheDocument();
  });
});
