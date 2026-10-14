/**
 * THE STAFF MAPS DRAW WITHOUT A MAPBOX KEY (two-month review, finding 5).
 *
 * Before this, 13 of 14 maps needed a Mapbox token. The public engagement map's
 * engine choice is now shared (`src/lib/maps/map-engine.ts`), and these maps
 * use it: Safety, Corridor Analysis, the engagement geometry picker, the
 * engagement location map and the published land-use designation map. With no
 * key and an operator style, each builds a MapLibre map on that style. A key
 * still wins.
 *
 * MapLibre is replaced by the same lifecycle fake as Mapbox, so nothing here
 * proves MapLibre renders the style or that a layer is visible. No browser run
 * was made for this change.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ParticipantContextLayer } from "@/lib/engagement/context-layers";
import type { SafetyCrashCollection } from "@/lib/safety/client-types";
import {
  failNextFakeMapConstruction,
  fakeMaps,
  lastFakeMap,
  resetFakeMaps,
  type FakeMapboxMap,
} from "@/test/helpers/mapbox-gl-fake";

const protocols = vi.hoisted(() => ({ added: [] as string[] }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/safety",
}));
vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  const fake = createMapboxGlModuleFake();
  const api = {
    ...fake.default,
    FullscreenControl: class {},
    ScaleControl: class {},
    addProtocol: (name: string) => protocols.added.push(name),
    setWorkerUrl: () => undefined,
  };
  return { default: api, ...api };
});
vi.mock("pmtiles", () => ({ Protocol: class { tile = () => undefined; } }));

const STYLE = "https://tiles.example.org/styles/liberty";

const COLLECTION: SafetyCrashCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-83.0, 39.96] },
      properties: {
        id: "crash-1",
        externalId: "EXT-1",
        sourceId: "fars-us",
        severity: "fatal",
        collisionDate: "2024-03-04",
        collisionYear: 2024,
        killedCount: 1,
        injuredCount: null,
        pedestrianInvolved: false,
        bicyclistInvolved: false,
        motorcyclistInvolved: false,
      },
    },
  ],
} as unknown as SafetyCrashCollection;

const CONTEXT_LAYER: ParticipantContextLayer = {
  id: "ctx-a",
  name: "Proposed alignment",
  description: null,
  color: "#38bdf8",
  geometryKinds: ["LineString"],
  featureCollection: {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "LineString", coordinates: [[-83.0, 39.9], [-82.9, 40.0]] }, properties: {} },
    ],
  } as ParticipantContextLayer["featureCollection"],
  bbox: [-83.0, 39.9, -82.9, 40.0],
  coverageNotes: [],
};

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
});

async function waitForMap(): Promise<FakeMapboxMap> {
  await waitFor(() => expect(fakeMaps()).toHaveLength(1));
  return lastFakeMap();
}

/** The credit control: each of these maps adds a compact attribution by hand. */
function hasCompactAttribution(map: FakeMapboxMap): boolean {
  return map.controls.some((control) => (control as { options?: { compact?: boolean } }).options?.compact === true);
}

