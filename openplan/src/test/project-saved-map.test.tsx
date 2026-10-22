import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectCorridor } from "@/lib/cartographic/project-corridor-record";
import { failNextFakeMapSetup, fakeMaps, lastFakeMap, resetFakeMaps } from "@/test/helpers/mapbox-gl-fake";

// The fake records sources, layers and lifecycle events. It has no WebGL or
// layout, so these checks cannot establish pixels, projection or usability.
const deferred = vi.hoisted(() => ({ library: null as Promise<void> | null }));
vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("maplibre-gl", async () => {
  await deferred.library;
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  const fake = createMapboxGlModuleFake();
  const api = { ...fake.default, addProtocol() {}, setWorkerUrl() {} };
  return { default: api, ...api };
});
vi.mock("pmtiles", () => ({ Protocol: class { tile = () => {}; } }));
vi.mock("@/components/projects/project-map-presence", () => ({ ProjectMapPresence: () => <div>Geography editors</div> }));

const SOURCE = "project-saved-geography";
const point: GeoJSON.Point = { type: "Point", coordinates: [144.79371, 13.44430] };
const line: GeoJSON.LineString = { type: "LineString", coordinates: [[144.78, 13.43], [144.81, 13.47]] };
const area: GeoJSON.MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    [[[144.77, 13.42], [144.82, 13.42], [144.82, 13.48], [144.77, 13.42]],
      [[144.79, 13.44], [144.80, 13.44], [144.80, 13.45], [144.79, 13.44]]],
    [[[145.1, 14.1], [145.2, 14.1], [145.2, 14.2], [145.1, 14.1]]],
  ],
};
const splitArea: GeoJSON.MultiPolygon = {
  type: "MultiPolygon", coordinates: [
    [[[179.7, 51], [180, 51], [180, 51.2], [179.7, 51.2], [179.7, 51]],
      [[179.75, 51.05], [179.9, 51.05], [179.9, 51.1], [179.75, 51.05]]],
    [[[-180, 51], [-179.7, 51], [-179.7, 51.2], [-180, 51.2], [-180, 51]]],
  ],
};
const corridor: ProjectCorridor = {
  id: "corridor-1", projectId: "project-1", workspaceId: "workspace-1", name: "Saved corridor",
  corridorType: "arterial", losGrade: null, geometry: line, createdAt: "2026-10-15", updatedAt: "2026-10-15",
};
const collection = (...geometries: GeoJSON.Geometry[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection", features: geometries.map((geometry) => ({ type: "Feature", geometry, properties: {} })),
});

