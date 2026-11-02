/**
 * THE REST OF THE MAPS DRAW WITHOUT A MAPBOX KEY (KI-2026-10-12-026).
 *
 * PR 277 moved Safety, Corridor Analysis, both engagement maps and the
 * published land-use map onto the shared engine choice
 * (`src/lib/maps/map-engine.ts`). These were still key-only: the shell map on
 * the Aerial index, the aerial mission map, the mission area editor, the
 * flight plan editor, the traffic volume map, the model agreement map, the
 * participation heat map and the extent preview in GIS layer import. For each
 * one this checks:
 *
 *   - no key and an operator style: MapLibre builds the map on that style and
 *     the map adds a compact credit;
 *   - a public key: Mapbox builds it on the same Mapbox style as before, and
 *     MapLibre is never loaded;
 *   - the drawing waits for the map's own `load` (or `whenStyleAccepts`), so a
 *     map that MapLibre builds a moment late still draws what is on the page.
 *
 * MapLibre is replaced by the same lifecycle fake as Mapbox, so nothing here
 * proves MapLibre renders a style, that a layer is visible, or that a canvas
 * has a size. Those need a browser.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGREEMENT_VERIFICATION_HEADERS } from "@/lib/models/demand-agreement-artifact";
import type { SpatialFileImport } from "@/lib/geo/spatial-file-import";
import {
  failNextFakeMapConstruction,
  fakeMaps,
  lastFakeMap,
  resetFakeMaps,
  type FakeMapboxMap,
} from "@/test/helpers/mapbox-gl-fake";

const protocols = vi.hoisted(() => ({ added: [] as string[] }));
const theme = vi.hoisted(() => ({ resolved: "light" as "light" | "dark" }));
const MAPLIBRE_EXPANSION_ZOOM = vi.hoisted(() => 15);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/aerial",
}));
vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
/*
  MapLibre's fake differs from Mapbox's where the libraries differ in ways a map
  can trip on: its popups are its own class (a Mapbox popup cannot attach to a
  MapLibre map), and its cluster source answers `getClusterExpansionZoom` with
  a promise and never calls a callback, as MapLibre 5 and later do.
*/
vi.mock("maplibre-gl", async () => {
  const { createMapboxGlModuleFake, FakeMapboxMap } = await import("@/test/helpers/mapbox-gl-fake");
  const fake = createMapboxGlModuleFake();
  class MapLibrePopup extends fake.default.Popup {
    readonly library = "maplibre";
  }
  class MapLibreMap extends FakeMapboxMap {
    addSource(id: string, source: { data?: unknown }): void {
      super.addSource(id, source);
      Object.assign(this.getSource(id) as object, {
        getClusterExpansionZoom: () => Promise.resolve(MAPLIBRE_EXPANSION_ZOOM),
      });
    }
  }
  const api = {
    ...fake.default,
    Map: MapLibreMap,
    Popup: MapLibrePopup,
    addProtocol: (name: string) => protocols.added.push(name),
    setWorkerUrl: () => undefined,
  };
  return { default: api, ...api };
});
/** What the shared Mapbox fake's cluster source answers, by callback. */
const MAPBOX_EXPANSION_ZOOM = 14;
vi.mock("pmtiles", () => ({ Protocol: class { tile = () => undefined; } }));
// Only the shell map reads the theme; a test switches it here.
vi.mock("@/components/theme-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/theme-provider")>();
  return { ...actual, useTheme: () => ({ ...actual.useTheme(), resolvedTheme: theme.resolved }) };
});

const STYLE = "https://tiles.example.org/styles/liberty";
const MAPBOX_DARK = "mapbox://styles/mapbox/dark-v11";

/** A study area that is nowhere in particular: the tests read wiring, not place. */
const AOI = {
  type: "Polygon",
  coordinates: [
    [
      [-83.01, 39.95],
      [-82.99, 39.95],
      [-82.99, 39.97],
      [-83.01, 39.97],
      [-83.01, 39.95],
    ],
  ],
} as const;