describe("Safety crash map", () => {
  it("draws with MapLibre on the operator's style, crashes and credit included", async () => {
    const { SafetyCrashMap, SAFETY_CRASH_MAP_CAN_DRAW } = await import("@/components/safety/safety-crash-map");
    expect(SAFETY_CRASH_MAP_CAN_DRAW).toBe(true);
    // An empty style URL is what the page passes with no Mapbox backgrounds.
    render(<SafetyCrashMap collection={COLLECTION} bbox={[-84, 39, -82, 41]} styleUrl="" />);
    const map = await waitForMap();
    expect(map.options.style).toBe(STYLE);
    expect(protocols.added).toEqual(["pmtiles"]);
    expect(hasCompactAttribution(map)).toBe(true);
    // Framed once MapLibre arrives, though the bbox came first.
    await waitFor(() => expect(map.fitBoundsCalls).toHaveLength(1));
    act(() => map.loadStyle());
    // The high-injury network goes on first so the crash layers sit on top of it.
    expect(map.layerIds()).toEqual([
      "safety-high-injury-network-fill",
      "safety-high-injury-network-line",
      "safety-crash-halo",
      "safety-crash-core",
    ]);
    expect((map.sourceData("safety-crashes") as SafetyCrashCollection).features).toHaveLength(1);
  });

  it("shows the notice instead of a broken map when MapLibre cannot start", async () => {
    failNextFakeMapConstruction("Failed to initialize WebGL");
    const { SafetyCrashMap } = await import("@/components/safety/safety-crash-map");
    render(<SafetyCrashMap collection={COLLECTION} bbox={null} styleUrl="" />);
    const notice = await screen.findByTestId("safety-crash-map-unavailable");
    expect(notice.textContent).toContain("could not start");
    expect(notice.textContent).toContain("crash counts and rates on this page are unaffected");
  });

  it("still uses Mapbox and the page's background when a key is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token");
    const { SafetyCrashMap } = await import("@/components/safety/safety-crash-map");
    render(<SafetyCrashMap collection={COLLECTION} bbox={null} styleUrl="mapbox://styles/mapbox/streets-v12" />);
    expect(lastFakeMap().options.style).toBe("mapbox://styles/mapbox/streets-v12");
    expect(protocols.added).toEqual([]);
  });

  it("with neither, says the map is not set up", async () => {
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", "");
    const { SafetyCrashMap, SAFETY_CRASH_MAP_CAN_DRAW } = await import("@/components/safety/safety-crash-map");
    expect(SAFETY_CRASH_MAP_CAN_DRAW).toBe(false);
    render(<SafetyCrashMap collection={COLLECTION} bbox={null} styleUrl="" />);
    expect(screen.getByTestId("safety-crash-map-unavailable").textContent).toContain("no map key configured");
    expect(screen.getByTestId("safety-crash-map-unavailable").textContent).toContain("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL");
    expect(fakeMaps()).toHaveLength(0);
  });
});

describe("Corridor Analysis map", () => {
  async function renderHook() {
    const { useExploreMapInstance } = await import("@/app/(app)/explore/_components/use-explore-map-instance");
    function Probe() {
      const { mapContainerRef, mapUnavailableReason } = useExploreMapInstance();
      return <div ref={mapContainerRef} data-reason={mapUnavailableReason ?? ""} data-testid="explore-probe" />;
    }
    render(<Probe />);
  }

  it("draws with MapLibre on the operator's style, with its credit", async () => {
    await renderHook();
    const map = await waitForMap();
    expect(map.options.style).toBe(STYLE);
    expect(screen.getByTestId("explore-probe").dataset.reason).toBe("");
    act(() => {
      map.loadStyle();
      map.emit("load");
    });
    expect(hasCompactAttribution(map)).toBe(true);
  });

  it("reports that the map cannot start rather than leaving a blank pane", async () => {
    failNextFakeMapConstruction("Failed to initialize WebGL");
    await renderHook();
    await waitFor(() => expect(screen.getByTestId("explore-probe").dataset.reason).toBe("cannot_start"));
  });
});

describe("engagement geometry picker", () => {
  it("draws with MapLibre, and paints the campaign's layers once the map arrives", async () => {
    const { GeometryPickerMap, GEOMETRY_PICKER_CAN_DRAW } = await import("@/components/engagement/geometry-picker-map");
    expect(GEOMETRY_PICKER_CAN_DRAW).toBe(true);
    render(<GeometryPickerMap onGeometryChange={() => {}} contextLayers={{ layers: [CONTEXT_LAYER], readFailure: null }} />);
    const map = await waitForMap();
    expect(map.options.style).toBe(STYLE);
    expect(hasCompactAttribution(map)).toBe(true);
    act(() => {
      map.loadStyle();
      map.emit("load");
    });
    await waitFor(() => expect(map.sourceIds()).toContain("engagement-context-ctx-a"));
    expect(map.sourceIds()).toContain("engagement-draw");
  });

  it("shows its words-only notice when MapLibre cannot start", async () => {
    failNextFakeMapConstruction("Failed to initialize WebGL");
    const { GeometryPickerMap } = await import("@/components/engagement/geometry-picker-map");
    render(<GeometryPickerMap onGeometryChange={() => {}} />);
    expect(await screen.findByTestId("geometry-picker-map-unavailable")).toBeInTheDocument();
  });
});

