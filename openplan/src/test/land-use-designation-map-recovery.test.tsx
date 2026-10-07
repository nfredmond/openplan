import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicDesignationMap } from "@/components/land-use-plans/public-designation-map";

const mocks = vi.hoisted(() => ({ handlers: {} as Record<string, () => unknown>, setData: vi.fn(), fetch: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/mapbox/public-token", () => ({ resolvePublicMapboxToken: () => "synthetic-test-token" }));
vi.mock("@/lib/mapbox/keep-map-sized", () => ({ keepMapSizedToContainer: () => () => {} }));
vi.mock("mapbox-gl", () => ({ default: {
  Map: class {
    on(event: string, handler: () => unknown) { mocks.handlers[event] = handler; }
    getBounds() { return { getWest: () => -122, getSouth: () => 38, getEast: () => -121, getNorth: () => 39 }; }
    getSource() { return { setData: mocks.setData }; }
    addControl() {} addSource() {} addLayer() {} fitBounds() {}
    remove() { mocks.remove(); }
  },
  NavigationControl: class {},
} }));
const endpoint = "/api/reports/synthetic/land-use-map/synthetic";
const payload = { type: "FeatureCollection", features: [{ type: "Feature", id: "f1", geometry: { type: "Point", coordinates: [-121.5, 38.5] }, properties: { attributes: { designation: "SYNTHETIC retained use" } } }], matchedCount: 1, returnedCount: 1, tooDenseToDraw: false, legendField: "designation", coverageNotes: [] };
const expected = { ...payload.features[0], properties: { ...payload.features[0].properties, label: "SYNTHETIC retained use" } };
const empty = { type: "FeatureCollection", features: [] };
const show = () => render(<PublicDesignationMap endpoint={endpoint} bbox={[-122, 38, -121, 39]} label="SYNTHETIC map" />);
const event = (name: string) => act(async () => { await mocks.handlers[name](); });
beforeEach(() => { vi.clearAllMocks(); mocks.handlers = {}; vi.stubGlobal("fetch", mocks.fetch); mocks.fetch.mockResolvedValue(new Response(JSON.stringify(payload))); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("designation map refresh recovery", () => {
  it("loads the report viewport and draws retained labels", async () => {
    show(); await event("load");
    await waitFor(() => expect(mocks.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [expected] }));
    expect(mocks.fetch).toHaveBeenCalledWith(`${endpoint}?bbox=-122,38,-121,39`, { cache: "no-store" });
  });
  it("clears prior features on an authorization failure", async () => {
    show(); await event("load"); await waitFor(() => expect(mocks.setData).toHaveBeenCalled());
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    await event("moveend");
    expect(mocks.setData).toHaveBeenLastCalledWith(empty); expect(screen.getByText("Unauthorized")).toBeVisible();
  });
  it.each(["transport", "invalid JSON"])("clears prior features and offers retry after %s failure", async kind => {
    show(); await event("load"); await waitFor(() => expect(mocks.setData).toHaveBeenCalled());
    if (kind === "transport") mocks.fetch.mockRejectedValueOnce(new Error("offline"));
    else mocks.fetch.mockResolvedValueOnce(new Response("unreadable"));
    await event("moveend");
    expect(mocks.setData).toHaveBeenLastCalledWith(empty);
    expect(screen.getByText("The frozen designation map could not be loaded. Move the map to retry.")).toBeVisible();
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(payload))); await event("moveend");
    expect(mocks.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [expected] });
    expect(screen.queryByText(/Move the map to retry/)).toBeNull();
  });
  it("keeps a newer successful view when an older request fails", async () => {
    let rejectOld: (error: Error) => void = () => { throw new Error("Request not started"); };
    mocks.fetch.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    show(); await event("load"); await event("moveend");
    await act(async () => { rejectOld(new Error("old failure")); });
    expect(mocks.setData).toHaveBeenLastCalledWith({ type: "FeatureCollection", features: [expected] });
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });
  it("does not draw after the map unmounts", async () => {
    let resolveOld: (response: Response) => void = () => { throw new Error("Request not started"); };
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const view = show(); await event("load"); view.unmount();
    await act(async () => { resolveOld(new Response(JSON.stringify(payload))); });
    expect(mocks.setData).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
