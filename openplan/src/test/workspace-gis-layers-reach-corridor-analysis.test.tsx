import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { WorkspaceGisLayerListing } from "@/lib/workspace-gis/types";

/**
 * THE AGENCY'S OWN LAYERS REACH THE PAGE A PLANNER OPENS IN ORDER TO READ A MAP.
 *
 * v0.19.0 shipped the layer library and Corridor Analysis drew none of it. The
 * shell backdrop paints workspace layers behind every route, but it suppresses
 * itself on `/explore` — which builds its own `mapboxgl.Map` — so the one page
 * whose whole purpose is a map was the one page a planner's uploaded parcels,
 * bike network and city limits never reached. That is this repository's
 * most-repeated defect class: complete, tested capability nobody can get to.
 *
 * A unit test of the painter cannot see this. Nor can a test that mounts the
 * binding hook on its own — the hook could be perfect and simply never called.
 * So this mounts the REAL `ExploreWorkbench`, with the real provider above it,
 * and asserts four separate things a planner would notice the absence of:
 *
 *   1. the layer is REGISTERED ON EXPLORE'S OWN MAP INSTANCE, by id;
 *   2. it is drawn BENEATH the analysis geometry, so it cannot eat clicks or
 *      bury the corridor;
 *   3. panning the map RE-READS it for the new window — the layers are
 *      viewport-scoped, and a layer that loads once is blank the moment the
 *      planner moves;
 *   4. the coverage note renders IN EXPLORE'S OWN PANEL, because "too dense to
 *      draw" and "genuinely empty here" look identical on a map.
 */

type MockMapInstance = {
  resize: Mock;
  remove: Mock;
  on: Mock;
  off: Mock;
  once: Mock;
  addControl: Mock;
  getSource: Mock;
  getLayer: Mock;
  getStyle: Mock;
  addSource: Mock;
  addLayer: Mock;
  removeLayer: Mock;
  moveLayer: Mock;
  setPaintProperty: Mock;
  setLayoutProperty: Mock;
  setFilter: Mock;
  isStyleLoaded: Mock;
  getBounds: Mock;
  getCanvas: Mock;
  queryRenderedFeatures: Mock;
  fitBounds: Mock;
  easeTo: Mock;
  flyTo: Mock;
  handlers: Map<string, Array<(...args: unknown[]) => void>>;
};

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

const mapboxMocks = vi.hoisted(() => {
  const instances: unknown[] = [];
  // NAMED `MapCtor`, not `Map`: a `const Map` here shadows the global `Map`
  // inside this factory, and `new Map()` below then recurses into the mock.
  const MapCtor = vi.fn(function MockMapboxMap() {
    const handlers = new globalThis.Map<string, Array<(...args: unknown[]) => void>>();
    // The layers Explore's own installer puts down. `analysis-fill` is the one
    // the anchor must resolve to when there is no tract layer.
    const installed = new Set<string>();

    const instance = {
      handlers,
      resize: vi.fn(),
      remove: vi.fn(),
      on: vi.fn((type: string, ...rest: unknown[]) => {
        const listener = rest.at(-1) as (...args: unknown[]) => void;
        if (typeof listener !== "function") return instance;
        const list = handlers.get(type) ?? [];
        list.push(listener);
        handlers.set(type, list);
        return instance;
      }),
      off: vi.fn((type: string, ...rest: unknown[]) => {
        const listener = rest.at(-1);
        const list = handlers.get(type) ?? [];
        handlers.set(
          type,
          list.filter((entry) => entry !== listener),
        );
        return instance;
      }),
      once: vi.fn((type: string, listener: (...args: unknown[]) => void) => {
        listener();
        return instance;
      }),
      addControl: vi.fn(),
      getSource: vi.fn(() => undefined),
      getLayer: vi.fn((id: string) => (installed.has(id) ? { id } : undefined)),
      getStyle: vi.fn(() => ({ layers: [] })),
      addSource: vi.fn(),
      addLayer: vi.fn((spec: { id?: string }) => {
        if (spec?.id) installed.add(spec.id);
        return instance;
      }),
      removeLayer: vi.fn(),
      moveLayer: vi.fn(),
      setPaintProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
      setFilter: vi.fn(),
      isStyleLoaded: vi.fn(() => true),
      getBounds: vi.fn(() => ({
        getWest: () => -121.2,
        getSouth: () => 39.0,
        getEast: () => -120.8,
        getNorth: () => 39.4,
      })),
      getCanvas: vi.fn(() => ({ style: {} })),
      queryRenderedFeatures: vi.fn(() => []),
      fitBounds: vi.fn(),
      easeTo: vi.fn(),
      flyTo: vi.fn(),
    };
    instances.push(instance);
    return instance;
  });

  return {
    FullscreenControl: vi.fn(),
    Map: MapCtor,
    NavigationControl: vi.fn(),
    ScaleControl: vi.fn(),
    instances,
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/explore",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("mapbox-gl", () => ({
  default: { Map: mapboxMocks.Map, accessToken: "" },
  FullscreenControl: mapboxMocks.FullscreenControl,
  NavigationControl: mapboxMocks.NavigationControl,
  ScaleControl: mapboxMocks.ScaleControl,
}));

const LAYER_ID = "layer-parcels";

function listing(): WorkspaceGisLayerListing {
  return {
    layer: {
      id: LAYER_ID,
      workspaceId: "ws-1",
      projectId: null,
      name: "Parcels",
      description: null,
      style: { color: "#d55e00", opacity: 0.8, lineWidth: 2.5, labelField: null },
      // On by default, which is what the wizard now sends for a fresh upload.
      defaultVisible: true,
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-08-12T00:00:00.000Z",
      currentVersion: null,
    },
    notes: [],
  };
}