let quietErrors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  resetFakeMaps();
  protocols.added = [];
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", STYLE);
  quietErrors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  quietErrors.mockRestore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function useMapboxKey() {
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token");
}

function useNeitherEngine() {
  vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", "");
}

async function waitForMap(): Promise<FakeMapboxMap> {
  await waitFor(() => expect(fakeMaps()).toHaveLength(1));
  return lastFakeMap();
}

/** The map's `style.load` and then its `load`, as both libraries fire them. */
function loadMap(map: FakeMapboxMap) {
  act(() => {
    map.loadStyle();
    map.emit("load");
  });
}

function hasCompactAttribution(map: FakeMapboxMap): boolean {
  return map.controls.some((control) => (control as { options?: { compact?: boolean } }).options?.compact === true);
}

function expectOpenStyle(map: FakeMapboxMap) {
  expect(map.options.style).toBe(STYLE);
  expect(protocols.added).toEqual(["pmtiles"]);
  expect(hasCompactAttribution(map)).toBe(true);
}

function expectMapbox(map: FakeMapboxMap, style: string) {
  expect(map.options.style).toBe(style);
  // MapLibre was never loaded: its protocol registration never ran.
  expect(protocols.added).toEqual([]);
  expect(hasCompactAttribution(map)).toBe(true);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

// ── aerial mission map ───────────────────────────────────────────────────────

describe("aerial mission map", () => {
  const PREVIEW = {
    url: "https://storage.example.org/preview.png",
    bounds: [-83.01, 39.95, -82.99, 39.97] as [number, number, number, number],
    crs: "EPSG:4326",
    pixelSizeM: 0.05,
  };

  /** The imagery read resolves only when the test says so. */
  function stubImagery() {
    let resolve: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((settle) => (resolve = settle))));
    return (rows: unknown[]) => resolve(jsonResponse({ imagery: rows }));
  }

  async function renderMission() {
    const { AerialMissionMap } = await import("@/components/aerial/aerial-mission-map");
    render(<AerialMissionMap missionId="mission-1" preview={PREVIEW} previewNotice={null} aoi={AOI} />);
  }

  it("draws on the operator's style, says there is no satellite background, and credits the style", async () => {
    stubImagery();
    await renderMission();
    const map = await waitForMap();
    expectOpenStyle(map);
    expect(screen.getByTestId("aerial-mission-map-no-satellite").textContent).toBe(
      "No satellite background on this installation.",
    );
    // Nothing is drawn before the map's own `load`.
    expect(map.sourceIds()).toEqual([]);
    loadMap(map);
    expect(map.layerIds()).toEqual([
      "aerial-mission-area-fill",
      "aerial-mission-ortho-preview-layer",
      "aerial-mission-area-outline",
      "aerial-mission-photo-points-layer",
    ]);
    expect(map.fitBoundsCalls).toHaveLength(1);
  });

  it("draws photo locations that arrived before the map loaded", async () => {
    const answer = stubImagery();
    await renderMission();
    const map = await waitForMap();
    await act(async () => answer([{ id: "p1", gps_lat: 39.96, gps_lon: -83.0, original_filename: "a.jpg" }]));
    await screen.findByText(/Photo locations \(1\)/);
    loadMap(map);
    expect((map.sourceData("aerial-mission-photo-points") as { features: unknown[] }).features).toHaveLength(1);
  });

  it("draws a layer the planner switched off before the map loaded as hidden", async () => {
    stubImagery();
    await renderMission();
    const map = await waitForMap();
    fireEvent.click(screen.getByLabelText(/Orthomosaic preview/));
    loadMap(map);
    expect(map.layer("aerial-mission-ortho-preview-layer")?.spec.layout).toEqual({ visibility: "none" });
  });

  it("keeps the Mapbox satellite style when a key is set", async () => {
    useMapboxKey();
    stubImagery();
    await renderMission();
    expectMapbox(lastFakeMap(), "mapbox://styles/mapbox/satellite-streets-v12");
    expect(screen.queryByTestId("aerial-mission-map-no-satellite")).toBeNull();
  });

  it("with neither, says the map is not set up and builds nothing", async () => {
    useNeitherEngine();
    stubImagery();
    await renderMission();
    expect(screen.getByText(/has no map key set up/)).toBeInTheDocument();
    expect(fakeMaps()).toHaveLength(0);
  });
});

