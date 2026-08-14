import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHICH COUNTY ONBOARDING OPENS ON, AND WHAT IT REFUSES.
 *
 * THE DEFECT. `/county-runs` could only ever start from the workspace's home
 * geography, because the page declared no `searchParams` and had no way of being
 * told which project it had been opened for. For a multi-county MPO that meant
 * re-picking the county on every visit, from a page whose whole purpose is not
 * making a planner be the FIPS lookup table for their own county.
 *
 * WHAT MUST NOT CHANGE. This page already refuses a non-county place out loud
 * (`county-runs-page-client.tsx`), and inheriting an area must not turn that
 * refusal into a silent substitution of whichever county contains it. The last
 * test here is that guard: a city-scoped project seeds the picker and is still
 * refused by name.
 */

const pushMock = vi.fn();
const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const useCountyRunsMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (..._args: unknown[]) => {
    throw new Error("redirect");
  },
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => "/county-runs",
  useSearchParams: () => new URLSearchParams(""),
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

vi.mock("@/lib/hooks/use-county-onramp", () => ({
  useCountyRuns: (...args: unknown[]) => useCountyRunsMock(...args),
  useCountyRunMutations: () => ({ create: vi.fn(), loading: false, error: null }),
}));

// The shared any-US-place picker owns place search and a Mapbox surface. Here it
// only has to show the name the loader vouched for.
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({ externalLabel }: { externalLabel?: string | null }) => (
    <span data-testid="picker-external-label">{externalLabel ?? "(none)"}</span>
  ),
}));

import CountyRunsPage from "@/app/(app)/county-runs/page";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [-83.1, 39.9],
      [-82.8, 39.9],
      [-82.8, 40.1],
      [-83.1, 40.1],
      [-83.1, 39.9],
    ],
  ],
};

/** The workspace works out of one county; its projects need not sit in it. */
function workspaceHomeRow() {
  return {
    home_geography_source: "tigerweb",
    home_geography_kind: "county",
    home_geography_ref: "39049",
    home_geography_label: "Franklin County, Ohio",
    home_country_code: "US",
    home_subdivision_code: "OH",
    home_min_lon: -83.1,
    home_min_lat: 39.9,
    home_max_lon: -82.8,
    home_max_lat: 40.1,
    home_geometry_geojson: POLYGON,
    home_geography_set_at: "2026-07-01T00:00:00.000Z",
  };
}

function projectPlaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    name: "US-33 interchange study",
    place_source: "tigerweb",
    place_kind: "county",
    place_ref: "39089",
    place_label: "Licking County, Ohio",
    place_country_code: "US",
    place_subdivision_code: "OH",
    place_min_lon: -82.8,
    place_min_lat: 39.9,
    place_max_lon: -82.4,
    place_max_lat: 40.2,
    place_geometry_geojson: POLYGON,
    place_set_at: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

type Result = { data: unknown; error: { message: string } | null };

/**
 * What `loadAnalysisSequenceFacts` reads besides `workspaces`, which this file
 * already answers with the row under test.
 */
const SEQUENCE_STRIP_TABLES = new Set(["network_packages", "scenario_sets", "models", "county_runs"]);

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

function mountSupabase({
  workspace = { data: workspaceHomeRow(), error: null } as Result,
  projectPlace = { data: null, error: null } as Result,
}: { workspace?: Result; projectPlace?: Result } = {}) {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      if (table === "workspaces") return respondWith(workspace);
      if (table === "projects") return respondWith(projectPlace);
      // The analysis-sequence strip reads the rest of the procedure's state to
      // draw which step a planner is on. None of it bears on which county this
      // page opens, so it answers empty — but it is listed table by table, and
      // the throw below still stands, so a page that starts reading something
      // genuinely new fails here instead of being silently answered.
      if (SEQUENCE_STRIP_TABLES.has(table)) return respondWith({ data: [], error: null });
      throw new Error(`Unexpected table: ${table}`);
    },
  });
}

