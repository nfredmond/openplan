import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE THREE DOORS INTO A TRANSIT FEED, DRIVEN AS A PLANNER WOULD DRIVE THEM.
 *
 * The defect class this file exists to catch is the one CLAUDE.md calls
 * shipped-invisible: a complete, tested, access-gated capability that no person
 * can reach. `/api/gtfs/*` was built and green before anything called it. So
 * these tests render the REAL panel and assert on what a planner sees and what
 * leaves the browser — never on an internal helper.
 *
 * WHAT IS DOUBLED AND WHY.
 *
 *   `StudyAreaPicker` is doubled because it lazily loads a Mapbox surface that
 *   jsdom cannot render, and because the double is the ONLY way to drive the
 *   trap this panel is built around: `onPlaceResolved` fires with `null` for a
 *   hand-DRAWN polygon, so a panel that derived its bounding box from that
 *   callback would leave the search button dead for every planner who drew
 *   their study area instead of searching for a named place. The double lets a
 *   test do exactly that and watch the button enable. That the panel MOUNTS the
 *   shared picker at all — rather than a second geography selector, which the
 *   product forbids — is asserted directly.
 *
 *   `fetch` is doubled per route, so each test states what the server said.
 *
 * `describeGtfsServiceWindow` is NOT doubled: expiry wording is the fact these
 * tests are about.
 */

/* -------------------------------------------------------------------------- */
/* Doubles                                                                      */
/* -------------------------------------------------------------------------- */

/** The last props `StudyAreaPicker` was mounted with. Null if it never mounted. */
let pickerProps: {
  corridorText: string;
  onCorridorChange: (text: string) => void;
  onPlaceResolved?: (place: unknown) => void;
} | null = null;

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: (props: {
    corridorText: string;
    onCorridorChange: (text: string) => void;
    onPlaceResolved?: (place: unknown) => void;
  }) => {
    pickerProps = props;
    return <div data-testid="study-area-picker" />;
  },
}));

import { GtfsIngestPanel } from "@/components/data-hub/gtfs-ingest-panel";
import {
  GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT,
  GTFS_NOT_A_TIMETABLE_CAVEAT,
} from "@/lib/gtfs/caveats";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-08-05";
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** A valid GeoJSON polygon, as `StudyAreaPicker` emits for a DRAWN area. */
const DRAWN_POLYGON = JSON.stringify({
  type: "Polygon",
  coordinates: [
    [
      [-121.5, 38.5],
      [-121.4, 38.5],
      [-121.4, 38.6],
      [-121.5, 38.6],
      [-121.5, 38.5],
    ],
  ],
});

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };

/** Every request the panel made, in order. */
let requests: Array<{ url: string; method: string; body: unknown }> = [];
let handlers: Array<{ match: RegExp; method: string; handler: Handler }> = [];

function respond(method: string, match: RegExp, handler: Handler): void {
  handlers.push({ match, method, handler });
}

function feedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "feed-1",
    workspace_id: WORKSPACE_ID,
    agency_name: "Mountain Transit",
    city: null,
    state: null,
    status: "loaded",
    source_kind: "catalog",
    feed_url: "https://transit.example.org/gtfs.zip",
    catalog_provider: "Mountain Transit",
    catalog_source_id: "mdb-1",
    current_version_id: "version-1",
    created_at: "2026-08-01T00:00:00.000Z",
    loaded_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "version-1",
    feed_id: "feed-1",
    workspace_id: WORKSPACE_ID,
    status: "ready",
    failure_code: null,
    failure_detail: null,
    service_start_date: "2026-01-05",
    service_end_date: "2026-12-31",
    route_service_level_rows: 42,
    stop_service_level_rows: 1_800,
    route_count: 21,
    stop_count: 900,
    trip_count: 4_000,
    frequency_trip_count: 0,
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function catalogEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    catalogId: "mdb-1",
    provider: "Mountain Transit",
    name: "Mountain Transit GTFS",
    statedLocation: { countryCode: "US", subdivisionName: "California", municipality: "Grass Valley" },
    feedContactEmail: "gtfs@example.org",
    ...overrides,
  };
}

const EMPTY_DISCLOSURE = {
  staticEntriesConsidered: 1_173,
  supersededOrInactiveCoveringArea: 0,
  requiringApiKey: 0,
  withoutDownloadUrl: 0,
  entriesWithNoPublishedServiceAreaAnywhere: 0,
};

/** The registry answer used unless a test overrides it. */
function registryBody(feeds: unknown[], versions: unknown[], caveats: Record<string, string[]> = {}) {
  return {
    feeds,
    currentVersions: versions,
    recentVersions: versions,
    caveatsByFeedId: caveats,
  };
}

/**
 * Interaction helpers.
 *
 * `@testing-library/user-event` is not a dependency of this repo, so these wrap
 * `fireEvent` in `act` — every one of these interactions kicks off a fetch and
 * at least one state update, and an un-awaited one produces a React warning
 * rather than a failure, which is exactly the kind of noise that hides a real
 * defect.
 */