// ── mission area editor ──────────────────────────────────────────────────────

describe("mission area editor", () => {
  async function renderEditor() {
    const { MissionAoiEditor } = await import("@/components/aerial/mission-aoi-editor");
    render(<MissionAoiEditor missionId="mission-1" initialPolygon={AOI as never} />);
  }

  it("draws the saved area on the operator's style once the map loads", async () => {
    await renderEditor();
    const map = await waitForMap();
    expectOpenStyle(map);
    expect(map.sourceIds()).toEqual([]);
    loadMap(map);
    const preview = map.sourceData("aoi-preview") as { features: Array<{ geometry: { type: string } }> };
    expect(preview.features.some((feature) => feature.geometry.type === "Polygon")).toBe(true);
    expect(map.fitBoundsCalls).toHaveLength(1);
  });

  it("draws a vertex added while tiles stream once they settle", async () => {
    const { MissionAoiEditor } = await import("@/components/aerial/mission-aoi-editor");
    render(<MissionAoiEditor missionId="mission-1" initialPolygon={null} />);
    const map = await waitForMap();
    loadMap(map);
    map.tilesStillLoading = true;
    act(() => map.tap());
    const before = map.sourceData("aoi-preview") as { features: unknown[] };
    expect(before.features).toHaveLength(0);
    act(() => map.settleTiles());
    expect((map.sourceData("aoi-preview") as { features: unknown[] }).features.length).toBeGreaterThan(0);
  });

  it("keeps the Mapbox style when a key is set", async () => {
    useMapboxKey();
    await renderEditor();
    expectMapbox(lastFakeMap(), MAPBOX_DARK);
  });

  it("says the browser could not start it when MapLibre fails", async () => {
    failNextFakeMapConstruction("Failed to initialize WebGL");
    await renderEditor();
    expect(await screen.findByText("This browser could not start the map.")).toBeInTheDocument();
  });
});

// ── flight plan editor ───────────────────────────────────────────────────────

describe("flight plan editor", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ flightPlan: null })));
  });

  async function renderEditor() {
    const { FlightPlanEditor } = await import("@/components/aerial/flight-plan-editor");
    render(<FlightPlanEditor missionId="mission-1" aoiGeojson={AOI} canEdit={true} />);
  }

  it("opens on the mission area on the operator's style and draws it once loaded", async () => {
    await renderEditor();
    const map = await waitForMap();
    expectOpenStyle(map);
    expect(map.options.bounds).toEqual([[-83.01, 39.95], [-82.99, 39.97]]);
    expect(map.sourceIds()).toEqual([]);
    loadMap(map);
    expect(map.sourceIds()).toEqual(["flight-plan-aoi", "flight-plan-grid"]);
  });

  it("keeps the Mapbox style when a key is set", async () => {
    useMapboxKey();
    await renderEditor();
    expectMapbox(lastFakeMap(), MAPBOX_DARK);
  });

  it("says generation still works when there is no map", async () => {
    useNeitherEngine();
    await renderEditor();
    expect(screen.getByText(/Generation, statistics, saving and exports still work/)).toBeInTheDocument();
    expect(fakeMaps()).toHaveLength(0);
  });
});

// ── traffic volume map ───────────────────────────────────────────────────────

