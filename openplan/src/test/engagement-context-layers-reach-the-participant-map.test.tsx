import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTEXT_LAYER_SUMMARY_COLUMNS,
  PARTICIPANT_CONTEXT_LAYER_COLUMNS,
  loadParticipantContextLayers,
  toParticipantContextLayer,
  type ContextLayerRow,
  type ParticipantContextLayer,
  type ParticipantContextLayerSet,
} from "@/lib/engagement/context-layers";
import { contextLayerPaintIds, contextLayerSourceId, syncContextLayers } from "@/lib/engagement/context-layer-paint";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * THE SEAM THIS REPO KEEPS BREAKING.
 *
 * Four times in one week a capability shipped complete, tested and role-gated,
 * and no planner could reach it: once because a prop was never passed at the
 * render site, once because a column never made it into a `.select()` string.
 * Supabase clients here are deliberately untyped, so a missing column is
 * `undefined` at runtime and `tsc` says nothing at all.
 *
 * So these assertions are all at the point where a context layer becomes
 * SOMETHING A PERSON SEES: the projection names the columns the mapper reads,
 * the columns exist on the table, the publication filter is on the query, a
 * source and a paint layer really get registered on the map, and the legend
 * renders the operator's own name for the layer.
 */

// ── Mapbox double ────────────────────────────────────────────────────────────

type StyleLayer = { id: string };

const mapboxMocks = vi.hoisted(() => {
  const instances: Array<Record<string, unknown>> = [];

  const Map = vi.fn(function MockMap() {
    const styleLayers: StyleLayer[] = [];
    // A plain record, not a `new Map()`: inside this factory the identifier
    // `Map` is the Mapbox double being defined, not the global.
    const sources: Record<string, { setData: (data: unknown) => void }> = {};

    const instance = {
      styleLayers,
      sources,
      keyboard: { disable: vi.fn() },
      addControl: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      getCanvas: vi.fn(() => ({ setAttribute: vi.fn(), style: {} })),
      getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
      panBy: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      project: vi.fn(() => ({ x: 0, y: 0 })),
      fitBounds: vi.fn(),
      isStyleLoaded: vi.fn(() => true),
      getSource: vi.fn((id: string) => sources[id] ?? null),
      addSource: vi.fn((id: string) => {
        sources[id] = { setData: vi.fn() };
      }),
      removeSource: vi.fn((id: string) => {
        delete sources[id];
      }),
      getLayer: vi.fn((id: string) => styleLayers.find((layer) => layer.id === id) ?? null),
      addLayer: vi.fn((layer: { id: string }) => {
        styleLayers.push({ id: layer.id });
      }),
      removeLayer: vi.fn((id: string) => {
        const at = styleLayers.findIndex((layer) => layer.id === id);
        if (at >= 0) styleLayers.splice(at, 1);
      }),
      getStyle: vi.fn(() => ({ layers: [...styleLayers] })),
      remove: vi.fn(),
    };
    instances.push(instance);
    return instance;
  });

  const Popup = vi.fn(function MockPopup() {
    const self = { setDOMContent: vi.fn(() => self), setLngLat: vi.fn(() => self), addTo: vi.fn(() => self) };
    return self;
  });
  const Marker = vi.fn(function MockMarker() {
    const self = { setLngLat: vi.fn(() => self), setPopup: vi.fn(() => self), addTo: vi.fn(() => self) };
    return self;
  });
  const LngLatBounds = vi.fn(function MockBounds() {
    return { extend: vi.fn(), isEmpty: vi.fn(() => false) };
  });

  return { Map, NavigationControl: vi.fn(), Popup, Marker, LngLatBounds, instances };
});

vi.mock("mapbox-gl", () => ({
  default: {
    Map: mapboxMocks.Map,
    NavigationControl: mapboxMocks.NavigationControl,
    Popup: mapboxMocks.Popup,
    Marker: mapboxMocks.Marker,
    LngLatBounds: mapboxMocks.LngLatBounds,
    accessToken: "",
  },
  Map: mapboxMocks.Map,
  NavigationControl: mapboxMocks.NavigationControl,
}));

