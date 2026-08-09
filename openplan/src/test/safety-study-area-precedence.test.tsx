import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * WHICH AREA SAFETY OPENS ON, AND WHETHER IT SAYS SO.
 *
 * THE DEFECT. `/safety` read the workspace's home geography and nothing else.
 * For an MPO or RTPA whose workspace home is a county but whose projects are
 * corridors and cities, that prefilled the county every single time — and the
 * page could not even be told which project it had been opened for. A planner
 * working a two-mile corridor retrieved, mapped and reported crashes for the
 * whole county without anything on screen saying so.
 *
 * These tests are about the RESULT: which boundary the crash query actually ran
 * against, and what the page told the planner about where that boundary came
 * from. They deliberately drive the real `SafetyWorkspace` through the real
 * server loader rather than asserting on props, because "the page passed the
 * right object" is not the same claim as "the right crashes were fetched".
 */

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
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

// Mapbox-backed; this suite is about which boundary was chosen, not how it draws.
vi.mock("@/components/safety/safety-crash-map", () => ({
  SafetyCrashMap: () => <div data-testid="safety-crash-map" />,
}));

// The shared any-US-place picker, reduced to the two things this suite needs to
// see: the name the caller vouches for (`externalLabel`), and the fact that the
// boundary in the box is the one the loader seeded.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({ corridorText, externalLabel }: { corridorText: string; externalLabel?: string | null }) => (
    <div>
      <span data-testid="picker-external-label">{externalLabel ?? "(none)"}</span>
      <span data-testid="picker-corridor-text">{corridorText}</span>
    </div>
  ),
}));

import SafetyPage from "@/app/(app)/safety/page";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

/** A corridor inside the county below — the area a project would actually study. */
const PROJECT_POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [-121.06, 39.21],
      [-121.02, 39.21],
      [-121.02, 39.25],
      [-121.06, 39.25],
      [-121.06, 39.21],
    ],
  ],
};

/** The whole county — what the workspace states as its home geography. */
const COUNTY_POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [-121.3, 39.1],
      [-120.0, 39.1],
      [-120.0, 39.6],
      [-121.3, 39.6],
      [-121.3, 39.1],
    ],
  ],
};

function workspaceHomeRow() {
  return {
    home_geography_source: "tigerweb",
    home_geography_kind: "county",
    home_geography_ref: "06057",
    home_geography_label: "Nevada County, California",
    home_country_code: "US",
    home_subdivision_code: "CA",
    home_min_lon: -121.3,
    home_min_lat: 39.1,
    home_max_lon: -120.0,
    home_max_lat: 39.6,
    home_geometry_geojson: COUNTY_POLYGON,
    home_geography_set_at: "2026-07-01T00:00:00.000Z",
  };
}

function projectPlaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    name: "SR-49 corridor improvements",
    place_source: "tigerweb",
    place_kind: "city",
    place_ref: "0630000",
    place_label: "Grass Valley, California",
    place_country_code: "US",
    place_subdivision_code: "CA",
    place_min_lon: -121.06,
    place_min_lat: 39.21,
    place_max_lon: -121.02,
    place_max_lat: 39.25,
    place_geometry_geojson: PROJECT_POLYGON,
    place_set_at: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

type Result = { data: unknown; error: { message: string } | null };

/**
 * A supabase-js query builder that answers with `result` however it is chained.
 * Thenable so an un-terminated builder can be awaited, as the page does for the
 * list reads.
 */
