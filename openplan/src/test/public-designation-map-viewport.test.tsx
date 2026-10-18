import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicDesignationMap } from "@/components/land-use-plans/public-designation-map";

const mocks = vi.hoisted(() => ({
  bounds: [-10, -20, 10, 20] as number[] | null,
  boundsError: false,
  handlers: {} as Record<string, () => unknown>,
  setData: vi.fn(), fetch: vi.fn(), remove: vi.fn(),
}));
vi.mock("@/lib/mapbox/public-token", () => ({ resolvePublicMapboxToken: () => "synthetic-test-token" }));
vi.mock("@/lib/mapbox/keep-map-sized", () => ({ keepMapSizedToContainer: () => () => {} }));
vi.mock("mapbox-gl", () => ({ default: {
  Map: class {
    on(event: string, handler: () => unknown) { mocks.handlers[event] = handler; }
    getBounds() {
      if (mocks.boundsError) throw new Error("SYNTHETIC unreadable bounds");
      const coordinates = mocks.bounds;
      return coordinates ? {
        getWest: () => coordinates[0], getSouth: () => coordinates[1],
        getEast: () => coordinates[2], getNorth: () => coordinates[3],
      } : null;
    }
    getSource() { return { setData: mocks.setData }; }
    addControl() {} addSource() {} addLayer() {} fitBounds() {}
    remove() { mocks.remove(); }
  },
  NavigationControl: class {},
} }));

const endpoint = "/api/public/land-use-plans/synthetic/map/synthetic";
const unavailable = "The map view could not be read. Move or zoom the map to retry.";
const featureResponse = (id = "synthetic-current") => new Response(JSON.stringify({
  type: "FeatureCollection", matchedCount: 1, returnedCount: 1,
  tooDenseToDraw: false, legendField: null, coverageNotes: [],
  features: [{ type: "Feature", id, geometry: { type: "Point", coordinates: [0, 0] }, properties: { attributes: {} } }],
}));
const show = () => render(<PublicDesignationMap endpoint={endpoint} bbox={[-10, -20, 10, 20]} label="SYNTHETIC designation viewport" />);
const event = async (name: string) => { await act(async () => { await mocks.handlers[name](); }); };

beforeEach(() => {
  vi.clearAllMocks(); mocks.fetch.mockReset();
  mocks.bounds = [-10, -20, 10, 20]; mocks.boundsError = false; mocks.handlers = {};
  mocks.fetch.mockImplementation(async () => featureResponse());
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("designation camera viewport queries", () => {
  it.each([
    { bounds: [170, -10, 190, 10], query: "170,-10,-170,10" },
    { bounds: [190, -10, 210, 10], query: "-170,-10,-150,10" },
    { bounds: [-210, -10, -190, 10], query: "150,-10,170,10" },
    { bounds: [170, -10, -170, 10], query: "170,-10,-170,10" },
    { bounds: [0, -12, 360, 34], query: "-180,-12,180,34" },
    { bounds: [170, -10, -180, 10], query: "170,-10,180,10" },
  ])("requests one complete canonical viewport for $bounds", async ({ bounds, query }) => {
    mocks.bounds = bounds; show(); await event("load");
    await waitFor(() => expect(mocks.setData).toHaveBeenCalledWith(expect.objectContaining({
      features: [expect.objectContaining({ id: "synthetic-current" })],
    })));
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`${endpoint}?bbox=${query}`, { cache: "no-store" });
    expect(screen.queryByText(unavailable)).toBeNull();
  });

  it.each([
    { name: "missing", bounds: null, throws: false },
    { name: "invalid world-copy direction", bounds: [210, -10, 190, 10], throws: false },
    { name: "zero area", bounds: [190, 10, 210, 10], throws: false },
    { name: "invalid latitude", bounds: [170, -91, 190, 10], throws: false },
    { name: "throwing getter", bounds: null, throws: true },
  ])("clears earlier shapes for $name bounds without fetching the world", async ({ bounds, throws }) => {
    show(); await event("load");
    await waitFor(() => expect(mocks.setData).toHaveBeenLastCalledWith(expect.objectContaining({
      features: [expect.objectContaining({ id: "synthetic-current" })],
    })));
    mocks.bounds = bounds; mocks.boundsError = throws; await event("moveend");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [] });
    expect(screen.getByText(unavailable)).toBeVisible();
  });

  it("does not query a whole world when initial bounds are unavailable", async () => {
    mocks.bounds = null; show(); await event("load");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [] });
    expect(screen.getByText(unavailable)).toBeVisible();
  });

  it("invalidates an older response and recovers on a later valid move", async () => {
    show(); await event("load");
    await waitFor(() => expect(mocks.setData).toHaveBeenCalled());
    let resolveReply: ((value: Response) => void) | undefined;
    mocks.fetch.mockReturnValueOnce(new Promise<Response>(resolve => { resolveReply = resolve; }));
    mocks.bounds = [170, -10, 190, 10];
    // Do not await the pending move's refresh until its synthetic response arrives.
    let pending: unknown;
    await act(async () => { pending = mocks.handlers.moveend(); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    mocks.bounds = null; await event("moveend");
    expect(mocks.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [] });
    expect(resolveReply).toBeTypeOf("function");
    await act(async () => { resolveReply!(featureResponse("synthetic-stale")); await pending; });
    expect(mocks.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [] });
    expect(screen.getByText(unavailable)).toBeVisible();
    mocks.bounds = [190, -10, 210, 10];
    mocks.fetch.mockResolvedValueOnce(featureResponse("synthetic-recovered"));
    await event("moveend");
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch).toHaveBeenLastCalledWith(`${endpoint}?bbox=-170,-10,-150,10`, { cache: "no-store" });
    expect(mocks.setData).toHaveBeenLastCalledWith(expect.objectContaining({
      features: [expect.objectContaining({ id: "synthetic-recovered" })],
    }));
    expect(screen.queryByText(unavailable)).toBeNull();
  });
});