const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

beforeEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
  mapboxMocks.instances.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_TOKEN;
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LAYER_ID = "44444444-4444-4444-8444-444444444444";

function columnList(select: string): string[] {
  return select.split(",").map((column) => column.trim());
}

/**
 * A row built ONLY from the columns the participant projection actually asks
 * for. Anything the projection forgot is genuinely absent here, exactly as it
 * would be at runtime.
 */
function rowFromProjection(overrides: Record<string, unknown> = {}): ContextLayerRow {
  const values: Record<string, unknown> = {
    id: LAYER_ID,
    campaign_id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "22222222-2222-4222-8222-222222222222",
    name: "Proposed alignment",
    description: "Centreline as designed at 30% plans",
    source_format: "geojson",
    source_filename: "alignment.geojson",
    source_byte_size: 2048,
    srs_authority: "EPSG",
    srs_code: "4326",
    srs_name: "WGS 84",
    srs_basis: "geojson_rfc7946_default",
    geometry_kinds: ["LineString"],
    feature_count: 2,
    source_feature_count: 5,
    dropped_feature_count: 0,
    truncated: true,
    bbox: [-121.1, 39.2, -121.0, 39.3],
    display_color: "#38bdf8",
    sort_order: 0,
    visible_to_participants: true,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
    features: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-121.1, 39.2], [-121, 39.3]] } },
      ],
    },
  };

  const projected: Record<string, unknown> = {};
  for (const column of columnList(PARTICIPANT_CONTEXT_LAYER_COLUMNS)) {
    if (column in values) projected[column] = values[column];
  }
  return { ...projected, ...overrides } as unknown as ContextLayerRow;
}

function participantLayer(overrides: Partial<ParticipantContextLayer> = {}): ParticipantContextLayer {
  return { ...toParticipantContextLayer(rowFromProjection()), ...overrides };
}

// ── 1. The projection ────────────────────────────────────────────────────────

describe("the participant projection asks for what the map reads", () => {
  it("leaves no field of a participant layer undefined", () => {
    const layer = toParticipantContextLayer(rowFromProjection());

    // Written field by field rather than as a snapshot: a missing column reads
    // as `undefined`, and `toEqual` against a partial object would pass.
    expect(layer.id).toBe(LAYER_ID);
    expect(layer.name).toBe("Proposed alignment");
    expect(layer.description).toBe("Centreline as designed at 30% plans");
    expect(layer.color).toBe("#38bdf8");
    expect(layer.geometryKinds).toEqual(["LineString"]);
    expect(layer.featureCollection.features).toHaveLength(1);
    expect(layer.bbox).toEqual([-121.1, 39.2, -121, 39.3]);
    // The disclosure only exists because the four count columns were selected.
    expect(layer.coverageNotes).toHaveLength(1);
    expect(layer.coverageNotes[0]).toContain("showing 2 of 5");
  });

  it("names only columns the table actually has", () => {
    // The other half of the untyped-client defect: a projection can also name a
    // column that does not exist, which fails the whole query at runtime.
    const schema = loadSchemaInventory();
    const columns = schema.columns("engagement_context_layers");
    expect(columns, "the 20260729000002 migration must declare this table").toBeDefined();

    for (const column of new Set([
      ...columnList(PARTICIPANT_CONTEXT_LAYER_COLUMNS),
      ...columnList(CONTEXT_LAYER_SUMMARY_COLUMNS),
    ])) {
      expect(columns?.has(column), `engagement_context_layers has no column "${column}"`).toBe(true);
    }
  });

  it("keeps the geometry out of the operator's management projection", () => {
    // A campaign with a dozen parcel layers must not ship every polygon to a
    // panel that renders names and counts.
    expect(columnList(CONTEXT_LAYER_SUMMARY_COLUMNS)).not.toContain("features");
    expect(columnList(PARTICIPANT_CONTEXT_LAYER_COLUMNS)).toContain("features");
  });
});

