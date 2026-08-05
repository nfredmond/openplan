import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RTP_PORTFOLIO_ROLE_OPTIONS } from "@/lib/rtp/catalog";

/**
 * The per-cycle project map, tested where it becomes SOMETHING A PLANNER SEES.
 *
 * Four failure modes are what these assertions exist for, and every one of them
 * has shipped in this repo before in some other module:
 *
 *  1. A DEPLOYMENT WITH NO MAPBOX KEY RENDERS A BLANK BOX. `LocationDisplayMap`
 *     returns `null` in that case, which makes a misconfigured deployment and a
 *     plan with no projects look identical. This panel must say what is missing
 *     and must still report how many projects it WOULD have drawn.
 *  2. A FAILED LOAD RENDERS AS AN ABSENCE. "No projects" over a 500 is the
 *     defect class `lib/http/read-outcome.ts` exists for; the panel must say the
 *     read failed and must not claim the plan is empty.
 *  3. UNLOCATED PROJECTS VANISH. 14 dots for a 20-project programme, with
 *     nothing on screen to contradict it.
 *  4. THE LEGEND AND THE MAP DISAGREE. A role with no colour, or a colour with
 *     no legend entry, is a map that cannot be read.
 */

// ── Mapbox double ────────────────────────────────────────────────────────────

type Handler = (...args: unknown[]) => void;

type MockMapInstance = {
  handlers: Map<string, Handler[]>;
  layers: Array<{ id: string; paint?: Record<string, unknown> }>;
  sources: Record<string, { setData: ReturnType<typeof vi.fn> }>;
  addControl: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  getLayer: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  fire: (event: string, payload?: unknown) => void;
};

const mapboxMocks = vi.hoisted(() => {
  const instances: MockMapInstance[] = [];

  const MapCtor = vi.fn(function MockMap() {
    const handlers = new Map<string, Handler[]>();
    const layers: Array<{ id: string; paint?: Record<string, unknown> }> = [];
    const sources: Record<string, { setData: ReturnType<typeof vi.fn> }> = {};

    const on = vi.fn((...args: unknown[]) => {
      // Both `on(event, handler)` and `on(event, layerId, handler)`.
      const event = args[0] as string;
      const handler = (typeof args[1] === "function" ? args[1] : args[2]) as Handler | undefined;
      if (!handler) return;
      const key = typeof args[1] === "function" ? event : `${event}:${args[1]}`;
      handlers.set(key, [...(handlers.get(key) ?? []), handler]);
    });

    const instance = {
      handlers,
      layers,
      sources,
      addControl: vi.fn(),
      on,
      getCanvas: vi.fn(() => ({ style: {} })),
      addSource: vi.fn((id: string) => {
        sources[id] = { setData: vi.fn() };
      }),
      getSource: vi.fn((id: string) => sources[id] ?? undefined),
      addLayer: vi.fn((layer: { id: string; paint?: Record<string, unknown> }) => {
        layers.push(layer);
      }),
      getLayer: vi.fn((id: string) => layers.find((layer) => layer.id === id) ?? null),
      fitBounds: vi.fn(),
      remove: vi.fn(),
      fire(event: string, payload?: unknown) {
        for (const handler of handlers.get(event) ?? []) handler(payload);
      },
    };

    instances.push(instance);
    return instance;
  });

  const Popup = vi.fn(function MockPopup() {
    const self = {
      setLngLat: vi.fn(() => self),
      setDOMContent: vi.fn(() => self),
      addTo: vi.fn(() => self),
    };
    return self;
  });

  const LngLatBounds = vi.fn(function MockBounds() {
    const positions: unknown[] = [];
    return {
      positions,
      extend: vi.fn((position: unknown) => positions.push(position)),
      isEmpty: vi.fn(() => positions.length === 0),
    };
  });

  return {
    Map: MapCtor,
    NavigationControl: vi.fn(),
    AttributionControl: vi.fn(),
    Popup,
    LngLatBounds,
    instances,
  };
});

