/**
 * THE MAP STAGE, ON THE FOUR OCCASIONS IT USED TO LIE.
 *
 * Every case here is a state a resident can actually be in on the one page
 * where the map IS the question — and in each of them the stage used to show
 * something that was not true:
 *
 *   1. a context layer switched OFF that stayed painted, because the repaint
 *      skipped the sync whenever the visible set was empty;
 *   2. a background picker whose radio moved and whose map never changed,
 *      because the style the map was built with was never recorded;
 *   3. a style that never loaded — a revoked, wrong-scope, URL-restricted or
 *      network-blocked token — showing as a grey rectangle forever, because
 *      nothing listened for Mapbox's `error` event;
 *   4. a deployment with no offered background falling through to a style URL
 *      typed into the component, in a file whose header says it holds none.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom has no box model, no stylesheet and no
 * WebGL; Mapbox GL is a double below. Nothing here is evidence that anything is
 * VISIBLE, or that a real Mapbox error reaches the handler in a browser. It is
 * evidence about which calls the component makes and which elements it renders
 * — the half that regresses silently.
 *
 * THE TOKEN IS READ AT MODULE SCOPE by `public-map-stage.tsx`, so every case
 * resets the module registry and imports fresh under the environment it wants.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePublicBasemapConfig, type PublicBasemapChoice } from "@/lib/cartographic/basemaps";
import { contextLayerPaintIds, contextLayerSourceId } from "@/lib/engagement/context-layer-paint";
import type { ParticipantContextLayer } from "@/lib/engagement/context-layers";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle, EN_PORTAL_MESSAGES } from "@/lib/engagement/portal-i18n/messages";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";

// ── The Mapbox double ────────────────────────────────────────────────────────

type StyleLayer = { id: string };

const mapboxMocks = vi.hoisted(() => {
  const instances: Array<Record<string, unknown>> = [];

  const Map = vi.fn(function MockMap(options: { style?: string }) {
    const styleLayers: StyleLayer[] = [];
    const sources: Record<string, { setData: (data: unknown) => void }> = {};
    /** Every handler the component registered, so a test can fire one. */
    const handlers: Record<string, Array<(payload?: unknown) => void>> = {};

    const instance = {
      constructedWithStyle: options?.style ?? null,
      styleLayers,
      sources,
      handlers,
      keyboard: { disable: vi.fn() },
      addControl: vi.fn(),
      on: vi.fn((event: string, second: unknown, third?: unknown) => {
        // `map.on(event, layerId, handler)` and `map.on(event, handler)`.
        const handler = (typeof second === "function" ? second : third) as (payload?: unknown) => void;
        (handlers[event] ??= []).push(handler);
      }),
      once: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        (handlers[event] ??= []).push(handler);
      }),
      off: vi.fn(),
      resize: vi.fn(),
      setStyle: vi.fn(),
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

  const ctl = vi.fn(function MockControl() {
    const self = {
      setLngLat: vi.fn(() => self),
      setPopup: vi.fn(() => self),
      setDOMContent: vi.fn(() => self),
      addTo: vi.fn(() => self),
      remove: vi.fn(() => self),
      extend: vi.fn(() => self),
      isEmpty: vi.fn(() => true),
    };
    return self;
  });

  return { Map, ctl, instances };
});