async function renderCountyRuns(searchParams?: { projectId?: string }) {
  render(await CountyRunsPage({ searchParams: Promise.resolve(searchParams ?? {}) }));
}

describe("County onboarding opens on the right county", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "admin" },
    });
    useCountyRunsMock.mockReturnValue({ items: [], loading: false, error: null, refresh: vi.fn() });
  });

  it("is ready to onboard the project's county, not the workspace's", async () => {
    mountSupabase({ projectPlace: { data: projectPlaceRow(), error: null } });

    await renderCountyRuns({ projectId: PROJECT_ID });

    // The result: the page is armed with the project's FIPS, and the launch
    // button is live without the planner re-picking anything.
    expect(
      screen.getByText(/Onboarding will run on Licking County, Ohio \(FIPS 39089\)/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /launch county/i })).toHaveProperty("disabled", false);
    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("Licking County, Ohio");
  });

  it("still opens on the workspace home when no project is named", async () => {
    mountSupabase();

    await renderCountyRuns();

    expect(
      screen.getByText(/Onboarding will run on Franklin County, Ohio \(FIPS 39049\)/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/study area could not be used/i)).not.toBeInTheDocument();
  });

  it("names an inherited area that has no place label rather than leaving it anonymous", async () => {
    // A hand-drawn project area carries no identity, so there is no name to
    // show — but "Custom study area" would hide that it was inherited at all.
    mountSupabase({
      projectPlace: {
        data: projectPlaceRow({ place_source: "drawn", place_kind: null, place_ref: null, place_label: null }),
        error: null,
      },
    });

    await renderCountyRuns({ projectId: PROJECT_ID });

    expect(screen.getByTestId("picker-external-label")).toHaveTextContent("this project's study area");
  });

  it("discloses a project it could not read instead of quietly offering the workspace county", async () => {
    mountSupabase({ projectPlace: { data: null, error: { message: "permission denied for table projects" } } });

    await renderCountyRuns({ projectId: PROJECT_ID });

    expect(screen.getByText(/could not read the project this page was opened for/i)).toBeInTheDocument();
    expect(screen.getByText(/permission denied for table projects/)).toBeInTheDocument();
    // The workspace county is still offered — but as the workspace's, and only
    // after saying the requested project's area is not what is on screen.
    expect(
      screen.getByText(/Onboarding will run on Franklin County, Ohio \(FIPS 39049\)/i)
    ).toBeInTheDocument();
  });

  it("calls a deployment without the place columns unmigrated, not a failed read", async () => {
    mountSupabase({
      projectPlace: { data: null, error: { message: 'column projects.place_source does not exist' } },
    });

    await renderCountyRuns({ projectId: PROJECT_ID });

    expect(screen.getByText(/does not store an area for each project yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Part of this page could not be read/i)).not.toBeInTheDocument();
  });

  it("says a project has no study area of its own rather than passing the county off as its", async () => {
    mountSupabase({
      projectPlace: { data: projectPlaceRow({ place_geometry_geojson: null }), error: null },
    });

    await renderCountyRuns({ projectId: PROJECT_ID });

    expect(
      screen.getByText(/US-33 interchange study has no area of its own yet/i)
    ).toBeInTheDocument();
  });

  it("keeps refusing a project whose area is not a county, instead of guessing which county contains it", async () => {
    mountSupabase({
      projectPlace: {
        data: projectPlaceRow({
          place_kind: "city",
          place_ref: "3918000",
          place_label: "Columbus, Ohio",
        }),
        error: null,
      },
    });

    await renderCountyRuns({ projectId: PROJECT_ID });

    expect(screen.getByText(/County onboarding runs on a county/i)).toBeInTheDocument();
    expect(screen.getByText(/Columbus, Ohio is a city or town/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /launch county/i })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/Onboarding will run on/i)).not.toBeInTheDocument();
  });
});