vi.mock("mapbox-gl", () => ({
  default: {
    Map: mapboxMocks.Map,
    NavigationControl: mapboxMocks.NavigationControl,
    AttributionControl: mapboxMocks.AttributionControl,
    Popup: mapboxMocks.Popup,
    LngLatBounds: mapboxMocks.LngLatBounds,
    accessToken: "",
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CYCLE_ID = "22222222-2222-4222-8222-222222222222";
const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const ORIGINAL_LEGACY_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const ORIGINAL_FETCH = global.fetch;

type FeatureOverrides = {
  linkId?: string;
  projectName?: string;
  portfolioRole?: string;
  estimatedCost?: number | null;
  coordinates?: [number, number];
};

function feature(overrides: FeatureOverrides = {}) {
  return {
    type: "Feature" as const,
    id: overrides.linkId ?? "a0000001-0000-4000-8000-000000000001",
    geometry: { type: "Point" as const, coordinates: overrides.coordinates ?? [-82.5, 39.5] },
    properties: {
      kind: "rtp_cycle_project" as const,
      linkId: overrides.linkId ?? "a0000001-0000-4000-8000-000000000001",
      projectId: "b0000001-0000-4000-8000-000000000001",
      projectName: overrides.projectName ?? "Any corridor rebuild",
      projectStatus: "active",
      portfolioRole: overrides.portfolioRole ?? "constrained",
      horizonBandId: "44444444-4444-4444-8444-444444444444",
      estimatedCost: overrides.estimatedCost === undefined ? 12_500_000 : overrides.estimatedCost,
      costBasisYear: 2026,
    },
  };
}

function collection(input: {
  features?: ReturnType<typeof feature>[];
  withoutGeometry?: number;
  withoutReadableProject?: number;
  matchedCount?: number;
  truncated?: boolean;
  limit?: number;
}) {
  const features = input.features ?? [];
  const withoutGeometry = input.withoutGeometry ?? 0;
  const withoutReadableProject = input.withoutReadableProject ?? 0;
  const droppedCount = withoutGeometry + withoutReadableProject;
  return {
    type: "FeatureCollection" as const,
    features,
    withoutGeometry,
    withoutReadableProject,
    returnedCount: features.length,
    droppedCount,
    matchedCount: input.matchedCount ?? features.length + droppedCount,
    truncated: input.truncated ?? false,
    limit: input.limit ?? 500,
  };
}

function mockLayerFetch(payload: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  }) as unknown as typeof fetch;
}

function mockFailedFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

async function importPanel() {
  vi.resetModules();
  return import("@/components/rtp/rtp-cycle-project-map");
}

beforeEach(() => {
  vi.clearAllMocks();
  mapboxMocks.instances.length = 0;
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
  delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
});

afterEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_TOKEN;
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN = ORIGINAL_LEGACY_TOKEN;
  global.fetch = ORIGINAL_FETCH;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("RtpCycleProjectMap", () => {
  /**
   * TWO cycle ids, not one. A single fixture cannot tell "threads the prop
   * through" apart from "hardcodes the value the fixture happened to use" —
   * the failure mode recorded after 60 tests in this repo passed a hardcode
   * mutation. Varying the binding is what makes the assertion mean anything.
   */
  it("asks the layer route for the cycle named in its props, and follows the prop", async () => {
    const OTHER_CYCLE = "77777777-7777-4777-8777-777777777777";
    mockLayerFetch(collection({ features: [feature()] }));
    const { RtpCycleProjectMap } = await importPanel();

    const first = render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<RtpCycleProjectMap rtpCycleId={OTHER_CYCLE} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe(`/api/map-features/rtp-cycle-projects?rtpCycleId=${CYCLE_ID}`);
    expect(calls[1][0]).toBe(`/api/map-features/rtp-cycle-projects?rtpCycleId=${OTHER_CYCLE}`);
  });

  it("draws the located projects on a real Mapbox source and layer", async () => {
    mockLayerFetch(
      collection({
        features: [feature(), feature({ linkId: "a0000001-0000-4000-8000-000000000002", coordinates: [-83, 40] })],
      })
    );
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    await waitFor(() => expect(mapboxMocks.Map).toHaveBeenCalledTimes(1));
    const map = mapboxMocks.instances[0];
    map.fire("load");

    expect(map.addSource).toHaveBeenCalledWith(
      "rtp-cycle-projects",
      expect.objectContaining({ type: "geojson" })
    );
    const circle = map.layers.find((layer) => layer.id === "rtp-cycle-projects-circle");
    expect(circle).toBeDefined();
    // Coloured BY ROLE, not one uniform hue — the whole point of the layer.
    expect(JSON.stringify(circle?.paint?.["circle-color"])).toContain("portfolioRole");
    expect(map.fitBounds).toHaveBeenCalled();
  });

  /**
   * The no-token degrade. Not a blank box, not `null`, not a crash — a sentence
   * naming the variable to set, plus the facts the panel already holds.
   */
  it("states that no map key is configured, and still reports what it would have drawn", async () => {
    delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    mockLayerFetch(collection({ features: [feature()], withoutGeometry: 2 }));
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    expect(await screen.findByText(/No map key is configured on this deployment/i)).toBeTruthy();
    expect(screen.getByText(/NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN/)).toBeTruthy();
    // The plan's own facts survive a missing basemap.
    expect(screen.getByText(/1 of the 3 projects loaded for this plan/i)).toBeTruthy();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
    expect(screen.queryByTestId("rtp-cycle-project-map-canvas")).toBeNull();
  });

  it("tells an operator their configured token is a secret key rather than a public one", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "sk.secret-token-should-not-reach-mapbox";
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    mockLayerFetch(collection({ features: [feature()] }));
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    expect(await screen.findByText(/is set but is not a public key/i)).toBeTruthy();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
  });

  /**
   * THE SENTENCE THIS WHOLE LANE EXISTS FOR. Six unplaced projects out of
   * twenty must be stated, not silently subtracted.
   */
  it("states how many programmed projects have no location recorded", async () => {
    mockLayerFetch(
      collection({
        features: Array.from({ length: 14 }, (_, index) =>
          feature({ linkId: `a0000001-0000-4000-8000-00000000000${index % 10}`, coordinates: [-82 - index / 10, 39] })
        ),
        withoutGeometry: 6,
        matchedCount: 20,
      })
    );
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    expect(
      await screen.findByText(/6 of 20 projects have no location recorded/i)
    ).toBeTruthy();
    // And it says what to do about it.
    expect(screen.getByText(/Set a location on the project's own page/i)).toBeTruthy();
  });

  it("reports an unreadable project record apart from an unrecorded location", async () => {
    mockLayerFetch(
      collection({ features: [feature()], withoutGeometry: 1, withoutReadableProject: 2 })
    );
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    expect(await screen.findByText(/2 linked project records could not be read/i)).toBeTruthy();
    expect(screen.getByText(/1 of 4 projects has no location recorded/i)).toBeTruthy();
  });

  it("renders a failed load as a failure, never as a plan with no projects", async () => {
    mockFailedFetch(503, {
      error: "RTP financial schema is not available yet",
      hint: "Apply migration 20260805000003_rtp_financial_element.sql, then try again.",
    });
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    // The negative is asserted FIRST, and independently of the positive: a
    // panel that swallowed the failure would fall through to the empty state,
    // and a test that only looked for the error message would report a missing
    // string rather than the defect that matters.
    await waitFor(() => expect(screen.queryByText(/Loading the projects/i)).toBeNull());
    expect(screen.queryByText(/No projects are in this plan yet/i)).toBeNull();
    expect(screen.queryByText(/No project in this plan has a location recorded yet/i)).toBeNull();

    expect(screen.getByText(/RTP financial schema is not available yet/i)).toBeTruthy();
    expect(screen.getByText(/20260805000003_rtp_financial_element\.sql/)).toBeTruthy();
    expect(screen.getByText(/not a finding that the plan has no projects/i)).toBeTruthy();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
  });

  it("explains what to do when the plan has no projects attached at all", async () => {
    mockLayerFetch(collection({ features: [] }));
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    expect(await screen.findByText(/No projects are in this plan yet/i)).toBeTruthy();
    expect(screen.getByText(/Attach projects to this cycle from a project's own page/i)).toBeTruthy();
  });

  /**
   * Both facts at once. While the missing-key notice was a BRANCH of the map it
   * was unreachable whenever there was nothing to draw, so a deployment with no
   * key and no placed projects was never told its key was missing.
   */
  it("still reports a missing map key when there is also nothing to draw", async () => {
    delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    mockLayerFetch(collection({ features: [], withoutGeometry: 3, matchedCount: 3 }));
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    expect(await screen.findByText(/No map key is configured on this deployment/i)).toBeTruthy();
    expect(screen.getByText(/No project in this plan has a location recorded yet/i)).toBeTruthy();
    // The "N would be drawn" line is suppressed when N is zero rather than
    // claiming "0 of 3 projects have a location recorded and would be drawn".
    expect(screen.queryByText(/would be drawn/i)).toBeNull();
  });

  it("distinguishes a plan with no projects from a plan whose projects are all unplaced", async () => {
    mockLayerFetch(collection({ features: [], withoutGeometry: 5, matchedCount: 5 }));
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    expect(
      await screen.findByText(/No project in this plan has a location recorded yet/i)
    ).toBeTruthy();
    expect(screen.queryByText(/No projects are in this plan yet/i)).toBeNull();
  });

  it("renders a legend swatch for every portfolio role the catalog defines", async () => {
    mockLayerFetch(collection({ features: [feature()] }));
    const { RtpCycleProjectMap, RTP_CYCLE_PROJECT_MAP_LEGEND } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);
    await waitFor(() => expect(mapboxMocks.Map).toHaveBeenCalled());

    for (const option of RTP_PORTFOLIO_ROLE_OPTIONS) {
      expect(screen.getByText(option.label)).toBeTruthy();
      expect(RTP_CYCLE_PROJECT_MAP_LEGEND.order).toContain(option.value);
    }
    // Structural: the legend order is derived from the same vocabulary the
    // colours are, so a role can never have one without the other.
    expect([...RTP_CYCLE_PROJECT_MAP_LEGEND.order].sort()).toEqual(
      [...RTP_CYCLE_PROJECT_MAP_LEGEND.catalogRoles].sort()
    );
    for (const role of RTP_CYCLE_PROJECT_MAP_LEGEND.order) {
      expect(RTP_CYCLE_PROJECT_MAP_LEGEND.color[role]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // A role outside the vocabulary must not borrow a real role's colour.
    expect(Object.values(RTP_CYCLE_PROJECT_MAP_LEGEND.color)).not.toContain(
      RTP_CYCLE_PROJECT_MAP_LEGEND.unknownColor
    );
  });

  /**
   * THE POPUP HAD NO TEST AT ALL, and it is where the money is read.
   *
   * Found by mutation: replacing "No cost recorded in this plan" with `$0` left
   * the whole suite green. An unpriced project rendering as $0 is the single
   * misreading the financial element exists to prevent — a board looking at a
   * dot would conclude a project is programmed at zero dollars when in fact
   * nobody has costed it.
   */
  async function openFirstPopup(properties: Record<string, unknown>) {
    const map = mapboxMocks.instances[0];
    map.fire("load");
    map.fire("click:rtp-cycle-projects-circle", {
      features: [{ properties }],
      lngLat: { lng: -82.5, lat: 39.5 },
    });
    const popup = mapboxMocks.Popup.mock.results.at(-1)?.value as
      | { setDOMContent: ReturnType<typeof vi.fn> }
      | undefined;
    const node = popup?.setDOMContent.mock.calls.at(-1)?.[0] as HTMLElement | undefined;
    if (!node) throw new Error("the click handler opened no popup");
    return node;
  }

  it("says an unpriced project is unpriced in the popup, never $0", async () => {
    mockLayerFetch(collection({ features: [feature()] }));
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);
    await waitFor(() => expect(mapboxMocks.Map).toHaveBeenCalledTimes(1));

    const unpriced = await openFirstPopup({
      projectName: "Any corridor rebuild",
      portfolioRole: "constrained",
      estimatedCost: null,
      costBasisYear: null,
    });
    expect(unpriced.textContent).toContain("No cost recorded in this plan");
    // The misreading this whole element exists to prevent.
    expect(unpriced.textContent).not.toContain("$0");

    const priced = await openFirstPopup({
      projectName: "Any corridor rebuild",
      portfolioRole: "constrained",
      estimatedCost: 12_500_000,
      costBasisYear: 2026,
    });
    expect(priced.textContent).toContain("$12,500,000");
    expect(priced.textContent).toContain("2026 dollars");
    // And a project genuinely programmed at zero is NOT reported as unpriced.
    const zero = await openFirstPopup({
      projectName: "Any corridor rebuild",
      portfolioRole: "constrained",
      estimatedCost: 0,
      costBasisYear: 2026,
    });
    expect(zero.textContent).toContain("$0");
    expect(zero.textContent).not.toContain("No cost recorded");
  });

  /**
   * A project name is text the agency typed. `setHTML` with it interpolated is
   * how an agency's own data becomes script running on their own screen, and the
   * component's comment says so — but nothing was checking the comment was true.
   */
  it("builds the popup from text, so a project name cannot inject markup", async () => {
    mockLayerFetch(collection({ features: [feature()] }));
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);
    await waitFor(() => expect(mapboxMocks.Map).toHaveBeenCalledTimes(1));

    const hostile = '<img src=x onerror="document.title=\'pwned\'">Corridor';
    const node = await openFirstPopup({
      projectName: hostile,
      portfolioRole: "constrained",
      estimatedCost: null,
      costBasisYear: null,
    });

    expect(node.querySelector("img")).toBeNull();
    // The name is still SHOWN — escaped, not swallowed.
    expect(node.textContent).toContain(hostile);
  });

  /**
   * WebGL unavailable, a blocked style request, a locked-down browser. The
   * degrade must be a sentence, not a grey rectangle — and it must not read as
   * a plan with nothing in it, because the projects loaded fine.
   */
  it("says the map could not start rather than leaving an empty box", async () => {
    mockLayerFetch(collection({ features: [feature(), feature({ linkId: "b2", coordinates: [-83, 40] })] }));
    mapboxMocks.Map.mockImplementationOnce(() => {
      throw new Error("WebGL is not supported in this browser");
    });
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    expect(await screen.findByText(/The map could not start in this browser/i)).toBeTruthy();
    // The plan's own facts survive a browser that cannot draw.
    expect(screen.getByText(/2 located projects in this plan are still listed above/i)).toBeTruthy();
    expect(screen.queryByText(/No projects are in this plan yet/i)).toBeNull();
    expect(screen.queryByTestId("rtp-cycle-project-map-canvas")).toBeNull();
  });

  /**
   * A 200 carrying something that is not this layer's payload. Accepting it
   * would let `features: undefined` become "no projects in this plan" — a read
   * failure wearing the clothes of a finding.
   */
  it("treats an unrecognised payload as a failure, not as a plan with no projects", async () => {
    mockLayerFetch({ ok: true, rows: [] });
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    await waitFor(() => expect(screen.queryByText(/Loading the projects/i)).toBeNull());
    expect(screen.queryByText(/No projects are in this plan yet/i)).toBeNull();
    expect(screen.getByText(/shape this panel does not recognise/i)).toBeTruthy();
    expect(screen.getByText(/not a finding that the plan has no projects/i)).toBeTruthy();
  });

  /**
   * The request never completed — offline, DNS, a dropped connection. Nothing
   * was learned about the plan, so nothing may be claimed about it, and the
   * panel must not sit on "Loading…" forever either.
   */
  it("renders a request that never completed as a failure, not as loading forever", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    await waitFor(() =>
      expect(screen.getByText(/The project map could not be loaded/i)).toBeTruthy()
    );
    expect(screen.queryByText(/Loading the projects/i)).toBeNull();
    expect(screen.queryByText(/No projects are in this plan yet/i)).toBeNull();
    expect(screen.getByText(/not a finding that the plan has no projects/i)).toBeTruthy();
  });

  it("names a role it does not recognise instead of drawing it as a known one", async () => {
    mockLayerFetch(collection({ features: [feature({ portfolioRole: "reserved" })] }));
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    expect(await screen.findByText(/Role not recognised/i)).toBeTruthy();
  });
});

describe("describeRtpCycleProjectMapCoverage", () => {
  it("says nothing when every programmed project was drawn", async () => {
    const { describeRtpCycleProjectMapCoverage } = await importPanel();
    expect(describeRtpCycleProjectMapCoverage(collection({ features: [feature()] }))).toEqual([]);
  });

  it("reports truncation separately from undrawable rows", async () => {
    const { describeRtpCycleProjectMapCoverage } = await importPanel();
    const notes = describeRtpCycleProjectMapCoverage(
      collection({
        features: [feature()],
        withoutGeometry: 1,
        matchedCount: 900,
        truncated: true,
      })
    );

    expect(notes).toHaveLength(2);
    expect(notes.some((note) => /no location recorded/i.test(note))).toBe(true);
    expect(notes.some((note) => /the map draws at most/i.test(note))).toBe(true);
    // The unlocated count is a count of what this RESPONSE carried, not of the
    // 900 programmed projects — unqualified it would contradict the sentence
    // next to it, and a reader would take the smaller number as the plan total.
    expect(notes.find((note) => /no location recorded/i.test(note))).toMatch(
      /1 of the 2 loaded for this map/i
    );
    expect(notes.find((note) => /no location recorded/i.test(note))).not.toMatch(/1 of 900/);
  });

  /** And an untruncated layer keeps the plain wording — the fetched set IS the plan. */
  it("does not qualify the denominator when nothing was truncated", async () => {
    const { describeRtpCycleProjectMapCoverage } = await importPanel();
    const notes = describeRtpCycleProjectMapCoverage(
      collection({ features: [feature()], withoutGeometry: 6, matchedCount: 7 })
    );
    expect(notes[0]).toMatch(/6 of 7 projects have no location recorded/i);
    expect(notes[0]).not.toMatch(/loaded for this map/i);
  });

  it("uses the singular for one unplaced project", async () => {
    const { describeRtpCycleProjectMapCoverage } = await importPanel();
    const notes = describeRtpCycleProjectMapCoverage(
      collection({ features: [feature()], withoutGeometry: 1 })
    );
    expect(notes[0]).toMatch(/1 of 2 projects has no location recorded/i);
  });
});
