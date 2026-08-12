import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WORKSPACE_GIS_BBOX_DRAW_LIMIT,
  describeWorkspaceLayerCoverage,
} from "@/lib/workspace-gis/coverage";

/**
 * ═══ A LAYER TOO DENSE TO DRAW MUST DRAW NOTHING, AND SAY SO ═══
 *
 * Every other map layer in OpenPlan, at its cap, draws the first N and discloses
 * "showing 500 of 2,000". For a parcel fabric that behaviour is a trap: 1,000
 * arbitrary parcels out of 214,391 render as a shredded sheet, and a planner
 * looking at holes in their OWN parcel layer will believe the holes are real.
 * There is nothing on screen to contradict them, and the layer came from their
 * own file, so their confidence in it is entirely reasonable.
 *
 * So above the cap this layer draws NOTHING and reports the true count. Two
 * halves, and BOTH are load-bearing — either alone is worse than neither:
 *
 *   1. the map draws no features (an empty map view, not a partial one), and
 *   2. the panel says how many are there and what to do about it.
 *
 * Half 1 without half 2 is an empty layer behind a ticked checkbox, which reads
 * as "there is nothing here" — the same false conclusion by a different route.
 * This file tests both, through the real components.
 */

const ORIGINAL_FETCH = global.fetch;

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * A Mapbox map that records what it was asked to draw.
 *
 * The assertions below are about the DATA handed to a source, not about pixels:
 * "the source for this layer received a FeatureCollection with zero features" is
 * the machine-checkable form of "the map shows no holes in the parcel fabric".
 */
type AddedLayer = { id: string; beforeId: string | undefined };

const addedLayers: AddedLayer[] = [];
const sourceData = new Map<string, { features: unknown[] }>();
const listeners = new Map<string, Array<(event?: unknown) => void>>();

const fakeMap = {
  on: (name: string, second?: unknown, third?: unknown) => {
    // Layer-scoped handlers pass (event, layerId, handler); ignore those here.
    const handler = typeof second === "function" ? second : third;
    if (typeof handler !== "function") return;
    listeners.set(name, [...(listeners.get(name) ?? []), handler as () => void]);
    // `load` fires immediately, because a real Mapbox map fires it once the
    // style is up and this fake has no style to wait for. Firing it from the
    // test body instead would race the backdrop: the map is built in an effect
    // that only runs after the theme-mount effect has set state, so a `load`
    // dispatched on first render arrives before anything is listening.
    if (name === "load") (handler as () => void)();
  },
  off: () => {},
  once: (name: string, handler: () => void) => {
    listeners.set(name, [...(listeners.get(name) ?? []), handler]);
  },
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
  getSource: (id: string) =>
    sourceData.has(id)
      ? {
          setData: (data: { features: unknown[] }) => {
            sourceData.set(id, data);
          },
        }
      : undefined,
  addSource: (id: string, spec: { data: { features: unknown[] } }) => {
    sourceData.set(id, spec.data);
  },
  getLayer: (id: string) => addedLayers.find((layer) => layer.id === id),
  addLayer: (spec: { id: string }, beforeId?: string) => {
    addedLayers.push({ id: spec.id, beforeId });
  },
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
    // A constructor, not an arrow: the backdrop calls `new mapboxgl.Map(...)`.
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

function layerListing() {
  return {
    layer: {
      id: LAYER_ID,
      workspaceId: "ws-1",
      projectId: null,
      name: "Parcels",
      description: null,
      style: { color: "#c1440e", opacity: 0.8, lineWidth: 1.5, labelField: null },
      defaultVisible: true,
      sortOrder: 0,
      archivedAt: null,
      createdAt: "2026-08-12T00:00:00.000Z",
      currentVersion: {
        id: "version-1",
        layerId: LAYER_ID,
        versionNumber: 1,
        sourceFormat: "shapefile_zip",
        sourceFilename: "parcels.zip",
        sourceByteSize: 10,
        hasStoredSource: true,
        srs: {
          authority: "EPSG",
          code: "2226",
          name: "NAD83 / California zone 2 (ftUS)",
          basis: "prj_file",
          assertedBy: null,
          assertedAt: null,
        },
        reprojectionEngine: "openplan",
        datumShiftNote: null,
        datumAcknowledgedBy: null,
        geometryKinds: ["Polygon"],
        attributeFields: [],
        attributeEncoding: null,
        attributeEncodingIsFallback: false,
        declaredFeatureCount: 214391,
        featureCount: 214391,
        sourceFeatureCount: 214391,
        droppedFeatureCount: 0,
        truncated: false,
        bbox: [-121.1, 39.1, -120.9, 39.3],
        ingestStatus: "ready",
        ingestFailureReason: null,
        createdAt: "2026-08-12T00:00:00.000Z",
        finalizedAt: "2026-08-12T00:00:00.000Z",
      },
    },
    notes: [],
  };
}

/**
 * The too-dense payload as the REAL route builds it: no features, the true
 * matched count, and the sentence from the REAL coverage module.
 *
 * Written this way on purpose. A hand-typed "Parcels: 214,391 shapes…" string
 * would keep passing after somebody changed the real sentence, and this test
 * would then be asserting a sentence no planner ever sees.
 */
const MATCHED = 214391;
const DENSE_COLLECTION = {
  type: "FeatureCollection",
  features: [],
  returnedCount: 0,
  matchedCount: MATCHED,
  droppedCount: 0,
  truncated: true,
  limit: WORKSPACE_GIS_BBOX_DRAW_LIMIT,
  tooDenseToDraw: true,
  coverageNotes: describeWorkspaceLayerCoverage({
    layerName: "Parcels",
    returnedCount: 0,
    matchedCount: MATCHED,
    droppedCount: 0,
    limit: WORKSPACE_GIS_BBOX_DRAW_LIMIT,
    tooDenseToDraw: true,
  }),
};

function routeFetch(collection: unknown) {
  return vi.fn((input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/workspace-gis/layers")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ layers: [layerListing()] }) });
    }
    if (url.startsWith("/api/map-features/workspace-gis/")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => collection });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ type: "FeatureCollection", features: [] }),
    });
  }) as unknown as typeof fetch;
}

