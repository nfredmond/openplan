import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

// Independent library doubles exercise the real shared engine and style wait.
// They cannot prove worker bundling, WebGL, network/CSP or visible attribution.

type Handler = (...args: unknown[]) => void;

type MockMapInstance = {
  options: Record<string, unknown>;
  handlers: Map<string, Handler[]>;
  layers: Array<{ id: string; paint?: Record<string, unknown> }>;
  sources: Record<string, { data: unknown; setData: ReturnType<typeof vi.fn> }>;
  addControl: ReturnType<typeof vi.fn>;
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  getLayer: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  setStyleLoaded: (loaded: boolean) => void;
  fire: (event: string, payload?: unknown) => void;
};

const { mapboxMocks, maplibreMocks, libraryLoad } = vi.hoisted(() => {
  function engineDouble() {
    const instances: MockMapInstance[] = [];
    const popupBehavior = { closeOnAdd: false };

    const MapCtor = vi.fn(function MockMap(options: Record<string, unknown>) {
      let styleLoaded = false;
      const handlers = new Map<string, Handler[]>();
      const layers: Array<{ id: string; paint?: Record<string, unknown> }> = [];
      const sources: MockMapInstance["sources"] = {};

      const on = vi.fn((...args: unknown[]) => {
        // Both `on(event, handler)` and `on(event, layerId, handler)`.
        const event = args[0] as string;
        const handler = (typeof args[1] === "function" ? args[1] : args[2]) as Handler | undefined;
        if (!handler) return;
        const key = typeof args[1] === "function" ? event : `${event}:${args[1]}`;
        handlers.set(key, [...(handlers.get(key) ?? []), handler]);
      });

      const instance = {
        options,
        handlers,
        layers,
        sources,
        addControl: vi.fn(),
        on,
        off: vi.fn((...args: unknown[]) => {
          const key = typeof args[1] === "function" ? String(args[0]) : `${args[0]}:${args[1]}`;
          const handler = typeof args[1] === "function" ? args[1] : args[2];
          handlers.set(key, (handlers.get(key) ?? []).filter((entry) => entry !== handler));
        }),
        isStyleLoaded: vi.fn(() => styleLoaded),
        setStyleLoaded: (loaded: boolean) => { styleLoaded = loaded; },
        getCanvas: vi.fn(() => ({ style: {} })),
        addSource: vi.fn((id: string, source: { data: unknown }) => {
          sources[id] = {
            data: source.data,
            setData: vi.fn((data: unknown) => { sources[id].data = data; }),
          };
        }),
        getSource: vi.fn((id: string) => sources[id] ?? undefined),
        addLayer: vi.fn((layer: { id: string; paint?: Record<string, unknown> }) => {
          layers.push(layer);
        }),
        getLayer: vi.fn((id: string) => layers.find((layer) => layer.id === id) ?? null),
        fitBounds: vi.fn(),
        remove: vi.fn(),
        resize: vi.fn(),
        fire(event: string, payload?: unknown) {
          if (event === "load") styleLoaded = true;
          for (const handler of handlers.get(event) ?? []) handler(payload);
        },
      };

      instances.push(instance);
      return instance;
    });

    const Popup = vi.fn(function MockPopup() {
      let element: HTMLElement | undefined = document.createElement("div");
      const self = {
        setLngLat: vi.fn(() => self),
        setDOMContent: vi.fn(() => self),
        addTo: vi.fn(() => {
          if (popupBehavior.closeOnAdd) self.remove();
          return self;
        }),
        remove: vi.fn(() => { element = undefined; }),
        getElement: vi.fn(() => element),
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
      popupBehavior,
      LngLatBounds,
      addProtocol: vi.fn(),
      setWorkerUrl: vi.fn(),
      instances,
    };
  }
  return {
    mapboxMocks: engineDouble(),
    maplibreMocks: engineDouble(),
    libraryLoad: { wait: null as Promise<void> | null, error: null as Error | null, requested: vi.fn() },
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
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("pmtiles", () => ({ Protocol: class { tile = () => undefined; } }));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CYCLE_ID = "22222222-2222-4222-8222-222222222222";
const ORIGINAL_FETCH = global.fetch;
const OPEN_STYLE = "/maps/operator-style.json";

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
  maplibreMocks.instances.length = 0;
  mapboxMocks.popupBehavior.closeOnAdd = false;
  maplibreMocks.popupBehavior.closeOnAdd = false;
  libraryLoad.wait = null;
  libraryLoad.error = null;
  vi.doMock("maplibre-gl", async () => {
    libraryLoad.requested();
    await libraryLoad.wait;
    if (libraryLoad.error) throw libraryLoad.error;
    return { default: maplibreMocks };
  });
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it("adds the located projects to the Mapbox double's source and layer", async () => {
    mockLayerFetch(
      collection({
        features: [feature(), feature({ linkId: "a0000001-0000-4000-8000-000000000002", coordinates: [-83, 40] })],
      })
    );
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    await waitFor(() => expect(mapboxMocks.Map).toHaveBeenCalledTimes(1));
    const map = mapboxMocks.instances[0];
    act(() => map.fire("load"));

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

    expect(await screen.findByText(/has no map key set up/i)).toBeTruthy();
    // The variable is for whoever runs the installation, folded out of the planner's line.
    expect(screen.getByText(/NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN/).closest("details")).not.toBeNull();
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

    expect(await screen.findByText(/has no map key set up/i)).toBeTruthy();
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
    act(() => {
      map.fire("load");
      map.fire("click:rtp-cycle-projects-circle", {
        features: [{ properties }],
        lngLat: { lng: -82.5, lat: 39.5 },
      });
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

  // These doubles check sizing/stacking intent, not browser geometry or hit testing.
  it.each(["mapbox", "maplibre"] as const)("bounds the RTP popup and raises it above controls with %s", async (engine) => {
    if (engine === "maplibre") {
      vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
      vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
      vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", OPEN_STYLE);
    }
    const data = collection({ features: [feature({ estimatedCost: null })] });
    global.fetch = vi.fn();
    const { RtpCycleProjectMap } = await importPanel();
    render(<RtpCycleProjectMap collection={data} audience="public" />);

    const gl = engine === "maplibre" ? maplibreMocks : mapboxMocks;
    await waitFor(() => expect(gl.Map).toHaveBeenCalledTimes(1));
    const map = gl.instances[0];
    act(() => {
      map.fire("load");
      map.fire("click:rtp-cycle-projects-circle", {
        features: [{ properties: data.features[0].properties }],
        lngLat: { lng: -82.5, lat: 39.5 },
      });
    });

    expect(gl.Popup).toHaveBeenCalledTimes(1);
    expect(gl.Popup).toHaveBeenCalledWith({ offset: 12, maxWidth: "min(280px, calc(100% - 24px))" });
    const popup = gl.Popup.mock.results[0].value;
    const element = popup.getElement();
    expect(element).toBeDefined();
    if (!element) throw new Error("the popup has no element after opening");
    expect(element.style.zIndex).toBe("3");
    const content = popup.setDOMContent.mock.calls[0][0] as HTMLElement;
    expect({ minWidth: content.style.minWidth, overflowWrap: content.style.overflowWrap }).toEqual({
      minWidth: "0px", overflowWrap: "anywhere",
    });
    expect(content.textContent).toContain("No cost recorded in this plan");
    expect(map.addControl).toHaveBeenCalledWith(gl.NavigationControl.mock.instances[0], "top-right");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(["mapbox", "maplibre"] as const)("tolerates a popup closed during addTo and opens the next popup with %s", async (engine) => {
    if (engine === "maplibre") {
      vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
      vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
      vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", OPEN_STYLE);
    }
    const data = collection({ features: [feature()] });
    global.fetch = vi.fn();
    const { RtpCycleProjectMap } = await importPanel();
    render(<RtpCycleProjectMap collection={data} audience="public" />);

    const gl = engine === "maplibre" ? maplibreMocks : mapboxMocks;
    await waitFor(() => expect(gl.Map).toHaveBeenCalledTimes(1));
    const map = gl.instances[0];
    act(() => map.fire("load"));
    const click = () => map.fire("click:rtp-cycle-projects-circle", {
      features: [{ properties: data.features[0].properties }],
      lngLat: { lng: -82.5, lat: 39.5 },
    });

    gl.popupBehavior.closeOnAdd = true;
    expect(() => act(click)).not.toThrow();
    expect(gl.Popup).toHaveBeenCalledTimes(1);
    const closed = gl.Popup.mock.results[0].value;
    expect(closed.remove).toHaveBeenCalledTimes(1);
    expect(closed.getElement).toHaveBeenCalledTimes(1);
    expect(closed.getElement()).toBeUndefined();

    gl.popupBehavior.closeOnAdd = false;
    expect(() => act(click)).not.toThrow();
    expect(gl.Popup).toHaveBeenCalledTimes(2);
    const element = gl.Popup.mock.results[1].value.getElement();
    expect(element).toBeDefined();
    if (!element) throw new Error("the next popup has no element after opening");
    expect(element.style.zIndex).toBe("3");
    expect(map.remove).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  /**
   * WebGL unavailable, a blocked style request, a locked-down browser. The
   * degrade must be a sentence, not a grey rectangle — and it must not read as
   * a plan with nothing in it, because the projects loaded fine.
   */
  it("says the map could not start rather than leaving an empty box", async () => {
    mockLayerFetch(collection({ features: [feature(), feature({ linkId: "b2", coordinates: [-83, 40] })] }));
    const startupError = new Error("WebGL is not supported in this browser");
    mapboxMocks.Map.mockImplementationOnce(function MapboxWithoutWebGL() {
      throw startupError;
    });
    const { RtpCycleProjectMap } = await importPanel();

    render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);

    await waitFor(() => expect(mapboxMocks.Map).toHaveBeenCalledTimes(1));
    expect(mapboxMocks.Map.mock.results[0].type).toBe("throw");
    expect(mapboxMocks.Map.mock.results[0].value).toBe(startupError);
    expect(console.error).toHaveBeenCalledWith("[map] the map could not start", startupError);
    expect(await screen.findByText(/The map could not start in this browser/i)).toBeTruthy();
    // The plan's own facts survive a browser that cannot draw.
    expect(screen.getByText(/2 located projects in this plan are still listed above/i)).toBeTruthy();
    expect(screen.queryByText(/No projects are in this plan yet/i)).toBeNull();
    expect(screen.getByTestId("rtp-cycle-project-map-canvas").id).toBe("rtp-cycle-project-map-canvas");
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

describe("RTP fetch identity and audience transitions", () => {
  const OTHER_CYCLE = "77777777-7777-4777-8777-777777777777";

  function pendingResponse() {
    let resolve: (response: Response) => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }

  function layerResponse(data: ReturnType<typeof collection>) {
    return { ok: true, status: 200, json: async () => data } as Response;
  }

  it("shows loading without A coverage or canvas while B is pending, then draws B", async () => {
    const a = collection({ features: [feature()], withoutGeometry: 3 });
    const b = collection({ features: [feature({ coordinates: [10, 52] })], withoutGeometry: 1 });
    const pendingB = pendingResponse();
    const fetchLayer = vi.fn().mockResolvedValueOnce(layerResponse(a)).mockReturnValueOnce(pendingB.promise);
    global.fetch = fetchLayer;
    const { RtpCycleProjectMap } = await importPanel();
    const view = render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);
    expect(await screen.findByText(/3 of 4 projects have no location recorded/i)).toBeTruthy();
    await waitFor(() => expect(mapboxMocks.Map).toHaveBeenCalledTimes(1));
    const canvasA = screen.getByTestId("rtp-cycle-project-map-canvas");
    const mapA = mapboxMocks.instances[0];
    act(() => mapA.fire("load"));
    expect(mapA.sources["rtp-cycle-projects"].data).toEqual(a);

    view.rerender(<RtpCycleProjectMap rtpCycleId={OTHER_CYCLE} />);
    expect(screen.queryByText(/Loading the projects programmed in this plan/i)).not.toBeNull();
    expect(screen.queryByText(/3 of 4 projects have no location recorded/i)).toBeNull();
    expect(screen.queryByTestId("rtp-cycle-project-map-canvas")).toBeNull();
    expect(screen.queryByText(/No projects are in this plan yet/i)).toBeNull();
    expect(mapA.remove).toHaveBeenCalledTimes(1);
    expect(fetchLayer).toHaveBeenCalledTimes(2);
    expect(fetchLayer.mock.calls[1][0]).toBe(`/api/map-features/rtp-cycle-projects?rtpCycleId=${OTHER_CYCLE}`);

    await act(async () => pendingB.resolve(layerResponse(b)));
    expect(screen.queryByText(/Loading the projects programmed in this plan/i)).toBeNull();
    expect(screen.getByText(/1 of 2 projects has no location recorded/i)).toBeTruthy();
    expect(screen.queryByText(/3 of 4 projects have no location recorded/i)).toBeNull();
    expect(screen.getByTestId("rtp-cycle-project-map-canvas")).not.toBe(canvasA);
    expect(mapboxMocks.Map).toHaveBeenCalledTimes(2);
    const mapB = mapboxMocks.instances[1];
    act(() => mapB.fire("load"));
    expect(mapB.sources["rtp-cycle-projects"].data).toEqual(b);
  });

  it("ignores A's non-AbortError rejection after cancellation instead of overwriting ready B", async () => {
    const pendingA = pendingResponse();
    const pendingB = pendingResponse();
    const b = collection({ features: [feature({ coordinates: [10, 52] })], withoutGeometry: 2 });
    const fetchLayer = vi.fn().mockReturnValueOnce(pendingA.promise).mockReturnValueOnce(pendingB.promise);
    global.fetch = fetchLayer;
    const { RtpCycleProjectMap } = await importPanel();
    const view = render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);
    expect(fetchLayer).toHaveBeenCalledTimes(1);
    const signalA = fetchLayer.mock.calls[0][1].signal as AbortSignal;

    view.rerender(<RtpCycleProjectMap rtpCycleId={OTHER_CYCLE} />);
    expect(signalA.aborted).toBe(true);
    expect(fetchLayer).toHaveBeenCalledTimes(2);
    await act(async () => pendingB.resolve(layerResponse(b)));
    expect(screen.getByText(/2 of 3 projects have no location recorded/i)).toBeTruthy();
    expect(mapboxMocks.Map).toHaveBeenCalledTimes(1);
    const canvasB = screen.getByTestId("rtp-cycle-project-map-canvas");
    const mapB = mapboxMocks.instances[0];
    act(() => mapB.fire("load"));

    await act(async () => pendingA.reject(new Error("Request A rejected after cancellation")));
    expect(screen.queryByText(/Loading the projects programmed in this plan/i)).toBeNull();
    expect(screen.queryByText(/The project map could not be loaded/i)).toBeNull();
    expect(screen.getByText(/2 of 3 projects have no location recorded/i)).toBeTruthy();
    expect(screen.getByTestId("rtp-cycle-project-map-canvas")).toBe(canvasB);
    expect(mapB.sources["rtp-cycle-projects"].data).toEqual(b);
    expect(mapB.remove).not.toHaveBeenCalled();
    expect(mapboxMocks.Map).toHaveBeenCalledTimes(1);
    expect(fetchLayer).toHaveBeenCalledTimes(2);
  });

  it("renders supplied public data after a failed staff read without another member fetch", async () => {
    mockFailedFetch(503, { error: "Staff cycle unavailable" });
    const data = collection({ features: [feature()], withoutReadableProject: 1 });
    const { RtpCycleProjectMap } = await importPanel();
    const view = render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);
    expect(await screen.findByText("Staff cycle unavailable")).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    view.rerender(<RtpCycleProjectMap collection={data} audience="public" />);
    expect(screen.queryByText("Staff cycle unavailable")).toBeNull();
    expect(screen.queryByText(/This is a read failure/i)).toBeNull();
    expect(screen.queryByText(/Loading the projects programmed in this plan/i)).toBeNull();
    expect(screen.getByText(/1 linked project record could not be read/i)).toBeTruthy();
    expect(screen.getByTestId("rtp-cycle-project-map-canvas")).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mapboxMocks.Map).toHaveBeenCalledTimes(1);
    const map = mapboxMocks.instances[0];
    act(() => map.fire("load"));
    expect(map.sources["rtp-cycle-projects"].data).toEqual(data);
  });
});

describe("RTP engine choice and asynchronous lifecycle", () => {
  function useOpenStyle() {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", OPEN_STYLE);
  }

  function delayLibrary() {
    let release = () => {};
    libraryLoad.wait = new Promise<void>((resolve) => { release = () => resolve(); });
    return release;
  }

  it.each(["", "javascript:invalid"])("shows no-config facts without constructing either engine for style %s", async (style) => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", style);
    global.fetch = vi.fn();
    const { RtpCycleProjectMap } = await importPanel();
    render(<RtpCycleProjectMap collection={collection({ features: [feature()], withoutGeometry: 2 })} audience="public" />);
    expect(screen.getByText(/has no map key set up/i)).toBeTruthy();
    expect(screen.getByText(/1 of the 3 projects loaded for this plan/i)).toBeTruthy();
    expect(screen.queryByTestId("rtp-cycle-project-map-canvas")).toBeNull();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
    expect(maplibreMocks.Map).not.toHaveBeenCalled();
    expect(libraryLoad.requested).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("uses the operator style and MapLibre constructors for map, credits, bounds and popup", async () => {
    useOpenStyle();
    const data = collection({ features: [feature({ estimatedCost: null })], withoutGeometry: 2 });
    global.fetch = vi.fn();
    const { RtpCycleProjectMap } = await importPanel();
    render(<RtpCycleProjectMap collection={data} audience="public" />);

    await waitFor(() => expect(maplibreMocks.Map).toHaveBeenCalledTimes(1));
    const map = maplibreMocks.instances[0];
    expect(map.options.style).toBe(OPEN_STYLE);
    expect(map.options.center).toEqual(data.features[0].geometry.coordinates);
    expect(maplibreMocks.addProtocol).toHaveBeenCalledWith("pmtiles", expect.any(Function));
    expect(maplibreMocks.setWorkerUrl).toHaveBeenCalledWith(expect.any(String));
    expect(maplibreMocks.NavigationControl).toHaveBeenCalledWith({ showCompass: false });
    expect(maplibreMocks.AttributionControl).toHaveBeenCalledWith({ compact: true });
    expect(map.addControl).toHaveBeenCalledWith(
      maplibreMocks.AttributionControl.mock.instances[0], "bottom-right",
    );
    expect(screen.getByTestId("rtp-cycle-project-map-canvas").id).toBe("rtp-cycle-project-map-canvas");
    expect(screen.getByText(/2 of 3 projects have no location recorded/i)).toBeTruthy();
    expect(screen.queryByText(/has no map key set up/i)).toBeNull();

    act(() => map.fire("load"));
    expect(map.sources["rtp-cycle-projects"].data).toEqual(data);
    expect(map.layers.map((layer) => layer.id)).toContain("rtp-cycle-projects-circle");
    expect(map.fitBounds).toHaveBeenCalledWith(
      maplibreMocks.LngLatBounds.mock.results[0].value,
      expect.objectContaining({ padding: 48, maxZoom: 13 }),
    );
    act(() => map.fire("click:rtp-cycle-projects-circle", {
      features: [{ properties: data.features[0].properties }], lngLat: { lng: -82.5, lat: 39.5 },
    }));
    expect(maplibreMocks.Popup).toHaveBeenCalledTimes(1);
    expect(mapboxMocks.Popup).not.toHaveBeenCalled();
    const popup = maplibreMocks.Popup.mock.results[0].value;
    expect(popup.addTo).toHaveBeenCalledWith(map);
    expect(popup.setDOMContent.mock.calls[0][0].textContent).toContain("No cost recorded in this plan");
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
    expect(mapboxMocks.NavigationControl).not.toHaveBeenCalled();
    expect(mapboxMocks.AttributionControl).not.toHaveBeenCalled();
    expect(mapboxMocks.LngLatBounds).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("loads the staff cycle layer before drawing it with the configured open style", async () => {
    useOpenStyle();
    const data = collection({ features: [feature()], withoutReadableProject: 1 });
    mockLayerFetch(data);
    const { RtpCycleProjectMap } = await importPanel();
    const view = render(<RtpCycleProjectMap rtpCycleId={CYCLE_ID} />);
    await waitFor(() => expect(maplibreMocks.Map).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/map-features/rtp-cycle-projects?rtpCycleId=${CYCLE_ID}`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    const map = maplibreMocks.instances[0];
    act(() => map.fire("load"));
    expect(map.sources["rtp-cycle-projects"].data).toEqual(data);
    expect(map.options.style).toBe(OPEN_STYLE);
    expect(screen.getByText(/1 linked project record could not be read/i)).toBeTruthy();
    const signal = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(map.remove).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["pk.primary", "pk.legacy", "pk.primary"],
    ["", "pk.legacy", "pk.legacy"],
    ["sk.unusable", "pk.legacy", "pk.legacy"],
    ["pk.primary", "invalid-legacy", "pk.primary"],
  ])("keeps public token precedence with primary %s and legacy %s", async (primary, legacy, expected) => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", primary);
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", legacy);
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", OPEN_STYLE);
    const { RtpCycleProjectMap } = await importPanel();
    const gl = await import("mapbox-gl");
    render(<RtpCycleProjectMap collection={collection({ features: [feature()] })} audience="public" />);
    expect(mapboxMocks.Map).toHaveBeenCalledTimes(1);
    expect(mapboxMocks.instances[0].options.style).toBe("mapbox://styles/mapbox/light-v11");
    expect(gl.default.accessToken).toBe(expected);
    expect(libraryLoad.requested).not.toHaveBeenCalled();
    expect(maplibreMocks.Map).not.toHaveBeenCalled();
  });

  it.each([
    ["sk.unusable", ""], ["malformed", ""], ["", "sk.unusable"],
  ])("retains the RTP token refusal even with an open style (%s, %s)", async (primary, legacy) => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", primary);
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", legacy);
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", OPEN_STYLE);
    const { RtpCycleProjectMap } = await importPanel();
    render(<RtpCycleProjectMap collection={collection({ features: [feature()] })} audience="public" />);
    expect(screen.getByText(/is set but is not a public key/i)).toBeTruthy();
    expect(screen.queryByTestId("rtp-cycle-project-map-canvas")).toBeNull();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
    expect(libraryLoad.requested).not.toHaveBeenCalled();
    expect(maplibreMocks.Map).not.toHaveBeenCalled();
  });

  it("uses the latest public collection during delayed engine and style loading, then updates without rebuilding", async () => {
    useOpenStyle();
    const release = delayLibrary();
    const initial = collection({ features: [feature()] });
    const beforeEngine = collection({ features: [feature({ coordinates: [120, 5] })] });
    const beforeStyle = collection({ features: [feature({ coordinates: [10, 52] })], withoutGeometry: 1 });
    const afterStyle = collection({ features: [feature({ coordinates: [-70, -33] })] });
    global.fetch = vi.fn();
    const { RtpCycleProjectMap } = await importPanel();
    const view = render(<RtpCycleProjectMap collection={initial} audience="public" />);
    await waitFor(() => expect(libraryLoad.requested).toHaveBeenCalledTimes(1));
    view.rerender(<RtpCycleProjectMap collection={beforeEngine} audience="public" />);
    await act(async () => release());
    await waitFor(() => expect(maplibreMocks.Map).toHaveBeenCalledTimes(1));
    const map = maplibreMocks.instances[0];
    expect(map.options.center).toEqual([120, 5]);
    view.rerender(<RtpCycleProjectMap collection={beforeStyle} audience="public" />);
    // The early style event can precede readiness while source data arrives.
    act(() => map.fire("style.load"));
    expect(map.addSource).not.toHaveBeenCalled();
    act(() => {
      map.setStyleLoaded(true);
      map.fire("styledata");
    });
    expect(map.sources["rtp-cycle-projects"].data).toEqual(beforeStyle);
    expect(maplibreMocks.LngLatBounds.mock.results[0].value.positions).toEqual([[10, 52]]);
    expect(screen.getByText(/1 of 2 projects has no location recorded/i)).toBeTruthy();
    view.rerender(<RtpCycleProjectMap collection={afterStyle} audience="public" />);
    expect(map.sources["rtp-cycle-projects"].setData).toHaveBeenLastCalledWith(afterStyle);
    expect(maplibreMocks.Map).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not construct a map if unmounted before the library arrives", async () => {
    useOpenStyle();
    const release = delayLibrary();
    const { RtpCycleProjectMap } = await importPanel();
    const view = render(<RtpCycleProjectMap collection={collection({ features: [feature()] })} audience="public" />);
    await waitFor(() => expect(libraryLoad.requested).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => release());
    await waitFor(() => expect(maplibreMocks.addProtocol).toHaveBeenCalled());
    expect(maplibreMocks.Map).not.toHaveBeenCalled();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
  });

  it("cancels pending style work and disconnects sizing when unmounted", async () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      observe = observe;
      disconnect = disconnect;
    });
    const { RtpCycleProjectMap } = await importPanel();
    vi.useFakeTimers();
    const view = render(<RtpCycleProjectMap collection={collection({ features: [feature()] })} audience="public" />);
    const map = mapboxMocks.instances[0];
    expect(observe).toHaveBeenCalledWith(screen.getByTestId("rtp-cycle-project-map-canvas"));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(map.remove).toHaveBeenCalledTimes(1);
    expect([...map.handlers.values()].flat()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    act(() => map.fire("load"));
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("removes the active popup and delegated listeners on teardown", async () => {
    const { RtpCycleProjectMap } = await importPanel();
    const view = render(<RtpCycleProjectMap collection={collection({ features: [feature()] })} audience="public" />);
    const map = mapboxMocks.instances[0];
    act(() => {
      map.fire("load");
      map.fire("click:rtp-cycle-projects-circle", { features: [{ properties: {} }], lngLat: { lng: 0, lat: 0 } });
    });
    const popup = mapboxMocks.Popup.mock.results[0].value;
    view.unmount();
    expect(popup.remove).toHaveBeenCalledTimes(1);
    expect([...map.handlers.values()].flat()).toEqual([]);
    expect(map.remove).toHaveBeenCalledTimes(1);
  });

  it.each(["chunk", "WebGL"])("reports a MapLibre %s failure without trying Mapbox", async (failure) => {
    useOpenStyle();
    const startupError = new Error("WebGL unavailable");
    if (failure === "chunk") libraryLoad.error = new Error("chunk failed");
    else maplibreMocks.Map.mockImplementationOnce(function MapLibreWithoutWebGL() {
      throw startupError;
    });
    const { RtpCycleProjectMap } = await importPanel();
    render(<RtpCycleProjectMap collection={collection({ features: [feature()] })} audience="public" />);
    if (failure === "WebGL") {
      await waitFor(() => expect(maplibreMocks.Map).toHaveBeenCalledTimes(1));
      expect(maplibreMocks.Map.mock.results[0].type).toBe("throw");
      expect(maplibreMocks.Map.mock.results[0].value).toBe(startupError);
      expect(console.error).toHaveBeenCalledWith("[map] the map could not start", startupError);
    }
    expect(await screen.findByText(/The map could not start in this browser/i)).toBeTruthy();
    expect(screen.queryByText(/No projects are in this plan yet/i)).toBeNull();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
  });

  it("keeps the canvas after an initial style error and recovers on late load", async () => {
    useOpenStyle();
    const { RtpCycleProjectMap } = await importPanel();
    const view = render(<RtpCycleProjectMap collection={collection({ features: [feature()], withoutGeometry: 1 })} audience="public" />);
    await waitFor(() => expect(maplibreMocks.Map).toHaveBeenCalledTimes(1));
    const map = maplibreMocks.instances[0];
    const canvas = screen.getByTestId("rtp-cycle-project-map-canvas");
    act(() => map.fire("error", { error: new Error("style unavailable") }));
    expect(screen.getByText(/The map background could not be loaded/i).closest('[role="status"]')).not.toBeNull();
    expect(screen.getByTestId("rtp-cycle-project-map-canvas")).toBe(canvas);
    expect(screen.getByText(/1 of 2 projects has no location recorded/i)).toBeTruthy();
    expect(screen.queryByText(/No projects are in this plan yet/i)).toBeNull();
    act(() => map.fire("load"));
    expect(screen.queryByText(/The map background could not be loaded/i)).toBeNull();
    expect(map.sources["rtp-cycle-projects"]).toBeDefined();
    act(() => map.fire("error", { error: new Error("a later tile failed") }));
    expect(screen.queryByText(/The map background could not be loaded/i)).toBeNull();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
    view.unmount();
  });

  it("reports a stalled Mapbox style without provider fallback and clears its watchdog on recovery", async () => {
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", OPEN_STYLE);
    const { RtpCycleProjectMap } = await importPanel();
    vi.useFakeTimers();
    const view = render(<RtpCycleProjectMap collection={collection({ features: [feature()] })} audience="public" />);
    const map = mapboxMocks.instances[0];
    const canvas = screen.getByTestId("rtp-cycle-project-map-canvas");
    act(() => vi.advanceTimersByTime(14_999));
    expect(screen.queryByText(/The map background could not be loaded/i)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText(/The map background could not be loaded/i)).toBeTruthy();
    expect(screen.getByTestId("rtp-cycle-project-map-canvas")).toBe(canvas);
    expect(libraryLoad.requested).not.toHaveBeenCalled();
    expect(maplibreMocks.Map).not.toHaveBeenCalled();
    act(() => map.fire("load"));
    expect(screen.queryByText(/The map background could not be loaded/i)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
  });

  it("does not switch providers when a configured public token fails at runtime", async () => {
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", OPEN_STYLE);
    const { RtpCycleProjectMap } = await importPanel();
    render(<RtpCycleProjectMap collection={collection({ features: [feature()] })} audience="public" />);
    const map = mapboxMocks.instances[0];
    act(() => map.fire("error", { error: new Error("401 invalid or expired public token") }));
    expect(screen.getByText(/The map background could not be loaded/i)).toBeTruthy();
    expect(libraryLoad.requested).not.toHaveBeenCalled();
    expect(maplibreMocks.Map).not.toHaveBeenCalled();
    expect(mapboxMocks.Map).toHaveBeenCalledTimes(1);
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