// ── 2. The publication rule ──────────────────────────────────────────────────

describe("what the public query will and will not return", () => {
  function recordingClient(result: { data?: unknown; error?: { message: string } | null }) {
    const calls: { table?: string; select?: string; filters: Array<[string, unknown]> } = { filters: [] };
    const builder = {
      select: (columns: string) => {
        calls.select = columns;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        calls.filters.push([column, value]);
        return builder;
      },
      order: () => builder,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve),
    };
    return {
      calls,
      client: {
        from: (table: string) => {
          calls.table = table;
          return builder;
        },
      },
    };
  }

  it("filters on the publication switch, not merely on the campaign", () => {
    const { calls, client } = recordingClient({ data: [] });

    return loadParticipantContextLayers(client as never, "campaign-1").then(() => {
      expect(calls.table).toBe("engagement_context_layers");
      expect(calls.select).toBe(PARTICIPANT_CONTEXT_LAYER_COLUMNS);
      // Both filters, together. Dropping the second would publish every layer
      // an operator ever uploaded to anyone holding the share link.
      expect(calls.filters).toEqual([
        ["campaign_id", "campaign-1"],
        ["visible_to_participants", true],
      ]);
    });
  });

  it("reports a failed read as a failure rather than as an empty campaign", () => {
    const { client } = recordingClient({ error: { message: "permission denied for table" } });

    return loadParticipantContextLayers(client as never, "campaign-1").then((result) => {
      expect(result.layers).toEqual([]);
      expect(result.readFailure).toContain("permission denied");
    });
  });
});

// ── 3. Registration on the map ───────────────────────────────────────────────

describe("registering context layers on a map", () => {
  function fakeMap() {
    return new (mapboxMocks.Map as unknown as new () => {
      styleLayers: StyleLayer[];
      addSource: ReturnType<typeof vi.fn>;
      addLayer: ReturnType<typeof vi.fn>;
      removeLayer: ReturnType<typeof vi.fn>;
      getStyle: ReturnType<typeof vi.fn>;
    })();
  }

  it("adds a source and the paint layers each geometry kind needs", () => {
    const map = fakeMap();
    const layers = [
      participantLayer({ id: "a", geometryKinds: ["Polygon"] }),
      participantLayer({ id: "b", geometryKinds: ["LineString", "Point"] }),
    ];

    syncContextLayers(map as never, layers, { beforeId: "engagement-draw-fill" });

    expect(map.addSource).toHaveBeenCalledWith(contextLayerSourceId("a"), expect.objectContaining({ type: "geojson" }));
    expect(map.styleLayers.map((layer) => layer.id)).toEqual([
      contextLayerPaintIds("a").fill,
      contextLayerPaintIds("a").outline,
      contextLayerPaintIds("b").line,
      contextLayerPaintIds("b").point,
    ]);

    // Under the resident's own drawing, every time. Context that covers the
    // sketch defeats the map.
    for (const call of map.addLayer.mock.calls) {
      expect(call[1]).toBe("engagement-draw-fill");
    }
  });

  it("is idempotent, so a style swap and a data change can both trigger it", () => {
    const map = fakeMap();
    const layers = [participantLayer({ id: "a", geometryKinds: ["Polygon"] })];

    syncContextLayers(map as never, layers);
    syncContextLayers(map as never, layers);

    expect(map.styleLayers).toHaveLength(2);
    expect(map.addSource).toHaveBeenCalledTimes(1);
  });

  it("retires a layer the operator unpublished", () => {
    const map = fakeMap();
    syncContextLayers(map as never, [participantLayer({ id: "a", geometryKinds: ["Polygon"] })]);
    syncContextLayers(map as never, []);

    expect(map.styleLayers).toHaveLength(0);
    expect(map.removeLayer).toHaveBeenCalledWith(contextLayerPaintIds("a").fill);
  });

  it("drops a source only after every paint layer that referenced it is gone", () => {
    // A polygon layer registers TWO paint layers — a fill and an outline —
    // against ONE source, so retiring the source as soon as the first of them
    // goes leaves the second holding a reference to something that no longer
    // exists. Mapbox 3.x answers that with an ErrorEvent rather than by
    // throwing, so the sweep still ended in the right state while spraying
    // "source is in use" into the console of a resident's browser — and the
    // double above could not see it, because it models `removeSource` as an
    // unconditional delete. This one refuses, the way the real map complains.
    const styleLayers: Array<{ id: string; source: string }> = [];
    const sources = new Set<string>();
    const strictMap = {
      getStyle: () => ({ layers: styleLayers.map((layer) => ({ id: layer.id })) }),
      getSource: (id: string) => (sources.has(id) ? { setData: () => {} } : null),
      addSource: (id: string) => {
        sources.add(id);
      },
      removeSource: (id: string) => {
        const inUse = styleLayers.filter((layer) => layer.source === id);
        if (inUse.length > 0) {
          throw new Error(`source "${id}" is still in use by ${inUse.map((layer) => layer.id).join(", ")}`);
        }
        sources.delete(id);
      },
      getLayer: (id: string) => styleLayers.find((layer) => layer.id === id) ?? null,
      addLayer: (layer: { id: string; source: string }) => {
        styleLayers.push({ id: layer.id, source: layer.source });
      },
      removeLayer: (id: string) => {
        const at = styleLayers.findIndex((layer) => layer.id === id);
        if (at >= 0) styleLayers.splice(at, 1);
      },
    };

    syncContextLayers(strictMap as never, [participantLayer({ id: "a", geometryKinds: ["Polygon"] })]);
    expect(styleLayers.map((layer) => layer.id)).toEqual([
      contextLayerPaintIds("a").fill,
      contextLayerPaintIds("a").outline,
    ]);

    expect(() => syncContextLayers(strictMap as never, [])).not.toThrow();
    expect(styleLayers).toHaveLength(0);
    expect(sources.size).toBe(0);
  });
});