beforeEach(() => {
  vi.resetModules();
  resetFakeMaps();
  deferred.library = null;
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.synthetic");
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", "");
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(360);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function panel(overrides: Record<string, unknown> = {}) {
  const { ProjectMapPresencePanel } = await import("@/app/(app)/projects/[projectId]/_components/project-map-presence-panel");
  return render(<ProjectMapPresencePanel projectId="project-1" projectAreaGeometry={{ type: "Feature", geometry: area, properties: {} }} latitude={point.coordinates[1]} longitude={point.coordinates[0]} corridors={[corridor]} corridorsPending={false} canWrite={false} {...overrides} />);
}

describe("the project panel supplies saved features", () => {
  it("frames saved date-line inventory without rewriting any layer", async () => {
    const savedLine: GeoJSON.LineString = { type: "LineString", coordinates: [[179.5, 51.1], [179.9, 51.15]] };
    const before = JSON.stringify([splitArea, savedLine]);
    await panel({ projectAreaGeometry: splitArea, latitude: 51.1, longitude: -179.8, corridors: [{ ...corridor, geometry: savedLine }] });
    const map = lastFakeMap();
    act(() => map.loadStyle());
    expect(screen.getByText(/3 core layers · 3 features included · 0 unavailable · 0 rejected shapes/), "date-line-export-inventory").toBeVisible();
    expect(map.fitBoundsCalls[0]?.bounds, "date-line-inventory-camera").toEqual([[179.5, 51], [180.3, 51.2]]);
    expect((map.sourceData(SOURCE) as GeoJSON.FeatureCollection).features.map(({ geometry }) => geometry), "date-line-source-parity").toEqual([splitArea, { type: "Point", coordinates: [-179.8, 51.1] }, savedLine]);
    expect(JSON.stringify([splitArea, savedLine]), "date-line-input-parity").toBe(before);
  });

  it.each([false, true])("draws the inventory's exact three geometries with canWrite=%s", async (canWrite) => {
    await panel({ canWrite });
    const map = lastFakeMap();
    act(() => { map.loadStyle(); map.emit("load"); });
    expect(screen.getByText(/3 core layers · 3 features included · 0 unavailable · 0 rejected shapes/)).toBeVisible();
    expect((map.sourceData(SOURCE) as GeoJSON.FeatureCollection).features.map((feature) => feature.geometry), "saved-geometry-parity").toEqual([area, point, line]);
    expect(map.layerIds()).toEqual([`${SOURCE}-area`, `${SOURCE}-boundary`, `${SOURCE}-corridors`, `${SOURCE}-location`]);
    expect(map.layer(`${SOURCE}-area`)?.spec.filter, "saved-area-filter").toEqual(["==", ["geometry-type"], "Polygon"]);
    expect(map.layer(`${SOURCE}-corridors`)?.spec.filter).toEqual(["==", ["geometry-type"], "LineString"]);
    expect(map.layer(`${SOURCE}-location`)?.spec.filter).toEqual(["==", ["geometry-type"], "Point"]);
    expect(map.fitBoundsCalls[0]?.bounds).toEqual([[144.77, 13.42], [145.2, 14.2]]);
    expect(map.controls).toHaveLength(2);
  });

  it("keeps the saved area and site when the corridors table is unavailable", async () => {
    await panel({ corridors: [], corridorsPending: true });
    expect(fakeMaps(), "pending-corridors-map-exists").toHaveLength(1);
    const map = lastFakeMap();
    act(() => map.loadStyle());
    expect((map.sourceData(SOURCE) as GeoJSON.FeatureCollection).features.map((feature) => feature.geometry)).toEqual([area, point]);
    expect(screen.getByText(/Project corridors cannot be listed or drawn/)).toBeVisible();
  });

  it("reports invalid saved shapes without repairing or drawing them", async () => {
    await panel({ projectAreaGeometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }, latitude: 91, corridors: [{ ...corridor, geometry: { ...line, coordinates: [[0, 0], [Infinity, 0]] } }] });
    expect(fakeMaps(), "no-map-construction").toHaveLength(0);
    expect(screen.getByText(/3 core layers · 0 features included · 3 unavailable · 3 rejected shapes/)).toBeVisible();
    expect(screen.getByText("No saved project shapes are available to draw.")).toBeVisible();
  });

  it.each([[0, 0], [-121.5, 39], [179.8, 52], [-170.7, -14.3], [144.8, 13.4], [151.2, -33.8]])("retains a valid site at longitude %s latitude %s", async (longitude, latitude) => {
    await panel({ projectAreaGeometry: null, corridors: [], latitude, longitude });
    expect(fakeMaps(), "saved-site-map-exists").toHaveLength(1);
    const map = lastFakeMap();
    act(() => map.loadStyle());
    expect((map.sourceData(SOURCE) as GeoJSON.FeatureCollection).features[0].geometry).toEqual({ type: "Point", coordinates: [longitude, latitude] });
    expect(map.easeToCalls[0]?.center, "saved-site-center").toEqual([longitude, latitude]);
  });

  it("keeps inventory and download access when no engine is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    await panel();
    expect(fakeMaps(), "no-map-construction").toHaveLength(0);
    expect(screen.queryByRole("status"), "unconfigured-map-notice").not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("The saved layer inventory and GeoPackage download remain available.");
    expect(screen.getByRole("link", { name: "Download GeoPackage" })).toHaveAttribute("href", "/api/projects/project-1/export/geopackage");
    expect(screen.getByText(/3 core layers · 3 features included/)).toBeVisible();
  });
});