describe("traffic volume map", () => {
  const NETWORK = {
    type: "FeatureCollection",
    metadata: { maxVolume: 4000, linksAvailable: 1 },
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[-83.01, 39.95], [-82.99, 39.97]] },
        properties: { pce_tot: 1200, pce_ab: 600, pce_ba: 600 },
      },
    ],
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(NETWORK)));
  });

  async function renderMap() {
    const { TrafficVolumeMap } = await import("@/components/models/traffic-volume-map");
    render(<TrafficVolumeMap geojsonUrl="/api/models/m/runs/r/volumes" />);
  }

  it("draws the assignment on the operator's style once the map loads", async () => {
    await renderMap();
    const map = await waitForMap();
    expectOpenStyle(map);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    loadMap(map);
    await waitFor(() => expect(map.layerIds()).toEqual(["traffic-volumes-glow", "traffic-volumes-line"]));
    expect(map.fitBoundsCalls).toHaveLength(1);
  });

  it("keeps the Mapbox style when a key is set", async () => {
    useMapboxKey();
    await renderMap();
    expectMapbox(lastFakeMap(), MAPBOX_DARK);
  });

  it("with neither, shows the shared notice instead of an error line", async () => {
    useNeitherEngine();
    await renderMap();
    expect(screen.getByText("The traffic volume map can't be drawn here")).toBeInTheDocument();
    expect(screen.queryByText(/Mapbox token not configured/)).toBeNull();
    expect(fakeMaps()).toHaveLength(0);
  });
});

// ── model agreement map ──────────────────────────────────────────────────────

describe("model agreement map", () => {
  type Fixture = { metadata: Record<string, unknown> };
  const FIXTURE_TEXT = readFileSync(
    "../scripts/modeling/tests/fixtures/producer_corridor_agreement_v2.geojson",
    "utf8",
  );
  const URL_PATH =
    "/api/models/11111111-1111-4111-8111-111111111111/runs/22222222-2222-4222-8222-222222222222/agreement";

  function pick(value: unknown, ...keys: string[]): Record<string, unknown> {
    let current = value as Record<string, unknown>;
    for (const key of keys) current = current[key] as Record<string, unknown>;
    return current;
  }

  /** The route's verification headers for the producer fixture, as the rendering suite sends them. */
  function verifiedResponse(): Response {
    const fixture = JSON.parse(FIXTURE_TEXT) as Fixture;
    const headers = new Headers();
    headers.set(AGREEMENT_VERIFICATION_HEADERS.artifact, createHash("sha256").update(FIXTURE_TEXT).digest("hex"));
    headers.set(
      AGREEMENT_VERIFICATION_HEADERS.assignmentProfile,
      String(pick(fixture.metadata, "assignment_convergence", "assignment_profile_digests").first),
    );
    headers.set(
      AGREEMENT_VERIFICATION_HEADERS.networkSettings,
      String(pick(fixture.metadata, "network_consistency", "evidence", "network_settings", "first").digest),
    );
    headers.set(AGREEMENT_VERIFICATION_HEADERS.networkState, String(fixture.metadata.network_state_digest));
    return new Response(FIXTURE_TEXT, { status: 200, headers });
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => verifiedResponse()));
  });

  async function renderMap() {
    const { DemandAgreementMap } = await import("@/components/models/demand-agreement-map");
    render(<DemandAgreementMap geojsonUrl={URL_PATH} />);
  }

  it("draws the compared links on the operator's style once the map loads", async () => {
    await renderMap();
    const map = await waitForMap();
    expectOpenStyle(map);
    expect(map.sourceIds()).toEqual([]);
    act(() => map.emit("load"));
    expect(map.layerIds()).toEqual(["demand-agreement-lines"]);
    expect(map.fitBoundsCalls).toHaveLength(1);
  });

  it("keeps the Mapbox style when a key is set", async () => {
    useMapboxKey();
    await renderMap();
    expectMapbox(await waitForMap(), MAPBOX_DARK);
  });

  it("states a MapLibre start failure as the map's failure", async () => {
    failNextFakeMapConstruction("Failed to initialize WebGL");
    await renderMap();
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to initialize WebGL");
  });
});

// ── participation heat map ───────────────────────────────────────────────────