// ── 4. What a resident actually sees ─────────────────────────────────────────

describe("the participant maps render the operator's layers and their legend", () => {
  it("draws them under the sketch on the map a resident draws on", async () => {
    const { GeometryPickerMap } = await import("@/components/engagement/geometry-picker-map");

    render(
      <GeometryPickerMap
        onGeometryChange={() => {}}
        contextLayers={{ layers: [participantLayer({ id: "a", name: "Proposed alignment" })], readFailure: null }}
      />
    );

    const map = mapboxMocks.instances.at(-1) as { addSource: ReturnType<typeof vi.fn> };
    expect(map.addSource).toHaveBeenCalledWith(contextLayerSourceId("a"), expect.objectContaining({ type: "geojson" }));

    // The legend is the whole point: an unlabelled line teaches a resident
    // nothing about the project they are being asked to comment on.
    expect(screen.getByRole("complementary", { name: "Map layers" })).toBeInTheDocument();
    expect(screen.getByText("Proposed alignment")).toBeInTheDocument();
    expect(screen.getByText(/showing 2 of 5/)).toBeInTheDocument();
  });

  it("shows the display map for a campaign that has published context but collected no input", async () => {
    const { LocationDisplayMap } = await import("@/components/engagement/location-display-map");

    const { container } = render(
      <LocationDisplayMap
        items={[]}
        contextLayers={{ layers: [participantLayer({ id: "a", name: "Existing bike network" })], readFailure: null }}
      />
    );

    // Before this change the component returned null unless somebody had
    // already commented, which hid the project from the people being asked
    // about it.
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText("Existing bike network")).toBeInTheDocument();
    const map = mapboxMocks.instances.at(-1) as { addSource: ReturnType<typeof vi.fn> };
    expect(map.addSource).toHaveBeenCalledWith(contextLayerSourceId("a"), expect.objectContaining({ type: "geojson" }));
  });

  it("says the layers could not be loaded instead of rendering nothing", async () => {
    const { LocationDisplayMap } = await import("@/components/engagement/location-display-map");

    render(<LocationDisplayMap items={[]} contextLayers={{ layers: [], readFailure: "connection reset" }} />);

    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText(/not a finding that there are none/)).toBeInTheDocument();
  });

  it("renders nothing at all when a campaign genuinely has neither input nor layers", async () => {
    const { LocationDisplayMap } = await import("@/components/engagement/location-display-map");

    const { container } = render(<LocationDisplayMap items={[]} contextLayers={{ layers: [], readFailure: null }} />);
    expect(container.firstChild).toBeNull();
  });
});