describe("saved map lifecycle", () => {
  it("frames latest wrapped data after async style readiness and visible resize", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", "https://tiles.example.org/style.json");
    let release = () => {};
    deferred.library = new Promise<void>((resolve) => { release = resolve; });
    let visible = false;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => visible ? 390 : 0);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => visible ? 360 : 0);
    let notify: ResizeObserverCallback = () => {};
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { notify = callback; } observe() {} disconnect() {} });
    const { ProjectSavedMap } = await import("@/components/projects/project-saved-map");
    const view = render(<ProjectSavedMap collection={collection(point)} />);
    view.rerender(<ProjectSavedMap collection={collection(splitArea)} />);
    await act(async () => { release(); await deferred.library; });
    const map = lastFakeMap();
    vi.spyOn(map, "resize").mockImplementation(() => map.emit("resize"));
    act(() => map.loadStyleWhileTilesStream());
    expect(map.sourceIds(), "wrapped-style-waits").toEqual([]);
    const saved = collection(splitArea, { type: "Point", coordinates: [-179.5, 51.1] });
    view.rerender(<ProjectSavedMap collection={saved} />);
    act(() => map.settleTiles());
    expect(map.sourceData(SOURCE), "wrapped-latest-source").toEqual(saved);
    expect(map.fitBoundsCalls, "wrapped-hidden-camera-waits").toHaveLength(0);
    visible = true;
    act(() => notify([{ contentRect: { width: 390, height: 360 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(map.fitBoundsCalls[0]?.bounds, "wrapped-visible-camera").toEqual([[179.7, 51], [180.5, 51.2]]);
    act(() => { map.setStyle("replacement-style"); map.loadStyleWhileTilesStream(); map.settleTiles(); map.emit("resize"); });
    expect(map.sourceData(SOURCE), "wrapped-reloaded-source").toEqual(saved);
    expect(map.fitBoundsCalls, "wrapped-no-repeat-camera").toHaveLength(1);
  });

  it("draws late geometry after an initially empty mount", async () => {
    const { ProjectSavedMap } = await import("@/components/projects/project-saved-map");
    const view = render(<ProjectSavedMap collection={collection()} />);
    expect(fakeMaps(), "no-map-construction").toHaveLength(0);
    const saved = collection(area, point, line);
    view.rerender(<ProjectSavedMap collection={saved} />);
    expect(fakeMaps(), "late-map-exists").toHaveLength(1);
    const map = lastFakeMap();
    act(() => map.loadStyle());
    expect(map.sourceData(SOURCE), "latest-saved-source").toEqual(saved);
  });

  it("uses the newest geometry when style.load precedes tile readiness", async () => {
    const { ProjectSavedMap } = await import("@/components/projects/project-saved-map");
    const view = render(<ProjectSavedMap collection={collection(point)} />);
    const map = lastFakeMap();
    act(() => map.loadStyleWhileTilesStream());
    expect(map.sourceIds()).toEqual([]);
    const saved = collection(area, line);
    view.rerender(<ProjectSavedMap collection={saved} />);
    act(() => map.settleTiles());
    expect(map.sourceData(SOURCE), "latest-saved-source").toEqual(saved);
  });

  it("replaces removed features without rebuilding the map", async () => {
    const { ProjectSavedMap } = await import("@/components/projects/project-saved-map");
    const view = render(<ProjectSavedMap collection={collection(area, point, line)} />);
    const map = lastFakeMap();
    act(() => map.loadStyle());
    const saved = collection(line);
    view.rerender(<ProjectSavedMap collection={saved} />);
    expect(fakeMaps()).toHaveLength(1);
    expect(map.sourceData(SOURCE), "latest-saved-source").toEqual(saved);
    view.rerender(<ProjectSavedMap collection={collection()} />);
    expect(map.removed).toBe(true);
    expect(screen.getByText("No saved project shapes are available to draw.")).toBeVisible();
  });

  it("repaints saved layers after a style replacement without another camera move", async () => {
    const { ProjectSavedMap } = await import("@/components/projects/project-saved-map");
    const saved = collection(area, point, line);
    render(<ProjectSavedMap collection={saved} />);
    const map = lastFakeMap();
    act(() => { map.loadStyle(); map.emit("load"); });
    expect(map.sourceData(SOURCE), "style-initial-source").toEqual(saved);
    expect(map.fitBoundsCalls).toHaveLength(1);
    act(() => { map.setStyle("replacement-style"); map.loadStyleWhileTilesStream(); });
    expect(map.sourceIds()).toEqual([]);
    act(() => map.settleTiles());
    expect(map.sourceData(SOURCE), "style-reloaded-source").toEqual(saved);
    expect(map.layerIds()).toHaveLength(4);
    expect(map.fitBoundsCalls).toHaveLength(1);
  });

  it("cancels pending paint and style listeners on unmount", async () => {
    const { ProjectSavedMap } = await import("@/components/projects/project-saved-map");
    const view = render(<ProjectSavedMap collection={collection(point)} />);
    const map = lastFakeMap();
    expect(map.listenerCount("idle")).toBeGreaterThan(0);
    view.unmount();
    expect(["load", "styledata", "idle", "style.load", "resize"].map((event) => map.listenerCount(event)), "paint-listener-cleanup").toEqual([0, 0, 0, 0, 0]);
    act(() => { map.loadStyle(); map.settleTiles(); });
    expect(map.sourceIds()).toEqual([]);
    expect(map.removed).toBe(true);
  });

  it("resizes its actual container when a hidden tab becomes visible", async () => {
    let visible = false;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => visible ? 390 : 0);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => visible ? 360 : 0);
    let notify: ResizeObserverCallback = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { notify = callback; } observe = observe; disconnect = disconnect; });
    const { ProjectSavedMap } = await import("@/components/projects/project-saved-map");
    const view = render(<ProjectSavedMap collection={collection(point)} />);
    const map = lastFakeMap();
    const resize = vi.spyOn(map, "resize").mockImplementation(() => map.emit("resize"));
    expect(observe, "observes-map-container").toHaveBeenCalledWith(map.options.container);
    act(() => map.loadStyle());
    expect(map.easeToCalls, "hidden-camera-waits").toHaveLength(0);
    visible = true;
    act(() => notify([{ contentRect: { width: 390, height: 360 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(resize).toHaveBeenCalledOnce();
    expect(map.easeToCalls[0]?.center, "visible-camera-center").toEqual(point.coordinates);
    act(() => map.emit("resize"));
    expect(map.easeToCalls).toHaveLength(1);
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("uses latest saved geometry after asynchronous MapLibre startup", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", "https://tiles.example.org/style.json");
    let release = () => {};
    deferred.library = new Promise<void>((resolve) => { release = resolve; });
    const { ProjectSavedMap } = await import("@/components/projects/project-saved-map");
    const view = render(<ProjectSavedMap collection={collection(point)} />);
    const saved = collection(area, line);
    view.rerender(<ProjectSavedMap collection={saved} />);
    expect(fakeMaps(), "no-map-construction").toHaveLength(0);
    await act(async () => { release(); await deferred.library; });
    const map = lastFakeMap();
    expect(map.options.style).toBe("https://tiles.example.org/style.json");
    act(() => map.loadStyle());
    expect(map.sourceData(SOURCE), "latest-saved-source").toEqual(saved);
  });

  it("does not construct an asynchronous map after the panel unmounts", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL", "https://tiles.example.org/style.json");
    let release = () => {};
    deferred.library = new Promise<void>((resolve) => { release = resolve; });
    const { ProjectSavedMap } = await import("@/components/projects/project-saved-map");
    const view = render(<ProjectSavedMap collection={collection(point)} />);
    view.unmount();
    await act(async () => { release(); await deferred.library; });
    expect(fakeMaps(), "no-map-construction").toHaveLength(0);
  });

  it("releases a constructed map if control setup fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      failNextFakeMapSetup("synthetic control failure");
      await panel();
      expect(lastFakeMap().removed, "failed-setup-map-removed").toBe(true);
      expect(screen.getByRole("status")).toHaveTextContent("This browser could not start the map.");
    } finally { quiet.mockRestore(); }
  });

  it("states an initial style failure and releases the map", async () => {
    await panel();
    const map = lastFakeMap();
    act(() => map.failStyle("synthetic blocked style"));
    expect(screen.queryByRole("status"), "initial-style-failure-notice").not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("This browser could not start the map.");
    expect(map.removed).toBe(true);
  });
});