function respondWith(result: Result) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mountSupabase({
  workspace = { data: workspaceHomeRow(), error: null } as Result,
  projectPlace = { data: null, error: null } as Result,
  projectOptions = [] as Array<{ id: string; name: string; status: string }>,
  ingests = [] as Array<Record<string, unknown>>,
  /**
   * Lets a test make the crash-import read FAIL. Without this the fixture is
   * returned whatever happens, so the failure path — the one where the page
   * could tell an agency it has no crash data — is unreachable by any test.
   */
  ingestsResult = null as Result | null,
}: {
  workspace?: Result;
  projectPlace?: Result;
  projectOptions?: Array<{ id: string; name: string; status: string }>;
  ingests?: Array<Record<string, unknown>>;
  ingestsResult?: Result | null;
} = {}) {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      if (table === "workspaces") return respondWith(workspace);
      if (table === "projects") {
        return {
          // The two reads on `projects` are told apart by their projection: the
          // place read is the only one that asks for the boundary geometry.
          select: (columns: string) =>
            columns.includes("place_geometry_geojson")
              ? respondWith(projectPlace)
              : respondWith({ data: projectOptions, error: null }),
        };
      }
      if (table === "safety_crash_ingests")
        return respondWith(ingestsResult ?? { data: ingests, error: null });
      throw new Error(`Unexpected table: ${table}`);
    },
  });
}

async function renderSafety(searchParams?: { projectId?: string }) {
  render(await SafetyPage({ searchParams: Promise.resolve(searchParams ?? {}) }));
}

/** The bbox the crash query was actually issued for, or null if none was. */
function crashQueryBbox(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find((args) => String(args[0]).includes("/api/safety/crashes?"));
  if (!call) return null;
  const params = new URL(String(call[0]), "http://localhost").searchParams;
  return {
    minLon: Number(params.get("minLon")),
    maxLon: Number(params.get("maxLon")),
  };
}

