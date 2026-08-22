import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A PLANNER ON /aerial CAN ACTUALLY START A MISSION.
 *
 * THE DEFECT. Missions could only be created from a project detail page —
 * `AerialMissionCreator` requires a `projectId`, correctly, because the
 * mission-project link is what carries imagery into the evidence chain. But the
 * register at `/aerial` is where a planner who thinks in missions stands, and
 * it offered no creation affordance at all: a complete capability with no front
 * door on its own module page.
 *
 * WHAT THESE PIN. The register mounts a launcher whose project picker lists
 * THIS workspace's projects (the filter reaches the database — recorded off the
 * fake, not assumed); the mission the form submits is bound to the project the
 * planner CHOSE, not to the first one listed; a workspace with no projects is
 * told a mission needs one instead of shown a dead form; and a failed project
 * read is disclosed rather than rendered as "no projects".
 */

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (..._args: unknown[]) => {
    throw new Error("redirect");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ALPHA_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_BETA_ID = "22222222-2222-4222-8222-222222222222";

type Result = { data: unknown; error: { message: string } | null };

/** Every `.eq(column, value)` any builder saw this render, in order. */
let equalityFilters: Array<{ table: string; column: string; value: unknown }> = [];

/**
 * A supabase-js query builder that answers `maybeSingle()` with `single` and a
 * thenable chain with `list` — the page asks the projects table both questions
 * (the focus project, and the picker's list), and a fake that cannot tell them
 * apart would hand the picker a single object.
 */
function respondWith(table: string, list: Result, single: Result = { data: null, error: null }) {
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
  builder.maybeSingle = () => Promise.resolve(single);
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(list).then(resolve, reject);
  return builder;
}

function mountSupabase({
  projectList = { data: [], error: null } as Result,
  focusProject = { data: null, error: null } as Result,
  missions = { data: [], error: null } as Result,
  packages = { data: [], error: null } as Result,
}: { projectList?: Result; focusProject?: Result; missions?: Result; packages?: Result } = {}) {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      if (table === "projects") return respondWith(table, projectList, focusProject);
      if (table === "aerial_missions") return respondWith(table, missions);
      if (table === "aerial_evidence_packages") return respondWith(table, packages);
      throw new Error(`Unexpected table: ${table}`);
    },
  });
}

const twoProjects: Result = {
  data: [
    { id: PROJECT_ALPHA_ID, name: "Alpha corridor study" },
    { id: PROJECT_BETA_ID, name: "Beta bridge inspection" },
  ],
  error: null,
};

async function renderAerial(searchParams?: { projectId?: string }) {
  render(await AerialIndexPage({ searchParams: Promise.resolve(searchParams ?? {}) }));
}

describe("The aerial register can start a mission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    equalityFilters = [];
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "admin" },
    });
  });

  it("offers a project picker listing this workspace's projects", async () => {
    mountSupabase({ projectList: twoProjects });

    await renderAerial();

    const picker = screen.getByLabelText(/Project this mission is for/i);
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Alpha corridor study" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beta bridge inspection" })).toBeInTheDocument();

    // The list has to be narrowed in the database — a picker fed from an
    // unscoped read would offer another workspace's projects to fly for.
    expect(equalityFilters).toContainEqual({
      table: "projects",
      column: "workspace_id",
      value: WORKSPACE_ID,
    });
  });

  it("submits the mission against the project the planner chose, not the first one listed", async () => {
    mountSupabase({ projectList: twoProjects });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ missionId: "mission-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await renderAerial();

      // No project chosen yet: the way in is withheld, because a mission with
      // no project cannot be created and offering the form would pretend
      // otherwise.
      expect(screen.queryByTestId("aerial-mission-creator-open")).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/Project this mission is for/i), {
        target: { value: PROJECT_BETA_ID },
      });

      // The mission form is a guided flow now (2026-08-22), so it is entered
      // rather than filled in place.
      fireEvent.click(screen.getByTestId("aerial-mission-creator-open"));
      fireEvent.change(screen.getByLabelText("Mission name"), {
        target: { value: "Deck condition overflight" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Next/ }));
      fireEvent.click(screen.getByRole("button", { name: "Log the mission" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(url).toBe("/api/aerial/missions");
      const body = JSON.parse(init.body) as { projectId: string; title: string };
      // Beta is the SECOND option: a launcher that hardcoded the first project,
      // or ignored the picker entirely, fails here.
      expect(body.projectId).toBe(PROJECT_BETA_ID);
      expect(body.title).toBe("Deck condition overflight");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("starts the picker on the project the register was opened for", async () => {
    mountSupabase({
      projectList: twoProjects,
      focusProject: { data: { id: PROJECT_BETA_ID, name: "Beta bridge inspection" }, error: null },
    });

    await renderAerial({ projectId: PROJECT_BETA_ID });

    const picker = screen.getByLabelText(/Project this mission is for/i) as HTMLSelectElement;
    expect(picker.value).toBe(PROJECT_BETA_ID);
    // Preselected means the way into the form is offered for that project.
    expect(screen.getByTestId("aerial-mission-creator-open")).toBeInTheDocument();
  });

  it("names the project inside the flow, because the flow covers the picker", async () => {
    // The launcher exists so a mission's project link is CHOSEN rather than
    // skipped. Its copy used to say "the project chosen above", which was true
    // while the form sat under the picker — a flow covers the picker, so
    // "above" would point at something the planner cannot see.
    mountSupabase({
      projectList: twoProjects,
      focusProject: { data: { id: PROJECT_BETA_ID, name: "Beta bridge inspection" }, error: null },
    });

    await renderAerial({ projectId: PROJECT_BETA_ID });

    expect(screen.getByText(/Log a mission for Beta bridge inspection/i)).toBeInTheDocument();
    expect(screen.getAllByText(/linked to Beta bridge inspection/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/the project chosen above/i)).toBeNull();
  });

  it("tells a workspace with no projects that a mission needs one", async () => {
    mountSupabase({ projectList: { data: [], error: null } });

    await renderAerial();

    expect(screen.getByText(/This workspace has no projects yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create a project first/i })).toHaveAttribute(
      "href",
      "/projects"
    );
    expect(screen.queryByLabelText(/Project this mission is for/i)).not.toBeInTheDocument();
  });

  it("discloses a failed project read instead of presenting it as no projects", async () => {
    mountSupabase({ projectList: { data: null, error: { message: "permission denied for table projects" } } });

    await renderAerial();

    expect(screen.getByText(/a mission cannot be started from this page right now/i)).toBeInTheDocument();
    // The failed read must not borrow the empty workspace's sentence.
    expect(screen.queryByText(/This workspace has no projects yet/i)).not.toBeInTheDocument();
    // And the page-level banner names the read by what it was for.
    expect(screen.getByText(/Part of this page could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/needed to start a new mission/i)).toBeInTheDocument();
  });
});