async function renderShell(collection: unknown) {
  vi.resetModules();
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token-for-the-backdrop";
  global.fetch = routeFetch(collection);

  const { CartographicMapBackdrop } = await import(
    "@/components/cartographic/cartographic-map-backdrop"
  );
  const { CartographicLayersPanel } = await import(
    "@/components/cartographic/cartographic-layers-panel"
  );
  const { CartographicProvider } = await import(
    "@/components/cartographic/cartographic-context"
  );

  return render(
    <CartographicProvider>
      <CartographicMapBackdrop workspaceId="ws-1" />
      <CartographicLayersPanel workspaceId="ws-1" />
    </CartographicProvider>
  );
}

describe("a layer too dense to draw says so on screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addedLayers.length = 0;
    sourceData.clear();
    listeners.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("puts the true count and what to do about it on the panel", async () => {
    await renderShell(DENSE_COLLECTION);

    await waitFor(() => {
      expect(screen.getByText(/214,391 shapes in this view/)).toBeInTheDocument();
    });

    const note = screen.getByText(/214,391 shapes in this view/).textContent ?? "";
    // The true count, not the drawn count.
    expect(note).toContain("214,391");
    // WHY none are drawn, in the planner's terms.
    expect(note).toContain("holes in the fabric");
    // And the action that fixes it.
    expect(note).toContain("Zoom in");
  });

  it("hands the map ZERO features rather than an arbitrary subset", async () => {
    await renderShell(DENSE_COLLECTION);

    await waitFor(() => {
      expect(screen.getByText(/214,391 shapes in this view/)).toBeInTheDocument();
    });

    const source = sourceData.get(`cartographic-workspace-gis-${LAYER_ID}`);
    // The whole point: a partial parcel fabric is worse than none, because the
    // gaps look like findings.
    expect(source?.features).toEqual([]);
  });

  it("draws the features when the view is under the cap", async () => {
    const drawable = {
      ...DENSE_COLLECTION,
      features: [
        {
          type: "Feature",
          id: "f1",
          geometry: { type: "Point", coordinates: [-121, 39.2] },
          properties: {
            kind: "workspace_gis_feature",
            layerId: LAYER_ID,
            versionId: "version-1",
            featureIndex: 0,
            attributes: { APN: "001-020-030" },
          },
        },
      ],
      returnedCount: 1,
      matchedCount: 1,
      truncated: false,
      tooDenseToDraw: false,
      coverageNotes: [],
    };

    await renderShell(drawable);

    await waitFor(() => {
      expect(sourceData.get(`cartographic-workspace-gis-${LAYER_ID}`)?.features).toHaveLength(1);
    });
    // A negative control for the test above: this harness CAN observe features
    // reaching the map, so "zero features" there is a real observation rather
    // than a fake that never receives anything.
    expect(screen.queryByText(/shapes in this view/)).toBeNull();
  });

  /**
   * The agency's own reference layers go BENEATH the workspace's own records.
   * A parcel fabric drawn over the project pins buries the work the planner came
   * to look at, and eats every click on it.
   */
  it("inserts the workspace layer below the existing feature layers", async () => {
    await renderShell(DENSE_COLLECTION);

    await waitFor(() => {
      expect(
        addedLayers.some((layer) => layer.id.startsWith(`cartographic-workspace-gis-${LAYER_ID}`))
      ).toBe(true);
    });

    const drawn = addedLayers.filter((layer) =>
      layer.id.startsWith(`cartographic-workspace-gis-${LAYER_ID}`)
    );
    expect(drawn.length).toBeGreaterThan(0);
    for (const layer of drawn) {
      // Anchored to a built-in feature layer, never added on top with no anchor.
      expect(layer.beforeId).toBeTruthy();
      expect(layer.beforeId?.startsWith("cartographic-")).toBe(true);
      expect(layer.beforeId?.startsWith("cartographic-workspace-gis-")).toBe(false);
    }
  });

  /** The cap must fit one PostgREST response, or the platform truncates it silently. */
  it("keeps the draw limit inside what one request can actually return", () => {
    expect(WORKSPACE_GIS_BBOX_DRAW_LIMIT).toBeLessThanOrEqual(1000);
  });
});