describe("participation heat map", () => {
  const POINTS = [
    { lng: -83.0, lat: 39.96, weight: 1, negative: false },
    { lng: -82.995, lat: 39.955, weight: 1, negative: true },
  ];
  const NO_HOTSPOTS = { type: "FeatureCollection", features: [] } as never;

  async function renderMap() {
    const { ParticipationHeatmapMap } = await import("@/components/engagement/participation-heatmap-map");
    render(<ParticipationHeatmapMap points={POINTS} hotspots={NO_HOTSPOTS} sentimentAvailable={true} />);
  }

  it("draws the heat on the operator's style once the map loads", async () => {
    await renderMap();
    const map = await waitForMap();
    expectOpenStyle(map);
    expect(map.layerIds()).toEqual([]);
    loadMap(map);
    expect(map.layerIds()).toEqual(["engagement-heat"]);
  });

  it("applies a mode switch made while tiles stream once they settle", async () => {
    await renderMap();
    const map = await waitForMap();
    loadMap(map);
    map.tilesStillLoading = true;
    fireEvent.click(screen.getByRole("button", { name: "Concern" }));
    const concernCalls = () =>
      map.paintPropertyCalls.filter(
        (call) => call.layerId === "engagement-heat" && JSON.stringify(call.value).includes("negative"),
      );
    expect(concernCalls()).toHaveLength(0);
    act(() => map.settleTiles());
    expect(concernCalls()).toHaveLength(1);
  });

  it("keeps the Mapbox style when a key is set", async () => {
    useMapboxKey();
    await renderMap();
    expectMapbox(lastFakeMap(), MAPBOX_DARK);
  });

  it("says the browser could not start it when MapLibre fails", async () => {
    failNextFakeMapConstruction("Failed to initialize WebGL");
    await renderMap();
    expect(await screen.findByText("This browser could not start the map.")).toBeInTheDocument();
  });
});

// ── GIS layer import extent preview ──────────────────────────────────────────

