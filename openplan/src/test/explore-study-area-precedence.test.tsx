import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHICH AREA ANALYSIS STUDIO OPENS ON, AND WHAT IT ADMITS WHEN IT ISN'T THE
 * PROJECT'S.
 *
 * THE DEFECT. `/explore` was the last of the three study-area front doors still
 * reading the workspace's home geography and nothing else — and the one where
 * the substitution was silent. Safety retrieves crashes and county onboarding
 * refuses a non-county out loud, but Explore simply ran the analysis on the
 * wider area and reported numbers for it. For an agency whose workspace home is
 * a county and whose projects are corridors or cities, every study opened on the
 * county with nothing on screen saying so.
 *
 * WHAT THIS SUITE PINS. The loader reads the project named in `?projectId=`,
 * scoped to the caller's workspace, and hands its area of record down as the
 * candidate that outranks the workspace home. And every way that can fail —
 * unmigrated deployment, unreadable row, another workspace's project, a project
 * with no area yet — is disclosed in its own words instead of being answered
 * with the county.
 */

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

// The workbench owns a Mapbox surface, a run history and a workspace bootstrap
// flow — none of which is what this loader decides. Here it only has to report
// what it was handed.
vi.mock("@/app/(app)/explore/_components/explore-workbench", () => ({
  ExploreWorkbench: ({
    projectPlace,
    openedForProject,
    projectAreaNotice,
  }: {
    projectPlace: { label: string | null; geometry: unknown } | null;
    openedForProject: { id: string; name: string | null } | null;
    projectAreaNotice: string | null;
  }) => (
    <div>
      <span data-testid="inherited-label">{projectPlace?.label ?? "(none)"}</span>
      <span data-testid="inherited-geometry">
        {projectPlace?.geometry ? JSON.stringify(projectPlace.geometry) : "(none)"}
      </span>
      <span data-testid="opened-for">{openedForProject?.name ?? "(none)"}</span>
      <span data-testid="notice">{projectAreaNotice ?? "(none)"}</span>
    </div>
  ),
}));

import ExplorePage from "@/app/(app)/explore/page";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [-83.05, 39.92],
      [-82.95, 39.92],
      [-82.95, 39.98],
      [-83.05, 39.98],
      [-83.05, 39.92],
    ],
  ],
};

function projectPlaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    name: "Broad Street corridor study",
    place_source: "tigerweb",
    place_kind: "city",
    place_ref: "3918000",
    place_label: "Columbus, Ohio",
    place_country_code: "US",
    place_subdivision_code: "OH",
    place_min_lon: -83.05,
    place_min_lat: 39.92,
    place_max_lon: -82.95,
    place_max_lat: 39.98,
    place_geometry_geojson: POLYGON,
    place_set_at: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

type Result = { data: unknown; error: { message: string } | null };

/** A supabase-js query builder that answers with `result` however it is chained. */
function respondWith(result: Result) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mountSupabase(projectPlace: Result = { data: null, error: null }) {
  const tables: string[] = [];
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      tables.push(table);
      if (table === "projects") return respondWith(projectPlace);
      throw new Error(`Unexpected table: ${table}`);
    },
  });
  return tables;
}

async function renderExplore(searchParams?: { projectId?: string }) {
  render(await ExplorePage({ searchParams: Promise.resolve(searchParams ?? {}) }));
}

describe("Analysis Studio opens on the right area", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "admin" },
    });
  });

  it("hands the workbench the study area of the project it was opened for", async () => {
    mountSupabase({ data: projectPlaceRow(), error: null });

    await renderExplore({ projectId: PROJECT_ID });

    expect(screen.getByTestId("inherited-label")).toHaveTextContent("Columbus, Ohio");
    expect(screen.getByTestId("inherited-geometry")).toHaveTextContent(JSON.stringify(POLYGON));
    expect(screen.getByTestId("opened-for")).toHaveTextContent("Broad Street corridor study");
    expect(screen.getByTestId("notice")).toHaveTextContent("(none)");
  });

  it("reads nothing at all when no project was named", async () => {
    // Opening Analysis Studio from the nav is still the workspace-home path, and
    // it must not cost a project query to get there.
    const tables = mountSupabase();

    await renderExplore();

    expect(screen.getByTestId("inherited-label")).toHaveTextContent("(none)");
    expect(screen.getByTestId("opened-for")).toHaveTextContent("(none)");
    expect(screen.getByTestId("notice")).toHaveTextContent("(none)");
    expect(tables).toEqual([]);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("discloses a project it could not read instead of quietly analyzing the workspace county", async () => {
    mountSupabase({ data: null, error: { message: "permission denied for table projects" } });

    await renderExplore({ projectId: PROJECT_ID });

    expect(screen.getByTestId("notice")).toHaveTextContent(/could not be read/i);
    // The database's own words, so an operator has something to act on.
    expect(screen.getByTestId("notice")).toHaveTextContent("permission denied for table projects");
    expect(screen.getByTestId("inherited-label")).toHaveTextContent("(none)");
  });

  it("calls a deployment without the place columns unmigrated, not a failed read", async () => {
    mountSupabase({ data: null, error: { message: "column projects.place_source does not exist" } });

    await renderExplore({ projectId: PROJECT_ID });

    expect(screen.getByTestId("notice")).toHaveTextContent(/does not record project study areas yet/i);
    expect(screen.getByTestId("notice")).not.toHaveTextContent(/could not be read/i);
  });

  it("says a project is not in this workspace rather than showing an empty result as an answer", async () => {
    mountSupabase({ data: null, error: null });

    await renderExplore({ projectId: PROJECT_ID });

    expect(screen.getByTestId("notice")).toHaveTextContent(/not in this workspace/i);
    expect(screen.getByTestId("opened-for")).toHaveTextContent("(none)");
  });

  it("says a project has no study area of its own rather than passing the county off as its", async () => {
    // A bbox without a boundary cannot seed an area — see `studyAreaPrefillFrom`.
    mountSupabase({ data: projectPlaceRow({ place_geometry_geojson: null }), error: null });

    await renderExplore({ projectId: PROJECT_ID });

    expect(screen.getByTestId("notice")).toHaveTextContent(
      /Broad Street corridor study has no study area of its own yet/i
    );
    expect(screen.getByTestId("inherited-label")).toHaveTextContent("(none)");
    // The project is still named, so the panel can link to the record the
    // planner has to go and fix.
    expect(screen.getByTestId("opened-for")).toHaveTextContent("Broad Street corridor study");
  });

  it("does not manufacture a project notice for a visitor who has no workspace yet", async () => {
    // Signing up and landing here with a stale link is a real path. The
    // workbench's own membership panel is the honest thing to show; a second
    // notice about a project nobody could read would be noise on top of it.
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null });
    const tables = mountSupabase();

    await renderExplore({ projectId: PROJECT_ID });

    expect(screen.getByTestId("notice")).toHaveTextContent("(none)");
    expect(tables).toEqual([]);
  });
});