vi.mock("mapbox-gl", () => ({
  default: {
    Map: mapboxMocks.Map,
    NavigationControl: mapboxMocks.ctl,
    AttributionControl: mapboxMocks.ctl,
    Popup: mapboxMocks.ctl,
    Marker: mapboxMocks.ctl,
    LngLatBounds: mapboxMocks.ctl,
    accessToken: "",
  },
  Map: mapboxMocks.Map,
  NavigationControl: mapboxMocks.ctl,
  AttributionControl: mapboxMocks.ctl,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

beforeEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
  mapboxMocks.instances.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_TOKEN;
});

const EN_LOCALE = resolvePortalLocale({ requested: "en", acceptLanguage: null });
const TRANSLATOR = createPortalTranslator(buildPortalMessageBundle(EN_LOCALE));

/** Backgrounds through the REAL resolver — never a hand-written style list. */
const CHOICES: PublicBasemapChoice[] = resolvePublicBasemapConfig({
  mapboxToken: "pk.test-token",
  env: { OPENPLAN_PUBLIC_BASEMAPS: "streets,satellite" },
}).choices;

function layer(overrides: Partial<ParticipantContextLayer> = {}): ParticipantContextLayer {
  return {
    id: "layer-a",
    name: "Proposed alignment",
    description: null,
    color: "#38bdf8",
    geometryKinds: ["LineString"],
    featureCollection: { type: "FeatureCollection", features: [] },
    bbox: null,
    coverageNotes: [],
    ...overrides,
  };
}

type StageProps = Parameters<
  Awaited<typeof import("@/components/engagement/public-map-stage")>["PublicMapStage"]
>[0];

async function renderStage(overrides: Partial<StageProps> = {}) {
  const { PublicMapStage } = await import("@/components/engagement/public-map-stage");
  const props: StageProps = {
    items: [],
    contextLayers: null,
    initialView: { center: [-121.05, 39.2], zoom: 12 },
    basemapChoices: CHOICES,
    selectedBasemapId: "streets",
    onBasemapSelect: vi.fn(),
    visibleLayerIds: [],
    onVisibleLayerIdsChange: vi.fn(),
    translator: TRANSLATOR,
    ...overrides,
  };
  const view = render(<PublicMapStage {...props} />);
  return {
    view,
    rerender: (next: Partial<StageProps>) => view.rerender(<PublicMapStage {...props} {...next} />),
    map: mapboxMocks.instances.at(-1) as
      | (Record<string, ReturnType<typeof vi.fn>> & {
          handlers: Record<string, Array<(payload?: unknown) => void>>;
          constructedWithStyle: string | null;
        })
      | undefined,
  };
}

/**
 * Fire what the component registered for a Mapbox event. Inside `act` because
 * these handlers set React state from outside React, exactly as Mapbox does.
 */
function fireMapEvent(
  map: { handlers: Record<string, Array<(payload?: unknown) => void>> },
  event: string,
  payload?: unknown
) {
  act(() => {
    for (const handler of map.handlers[event] ?? []) handler(payload);
  });
}

/** The style arrived — the map is up. */
function styleLoads(map: { handlers: Record<string, Array<(payload?: unknown) => void>> }) {
  fireMapEvent(map, "style.load");
}

// ── 1. The off switch ────────────────────────────────────────────────────────

describe("switching a layer off takes it off the map", () => {
  it("retires the last visible layer instead of leaving it painted", async () => {
    const only = layer({ id: "only-one" });
    const { rerender, map } = await renderStage({
      contextLayers: { layers: [only], readFailure: null },
      visibleLayerIds: ["only-one"],
    });
    if (!map) throw new Error("no map was constructed");
    styleLoads(map);

    // It is on the map to begin with.
    expect(map.addSource).toHaveBeenCalledWith(
      contextLayerSourceId("only-one"),
      expect.objectContaining({ type: "geojson" })
    );

    map.removeLayer.mockClear();
    map.removeSource.mockClear();

    // The resident clears the only checkbox: the visible set is now EMPTY, which
    // is an instruction to take it off, not an absence of one.
    rerender({ visibleLayerIds: [] });
    styleLoads(map);

    expect(map.removeLayer).toHaveBeenCalledWith(contextLayerPaintIds("only-one").line);
    expect(map.removeSource).toHaveBeenCalledWith(contextLayerSourceId("only-one"));
    // And the double's own registry — the closest thing here to the style — no
    // longer carries it.
    const remaining = (map.styleLayers as unknown as StyleLayer[]).map((entry) => entry.id);
    expect(remaining).not.toContain(contextLayerPaintIds("only-one").line);
  });
});

// ── 2. One list of layers, not two ───────────────────────────────────────────

describe("the layer a resident switched off is not named as if it were drawn", () => {
  it("carries the picker and no second legend", async () => {
    await renderStage({
      contextLayers: { layers: [layer({ id: "a", name: "Proposed alignment" })], readFailure: null },
      visibleLayerIds: [],
    });

    // The picker is the legend on this surface — it is the only one of the two
    // that knows what is currently drawn.
    expect(screen.getByTestId("public-map-layer-picker")).toBeInTheDocument();
    // The standalone legend lists the FULL published set regardless of what is
    // visible, so on a map with a picker it can only ever contradict it.
    expect(screen.queryByRole("complementary", { name: "Map layers" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /what's on the map/i }));
    expect(screen.getAllByText("Proposed alignment")).toHaveLength(1);
  });

  it("says OpenPlan's own control words through the participant's catalog", async () => {
    /*
      THE ENGLISH DEFAULTS INSIDE THE PICKERS ARE THE SAME SENTENCES, so a
      translator carrying English cannot tell "the catalog reached the picker"
      apart from "the picker used its own copy" — the shape of test that passes
      whatever the component does. This one substitutes the two headings in a
      REAL bundle, so only a stage that actually threads its translator through
      renders them.
    */
    const bundle = buildPortalMessageBundle(resolvePortalLocale({ requested: "es", acceptLanguage: null }));
    const translator = createPortalTranslator({
      ...bundle,
      messages: {
        ...bundle.messages,
        "portal.layersHeading": "Qué se ve en el mapa",
        "portal.backgroundHeading": "El fondo del mapa",
      },
    });

    await renderStage({
      translator,
      contextLayers: { layers: [layer()], readFailure: null },
      visibleLayerIds: ["layer-a"],
    });

    expect(screen.getByTestId("public-map-layer-picker")).toHaveAttribute("lang", translator.bcp47);
    expect(screen.getByRole("button", { name: "Qué se ve en el mapa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "El fondo del mapa" })).toBeInTheDocument();
  });
});

// ── 3. The background picker actually changes the background ─────────────────

describe("choosing a different background", () => {
  it("swaps the style on the live map", async () => {
    const { rerender, map } = await renderStage({ selectedBasemapId: "streets" });
    if (!map) throw new Error("no map was constructed");
    styleLoads(map);

    rerender({ selectedBasemapId: "satellite" });

    const satellite = CHOICES.find((choice) => choice.id === "satellite");
    expect(map.setStyle).toHaveBeenCalledWith(satellite?.styleUrl);
  });
});

// ── 4. A background that will not load ───────────────────────────────────────

describe("a map that cannot draw says so", () => {
  it("shows the honest no-map state when the first style never loads", async () => {
    const { map } = await renderStage();
    if (!map) throw new Error("no map was constructed");

    // Mapbox reports a revoked, wrong-scope or URL-restricted token as an error
    // EVENT. Nothing has ever loaded, so the stage is a grey rectangle.
    fireMapEvent(map, "error", { error: { status: 401 } });

    expect(screen.getByTestId("portal-map-stage-unavailable")).toHaveTextContent(
      EN_PORTAL_MESSAGES["portal.mapMissingTitle"]
    );
    // Two controls over a stage that cannot draw are two controls that lie.
    expect(screen.queryByTestId("public-map-pickers")).toBeNull();
  });

  it("keeps the working map and marks only the failed background when a SWAP fails", async () => {
    const { rerender, map } = await renderStage({ selectedBasemapId: "streets" });
    if (!map) throw new Error("no map was constructed");
    styleLoads(map);

    rerender({ selectedBasemapId: "satellite" });
    fireMapEvent(map, "error", { error: { status: 404 } });

    // The resident still has the map they were using.
    expect(screen.queryByTestId("portal-map-stage-unavailable")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: EN_PORTAL_MESSAGES["portal.backgroundHeading"] }));
    expect(screen.getByRole("radio", { name: /satellite/i })).toBeDisabled();
  });

  it("ignores an error once the style is up — a failed tile is not a failed map", async () => {
    const { map } = await renderStage();
    if (!map) throw new Error("no map was constructed");
    styleLoads(map);

    fireMapEvent(map, "error", { error: { status: 404 } });

    expect(screen.queryByTestId("portal-map-stage-unavailable")).toBeNull();
    expect(screen.getByTestId("public-map-pickers")).toBeInTheDocument();
    // And the background it is happily drawing is not marked as broken: a
    // handler that blamed the current style for a tile error would disable the
    // option the resident is looking at.
    fireEvent.click(screen.getByRole("button", { name: EN_PORTAL_MESSAGES["portal.backgroundHeading"] }));
    expect(screen.getByRole("radio", { name: /streets/i })).toBeEnabled();
  });

  it("draws no map at all, and no style of its own, when the deployment offers no background", async () => {
    const { map } = await renderStage({ basemapChoices: [] });

    expect(map).toBeUndefined();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
    expect(screen.getByTestId("portal-map-stage-unavailable")).toBeInTheDocument();
    // An attribute rather than text: this hook stopped being an `sr-only` span
    // on 2026-08-13, because `sr-only` is hidden from eyes and not from
    // assistive technology, and a resident on the public portal was having a
    // Mapbox style URL read aloud to them.
    expect(screen.getByTestId("portal-map-basemap")).toHaveAttribute("data-basemap-style", "");
  });
});

// ── 5. A campaign nobody framed ──────────────────────────────────────────────

describe("a campaign with no geography does not present a wide map as its area", () => {
  it("says nobody set a place, and stops saying it once the resident moves the map", async () => {
    const { map } = await renderStage({ initialView: null, items: [], contextLayers: null });
    if (!map) throw new Error("no map was constructed");

    const notice = screen.getByTestId("portal-map-unframed-notice");
    expect(notice).toHaveTextContent(EN_PORTAL_MESSAGES["portal.mapNoAreaTitle"]);

    fireMapEvent(map, "movestart");
    expect(screen.queryByTestId("portal-map-unframed-notice")).toBeNull();
  });

  it("says nothing when the campaign was framed", async () => {
    await renderStage({ initialView: { center: [-121.05, 39.2], zoom: 12 } });
    expect(screen.queryByTestId("portal-map-unframed-notice")).toBeNull();
  });

  it("says nothing when a pin has already landed — the map is showing a real place", async () => {
    await renderStage({
      initialView: null,
      items: [{ id: "i1", latitude: 39.2, longitude: -121.05, title: null, body: "here" }],
    });
    expect(screen.queryByTestId("portal-map-unframed-notice")).toBeNull();
  });
});
