/**
 * EACH CONVERTED PAINT DRAWS IN THE RACE THE REPOSITORY MEASURED.
 *
 * The race: `style.load` has fired, `isStyleLoaded()` still answers false while
 * tiles stream, and no further `style.load` is coming. Measured on /safety, 2 of
 * 5 loads never drew. The fake reproduces it with `loadStyleWhileTilesStream()`
 * and ends it with `settleTiles()`, which emits `styledata` and `idle` but no
 * second `style.load`. Before this change each paint below either waited for
 * that second `style.load` or bailed with no retry.
 *
 * The fake renders nothing; these prove wiring, not pixels.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ParticipantContextLayer } from "@/lib/engagement/context-layers";
import type { SafetyCrashCollection } from "@/lib/safety/client-types";
import { lastFakeMap, resetFakeMaps } from "@/test/helpers/mapbox-gl-fake";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects",
}));
vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

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
const CONTEXT_SOURCE = "engagement-context-ctx-a";

beforeEach(() => {
  vi.resetModules();
  resetFakeMaps();
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token");
});

afterEach(() => cleanup());

type Collection = { features: Array<{ geometry: { type: string } }> };

describe("the engagement geometry picker", () => {
  it("paints the campaign's layers after the tiles settle", async () => {
    const { GeometryPickerMap } = await import("@/components/engagement/geometry-picker-map");
    render(<GeometryPickerMap onGeometryChange={() => {}} contextLayers={{ layers: [CONTEXT_LAYER], readFailure: null }} />);
    const map = lastFakeMap();
    act(() => map.loadStyleWhileTilesStream());
    expect(map.sourceIds()).not.toContain(CONTEXT_SOURCE);
    act(() => map.settleTiles());
    expect(map.sourceIds()).toContain(CONTEXT_SOURCE);
  });

  it("draws a point placed while tiles stream", async () => {
    const { GeometryPickerMap } = await import("@/components/engagement/geometry-picker-map");
    render(<GeometryPickerMap onGeometryChange={() => {}} />);
    const map = lastFakeMap();
    act(() => {
      map.loadStyle();
      map.emit("load");
    });
    map.tilesStillLoading = true;
    act(() => map.tap());
    expect((map.sourceData("engagement-draw") as Collection).features).toHaveLength(0);
    act(() => map.settleTiles());
    expect((map.sourceData("engagement-draw") as Collection).features).toHaveLength(1);
  });
});

describe("the engagement location map", () => {
  it("paints the campaign's layers after the tiles settle", async () => {
    const { LocationDisplayMap } = await import("@/components/engagement/location-display-map");
    render(<LocationDisplayMap items={[]} contextLayers={{ layers: [CONTEXT_LAYER], readFailure: null }} />);
    const map = lastFakeMap();
    act(() => map.loadStyleWhileTilesStream());
    expect(map.sourceIds()).not.toContain(CONTEXT_SOURCE);
    act(() => map.settleTiles());
    expect(map.sourceIds()).toContain(CONTEXT_SOURCE);
  });
});

describe("the mission area editor", () => {
  const SQUARE = {
    type: "Polygon" as const,
    coordinates: [[[-83.1, 39.9], [-82.9, 39.9], [-82.9, 40.1], [-83.1, 40.1], [-83.1, 39.9]]] as [number, number][][],
  };

  it("draws a saved area when the map loads, not only after an edit", async () => {
    const { MissionAoiEditor } = await import("@/components/aerial/mission-aoi-editor");
    render(<MissionAoiEditor missionId="mission-1" initialPolygon={SQUARE} />);
    const map = lastFakeMap();
    // The order a real map uses: the style settles (`styledata`) before the
    // first full render (`load`), so a paint waiting on the style runs while
    // the preview source does not exist yet. Only the load handler can draw it.
    act(() => {
      map.loadStyle();
      map.emit("styledata");
      map.emit("load");
    });
    const types = (map.sourceData("aoi-preview") as Collection).features.map((feature) => feature.geometry.type);
    expect(types).toContain("Polygon");
  });

  it("draws a corner added while tiles stream", async () => {
    const { MissionAoiEditor } = await import("@/components/aerial/mission-aoi-editor");
    render(<MissionAoiEditor missionId="mission-1" initialPolygon={null} />);
    const map = lastFakeMap();
    act(() => {
      map.loadStyle();
      map.emit("load");
    });
    map.tilesStillLoading = true;
    act(() => map.tap());
    expect((map.sourceData("aoi-preview") as Collection).features).toHaveLength(0);
    act(() => map.settleTiles());
    expect((map.sourceData("aoi-preview") as Collection).features).toHaveLength(1);
  });
});

describe("the Safety crash map", () => {
  const crash = (id: string) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [-83.0, 39.96] },
    properties: { id, severity: "fatal", collisionDate: "2024-03-04", killedCount: 1, injuredCount: 0 },
  });

  it("draws a filter change that lands while tiles stream", async () => {
    const { SafetyCrashMap } = await import("@/components/safety/safety-crash-map");
    const first = { type: "FeatureCollection", features: [crash("a")] } as unknown as SafetyCrashCollection;
    const second = { type: "FeatureCollection", features: [crash("a"), crash("b")] } as unknown as SafetyCrashCollection;
    const { rerender } = render(<SafetyCrashMap collection={first} bbox={null} styleUrl="mapbox://styles/mapbox/streets-v12" />);
    const map = lastFakeMap();
    act(() => map.loadStyle());
    map.tilesStillLoading = true;
    rerender(<SafetyCrashMap collection={second} bbox={null} styleUrl="mapbox://styles/mapbox/streets-v12" />);
    expect((map.sourceData("safety-crashes") as Collection).features).toHaveLength(1);
    act(() => map.settleTiles());
    expect((map.sourceData("safety-crashes") as Collection).features).toHaveLength(2);
  });
});
