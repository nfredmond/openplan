import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHAT THE AERIAL REGISTER IS SHOWING, AND WHOSE MISSIONS THEY ARE.
 *
 * THE DEFECT. The project spine board's Aerial evidence lane counts one
 * project's missions — "2 missions tied to this project" — and then linked to a
 * bare `/aerial`, which is every mission in the workspace. The page could not
 * have honoured the id even if the board had sent one: it declared no
 * `searchParams`. So the board's own sentence and the list it handed over were
 * about different sets of rows, and nothing on screen said so.
 *
 * WHAT THESE PIN. Not "the page accepts a parameter" — that is a request shape.
 * The results: the narrowing reaches the DATABASE (the register is capped at 100
 * rows, so filtering afterwards would drop a project's older missions behind
 * other projects' newer ones); a filtered empty register says which project it
 * is empty FOR; a project this workspace does not have is refused by name rather
 * than rendered as "that project has no missions"; and a read that failed is not
 * printed as a zero.
 */

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (..._args: unknown[]) => {
    throw new Error("redirect");
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
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

import AerialIndexPage from "@/app/(app)/aerial/page";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT_ID = "33333333-3333-4333-8333-333333333333";

type Result = { data: unknown; error: { message: string } | null };

/** Every `.eq(column, value)` any builder saw this render, in order. */
let equalityFilters: Array<{ table: string; column: string; value: unknown }> = [];

/** A supabase-js query builder that answers with `result` however it is chained. */
function respondWith(table: string, result: Result) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.in = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.eq = (column: string, value: unknown) => {
    equalityFilters.push({ table, column, value });
    return builder;
  };
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function missionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mission-1",
    title: "Corridor overflight",
    status: "complete",
    mission_type: "corridor_survey",
    geography_label: "Study corridor",
    collected_at: "2026-07-01T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    project_id: PROJECT_ID,
    projects: { name: "US-33 interchange study" },
    ...overrides,
  };
}

function mountSupabase({
  project = { data: null, error: null } as Result,
  missions = { data: [], error: null } as Result,
  packages = { data: [], error: null } as Result,
}: { project?: Result; missions?: Result; packages?: Result } = {}) {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      if (table === "projects") return respondWith(table, project);
      if (table === "aerial_missions") return respondWith(table, missions);
      if (table === "aerial_evidence_packages") return respondWith(table, packages);
      throw new Error(`Unexpected table: ${table}`);
    },
  });
}

async function renderAerial(searchParams?: { projectId?: string }) {
  render(await AerialIndexPage({ searchParams: Promise.resolve(searchParams ?? {}) }));
}

const foundProject = { data: { id: PROJECT_ID, name: "US-33 interchange study" }, error: null } as Result;

describe("The aerial register says whose missions it is showing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    equalityFilters = [];
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "admin" },
    });
  });

  it("asks the database for one project's missions, not for all of them", async () => {
    mountSupabase({ project: foundProject, missions: { data: [missionRow()], error: null } });

    await renderAerial({ projectId: PROJECT_ID });

    // The narrowing has to happen in the query. The register is capped at 100
    // rows, so a post-fetch filter would hide this project's older missions
    // behind other projects' newer ones and report the shortfall as fact.
    expect(equalityFilters).toContainEqual({
      table: "aerial_missions",
      column: "project_id",
      value: PROJECT_ID,
    });
    expect(screen.getByText(/Showing only missions linked to US-33 interchange study/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Show every mission in this workspace/i })).toHaveAttribute(
      "href",
      "/aerial"
    );
  });

  it("resolves the requested project inside this workspace before trusting the id", async () => {
    mountSupabase({ project: foundProject, missions: { data: [missionRow()], error: null } });

    await renderAerial({ projectId: PROJECT_ID });

    // The id arrives from a URL. Without the workspace scope, "no missions for
    // that project" would be indistinguishable from "that project is not yours".
    expect(equalityFilters).toContainEqual({ table: "projects", column: "id", value: PROJECT_ID });
    expect(equalityFilters).toContainEqual({
      table: "projects",
      column: "workspace_id",
      value: WORKSPACE_ID,
    });
  });

  it("names the project a filtered register is empty for", async () => {
    mountSupabase({ project: foundProject, missions: { data: [], error: null } });

    await renderAerial({ projectId: PROJECT_ID });

    expect(screen.getByText(/No aerial missions are linked to US-33 interchange study/i)).toBeInTheDocument();
    expect(screen.getByText(/other missions may exist in this workspace/i)).toBeInTheDocument();
    // The unfiltered sentence is a claim about the whole workspace, and this
    // render has not looked at the whole workspace.
    expect(screen.queryByText(/No aerial missions recorded yet/i)).not.toBeInTheDocument();
  });

  it("refuses a project this workspace does not have instead of reporting it has no missions", async () => {
    mountSupabase({ project: { data: null, error: null }, missions: { data: [missionRow()], error: null } });

    await renderAerial({ projectId: OTHER_PROJECT_ID });

    expect(screen.getByText(/not in this workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/Every mission in this workspace is listed/i)).toBeInTheDocument();
    // And the fall-through is a genuinely unfiltered register, not an empty one
    // dressed up as a project's.
    expect(
      equalityFilters.some((filter) => filter.table === "aerial_missions" && filter.column === "project_id")
    ).toBe(false);
    expect(screen.getByText("Corridor overflight")).toBeInTheDocument();
  });

  it("discloses a project it could not read rather than silently showing everything", async () => {
    mountSupabase({
      project: { data: null, error: { message: "permission denied for table projects" } },
      missions: { data: [missionRow()], error: null },
    });

    await renderAerial({ projectId: PROJECT_ID });

    expect(screen.getByText(/Part of this page could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/permission denied for table projects/)).toBeInTheDocument();
    expect(screen.getByText(/whose record could not be read/i)).toBeInTheDocument();
  });

  it("still shows the whole workspace, labelled as such, when no project is named", async () => {
    mountSupabase({ missions: { data: [missionRow()], error: null } });

    await renderAerial();

    expect(screen.getByText(/Planned, active, and completed missions in this workspace/i)).toBeInTheDocument();
    expect(screen.queryByText(/Showing only missions linked to/i)).not.toBeInTheDocument();
    expect(
      equalityFilters.some((filter) => filter.table === "aerial_missions" && filter.column === "project_id")
    ).toBe(false);
    // No project was requested, so there is nothing to disclose about one.
    expect(screen.queryByText(/was not narrowed to that project/i)).not.toBeInTheDocument();
  });

  it("reports a failed mission read as unknown, never as zero missions", async () => {
    mountSupabase({ missions: { data: null, error: { message: "relation aerial_missions does not exist" } } });

    await renderAerial();

    expect(screen.getByText(/Missions could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/not evidence that no missions exist/i)).toBeInTheDocument();
    expect(screen.getByText(/relation aerial_missions does not exist/)).toBeInTheDocument();
    expect(screen.getByText("count unavailable")).toBeInTheDocument();
    // Four tiles — Missions, Active, Complete, Ready packages — and not one of
    // them may print the failed read as a count.
    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("reports a failed package read as unknown rather than as no packages", async () => {
    mountSupabase({
      missions: { data: [missionRow()], error: null },
      packages: { data: null, error: { message: "permission denied for table aerial_evidence_packages" } },
    });

    await renderAerial();

    expect(screen.getByText(/evidence packages for these missions/i)).toBeInTheDocument();
    expect(screen.getByText("unknown")).toBeInTheDocument();
    // The mission counts still loaded, so those stay numbers; only the package
    // tile goes unavailable.
    expect(screen.getAllByText("—")).toHaveLength(1);
  });
});
