import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ═══ "YOU HAVE NO MAP LAYERS" AND "OPENPLAN COULD NOT FIND OUT" ARE DIFFERENT
 * SENTENCES, AND ONLY ONE OF THEM WAS BEING SAID ═══
 *
 * The backdrop fetches the workspace's layer catalog. When that request failed
 * it called `registerWorkspaceLayers([], workspaceId)` — registering an EMPTY
 * CATALOG as though the read had succeeded — and reported the failure only to
 * `console.warn`, behind a `process.env.NODE_ENV !== "production"` guard. In
 * production that branch is stripped, so a planner whose agency has forty
 * uploaded layers, on a flaky connection or against a database hiccup, saw a
 * Layers panel with no "Your map layers" section at all. Nothing was wrong on
 * screen. It simply said, in the only way a panel can, that they had none.
 *
 * This is the defect class three other lanes closed the same week — crash
 * counts, casualty totals, measure oversight — arriving here by a fourth route.
 * The shape is always the same: an error path that renders as a legitimate
 * zero, and a zero that a planner has no reason to doubt.
 *
 * ═══ WHY BOTH TESTS BELOW ARE REQUIRED ═══
 *
 * A test that only asserts the failure message would pass just as happily if
 * OpenPlan showed that message all the time, which would be its own lie. So the
 * genuinely-empty workspace is asserted too, in the same file, from the same
 * harness: the panel must distinguish the two states, not merely have words for
 * one of them.
 *
 * Both drive the REAL backdrop, the REAL provider and the REAL panel. The only
 * fakes are Mapbox and the network — the two things a test cannot have.
 */

const ORIGINAL_FETCH = global.fetch;

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ push: vi.fn() }),
}));

const fakeMap = {
  on: (name: string, second?: unknown, third?: unknown) => {
    const handler = typeof second === "function" ? second : third;
    if (typeof handler !== "function") return;
    if (name === "load") (handler as () => void)();
  },
  off: () => {},
  once: () => {},
  remove: () => {},
  setStyle: () => {},
  zoomIn: () => {},
  zoomOut: () => {},
  isStyleLoaded: () => true,
  getBounds: () => ({
    getWest: () => -121.1,
    getSouth: () => 39.1,
    getEast: () => -120.9,
    getNorth: () => 39.3,
  }),
  getSource: () => undefined,
  addSource: () => {},
  getLayer: () => undefined,
  addLayer: () => {},
  removeLayer: () => {},
  moveLayer: () => {},
  setLayoutProperty: () => {},
  setPaintProperty: () => {},
  setFeatureState: () => {},
  removeFeatureState: () => {},
  queryRenderedFeatures: () => [],
  easeTo: () => {},
  fitBounds: () => {},
  getCanvas: () => ({ style: {} }),
};

vi.mock("mapbox-gl", () => ({
  default: {
    Map: function MapboxMap() {
      return fakeMap;
    },
    accessToken: "",
    LngLatBounds: class {
      isEmpty() {
        return true;
      }
      extend() {
        return this;
      }
    },
    Popup: class {
      setLngLat() {
        return this;
      }
      setDOMContent() {
        return this;
      }
      addTo() {
        return this;
      }
      remove() {
        return this;
      }
    },
  },
}));

const LAYER_ID = "11111111-1111-4111-8111-111111111111";

/**
 * One real listing, so the successful case has a VISIBLE consequence to wait
 * for.
 *
 * The control case originally used an empty catalog, which is the more obvious
 * opposite of a failure — but "no alert appeared" is not something a test can
 * wait for, so it would have passed by winning a race rather than by the panel
 * behaving. A catalog with a layer in it produces "Parcels" on screen, which is
 * proof that the read completed and was registered; asserting the absence of an
 * alert at that moment is then a real assertion about a settled tree.
 */
function layerListing() {
  return {
    layer: {
      id: LAYER_ID,
      workspaceId: "ws-1",
      projectId: null,
      name: "Parcels",
      description: null,
      style: { color: "#c1440e", opacity: 0.8, lineWidth: 1.5, labelField: null },
      defaultVisible: false,
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-08-12T00:00:00.000Z",
      currentVersion: null,
    },
    notes: [],
  };
}

/**
 * @param catalog `"fails"` for a request that never lands, `"reads"` for a
 * catalog that comes back normally.
 */
function stubbedFetch(catalog: "fails" | "reads") {
  return vi.fn((input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/workspace-gis/layers")) {
      // A connection that drops, rather than a 500: it is the case with no
      // response body at all to fall back on, and the one a planner's flaky
      // office wifi actually produces.
      if (catalog === "fails") return Promise.reject(new Error("network is unreachable"));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ layers: [layerListing()] }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ type: "FeatureCollection", features: [] }),
    });
  }) as unknown as typeof fetch;
}

async function renderShell(catalog: "fails" | "reads") {
  vi.resetModules();
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token-for-the-backdrop";
  global.fetch = stubbedFetch(catalog);

  const { CartographicMapBackdrop } = await import(
    "@/components/cartographic/cartographic-map-backdrop"
  );
  const { CartographicLayersPanel } = await import(
    "@/components/cartographic/cartographic-layers-panel"
  );
  const { CartographicProvider } = await import("@/components/cartographic/cartographic-context");

  return render(
    <CartographicProvider>
      <CartographicMapBackdrop workspaceId="ws-1" />
      <CartographicLayersPanel workspaceId="ws-1" />
    </CartographicProvider>
  );
}

describe("a layer catalog that could not be read is not a workspace with no layers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("says the catalog could not be read, on screen, when the request fails", async () => {
    await renderShell("fails");

    const alert = await waitFor(() => screen.getByRole("alert"));
    const text = alert.textContent ?? "";

    // It names what happened…
    expect(text).toMatch(/could not load/i);
    // …and, crucially, refuses the inference the empty list would invite.
    expect(text).toMatch(/not a statement that there are none/i);
    // …and tells the planner what to do next.
    expect(text).toMatch(/reload/i);
  });

  it("says nothing of the kind when the catalog reads normally", async () => {
    await renderShell("reads");

    // The layer's own name is the proof the read completed and registered.
    await waitFor(() => {
      expect(screen.getByText("Parcels")).toBeInTheDocument();
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/could not load/i)).toBeNull();
    expect(screen.getByText("Your map layers")).toBeInTheDocument();
  });
});