// ── 5. The surface a resident actually opens ─────────────────────────────────

describe("the public engagement portal", () => {
  async function renderPortal(contextLayers: ParticipantContextLayerSet, acceptingSubmissions = true) {
    const [{ PublicEngagementPortal }, { resolvePortalMapFraming }, { resolvePortalLocale }, { buildPortalMessageBundle }] =
      await Promise.all([
        import("@/components/engagement/public-engagement-portal"),
        import("@/lib/engagement/public-portal-data"),
        import("@/lib/engagement/portal-i18n/locales"),
        import("@/lib/engagement/portal-i18n/messages"),
      ]);

    // The portal cannot render without knowing which language it is in — the
    // props are required so a render site cannot silently answer a Vietnamese
    // participant in English. Resolved rather than hand-written, so this fixture
    // cannot describe a locale the resolver would never produce.
    const locale = resolvePortalLocale({});

    return render(
      <PublicEngagementPortal
        // Built through the real resolver: this campaign has no study area, so
        // the map opens on the continent. The context layers still have to draw
        // — a resident who cannot see the project cannot comment on it, framed
        // or not.
        mapFraming={resolvePortalMapFraming({})}
        shareToken="share-token-123"
        acceptingSubmissions={acceptingSubmissions}
        engagementType="map_feedback"
        categories={[]}
        approvedItems={[]}
        contextLayers={contextLayers}
        locale={locale}
        messages={buildPortalMessageBundle(locale)}
      />
    );
  }

  it("draws the campaign's published layers under the map a resident sketches on, and names them", async () => {
    await renderPortal({
      layers: [participantLayer({ id: "a", name: "Proposed alignment" })],
      readFailure: null,
    });

    const map = mapboxMocks.instances.at(-1) as { addSource: ReturnType<typeof vi.fn> };
    expect(map.addSource).toHaveBeenCalledWith(contextLayerSourceId("a"), expect.objectContaining({ type: "geojson" }));

    // Registration alone is decoration. The operator's own name for the layer
    // is what turns a blue line into the thing being planned.
    expect(screen.getByRole("complementary", { name: "Map layers" })).toBeInTheDocument();
    expect(screen.getByText("Proposed alignment")).toBeInTheDocument();
  });

  it("draws them on the community feedback map too, before anyone has commented", async () => {
    await renderPortal(
      { layers: [participantLayer({ id: "a", name: "Existing bike network" })], readFailure: null },
      // Submissions closed, so the portal opens on the feedback tab — the map
      // that used to render nothing at all until somebody had already commented.
      false
    );

    const map = mapboxMocks.instances.at(-1) as { addSource: ReturnType<typeof vi.fn> };
    expect(map.addSource).toHaveBeenCalledWith(contextLayerSourceId("a"), expect.objectContaining({ type: "geojson" }));
    expect(screen.getByText("Existing bike network")).toBeInTheDocument();
  });

  it("tells a resident the layers could not be loaded rather than showing a bare basemap", async () => {
    await renderPortal({ layers: [], readFailure: "connection reset" });

    // A failed read rendered as an empty map states, confidently and without
    // anyone having checked, that this project has no geometry to show.
    expect(screen.getAllByText(/could not be loaded/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not a finding that there are none/i).length).toBeGreaterThan(0);
  });
});
