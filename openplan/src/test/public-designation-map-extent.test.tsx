import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicDesignationMap } from "@/components/land-use-plans/public-designation-map";

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, () => unknown>,
  cameras: [] as Array<{ center: number[]; zoom: number }>,
  fitBounds: vi.fn(),
  remove: vi.fn(),
  setData: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/mapbox/public-token", () => ({ resolvePublicMapboxToken: () => "synthetic-test-token" }));
vi.mock("@/lib/mapbox/keep-map-sized", () => ({ keepMapSizedToContainer: () => () => {} }));
vi.mock("mapbox-gl", () => ({ default: {
  Map: class {
    constructor(options: { center: number[]; zoom: number }) { mocks.cameras.push(options); }
    on(event: string, handler: () => unknown) { mocks.handlers[event] = handler; }
    getBounds() { return { getWest: () => -10, getSouth: () => -20, getEast: () => 10, getNorth: () => 20 }; }
    getSource() { return { setData: mocks.setData }; }
    addControl() {} addSource() {} addLayer() {}
    fitBounds(...args: unknown[]) { mocks.fitBounds(...args); }
    remove() { mocks.remove(); }
  },
  NavigationControl: class {},
} }));

const endpoint = "/api/reports/synthetic/land-use-map/synthetic";
const unavailable = "The retained designation extent is unavailable. Pan or zoom to choose a map view.";
const show = (bbox: unknown) => render(<PublicDesignationMap endpoint={endpoint} bbox={bbox} label="Synthetic retained designation map" />);
const load = () => act(async () => { await mocks.handlers.load(); });

beforeEach(() => {
  vi.clearAllMocks(); mocks.handlers = {}; mocks.cameras = [];
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
    type: "FeatureCollection", features: [], matchedCount: 0, returnedCount: 0,
    tooDenseToDraw: false, legendField: null, coverageNotes: [],
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("retained designation extent", () => {
  it.each([
    ["missing", undefined], ["null", null], ["object", { west: 1, south: 2, east: 3, north: 4 }],
    ["short", [1, 2, 3]], ["long", [1, 2, 3, 4, 5]], ["string", ["1", 2, 3, 4]],
    ["NaN", [Number.NaN, 2, 3, 4]], ["infinity", [1, 2, Number.POSITIVE_INFINITY, 4]],
    ["west range", [-181, 2, 3, 4]], ["east range", [1, 2, 181, 4]],
    ["south range", [1, -91, 3, 4]], ["north range", [1, 2, 3, 91]],
    ["reversed latitude", [1, 5, 3, 4]], ["reversed or wrapped longitude", [170, -10, -170, 10]],
  ])("refuses %s before camera construction and discloses unavailable extent", async (_name, bbox) => {
    show(bbox); await load();
    expect(mocks.cameras).toHaveLength(1);
    expect(mocks.cameras[0]).toMatchObject({ center: [0, 20], zoom: 1.5 });
    expect(mocks.fitBounds).not.toHaveBeenCalled();
    expect(screen.queryByText(unavailable)).not.toBeNull();
  });

  it.each([
    [[-10, -20, 10, 20], [0, 0]],
    [[20, -40, 30, -30], [25, -35]],
    [[-180, -90, 180, 90], [0, 0]],
    [[20, -40, 20, -30], [20, -35]],
    [[20, -40, 30, -40], [25, -40]],
  ])("frames valid ordinary extent %j without narrowing its geography", async (bbox, center) => {
    show(bbox); await load();
    expect(mocks.cameras[0]).toMatchObject({ center, zoom: 9 });
    expect(mocks.fitBounds).toHaveBeenCalledExactlyOnceWith(
      [[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 36, maxZoom: 14, duration: 0 },
    );
    expect(screen.queryByText(unavailable)).toBeNull();
  });

  it.each([[0, 0, 0, 0], [180, 90, 180, 90]])("centres point extent %j without fitting a zero-size box", async (west, south, east, north) => {
    show([west, south, east, north]); await load();
    expect(mocks.cameras[0]).toMatchObject({ center: [west, south], zoom: 9 });
    expect(mocks.fitBounds).not.toHaveBeenCalled();
    expect(screen.queryByText(unavailable)).toBeNull();
  });

  it("retains the fallback disclosure after a completed empty viewport query", async () => {
    show([0, 0, Number.NaN, 1]); await load();
    await waitFor(() => expect(screen.getByText("No designation features intersect this map view.")).toBeVisible());
    expect(screen.queryByText(unavailable)).not.toBeNull();
    expect(mocks.cameras).toHaveLength(1);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("replaces an invalid extent with a valid recorded extent", async () => {
    const view = show([0, 0, Number.NaN, 1]); await load();
    view.rerender(<PublicDesignationMap endpoint={endpoint} bbox={[20, -40, 30, -30]} label="Synthetic retained designation map" />);
    await load();
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.cameras).toHaveLength(2);
    expect(mocks.cameras[1]).toMatchObject({ center: [25, -35], zoom: 9 });
    expect(screen.queryByText(unavailable)).toBeNull();
  });
});