describe("engagement location map", () => {
  const ITEMS = [{ id: "item-1", latitude: 39.96, longitude: -83.0, title: "Crossing", body: "Hard to cross.", geometry: null }];

  it("draws with MapLibre, pins included", async () => {
    const { LocationDisplayMap } = await import("@/components/engagement/location-display-map");
    render(<LocationDisplayMap items={ITEMS} contextLayers={{ layers: [CONTEXT_LAYER], readFailure: null }} />);
    const map = await waitForMap();
    expect(map.options.style).toBe(STYLE);
    expect(hasCompactAttribution(map)).toBe(true);
    act(() => {
      map.loadStyle();
      map.emit("load");
    });
    expect(map.liveMarkers()).toHaveLength(1);
    await waitFor(() => expect(map.sourceIds()).toContain("engagement-context-ctx-a"));
  });

  it("says the browser could not start it, not that a key is missing", async () => {
    failNextFakeMapConstruction("Failed to initialize WebGL");
    const { LocationDisplayMap } = await import("@/components/engagement/location-display-map");
    render(<LocationDisplayMap items={ITEMS} />);
    const notice = await screen.findByTestId("engagement-map-unavailable");
    expect(notice.textContent).toContain("this browser could not start it");
    expect(notice.textContent).not.toContain("no map key configured");
  });
});

describe("published land-use designation map", () => {
  const ENDPOINT = "/api/public/land-use-plans/plan-1/map/designation-1";

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [],
            matchedCount: 0,
            returnedCount: 0,
            tooDenseToDraw: false,
            legendField: "zone",
            coverageNotes: [],
          }),
        ),
      ),
    );
  });

  function loadWithStyle(map: FakeMapboxMap, style: unknown) {
    Object.assign(map, {
      getStyle: () => style,
      getBounds: () => ({ getWest: () => -84, getSouth: () => 39, getEast: () => -82, getNorth: () => 41 }),
    });
    act(() => {
      map.loadStyle();
      map.emit("load");
    });
  }

  it("draws with MapLibre, labels in the style's own font", async () => {
    const { PublicDesignationMap } = await import("@/components/land-use-plans/public-designation-map");
    render(<PublicDesignationMap endpoint={ENDPOINT} bbox={[-84, 39, -82, 41]} label="Zoning" />);
    const map = await waitForMap();
    expect(map.options.style).toBe(STYLE);
    // The default control stays on, which credits the style's sources.
    expect(map.options.attributionControl).toBe(true);
    loadWithStyle(map, { glyphs: "https://tiles.example.org/fonts/{fontstack}/{range}.pbf", layers: [{ id: "place", layout: { "text-font": ["Noto Sans Regular"] } }] });
    expect((map.layer("designation-label")?.spec.layout as Record<string, unknown>)["text-font"]).toEqual(["Noto Sans Regular"]);
    expect(map.layer("designation-fill")).toBeDefined();
  });

  it("keeps the shapes and drops the labels on a style that serves no fonts", async () => {
    const { PublicDesignationMap } = await import("@/components/land-use-plans/public-designation-map");
    render(<PublicDesignationMap endpoint={ENDPOINT} bbox={[-84, 39, -82, 41]} label="Zoning" />);
    const map = await waitForMap();
    loadWithStyle(map, { layers: [] });
    expect(map.layer("designation-fill")).toBeDefined();
    expect(map.layer("designation-label")).toBeUndefined();
  });

  it("asks Mapbox for its default label fonts when a key is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token");
    const { PublicDesignationMap } = await import("@/components/land-use-plans/public-designation-map");
    render(<PublicDesignationMap endpoint={ENDPOINT} bbox={[-84, 39, -82, 41]} label="Zoning" />);
    const map = lastFakeMap();
    expect(map.options.style).toBe("mapbox://styles/mapbox/light-v11");
    loadWithStyle(map, { layers: [] });
    expect((map.layer("designation-label")?.spec.layout as Record<string, unknown>)["text-font"]).toEqual([
      "Open Sans Regular",
      "Arial Unicode MS Regular",
    ]);
  });
});