describe("Safety opens on the right study area", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "admin" },
    });
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ type: "FeatureCollection", features: [], returnedCount: 0, matchedCount: 0 }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retrieves crashes for the project's corridor, not the workspace's county", async () => {
    mountSupabase({ projectPlace: { data: projectPlaceRow(), error: null } });

    await renderSafety({ projectId: PROJECT_ID });

    // The result that matters: the crash query ran against the corridor. Before
    // this, the same page issued the county bbox and nothing said otherwise.
    await waitFor(() => expect(crashQueryBbox(fetchMock)).not.toBeNull());
    expect(crashQueryBbox(fetchMock)).toEqual({ minLon: -121.06, maxLon: -121.02 });
  });

  it("names the project the area came from, so a corridor is not mistaken for the county", async () => {
    mountSupabase({ projectPlace: { data: projectPlaceRow(), error: null } });

    await renderSafety({ projectId: PROJECT_ID });

    expect(await screen.findByText(/Starting from the study area set on/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SR-49 corridor improvements" })).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}`
    );
    expect(screen.getByText(/\(Grass Valley, California\)/)).toBeInTheDocument();
    // And the picker card carries the same name rather than "Custom study area".
    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("Grass Valley, California");
  });

  it("falls back to the workspace home only when the project has none, and says which it used", async () => {
    mountSupabase({
      projectPlace: { data: projectPlaceRow({ place_geometry_geojson: null }), error: null },
    });

    await renderSafety({ projectId: PROJECT_ID });

    expect(await screen.findByText(/Starting from this workspace[\u2019']s home geography/i)).toBeInTheDocument();
    expect(screen.getByText(/\(Nevada County, California\)/)).toBeInTheDocument();
    // The fall-through is explained, not left for the planner to notice: a
    // county-wide retrieval must not pass for a corridor-scoped one.
    expect(
      screen.getByText(/SR-49 corridor improvements has no study area of its own yet/i)
    ).toBeInTheDocument();
  });

  it("discloses a project it could not read instead of quietly retrieving the county", async () => {
    mountSupabase({
      projectPlace: { data: null, error: { message: "permission denied for table projects" } },
    });

    await renderSafety({ projectId: PROJECT_ID });

    expect(
      await screen.findByText(/could not read the project this page was opened for/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/permission denied for table projects/)).toBeInTheDocument();
    expect(
      screen.getByText(/whose record could not be read, so its study area could not be used/i)
    ).toBeInTheDocument();
  });

  it("calls a deployment without the place columns unmigrated, not a failed read", async () => {
    // Classify first, collect what is left. A deployment that has not applied
    // 20260728000009 answers 42703 for every place column; saying "this page
    // could not read the project" there would send an operator hunting a
    // permissions problem that does not exist.
    mountSupabase({
      projectPlace: { data: null, error: { message: 'column projects.place_source does not exist' } },
    });

    await renderSafety({ projectId: PROJECT_ID });

    expect(
      await screen.findByText(/does not record project study areas yet/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Part of this page could not be read/i)).not.toBeInTheDocument();
  });

  it("refuses to inherit from a project that is not in this workspace", async () => {
    // `maybeSingle` answers "no row" for another workspace's project, which is an
    // answer and not a failure — and must not read as "that project has no area".
    mountSupabase({ projectPlace: { data: null, error: null } });

    await renderSafety({ projectId: PROJECT_ID });

    expect(
      await screen.findByText(/not in this workspace, so its study area could not be used/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Starting from this workspace[\u2019']s home geography/i)).toBeInTheDocument();
  });

  it("still opens on the workspace home when no project is named", async () => {
    mountSupabase();

    await renderSafety();

    await waitFor(() => expect(crashQueryBbox(fetchMock)).not.toBeNull());
    expect(crashQueryBbox(fetchMock)).toEqual({ minLon: -121.3, maxLon: -120.0 });
    expect(screen.getByText(/Starting from this workspace[\u2019']s home geography/i)).toBeInTheDocument();
    // Nothing was asked for, so nothing is claimed about a project.
    expect(screen.queryByText(/study area could not be used/i)).not.toBeInTheDocument();
  });

  it("attaches the next acquisition to the project it was opened for, over the last one's habit", async () => {
    // Without this, a planner who opened Safety for a project and retrieved
    // crashes left the project's safety lane empty — the acquisition landed on
    // whichever project the PREVIOUS one had used. An id named in the URL is a
    // statement; the last acquisition's project is only a habit.
    const OTHER_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
    mountSupabase({
      projectPlace: { data: projectPlaceRow(), error: null },
      projectOptions: [
        { id: PROJECT_ID, name: "SR-49 corridor improvements", status: "active" },
        { id: OTHER_PROJECT_ID, name: "Downtown streetscape", status: "active" },
      ],
      ingests: [
        {
          id: "ingest-1",
          project_id: OTHER_PROJECT_ID,
          source_label: "California Crash Reporting System (CCRS)",
          coverage_state: "ccrs_ca_statewide",
          severity_completeness: "fatal_injury_only",
          status: "ready",
          crash_count: 12,
          geocoded_count: 12,
          truncated: false,
          years_requested: [2025],
          fetch_error: null,
          created_at: "2026-07-20T00:00:00.000Z",
        },
      ],
    });

    await renderSafety({ projectId: PROJECT_ID });

    const selector = await screen.findByLabelText(/Project for this crash import/i);
    expect(selector).toHaveValue(PROJECT_ID);
  });

  it("preselects nothing, and fetches nothing, when neither the project nor the workspace has an area", async () => {
    mountSupabase({ workspace: { data: null, error: null } });

    await renderSafety();

    expect(await screen.findByText(/Choose a study area above/i)).toBeInTheDocument();
    expect(crashQueryBbox(fetchMock)).toBeNull();
    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("(none)");
  });

  /**
   * A failed crash-import read may not read as "no crash data".
   *
   * The page destructured `{ data: ingestRows }` out of a `Promise.all`, so a
   * revoked grant or a dropped column arrived as an empty array and the page
   * said "No crash data has been retrieved for this study area yet." On a safety
   * module that sentence is close to a statement about an agency's collision
   * record, and a planner acting on it would go and re-import data they already
   * have.
   */
  it("says the crash-import history could not be read, rather than that none exists", async () => {
    mountSupabase({
      ingestsResult: { data: null, error: { message: "permission denied for table safety_crash_ingests" } },
    });
    await renderSafety();

    expect(screen.queryByText(/No crash data has been retrieved for this study area yet/i)).toBeNull();
    expect(screen.getByText(/crash-import history could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/failed lookup, not a finding/i)).toBeInTheDocument();
  });

  it("still says the ordinary empty state when the read succeeded and there is nothing", async () => {
    mountSupabase();
    await renderSafety();

    expect(screen.getByText(/No crash data has been retrieved for this study area yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/i)).toBeNull();
  });
});