describe("GIS layer import extent preview", () => {
  const BBOX = { west: -83.01, south: 39.95, east: -82.99, north: 39.97 };
  const IMPORTED = {
    ok: true,
    format: "geojson",
    srs: { authority: "EPSG", code: "4326", name: "WGS 84", basis: "specification", reprojectedFrom: null, datumNote: null },
    featureCollection: { type: "FeatureCollection", features: [] },
    geometryKinds: ["Polygon"],
    featureCount: 3,
    sourceFeatureCount: 3,
    droppedFeatureCount: 0,
    truncated: false,
    bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    attributeFields: [{ name: "name", type: "text" }],
    attributeEncoding: { label: "utf-8", basis: "specification" },
    attributesUnavailableReason: null,
  } as unknown as SpatialFileImport;

  async function renderPreview(bbox = BBOX) {
    const { LayerPlacementPreview } = await import("@/components/workspace-gis/layer-placement-preview");
    const props = { imported: IMPORTED, entry: null, basis: "specification" as const, warnings: [], homeGeography: null };
    const view = render(<LayerPlacementPreview {...props} bbox={bbox} />);
    return (next: typeof BBOX) => view.rerender(<LayerPlacementPreview {...props} bbox={next} />);
  }

  it("draws the extent on a fixed map on the operator's style", async () => {
    await renderPreview();
    const map = await waitForMap();
    expectOpenStyle(map);
    expect(map.options.interactive).toBe(false);
    expect(map.options.bounds).toEqual([[BBOX.west, BBOX.south], [BBOX.east, BBOX.north]]);
    expect(screen.getByTestId("gis-preview-extent-map")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("The extent of this file"),
    );
    expect(map.sourceIds()).toEqual([]);
    loadMap(map);
    expect(map.layerIds()).toEqual(["gis-preview-extent-fill", "gis-preview-extent-line"]);
  });

  it("moves the extent when the planner reads the file another way, after tiles settle", async () => {
    const rerender = await renderPreview();
    const map = await waitForMap();
    loadMap(map);
    map.tilesStillLoading = true;
    const moved = { west: -84.01, south: 40.95, east: -83.99, north: 40.97 };
    rerender(moved);
    const ring = () =>
      (map.sourceData("gis-preview-extent") as { geometry: { coordinates: number[][][] } }).geometry.coordinates[0];
    expect(ring()[0]).toEqual([BBOX.west, BBOX.south]);
    act(() => map.settleTiles());
    expect(ring()[0]).toEqual([moved.west, moved.south]);
  });

  it("keeps the Mapbox static image when a key is set, and builds no map", async () => {
    useMapboxKey();
    await renderPreview();
    const image = screen.getByRole("img", { name: /The extent of this file/ });
    expect(image.getAttribute("src")).toMatch(/^https:\/\/api\.mapbox\.com\/styles\/v1\/mapbox\/light-v11\/static\//);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fakeMaps()).toHaveLength(0);
  });

  it("states the extent in words when MapLibre cannot start", async () => {
    failNextFakeMapConstruction("Failed to initialize WebGL");
    await renderPreview();
    expect(await screen.findByText(/This browser could not start the map, so the extent is given in coordinates/)).toBeInTheDocument();
  });

  it("with neither, states the extent in words", async () => {
    useNeitherEngine();
    await renderPreview();
    expect(screen.getByText(/No basemap is configured on this deployment/)).toBeInTheDocument();
  });
});

// ── shell map on the Aerial index ────────────────────────────────────────────

describe("shell map on the Aerial index", () => {
  const MISSION_AREAS = {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: AOI, properties: { id: "mission-1" } }],
  };

  beforeEach(() => {
    theme.resolved = "light";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        jsonResponse(String(url).includes("aerial-missions") ? MISSION_AREAS : { type: "FeatureCollection", features: [] }),
      ),
    );
  });

  async function renderBackdrop() {
    const { CartographicMapBackdrop } = await import("@/components/cartographic/cartographic-map-backdrop");
    const view = render(<CartographicMapBackdrop />);
    return { ...view, rerenderBackdrop: () => view.rerender(<CartographicMapBackdrop />) };
  }

  /** The workspace layer binding windows its read to the view once the map is ready. */
  function giveBounds(map: FakeMapboxMap) {
    Object.assign(map, {
      getBounds: () => ({ getWest: () => -84, getSouth: () => 39, getEast: () => -82, getNorth: () => 41 }),
    });
  }

  it("draws on the operator's style, credits it, and paints mission areas once loaded", async () => {
    const { container } = await renderBackdrop();
    const map = await waitForMap();
    expectOpenStyle(map);
    expect(container.querySelector(".op-map-backdrop__canvas")).not.toBeNull();
    giveBounds(map);
    expect(map.layerIds()).toEqual([]);
    loadMap(map);
    await waitFor(() => expect(map.layerIds()).toContain("cartographic-aerial-mission-aois-fill"));
    expect(map.setStyleCalls).toEqual([]);
  });

  it("rebuilds on the same open style when the theme changes, and paints the new map once it loads", async () => {
    const { rerenderBackdrop } = await renderBackdrop();
    const first = await waitForMap();
    giveBounds(first);
    loadMap(first);
    await waitFor(() => expect(first.layerIds()).toContain("cartographic-aerial-mission-aois-fill"));

    theme.resolved = "dark";
    rerenderBackdrop();
    await waitFor(() => expect(fakeMaps()).toHaveLength(2));
    const second = lastFakeMap();
    expect(first.removed).toBe(true);
    // One open style serves both themes; nothing asks MapLibre for a Mapbox style.
    expect(second.options.style).toBe(STYLE);
    expect([...first.setStyleCalls, ...second.setStyleCalls]).toEqual([]);
    giveBounds(second);
    loadMap(second);
    await waitFor(() => expect(second.layerIds()).toContain("cartographic-aerial-mission-aois-fill"));
  });

  const TRANSIT_SOURCE = "cartographic-transit-stops";
  const CLUSTER_CLICK = {
    features: [{ properties: { cluster_id: 7 }, geometry: { type: "Point", coordinates: [-83.0, 39.96] } }],
  };
  const STOP_CLICK = {
    features: [
      {
        properties: { stopName: "High St & Broad St", tripsPerDay: 120, peakHeadwayMinutes: 10, routesServing: 2 },
        geometry: { type: "Point", coordinates: [-83.0, 39.96] },
      },
    ],
  };

  /** A loaded shell map with a clustered transit source, as the transit paint leaves it. */
  async function loadedWithTransit() {
    await renderBackdrop();
    const map = await waitForMap();
    giveBounds(map);
    loadMap(map);
    await waitFor(() => expect(map.layerIds()).toContain("cartographic-aerial-mission-aois-fill"));
    map.addSource(TRANSIT_SOURCE, { data: { type: "FeatureCollection", features: [] } });
    return map;
  }

  it("zooms into a transit cluster on MapLibre, whose source answers with a promise", async () => {
    const map = await loadedWithTransit();
    act(() => map.emitOnLayer("click", "cartographic-transit-stops-cluster", CLUSTER_CLICK));
    await waitFor(() => expect(map.easeToCalls).toHaveLength(1));
    expect(map.easeToCalls[0]).toMatchObject({ center: [-83.0, 39.96], zoom: MAPLIBRE_EXPANSION_ZOOM });
  });

  it("still zooms into a transit cluster on Mapbox, whose source answers by callback", async () => {
    useMapboxKey();
    const map = await loadedWithTransit();
    act(() => map.emitOnLayer("click", "cartographic-transit-stops-cluster", CLUSTER_CLICK));
    await waitFor(() => expect(map.easeToCalls).toHaveLength(1));
    expect(map.easeToCalls[0]).toMatchObject({ center: [-83.0, 39.96], zoom: MAPBOX_EXPANSION_ZOOM });
  });

  it("opens a transit stop's popup built by MapLibre, not by Mapbox", async () => {
    const map = await loadedWithTransit();
    act(() => map.emitOnLayer("click", "cartographic-transit-stops-circle", STOP_CLICK));
    expect(map.openPopups).toHaveLength(1);
    expect((map.openPopups[0] as unknown as { library?: string }).library).toBe("maplibre");
    expect(map.openPopups[0].content?.textContent).toContain("High St & Broad St");
  });

  it("keeps the theme's Mapbox style when a key is set", async () => {
    useMapboxKey();
    await renderBackdrop();
    const map = await waitForMap();
    expectMapbox(map, "mapbox://styles/mapbox/light-v11");
  });

  it("keeps the parchment when MapLibre cannot start", async () => {
    failNextFakeMapConstruction("Failed to initialize WebGL");
    const { container } = await renderBackdrop();
    await waitFor(() => expect(container.querySelector(".op-map-backdrop__canvas")).toBeNull());
  });
});