/** Every window this test's map was asked to read the layer for. */
let featureRequestBboxes: string[] = [];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function installFetch() {
  featureRequestBboxes = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.startsWith("/api/workspaces/current")) {
      return jsonResponse({ workspaceId: "ws-1", name: "Test RTPA", role: "admin" });
    }
    if (url.startsWith("/api/workspace-gis/layers")) {
      return jsonResponse({ layers: [listing()] });
    }
    if (url.startsWith("/api/map-features/workspace-gis/")) {
      const bbox = new URL(url, "http://localhost").searchParams.get("bbox") ?? "";
      featureRequestBboxes.push(bbox);
      return jsonResponse({
        type: "FeatureCollection",
        features: [],
        returnedCount: 0,
        matchedCount: 214391,
        droppedCount: 0,
        truncated: false,
        limit: 5000,
        tooDenseToDraw: true,
        coverageNotes: [
          "Parcels: 214,391 shapes fall in this view, which is too dense to draw. Zoom in and they will appear. This is not a finding that the area is empty.",
        ],
      });
    }
    // Everything else Explore pulls on mount is irrelevant to this claim.
    return jsonResponse({}, 404);
  }) as unknown as typeof global.fetch;
}

async function renderWorkbench() {
  vi.resetModules();
  installFetch();

  const { CartographicProvider } = await import(
    "@/components/cartographic/cartographic-context"
  );
  const { ExploreWorkbench } = await import(
    "@/app/(app)/explore/_components/explore-workbench"
  );

  const view = render(
    <CartographicProvider>
      <ExploreWorkbench projectPlace={null} openedForProject={null} projectAreaNotice={null} />
    </CartographicProvider>,
  );

  const instance = mapboxMocks.instances.at(-1) as MockMapInstance;

  // Explore creates the map in an effect and marks it ready on "load". Nothing
  // paints before that, which is what guarantees the analysis layers are down
  // before the workspace layers look for an anchor.
  await act(async () => {
    for (const listener of instance.handlers.get("load") ?? []) listener();
  });

  return { view, instance };
}

function addedLayerIds(instance: MockMapInstance): string[] {
  return instance.addLayer.mock.calls.map((call) => String((call[0] as { id?: string }).id));
}

describe("workspace layers reach Corridor Analysis", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token-for-corridor-analysis";
    mapboxMocks.instances.length = 0;
    mapboxMocks.Map.mockClear();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_TOKEN === undefined) delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    else process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_TOKEN;
    vi.clearAllMocks();
  });

  it("registers the uploaded layer on Explore's own map instance", async () => {
    const { instance } = await renderWorkbench();

    await waitFor(() => {
      expect(addedLayerIds(instance)).toContain(
        `cartographic-workspace-gis-${LAYER_ID}-line`,
      );
    });

    // The casing too — the thing that makes the line legible over a dark
    // basemap. A line registered without it is registered invisible.
    expect(addedLayerIds(instance)).toContain(
      `cartographic-workspace-gis-${LAYER_ID}-casing`,
    );
  });

  it("draws it BENEATH the analysis geometry, so it cannot eat clicks", async () => {
    const { instance } = await renderWorkbench();

    await waitFor(() => {
      expect(addedLayerIds(instance)).toContain(
        `cartographic-workspace-gis-${LAYER_ID}-line`,
      );
    });

    const workspaceCalls = instance.addLayer.mock.calls.filter((call) =>
      String((call[0] as { id?: string }).id).startsWith("cartographic-workspace-gis-"),
    );
    expect(workspaceCalls.length).toBeGreaterThan(0);
    for (const call of workspaceCalls) {
      // Explore installs `tract-fill` first, so that is the anchor. An
      // `undefined` here means "on top of everything" — a viewport-filling
      // parcel polygon over the corridor, the crashes and the tracts.
      expect(call[1]).toBe("tract-fill");
    }
  });

  it("re-reads the layer for the new window when the planner pans", async () => {
    const { instance } = await renderWorkbench();

    await waitFor(() => {
      expect(featureRequestBboxes.length).toBeGreaterThan(0);
    });
    const firstCount = featureRequestBboxes.length;

    // Move the map somewhere else, then fire the same event Mapbox fires.
    instance.getBounds.mockReturnValue({
      getWest: () => -122.5,
      getSouth: () => 37.6,
      getEast: () => -122.2,
      getNorth: () => 37.9,
    });
    await act(async () => {
      for (const listener of instance.handlers.get("moveend") ?? []) listener();
    });

    await waitFor(() => {
      expect(featureRequestBboxes.length).toBeGreaterThan(firstCount);
    });
    expect(featureRequestBboxes.at(-1)).toContain("-122.5");
  });

  it("renders the coverage note in Explore's own panel", async () => {
    await renderWorkbench();

    // "Too dense to draw" and "genuinely empty here" are the same blank map.
    // The sentence that tells them apart has to be on this page, not only on
    // the shell's dock — which is CSS-hidden on this route.
    expect(await screen.findByText(/too dense to draw/i)).toBeTruthy();
    expect(screen.getByText(/1 coverage note/i)).toBeTruthy();
  });

  it("lists the layer with a checkbox a planner can switch off", async () => {
    await renderWorkbench();

    const checkbox = await screen.findByRole("checkbox", { name: /parcels/i });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });
});