async function click(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function typeInto(element: Element, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
}

async function chooseFile(element: Element, file: File): Promise<void> {
  await act(async () => {
    fireEvent.change(element, { target: { files: [file] } });
  });
}

async function renderPanel(props: Partial<Parameters<typeof GtfsIngestPanel>[0]> = {}) {
  render(
    <GtfsIngestPanel
      workspaceId={WORKSPACE_ID}
      maxUploadBytes={MAX_UPLOAD_BYTES}
      today={TODAY}
      {...props}
    />
  );
  // The registry read is issued on mount; wait for it to settle so no test
  // asserts against the loading state by accident.
  await waitFor(() => expect(screen.queryByText(/Reading this workspace/i)).toBeNull());
}

beforeEach(() => {
  pickerProps = null;
  requests = [];
  handlers = [];

  // The default: one loaded feed whose schedule is still running.
  respond("GET", /\/api\/gtfs\/feeds\?/, () => ({
    status: 200,
    body: registryBody([feedRow()], [versionRow()]),
  }));

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      let parsedBody: unknown = null;
      if (typeof init?.body === "string") {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      } else if (init?.body) {
        parsedBody = init.body;
      }
      requests.push({ url, method, body: parsedBody });

      // LAST MATCHING HANDLER WINS, so a test can override the default set up
      // in `beforeEach` simply by registering another.
      const matched = [...handlers].reverse().find((entry) => entry.method === method && entry.match.test(url));
      if (!matched) throw new Error(`No handler for ${method} ${url}`);
      const { status, body } = matched.handler(url, init);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as unknown as Response;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Reachability and the shared picker                                           */
/* -------------------------------------------------------------------------- */

describe("GtfsIngestPanel — the lane is reachable", () => {
  it("reads this workspace's feeds on mount, naming the workspace", async () => {
    await renderPanel();

    const read = requests.find((request) => request.url.startsWith("/api/gtfs/feeds?"));
    expect(read).toBeDefined();
    expect(read?.url).toContain(`workspaceId=${WORKSPACE_ID}`);
  });

  it("offers all three doors", async () => {
    await renderPanel();

    expect(screen.getByRole("tab", { name: /Search the feed catalog/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Paste a feed address/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Upload a GTFS \.zip/i })).toBeInTheDocument();
  });

  /**
   * The product forbids a second geography selector. The only way to prove the
   * shared one is used is to assert the shared one MOUNTED.
   */
  it("reuses the shared StudyAreaPicker rather than inventing a geography selector", async () => {
    await renderPanel();

    expect(screen.getByTestId("study-area-picker")).toBeInTheDocument();
    expect(pickerProps).not.toBeNull();
  });

  it("says a feed's schedule has expired without being asked", async () => {
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => ({
      status: 200,
      body: registryBody(
        [feedRow()],
        [versionRow({ service_start_date: "2024-08-01", service_end_date: "2025-04-05" })]
      ),
    }));

    await renderPanel();

    expect(screen.getByText(/that schedule ENDED/i)).toBeInTheDocument();
    expect(screen.getByText(/historic service levels/i)).toBeInTheDocument();
    expect(screen.getByText("Schedule expired")).toBeInTheDocument();
  });

  it("shows the caveats that travel with every number derived from the feed", async () => {
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => ({
      status: 200,
      body: registryBody([feedRow()], [versionRow()], {
        "feed-1": [GTFS_NOT_A_TIMETABLE_CAVEAT, GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT],
      }),
    }));

    await renderPanel();

    expect(screen.getByText(GTFS_NOT_A_TIMETABLE_CAVEAT)).toBeInTheDocument();
    expect(screen.getByText(GTFS_HOURLY_AVERAGE_HEADWAY_CAVEAT)).toBeInTheDocument();
  });

  it("does not offer refresh or removal for a public preloaded feed", async () => {
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => ({
      status: 200,
      body: registryBody([feedRow({ workspace_id: null })], []),
    }));

    await renderPanel();

    expect(screen.queryByRole("button", { name: /Refresh from source/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove feed/i })).toBeNull();
    expect(screen.getByText(/shared preloaded feed/i)).toBeInTheDocument();
  });

  it("does not offer a refetch for an uploaded feed, because there is no address to refetch", async () => {
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => ({
      status: 200,
      body: registryBody([feedRow({ source_kind: "upload", feed_url: null })], [versionRow()]),
    }));

    await renderPanel();

    expect(screen.queryByRole("button", { name: /Refresh from source/i })).toBeNull();
    // The sentence AND the control it names. Asserting only the sentence is
    // what let the panel ship telling planners to do something it gave them no
    // way to do — see the upload tests below.
    expect(screen.getByText(/no address to refetch/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Upload a newer archive to this feed/i })
    ).toBeInTheDocument();
  });

  /* ------------------------------------------------------------------------ */
  /* The per-feed ingest history — the detail route nothing used to call        */
  /* ------------------------------------------------------------------------ */

  /**
   * `GET /api/gtfs/feeds/[feedId]` WAS REACHABLE BY NOTHING.
   *
   * Complete, membership-gated, audited, and called by no surface — the defect
   * class this repo has shipped eleven times. It answers with up to 50 versions
   * of ONE feed, which the list read cannot promise: that one caps at 200 rows
   * across the whole workspace, so a quiet feed's run of failures can be pushed
   * out of the window entirely by a busy neighbour. The panel now asks it, and
   * this test drives the button a planner presses.
   */
  it("reads one feed's whole ingest history from the detail route, failures included", async () => {
    respond("GET", /\/api\/gtfs\/feeds\/[^/?]+\?/, (url) => ({
      status: 200,
      body: {
        feed: feedRow(),
        currentVersion: versionRow(),
        versions: [
          versionRow({ id: "version-2", status: "failed", failure_code: "fetch_failed", failure_detail: "The agency's server closed the connection.", created_at: "2026-08-04T00:00:00.000Z" }),
          versionRow({ id: "version-1", created_at: "2026-08-01T00:00:00.000Z" }),
        ],
        caveats: [],
        requestedUrl: url,
      },
    }));

    await renderPanel();
    await click(screen.getByRole("button", { name: /Show every ingest of this feed/i }));

    const history = await screen.findByTestId("gtfs-feed-history-feed-1");
    expect(within(history).getByText(/fetch_failed/)).toBeInTheDocument();
    expect(within(history).getByText(/closed the connection/)).toBeInTheDocument();
    expect(within(history).getByText(/in use/)).toBeInTheDocument();

    const detail = requests.find((request) => /\/api\/gtfs\/feeds\/feed-1\?/.test(request.url));
    expect(detail).toBeDefined();
    expect(detail?.url).toContain(`workspaceId=${WORKSPACE_ID}`);
  });

  /**
   * The same rule as everywhere else in this lane: a read that failed is not a
   * feed that has never been ingested. An empty list under a heading is exactly
   * how those two get confused.
   */
  it("says a failed history read failed, rather than showing a feed with no ingests", async () => {
    respond("GET", /\/api\/gtfs\/feeds\/[^/?]+\?/, () => ({
      status: 500,
      body: { error: "permission denied for table gtfs_feed_versions" },
    }));

    await renderPanel();
    await click(screen.getByRole("button", { name: /Show every ingest of this feed/i }));

    const history = await screen.findByTestId("gtfs-feed-history-feed-1");
    expect(within(history).getByText(/could not be read/i)).toBeInTheDocument();
    expect(within(history).queryByText(/no recorded ingest attempts/i)).toBeNull();
  });

  /**
   * The detail route scopes its query to the workspace, so a shared preloaded
   * feed answers 404. Offering the control anyway would be a button that can
   * only fail.
   */
  it("does not offer an ingest history for a public preloaded feed", async () => {
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => ({
      status: 200,
      body: registryBody([feedRow({ workspace_id: null })], []),
    }));

    await renderPanel();

    expect(screen.queryByRole("button", { name: /Show every ingest of this feed/i })).toBeNull();
  });

  it("declines to claim anything about feeds when the registry read failed", async () => {
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => ({
      status: 500,
      body: { error: "permission denied for table gtfs_feeds" },
    }));

    await renderPanel();

    expect(screen.getByText(/registry could not be read/i)).toBeInTheDocument();
    expect(screen.queryByText(/No transit feed has been ingested/i)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The drawn-polygon trap                                                       */
/* -------------------------------------------------------------------------- */

describe("GtfsIngestPanel — the search area", () => {
  /**
   * THE TRAP THIS PANEL IS BUILT AROUND.
   *
   * `StudyAreaPicker` calls `onPlaceResolved(null)` for a hand-drawn polygon
   * and only passes a place for a SEARCHED one. A panel deriving its bounding
   * box from that callback would leave the search button permanently disabled
   * for every planner who drew their study area — a control that exists and
   * cannot be used, which is worse than one that is missing.
   */
  it("enables the catalog search from a DRAWN polygon, which resolves no place at all", async () => {
    await renderPanel();

    const button = screen.getByRole("button", { name: /Search the feed catalog for this area/i });
    expect(button).toBeDisabled();

    act(() => {
      // Exactly what the picker does for a drawn area: geometry, and no place.
      pickerProps?.onPlaceResolved?.(null);
      pickerProps?.onCorridorChange(DRAWN_POLYGON);
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Search the feed catalog for this area/i })).toBeEnabled()
    );
  });

  /**
   * A RESULT IS ONLY TRUE OF THE AREA IT WAS RUN FOR.
   *
   * The result was held in state that nothing tied to the study area, and
   * changing the area did not clear it. So a planner who searched area A and
   * then picked area B read A's answer as B's — and one of those branches is a
   * statement about the world ("Nothing in the catalog publishes a service area
   * covering this area"), which was then simply false about the area on screen.
   */
  it("stops showing a search result once the study area changes", async () => {
    respond("GET", /\/api\/gtfs\/catalog\/search/, () => ({
      status: 200,
      body: { status: "no_covering_feed", disclosure: EMPTY_DISCLOSURE, catalogUrl: "https://catalog.example/x.csv" },
    }));

    await renderPanel();
    act(() => {
      pickerProps?.onCorridorChange(DRAWN_POLYGON);
    });
    await click(screen.getByRole("button", { name: /Search the feed catalog for this area/i }));

    // The answer about the FIRST area.
    expect(await screen.findByTestId("catalog-outcome-no_covering_feed")).toBeInTheDocument();

    // A different area, exactly as the picker hands one over.
    await act(async () => {
      pickerProps?.onCorridorChange(
        JSON.stringify({
          type: "Polygon",
          coordinates: [
            [
              [-118.5, 34.0],
              [-118.4, 34.0],
              [-118.4, 34.1],
              [-118.5, 34.1],
              [-118.5, 34.0],
            ],
          ],
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId("catalog-outcome-no_covering_feed")).toBeNull();
      expect(
        screen.queryByText(/Nothing in the catalog publishes a service area covering this area/i)
      ).toBeNull();
    });
    // And the search button is offered again for the new area, rather than the
    // planner being left with a stale answer and nothing to do about it.
    expect(screen.getByRole("button", { name: /Search the feed catalog for this area/i })).toBeEnabled();
  });

  /** The negative control: the same area must keep its own answer on screen. */
  it("keeps the result while the area it answers about is still the one on screen", async () => {
    respond("GET", /\/api\/gtfs\/catalog\/search/, () => ({
      status: 200,
      body: { status: "no_covering_feed", disclosure: EMPTY_DISCLOSURE, catalogUrl: "https://catalog.example/x.csv" },
    }));

    await renderPanel();
    act(() => {
      pickerProps?.onCorridorChange(DRAWN_POLYGON);
    });
    await click(screen.getByRole("button", { name: /Search the feed catalog for this area/i }));

    expect(await screen.findByTestId("catalog-outcome-no_covering_feed")).toBeInTheDocument();

    // The same geometry arriving again — the picker re-emits on its own reasons.
    await act(async () => {
      pickerProps?.onCorridorChange(DRAWN_POLYGON);
    });

    expect(screen.getByTestId("catalog-outcome-no_covering_feed")).toBeInTheDocument();
  });

  it("sends the drawn area's bounding box to the catalog search", async () => {
    respond("GET", /\/api\/gtfs\/catalog\/search/, () => ({
      status: 200,
      body: { status: "no_covering_feed", disclosure: EMPTY_DISCLOSURE, catalogUrl: "https://catalog.example/x.csv" },
    }));

    await renderPanel();
    act(() => {
      pickerProps?.onCorridorChange(DRAWN_POLYGON);
    });
    await click(screen.getByRole("button", { name: /Search the feed catalog for this area/i }));

    await waitFor(() => {
      const search = requests.find((request) => request.url.startsWith("/api/gtfs/catalog/search"));
      expect(search).toBeDefined();
      expect(search?.url).toContain("minLon=-121.5");
      expect(search?.url).toContain("maxLat=38.6");
      expect(search?.url).toContain(`workspaceId=${WORKSPACE_ID}`);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The four catalog outcomes                                                    */
/* -------------------------------------------------------------------------- */

async function searchWith(body: unknown) {
  respond("GET", /\/api\/gtfs\/catalog\/search/, () => ({ status: 200, body }));
  await renderPanel();
  act(() => {
    pickerProps?.onCorridorChange(DRAWN_POLYGON);
  });
  await click(screen.getByRole("button", { name: /Search the feed catalog for this area/i }));
}

describe("GtfsIngestPanel — the four catalog outcomes read differently", () => {
  it("never draws a catalog outage as an absence of transit", async () => {
    await searchWith({
      status: "catalog_unavailable",
      code: "catalog_unavailable",
      detail: "The catalog host did not answer in time.",
      catalogUrl: "https://catalog.example/x.csv",
    });

    const panel = await screen.findByTestId("catalog-outcome-catalog_unavailable");
    expect(within(panel).getByText(/could not read the transit feed catalog/i)).toBeInTheDocument();
    expect(within(panel).getByText(/says NOTHING about whether transit serves your area/i)).toBeInTheDocument();

    // The lie this branch exists to prevent, in every form it could take.
    expect(screen.queryByText(/no transit/i)).toBeNull();
    expect(screen.queryByTestId("catalog-outcome-no_covering_feed")).toBeNull();
    expect(screen.queryByText(/Nothing in the catalog publishes a service area covering this area/i)).toBeNull();
  });

  it("says feeds DO cover this area when every one of them was withheld, and why each was", async () => {
    await searchWith({
      status: "covered_but_unusable",
      withheld: [
        { entry: catalogEntry({ catalogId: "mdb-2", provider: "Valley Transit" }), reason: "requires_api_key" },
        { entry: catalogEntry({ catalogId: "mdb-3", provider: "City Lines" }), reason: "no_download_url" },
      ],
      disclosure: { ...EMPTY_DISCLOSURE, requiringApiKey: 1, withoutDownloadUrl: 1 },
      catalogUrl: "https://catalog.example/x.csv",
    });

    const panel = await screen.findByTestId("catalog-outcome-covered_but_unusable");
    expect(within(panel).getByText(/2 transit feeds cover this area/i)).toBeInTheDocument();
    expect(within(panel).getByText(/Your area has transit\./i)).toBeInTheDocument();
    expect(within(panel).getByText("Valley Transit")).toBeInTheDocument();
    expect(within(panel).getByText(/behind an API key/i)).toBeInTheDocument();
    expect(within(panel).getByText(/publishes no download address/i)).toBeInTheDocument();

    // It must not be collapsed into the branch that IS a statement about the
    // world.
    expect(screen.queryByTestId("catalog-outcome-no_covering_feed")).toBeNull();
  });

  /**
   * A WITHDRAWN ENTRY IS NOT AN UNINGESTABLE ONE.
   *
   * The headline asserted that none of the withheld feeds "can be ingested from
   * the catalog" while the paragraph under each superseded entry said the
   * catalog "usually names a replacement, and OpenPlan follows that redirect
   * automatically when the entry is ingested". The route does follow it —
   * `resolveGtfsCatalogRedirect` walks the chain and only refuses when it leads
   * nowhere — so the panel was withholding a control for something the product
   * can do, and contradicting itself on screen while doing it.
   */
  it("offers to follow the catalog's redirect for a withdrawn entry, and does not claim it cannot be ingested", async () => {
    await searchWith({
      status: "covered_but_unusable",
      withheld: [
        { entry: catalogEntry({ catalogId: "mdb-7", provider: "Foothill Transit" }), reason: "superseded" },
        { entry: catalogEntry({ catalogId: "mdb-2", provider: "Valley Transit" }), reason: "requires_api_key" },
      ],
      disclosure: { ...EMPTY_DISCLOSURE, supersededOrInactiveCoveringArea: 1, requiringApiKey: 1 },
      catalogUrl: "https://catalog.example/x.csv",
    });

    const panel = await screen.findByTestId("catalog-outcome-covered_but_unusable");

    // The claim the route can disprove, in the form it was made.
    expect(within(panel).queryByText(/none of them can be ingested/i)).toBeNull();
    // The fact that still matters most is unchanged.
    expect(within(panel).getByText(/2 transit feeds cover this area/i)).toBeInTheDocument();
    expect(within(panel).getByText(/Your area has transit\./i)).toBeInTheDocument();

    const follow = within(panel).getByRole("button", {
      name: /Follow the catalog's redirect and ingest this feed/i,
    });
    // Exactly one: the entry behind an API key has no address to fetch and must
    // NOT get a button that would fail every time.
    expect(within(panel).getAllByRole("button")).toHaveLength(1);
    expect(within(panel).getByText(/behind an API key/i)).toBeInTheDocument();

    respond("POST", /\/api\/gtfs\/feeds$/, () => ({
      status: 201,
      body: { feedId: "feed-9", versionId: "version-9", adoption: { adopted: true } },
    }));
    await click(follow);

    await waitFor(() => {
      const post = requests.find((request) => request.method === "POST" && /\/api\/gtfs\/feeds$/.test(request.url));
      expect(post?.body).toMatchObject({ source: "catalog", catalogId: "mdb-7", workspaceId: WORKSPACE_ID });
    });
  });

  it("still explains, and offers nothing, when every withheld feed is genuinely unreachable", async () => {
    await searchWith({
      status: "covered_but_unusable",
      withheld: [
        { entry: catalogEntry({ catalogId: "mdb-2", provider: "Valley Transit" }), reason: "requires_api_key" },
        { entry: catalogEntry({ catalogId: "mdb-3", provider: "City Lines" }), reason: "no_download_url" },
      ],
      disclosure: { ...EMPTY_DISCLOSURE, requiringApiKey: 1, withoutDownloadUrl: 1 },
      catalogUrl: "https://catalog.example/x.csv",
    });

    const panel = await screen.findByTestId("catalog-outcome-covered_but_unusable");
    expect(within(panel).queryByRole("button")).toBeNull();
    expect(within(panel).getByText(/behind an API key/i)).toBeInTheDocument();
    expect(within(panel).getByText(/publishes no download address/i)).toBeInTheDocument();
    // Nothing here may suggest a redirect is worth trying, because there is none.
    expect(within(panel).queryByText(/withdrawn from the catalog rather than made unreachable/i)).toBeNull();
  });

  it("states an absence of covering feeds as the catalog's coverage, not as the ground truth", async () => {
    await searchWith({
      status: "no_covering_feed",
      disclosure: EMPTY_DISCLOSURE,
      catalogUrl: "https://catalog.example/x.csv",
    });

    const panel = await screen.findByTestId("catalog-outcome-no_covering_feed");
    expect(within(panel).getByText(/Nothing in the catalog publishes a service area covering this area/i)).toBeInTheDocument();
    expect(within(panel).getByText(/not a certainty about the ground/i)).toBeInTheDocument();
  });

  it("ranks matched feeds and offers each one for ingest", async () => {
    await searchWith({
      status: "matched",
      feeds: [
        { entry: catalogEntry(), serviceAreaSpread: 0.42, focusOffsetDegrees: 0.01 },
        {
          entry: catalogEntry({ catalogId: "mdb-9", provider: "Statewide Rail" }),
          serviceAreaSpread: 1_300,
          focusOffsetDegrees: 2.2,
        },
      ],
      disclosure: EMPTY_DISCLOSURE,
      catalogUrl: "https://catalog.example/x.csv",
    });

    const panel = await screen.findByTestId("catalog-outcome-matched");
    expect(within(panel).getByText(/2 feeds publish a service area covering this area/i)).toBeInTheDocument();
    expect(within(panel).getByText("Mountain Transit")).toBeInTheDocument();
    expect(within(panel).getByText("Statewide Rail")).toBeInTheDocument();
    expect(within(panel).getAllByRole("button", { name: /Ingest this feed/i })).toHaveLength(2);
  });

  /**
   * `entriesWithNoPublishedServiceAreaAnywhere` counts the WHOLE WORLDWIDE
   * CATALOG. The field was renamed from `withoutPublishedServiceArea`
   * specifically because sitting beside three area-scoped counters invites the
   * sentence "88 feeds near you publish no service area", which is a
   * relationship the data does not have.
   */
  it("never presents the whole-catalog counter as a count of feeds near this area", async () => {
    await searchWith({
      status: "no_covering_feed",
      disclosure: { ...EMPTY_DISCLOSURE, entriesWithNoPublishedServiceAreaAnywhere: 88 },
      catalogUrl: "https://catalog.example/x.csv",
    });

    const disclosure = await screen.findByTestId("catalog-disclosure");
    expect(within(disclosure).getByText(/88 feeds anywhere in the worldwide catalog/i)).toBeInTheDocument();
    expect(within(disclosure).getByText(/not a count of feeds near this area/i)).toBeInTheDocument();
    expect(within(disclosure).queryByText(/88 feeds near/i)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Ingest: the counts come from a re-read, never from the write's own answer    */
/* -------------------------------------------------------------------------- */

describe("GtfsIngestPanel — what a planner is shown after a write", () => {
  /**
   * THE PARTIAL-WRITE CASE, WHICH IS WHY THIS RULE EXISTS.
   *
   * `runGtfsIngest` writes route rows and stop rows in separate statements. A
   * response saying "9,000 stop rows" after a `partial_write` is a truthful
   * account of a BROKEN state that reads as a success. Only the database knows
   * what is actually stored.
   */
  it("shows stored row counts from a re-read, not the numbers the ingest reported", async () => {
    let reads = 0;
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => {
      reads += 1;
      return {
        status: 200,
        body:
          reads === 1
            ? registryBody([], [])
            : registryBody([feedRow()], [versionRow({ stop_service_level_rows: 7 })]),
      };
    });
    respond("POST", /\/api\/gtfs\/feeds$/, () => ({
      status: 201,
      body: {
        feedId: "feed-1",
        versionId: "version-1",
        createdFeed: true,
        adoption: { adopted: true },
        displayName: "Mountain Transit",
        routeServiceLevelRows: 42,
        stopServiceLevelRows: 9_000,
      },
    }));

    await renderPanel();
    await click(screen.getByRole("tab", { name: /Paste a feed address/i }));
    await typeInto(screen.getByRole("textbox", { name: /GTFS feed address/i }), "https://transit.example.org/gtfs.zip");
    await click(screen.getByRole("button", { name: /Fetch and read this feed/i }));

    await waitFor(() => expect(screen.getByTestId("gtfs-ingest-outcome")).toBeInTheDocument());
    // The stored figure, from the re-read.
    expect(screen.getByText(/42 route and 7 stop service-level rows/i)).toBeInTheDocument();
    // The figure the write claimed, which nothing on screen may repeat.
    expect(screen.queryByText(/9,?000/)).toBeNull();
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  /**
   * `bytesStored: false` WAS RETURNED BY THE API AND RENDERED BY NOTHING.
   *
   * It is the one signal that an ingest cannot reach a model run. Every door
   * stores its archive since 2026-08-06 because the travel model is handed the
   * exact bytes OpenPlan parsed, verified against their checksum; a catalog or
   * URL ingest whose object write misses still produces correct and complete
   * service levels, so the ingest is `ok` and this flag is the ONLY thing that
   * says the run handoff will refuse it.
   *
   * Unrendered, the planner meets that refusal days later at launch, on a feed
   * this panel called a success — which is this repository's shipped-invisible
   * defect class exactly.
   */
  it("says the archive was NOT kept, on an ingest that otherwise succeeded", async () => {
    respond("POST", /\/api\/gtfs\/feeds$/, () => ({
      status: 201,
      body: {
        feedId: "feed-1",
        versionId: "version-1",
        createdFeed: true,
        adoption: { adopted: true },
        displayName: "Mountain Transit",
        routeServiceLevelRows: 42,
        stopServiceLevelRows: 7,
        bytesStored: false,
        bytesNotStoredReason: "bucket unavailable",
      },
    }));

    await renderPanel();
    await click(screen.getByRole("tab", { name: /Paste a feed address/i }));
    await typeInto(screen.getByRole("textbox", { name: /GTFS feed address/i }), "https://transit.example.org/gtfs.zip");
    await click(screen.getByRole("button", { name: /Fetch and read this feed/i }));

    const outcome = await screen.findByTestId("gtfs-ingest-outcome");
    expect(within(outcome).getByText(/copy of the feed was NOT kept/i)).toBeInTheDocument();
    // What still works, so nobody re-does an ingest that was fine.
    expect(within(outcome).getByText(/service levels, routes and stops are complete/i)).toBeInTheDocument();
    // What does not, in the words a planner will meet at launch.
    expect(within(outcome).getByText(/refuse to model transit from it/i)).toBeInTheDocument();
    // And Storage's own reason, so an operator has something to act on.
    expect(within(outcome).getByText(/bucket unavailable/i)).toBeInTheDocument();
  });

  it("says nothing about the archive when it WAS kept", async () => {
    // A warning nobody needs is a warning everybody learns to skip.
    respond("POST", /\/api\/gtfs\/feeds$/, () => ({
      status: 201,
      body: {
        feedId: "feed-1",
        versionId: "version-1",
        createdFeed: true,
        adoption: { adopted: true },
        displayName: "Mountain Transit",
        routeServiceLevelRows: 42,
        stopServiceLevelRows: 7,
        bytesStored: true,
        bytesNotStoredReason: null,
      },
    }));

    await renderPanel();
    await click(screen.getByRole("tab", { name: /Paste a feed address/i }));
    await typeInto(screen.getByRole("textbox", { name: /GTFS feed address/i }), "https://transit.example.org/gtfs.zip");
    await click(screen.getByRole("button", { name: /Fetch and read this feed/i }));

    const outcome = await screen.findByTestId("gtfs-ingest-outcome");
    expect(within(outcome).queryByText(/NOT kept/i)).toBeNull();
  });

  it("re-reads the registry after a FAILED ingest too, and says so", async () => {
    let reads = 0;
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => {
      reads += 1;
      return { status: 200, body: registryBody([], []) };
    });
    respond("POST", /\/api\/gtfs\/feeds$/, () => ({
      status: 502,
      body: {
        error: "This transit feed could not be ingested",
        code: "fetch_failed",
        detail: "The agency's server closed the connection.",
      },
    }));

    await renderPanel();
    await click(screen.getByRole("tab", { name: /Paste a feed address/i }));
    await typeInto(screen.getByRole("textbox", { name: /GTFS feed address/i }), "https://transit.example.org/gtfs.zip");
    await click(screen.getByRole("button", { name: /Fetch and read this feed/i }));

    const outcome = await screen.findByTestId("gtfs-ingest-outcome");
    expect(within(outcome).getByText(/could not be ingested/i)).toBeInTheDocument();
    expect(within(outcome).getByText(/Failure code: fetch_failed\./i)).toBeInTheDocument();
    expect(within(outcome).getByText(/re-read after the failure/i)).toBeInTheDocument();
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  /**
   * A refetch that derives far less than the feed in use is STORED and NOT
   * adopted, because a drop that size is as likely to be a truncated download
   * as a real service cut. The planner must be told, and given the choice —
   * silently discarding it and silently adopting it are both wrong.
   */
  it("reports a withheld refetch as a non-adoption, with the assessment and a way to accept it", async () => {
    respond("POST", /\/api\/gtfs\/feeds\/[^/]+\/refresh$/, (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { adoptDespiteCollapse?: boolean };
      return body.adoptDespiteCollapse
        ? { status: 200, body: { feedId: "feed-1", versionId: "version-2", adoption: { adopted: true } } }
        : {
            status: 200,
            body: {
              feedId: "feed-1",
              versionId: "version-2",
              adoption: {
                adopted: false,
                reason: "withheld_for_collapse",
                assessment: { detail: "This refetch derived 3 routes where the feed in use has 21." },
              },
            },
          };
    });

    await renderPanel();
    await click(screen.getByRole("button", { name: /Refresh from source/i }));

    const outcome = await screen.findByTestId("gtfs-ingest-outcome");
    expect(within(outcome).getByText(/was NOT adopted/i)).toBeInTheDocument();
    expect(within(outcome).getByText(/3 routes where the feed in use has 21/i)).toBeInTheDocument();

    await click(screen.getByRole("button", { name: /adopt the smaller version anyway/i }));

    await waitFor(() => {
      const accepted = requests.filter((request) => /\/refresh$/.test(request.url));
      expect(accepted).toHaveLength(2);
      expect(accepted[1].body).toMatchObject({ adoptDespiteCollapse: true, workspaceId: WORKSPACE_ID });
    });
  });

  it("names the workspace on every write, so a feed cannot land in the wrong one", async () => {
    respond("POST", /\/api\/gtfs\/feeds$/, () => ({
      status: 201,
      body: { feedId: "feed-1", versionId: "version-1", adoption: { adopted: true } },
    }));

    render(
      <GtfsIngestPanel workspaceId={OTHER_WORKSPACE_ID} maxUploadBytes={MAX_UPLOAD_BYTES} today={TODAY} />
    );
    await waitFor(() => expect(screen.queryByText(/Reading this workspace/i)).toBeNull());

    await click(screen.getByRole("tab", { name: /Paste a feed address/i }));
    await typeInto(screen.getByRole("textbox", { name: /GTFS feed address/i }), "https://transit.example.org/gtfs.zip");
    await click(screen.getByRole("button", { name: /Fetch and read this feed/i }));

    await waitFor(() => {
      const post = requests.find((request) => request.method === "POST");
      expect(post?.body).toMatchObject({ workspaceId: OTHER_WORKSPACE_ID, source: "url" });
    });
  });

  it("asks before removing a feed, and states what removal destroys", async () => {
    respond("DELETE", /\/api\/gtfs\/feeds\//, () => ({
      status: 200,
      body: { deleted: true, detail: "Removed this feed and all 1 of its ingests." },
    }));

    await renderPanel();
    await click(screen.getByRole("button", { name: /Remove feed/i }));

    expect(screen.getByText(/deletes every service level derived from it/i)).toBeInTheDocument();
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);

    await click(screen.getByRole("button", { name: /Confirm removal/i }));

    await waitFor(() => {
      const removal = requests.find((request) => request.method === "DELETE");
      expect(removal?.url).toContain(`workspaceId=${WORKSPACE_ID}`);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Upload and read-only                                                         */
/* -------------------------------------------------------------------------- */

describe("GtfsIngestPanel — upload and read-only access", () => {
  it("refuses an oversize archive in the browser without sending 200 MB first", async () => {
    await renderPanel({ maxUploadBytes: 1_024 });
    await click(screen.getByRole("tab", { name: /Upload a GTFS \.zip/i }));

    const file = new File([new Uint8Array(4_096)], "feed.zip", { type: "application/zip" });
    await chooseFile(screen.getByLabelText(/GTFS archive/i), file);
    await click(screen.getByRole("button", { name: /Upload and read this archive/i }));

    expect(await screen.findByText(/larger than this deployment accepts/i)).toBeInTheDocument();
    expect(requests.some((request) => request.url.includes("/api/gtfs/feeds/upload"))).toBe(false);
  });

  it("sends the archive with its filename to the upload door", async () => {
    respond("POST", /\/api\/gtfs\/feeds\/upload/, () => ({
      status: 201,
      body: { feedId: "feed-2", versionId: "version-2", adoption: { adopted: true }, displayName: "feed" },
    }));

    await renderPanel();
    await click(screen.getByRole("tab", { name: /Upload a GTFS \.zip/i }));

    const file = new File([new Uint8Array(16)], "mountain-gtfs.zip", { type: "application/zip" });
    await chooseFile(screen.getByLabelText(/GTFS archive/i), file);
    await click(screen.getByRole("button", { name: /Upload and read this archive/i }));

    await waitFor(() => {
      const upload = requests.find((request) => request.url.includes("/api/gtfs/feeds/upload"));
      expect(upload).toBeDefined();
      expect(upload?.url).toContain("filename=mountain-gtfs.zip");
      expect(upload?.url).toContain(`workspaceId=${WORKSPACE_ID}`);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Adding a version to an uploaded feed, which the panel told planners to do  */
  /* ------------------------------------------------------------------------ */

  /**
   * THE DEFECT ALL THREE REVIEWERS FOUND, DRIVEN END TO END.
   *
   * The panel printed "Upload a newer archive to this feed to refresh it" and
   * the refresh route said the same thing in its 422. The only upload control
   * on the page sent `workspaceId` and `filename` and NO `feedId`, so a planner
   * who followed the instruction got a SECOND `gtfs_feeds` row for the same
   * agency: the expired version still adopted on the first, the new one adopted
   * on a feed with no history to compare against, and the collapse check —
   * which exists to catch a truncated download — bypassed entirely because
   * there was nothing to collapse from.
   *
   * `feedId` in the query string is the whole fix, and it is what this asserts.
   */
  it("adds a newer archive to the SAME feed, instead of registering a second one", async () => {
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => ({
      status: 200,
      body: registryBody([feedRow({ source_kind: "upload", feed_url: null })], [versionRow()]),
    }));
    respond("POST", /\/api\/gtfs\/feeds\/upload/, () => ({
      status: 200,
      body: {
        feedId: "feed-1",
        versionId: "version-2",
        createdFeed: false,
        adoption: { adopted: true },
        displayName: "Mountain Transit",
      },
    }));

    await renderPanel();

    const file = new File([new Uint8Array(32)], "mountain-2026.zip", { type: "application/zip" });
    await chooseFile(screen.getByLabelText(/Newer GTFS archive for Mountain Transit/i), file);
    await click(screen.getByRole("button", { name: /Upload a newer archive to this feed/i }));

    await waitFor(() => {
      const upload = requests.find((request) => request.url.includes("/api/gtfs/feeds/upload"));
      expect(upload).toBeDefined();
      // The parameter whose absence created the duplicate feed.
      expect(upload?.url).toContain("feedId=feed-1");
      expect(upload?.url).toContain(`workspaceId=${WORKSPACE_ID}`);
      expect(upload?.url).toContain("filename=mountain-2026.zip");
    });
  });

  /**
   * The bottom door still creates a feed, and must not start naming one. If
   * this and the test above ever agree, one of the two doors has been broken:
   * a new-feed upload carrying a `feedId` would append somebody else's archive
   * to an existing agency's record.
   */
  it("does not send a feedId from the door that creates a feed", async () => {
    respond("POST", /\/api\/gtfs\/feeds\/upload/, () => ({
      status: 201,
      body: { feedId: "feed-2", versionId: "version-2", createdFeed: true, adoption: { adopted: true } },
    }));

    await renderPanel();
    await click(screen.getByRole("tab", { name: /Upload a GTFS \.zip/i }));

    const file = new File([new Uint8Array(16)], "somewhere-else.zip", { type: "application/zip" });
    await chooseFile(screen.getByLabelText("GTFS archive"), file);
    await click(screen.getByRole("button", { name: /Upload and read this archive/i }));

    await waitFor(() => {
      const upload = requests.find((request) => request.url.includes("/api/gtfs/feeds/upload"));
      expect(upload).toBeDefined();
      expect(upload?.url).not.toContain("feedId=");
    });
  });

  /**
   * BOTH DOORS GO THROUGH ONE FUNCTION, AND THIS IS WHY.
   *
   * The ceiling is checked in the browser so a 200 MB body is never sent to be
   * refused. A second upload path that reimplemented the POST would have been
   * the obvious place to leave it out — the failure would be invisible on a
   * fast connection and expensive on a real one.
   */
  it("applies the upload ceiling to the per-feed door as well", async () => {
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => ({
      status: 200,
      body: registryBody([feedRow({ source_kind: "upload", feed_url: null })], [versionRow()]),
    }));

    await renderPanel({ maxUploadBytes: 1_024 });

    const file = new File([new Uint8Array(4_096)], "too-big.zip", { type: "application/zip" });
    await chooseFile(screen.getByLabelText(/Newer GTFS archive for Mountain Transit/i), file);
    await click(screen.getByRole("button", { name: /Upload a newer archive to this feed/i }));

    expect(await screen.findByText(/larger than this deployment accepts/i)).toBeInTheDocument();
    expect(requests.some((request) => request.url.includes("/api/gtfs/feeds/upload"))).toBe(false);
  });

  it("does not offer the per-feed archive control to a viewer", async () => {
    handlers = [];
    respond("GET", /\/api\/gtfs\/feeds\?/, () => ({
      status: 200,
      body: registryBody([feedRow({ source_kind: "upload", feed_url: null })], [versionRow()]),
    }));

    await renderPanel({ readOnly: true });

    expect(screen.queryByRole("button", { name: /Upload a newer archive to this feed/i })).toBeNull();
  });

  it("lets a viewer see the feeds and search the catalog, and not write", async () => {
    await renderPanel({ readOnly: true });

    expect(screen.getByText(/read-only access to this workspace/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh from source/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove feed/i })).toBeNull();
    // The catalog search is a read of a public catalog and stays available.
    expect(screen.getByRole("button", { name: /Search the feed catalog for this area/i })).toBeInTheDocument();
    // So is the ingest history: it is a read, and a viewer investigating why a
    // feed's numbers look wrong needs the failures as much as an editor does.
    expect(screen.getByRole("button", { name: /Show every ingest of this feed/i })).toBeInTheDocument();
  });
});