// ── the shared cluster helper ────────────────────────────────────────────────

describe("expandCluster", () => {
  async function helper() {
    return (await import("@/lib/maps/expand-cluster")).expandCluster;
  }

  it("eases once by callback (Mapbox) and once by promise (MapLibre)", async () => {
    const expandCluster = await helper();
    const byCallback = { easeTo: vi.fn() };
    expandCluster(byCallback as never, { getClusterExpansionZoom: (_id: number, done: (e: unknown, z: number) => void) => done(null, 12) } as never, 1, [0, 0]);
    expect(byCallback.easeTo).toHaveBeenCalledWith({ center: [0, 0], zoom: 12 });

    const byPromise = { easeTo: vi.fn() };
    expandCluster(byPromise as never, { getClusterExpansionZoom: () => Promise.resolve(13) } as never, 1, [0, 0], { duration: 300 });
    await waitFor(() => expect(byPromise.easeTo).toHaveBeenCalledWith({ center: [0, 0], zoom: 13, duration: 300 }));
    expect(byPromise.easeTo).toHaveBeenCalledTimes(1);
  });

  it("does nothing when either form reports a failure", async () => {
    const expandCluster = await helper();
    const map = { easeTo: vi.fn() };
    expandCluster(map as never, { getClusterExpansionZoom: (_id: number, done: (e: unknown) => void) => done(new Error("gone")) } as never, 1, [0, 0]);
    expandCluster(map as never, { getClusterExpansionZoom: () => Promise.reject(new Error("gone")) } as never, 1, [0, 0]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(map.easeTo).not.toHaveBeenCalled();
  });
});
