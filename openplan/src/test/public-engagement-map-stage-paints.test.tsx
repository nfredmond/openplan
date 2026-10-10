/**
 * WHAT ACTUALLY GETS DRAWN ON THE RESIDENT'S MAP.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS — the green suite that watched the map break
 * ============================================================================
 *
 * Every earlier test of this surface mocked `mapbox-gl` with `isStyleLoaded: ()
 * => false` and `once: vi.fn()`. The stage does all of its drawing inside a
 * `paint()` closure handed to `map.once("style.load", paint)`, so in all of
 * those tests the drawing code NEVER RAN — and nothing about pins, submitted
 * shapes, popups, context layers, the camera or the background was under test.
 * Deleting the entire legend from the stage left 30 of 30 tests passing.
 *
 * These tests drive the real lifecycle through `@/test/helpers/mapbox-gl-fake`:
 * a style that loads on command, a style that fails the way Mapbox really
 * reports failure (an `error` EVENT, never a throw), and a source/layer
 * registry a swap wipes. They go through `PublicMapShell` rather than the stage
 * directly, because the shell owns the visible-layer set and the background
 * choice, and a stage tested in isolation proves nothing about the control a
 * resident actually touches.
 *
 * ============================================================================
 * WHAT JSDOM CANNOT PROVE, STATED SO NOBODY READS THIS AS MORE
 * ============================================================================
 *
 * jsdom applies no stylesheet, has no box model, and runs no WebGL. The fake is
 * not Mapbox: it renders nothing and validates no style URL. Therefore nothing
 * here is evidence that the map is visible, that a layer is legible, that a
 * style URL resolves, that a tap target is 44px, or that the REAL library fires
 * these events in this order — that last one is a browser fact to re-check
 * after any Mapbox major-version bump. What is proved is OpenPlan's side of the
 * boundary: which sources and layers get registered and retired, which pins are
 * built, which popup a pin carries, what the camera is asked to do, and which
 * style URL reaches `setStyle`.
 */
import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import {
  emptyPortalTranslationIndex,
  resolveOperatorText,
} from "@/lib/engagement/portal-i18n/operator-text";
import {
  PUBLIC_BASEMAP_OFFER_ENV,
  PUBLIC_BASEMAP_DEFAULT_ENV,
  resolvePublicBasemapConfig,
} from "@/lib/cartographic/basemaps";
import { contextLayerPaintIds, contextLayerSourceId } from "@/lib/engagement/context-layer-paint";
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";
import { lastFakeMap, resetFakeMaps } from "@/test/helpers/mapbox-gl-fake";

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const EN_LOCALE = resolvePortalLocale({ requested: "en", acceptLanguage: null });
const EN_MESSAGES = buildPortalMessageBundle(EN_LOCALE);
const EN_INDEX = emptyPortalTranslationIndex("en");

function operatorText(text: string) {
  return resolveOperatorText(EN_INDEX, { entity: "campaign", id: "campaign-1", field: "title" }, text);
}

/**
 * Two backgrounds where the DEFAULT IS NOT THE FIRST ONE. That ordering is
 * load-bearing in every basemap assertion below: with `streets` both first and
 * default, a stage that ignored its `selectedBasemapId` and always used
 * `basemapChoices[0]` would pass — which is exactly how the previous
 * basemap-selection test stayed green while proving nothing.
 */
const BASEMAPS = resolvePublicBasemapConfig({
  mapboxToken: "pk.test",
  env: {
    [PUBLIC_BASEMAP_OFFER_ENV]: "streets,satellite",
    [PUBLIC_BASEMAP_DEFAULT_ENV]: "satellite",
  },
});

const CONTEXT_LAYERS: ParticipantContextLayerSet = {
  layers: [
    {
      id: "layer-1",
      name: "Proposed alignment",
      description: null,
      color: "#38bdf8",
      geometryKinds: ["LineString"],
      featureCollection: { type: "FeatureCollection", features: [] },
      bbox: null,
      coverageNotes: [],
    },
  ],
  readFailure: null,
};

const PIN_ITEM = {
  id: "item-1",
  latitude: 39.2,
  longitude: -121.05,
  title: "Crossing is dangerous",
  body: "Cars turn without looking.",
  geometry: null,
  votesCount: 3,
  parentItemId: null,
};

const SHAPE_ITEM = {
  id: "item-2",
  latitude: null,
  longitude: null,
  title: "This whole stretch",
  body: "The sidewalk stops here.",
  geometry: {
    type: "LineString",
    coordinates: [
      [-121.06, 39.21],
      [-121.04, 39.23],
    ],
  },
  votesCount: 1,
  parentItemId: null,
};

type ShellProps = ComponentProps<typeof import("@/components/engagement/public-map-shell").PublicMapShell>;

function shellProps(overrides: Partial<ShellProps> = {}): ShellProps {
  return {
    shareToken: "share-token-12345",
    acceptingSubmissions: true,
    categories: [],
    items: [PIN_ITEM],
    readFailures: { comments: false, categories: false, closeLoop: false, project: false },
    demographicsEnabled: false,
    mapFraming: resolvePortalMapFraming({}),
    contextLayers: null,
    messages: EN_MESSAGES,
    campaignTitle: operatorText("Downtown listening campaign"),
    campaignDescription: null,
    detailsHref: "/engage/share-token-12345/about",
    detailsContents: { survey: false, comments: false, closeLoop: false },
    mapAvailable: true,
    basemapChoices: BASEMAPS.choices,
    defaultBasemapId: BASEMAPS.defaultId,
    ...overrides,
  };
}

/** Render the shell and take the map all the way to "a background is on screen". */
async function renderWithLoadedMap(overrides: Partial<ShellProps> = {}) {
  const { PublicMapShell } = await import("@/components/engagement/public-map-shell");
  const view = render(<PublicMapShell {...shellProps(overrides)} />);
  const map = lastFakeMap();
  act(() => map.loadStyle());
  return { ...view, map };
}

/**
 * A background option, found by the registry id it carries rather than by its
 * label. Two labels can share a word ("Streets" and "Satellite" both describe
 * streets in their descriptions, and the accessible name includes the
 * description), so a name regex is ambiguous — and an ambiguous query is one
 * that silently starts matching the wrong control.
 */
function basemapRadio(id: string): HTMLInputElement {
  const radio = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${id}"]`);
  if (!radio) throw new Error(`the background picker offers no "${id}" option`);
  return radio;
}

function styleUrlFor(id: string): string {
  const choice = BASEMAPS.choices.find((entry) => entry.id === id);
  if (!choice) throw new Error(`the test's own basemap fixture has no ${id}`);
  return choice.styleUrl;
}

beforeEach(() => {
  vi.resetModules();
  resetFakeMaps();
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-participant-map");
});

afterEach(() => {
  cleanup();
  // Opening a comment writes `?item=` to the address bar; jsdom keeps it
  // between tests, and the next render would open that comment from it.
  window.history.replaceState(null, "", "/");
  // A tap that marks a place saves a draft, and the next render restores it.
  window.localStorage.clear();
  vi.unstubAllEnvs();
  vi.resetModules();
  resetFakeMaps();
});

describe("the operator's layers, and the switch that takes them off", () => {
  it("registers a published layer as a real source and paint layer once the style is up", async () => {
    const { map } = await renderWithLoadedMap({ contextLayers: CONTEXT_LAYERS });

    expect(map.sourceIds()).toContain(contextLayerSourceId("layer-1"));
    expect(map.layerIds()).toContain(contextLayerPaintIds("layer-1").line);
  });

  it("RETIRES the last visible layer instead of leaving it painted", async () => {
    /*
      THE BUG THIS NAMES. `syncContextLayers` both registers what should be on
      the map and retires what should not; the paint used to skip the call when
      the visible set was empty, so switching off the only layer left it drawn.
      The checkbox cleared and the map did not — the one control this surface
      gives a resident did nothing, and no test could see it because `paint()`
      never ran in any of them.
    */
    const { map } = await renderWithLoadedMap({ contextLayers: CONTEXT_LAYERS });
    expect(map.layerIds()).toContain(contextLayerPaintIds("layer-1").line);

    fireEvent.click(screen.getByRole("button", { name: /what's on the map/i }));
    act(() => {
      fireEvent.click(screen.getByRole("checkbox", { name: /proposed alignment/i }));
    });

    expect(map.layerIds()).not.toContain(contextLayerPaintIds("layer-1").line);
    // And its source goes with it, or the next style swap re-registers a layer
    // nobody asked for.
    expect(map.sourceIds()).not.toContain(contextLayerSourceId("layer-1"));
  });

  it("names on screen only what is actually drawn, and carries no second legend", async () => {
    const { map, container } = await renderWithLoadedMap({ contextLayers: CONTEXT_LAYERS });
    fireEvent.click(screen.getByRole("button", { name: /what's on the map/i }));

    // Drawn, and named exactly once — a legend beside the picker made this two.
    expect(map.layerIds()).toContain(contextLayerPaintIds("layer-1").line);
    expect(screen.getAllByText("Proposed alignment")).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="public-map-pickers"]')).toHaveLength(1);
  });

  it("puts the operator's context UNDER the community's shapes", async () => {
    // Context is context. A layer an operator uploaded must never bury the
    // input the map exists to collect.
    const { map } = await renderWithLoadedMap({
      contextLayers: CONTEXT_LAYERS,
      items: [SHAPE_ITEM],
    });

    expect(map.layer(contextLayerPaintIds("layer-1").line)?.beforeId).toBe("engagement-shapes-fill");
  });
});

describe("what the community already said, drawn on the map", () => {
  it("puts a point for every approved comment that has a place into a clustered source", async () => {
    const { map } = await renderWithLoadedMap({ items: [PIN_ITEM] });

    const data = map.sourceData("engagement-points") as {
      features: { geometry: { coordinates: unknown }; properties: { itemId: string } }[];
    };
    expect(data.features.map((feature) => feature.properties.itemId)).toEqual(["item-1"]);
    expect(data.features[0].geometry.coordinates).toEqual([-121.05, 39.2]);
    // Grouped into a count when pins pile up, so a busy corner stays tappable.
    expect(map.sourceOptions("engagement-points")).toMatchObject({ cluster: true });
    expect(map.liveMarkers()).toHaveLength(0);
  });

  it("opens a tapped pin's comment, with its support button, and leaves the resident's own mark alone", async () => {
    /*
      THE DEFECT THIS NAMES, observed in a browser on 2026-10-10: every tap went
      to the drawing tool, so tapping a neighbour's pin to read it also moved
      the resident's own mark onto it. A tap on a pin now opens the comment and
      draws nothing.
    */
    const { map } = await renderWithLoadedMap({ items: [PIN_ITEM] });
    map.renderedFeatures = [
      {
        layer: { id: "engagement-points" },
        properties: { itemId: "item-1" },
        geometry: { type: "Point", coordinates: [-121.05, 39.2] },
      },
    ];

    act(() => map.tap());

    const detail = screen.getByTestId("portal-feed-detail");
    expect(detail.textContent).toContain("Cars turn without looking.");
    const support = screen.getByRole("button", { name: /support/i });
    expect(support.textContent).toContain("3");
    const draft = map.sourceData("engagement-draw") as { features: unknown[] };
    expect(draft.features).toHaveLength(0);
    expect(screen.queryByTestId("portal-location-status")).not.toBeInTheDocument();
  });

  it("still marks the resident's place when the tap lands on empty map", async () => {
    const { map } = await renderWithLoadedMap({ items: [PIN_ITEM] });
    map.renderedFeatures = [];

    act(() => map.tap());

    expect(screen.queryByTestId("portal-feed-detail")).not.toBeInTheDocument();
    expect(screen.getByTestId("portal-location-status")).toBeInTheDocument();
  });

  it("zooms into a group of pins instead of opening anything", async () => {
    const { map } = await renderWithLoadedMap({ items: [PIN_ITEM] });
    map.renderedFeatures = [
      {
        layer: { id: "engagement-clusters" },
        properties: { cluster_id: 7, point_count: 5 },
        geometry: { type: "Point", coordinates: [-121.05, 39.2] },
      },
    ];

    act(() => map.tap());

    expect(map.easeToCalls).toEqual([{ center: [-121.05, 39.2], zoom: 14 }]);
    expect(screen.queryByTestId("portal-feed-detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("portal-location-status")).not.toBeInTheDocument();
  });

  it("draws a submitted shape as its own source, with the shape a resident sent", async () => {
    const { map } = await renderWithLoadedMap({ items: [SHAPE_ITEM] });

    expect(map.sourceIds()).toContain("engagement-shapes");
    expect(map.layerIds()).toEqual(expect.arrayContaining(["engagement-shapes-line"]));

    const data = map.sourceData("engagement-shapes") as {
      features: { geometry: { type: string; coordinates: unknown } }[];
    };
    expect(data.features).toHaveLength(1);
    expect(data.features[0].geometry).toEqual(SHAPE_ITEM.geometry);
    // A shape is not a point: the clustered pin source is for point comments only.
    expect((map.sourceData("engagement-points") as { features: unknown[] }).features).toHaveLength(0);
  });
});

describe("where the camera opens", () => {
  it("fits the map to what people submitted when nothing else framed the campaign", async () => {
    const { map } = await renderWithLoadedMap({ items: [PIN_ITEM, SHAPE_ITEM] });

    expect(map.fitBoundsCalls).toHaveLength(1);
    const extended = map.fitBoundsCalls[0].bounds.positions;
    expect(extended).toContainEqual([-121.05, 39.2]);
    expect(extended).toContainEqual([-121.06, 39.21]);
  });

  it("leaves the camera where the agency framed it, even with pins two towns over", async () => {
    /*
      An agency that said "this consultation is about these six blocks" must not
      have its map yanked to a pin somebody dropped elsewhere. The campaign's
      own area outranks the extent of what has been submitted.
    */
    const framed = resolvePortalMapFraming({
      campaignPlace: {
        state: "set",
        label: "Jefferson Street",
        bbox: { minLon: -121.1, minLat: 39.1, maxLon: -121.0, maxLat: 39.3 },
      },
    });
    const { map } = await renderWithLoadedMap({ mapFraming: framed, items: [PIN_ITEM] });

    expect(map.fitBoundsCalls).toHaveLength(0);
    expect(map.options.center).toEqual(framed.view?.center);
    expect(map.options.zoom).toBe(framed.view?.zoom);
  });
});

describe("the background a resident chooses", () => {
  it("opens on the configured default, not on whichever background is listed first", async () => {
    const { map } = await renderWithLoadedMap();
    expect(map.options.style).toBe(styleUrlFor("satellite"));
    expect(map.options.style).not.toBe(styleUrlFor("streets"));
  });

  it("swaps the LIVE map when the resident picks another background, and repaints what was on it", async () => {
    /*
      THE CONTROL THAT DID NOTHING. `appliedStyleRef` was declared in the paint
      effect and only ever assigned inside its own `styleChanged` branch, so it
      stayed null, the branch was never entered, and `setStyle` was never
      called. The radio moved, an sr-only readout agreed with it, and the map
      underneath never changed — a test-visible field confirming a swap that had
      not happened.
    */
    const { map } = await renderWithLoadedMap({ items: [PIN_ITEM], contextLayers: CONTEXT_LAYERS });
    expect(map.setStyleCalls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /map background/i }));
    act(() => {
      fireEvent.click(basemapRadio("streets"));
    });

    expect(map.setStyleCalls).toEqual([styleUrlFor("streets")]);

    // A swap wipes Mapbox's registry. Everything has to come back, or a
    // background toggle silently empties the map of the thing it is about.
    expect(map.layerIds()).not.toContain(contextLayerPaintIds("layer-1").line);
    act(() => map.loadStyle());
    expect(map.layerIds()).toContain(contextLayerPaintIds("layer-1").line);
    expect((map.sourceData("engagement-points") as { features: unknown[] }).features).toHaveLength(1);
  });
});

describe("when the map does not come", () => {
  it("says so, in the resident's own words, when no background ever loaded", async () => {
    const { PublicMapShell } = await import("@/components/engagement/public-map-shell");
    render(<PublicMapShell {...shellProps()} />);
    const map = lastFakeMap();

    expect(screen.queryByTestId("portal-map-stage-unavailable")).not.toBeInTheDocument();
    act(() => map.failStyle());

    // Mapbox reports a revoked, URL-restricted or wrong-scope token as an EVENT
    // and never by throwing, so without this the resident gets a grey rectangle
    // inviting them to tap it, forever.
    expect(screen.getByTestId("portal-map-stage-unavailable")).toBeInTheDocument();
    expect(screen.getByText(EN_MESSAGES.messages["portal.mapMissingTitle"])).toBeInTheDocument();
  });

  it("treats a failed tile on a working map as the hiccup it is", async () => {
    const { map } = await renderWithLoadedMap();
    act(() => map.failStyle("Failed to fetch tile"));

    expect(screen.queryByTestId("portal-map-stage-unavailable")).not.toBeInTheDocument();
    // And it does not blame — or disable — the background the resident is
    // currently looking at.
    fireEvent.click(screen.getByRole("button", { name: /map background/i }));
    expect(basemapRadio("satellite")).not.toBeDisabled();
  });

  it("keeps the working map when a SWAP fails, and marks only the background that failed", async () => {
    const { map } = await renderWithLoadedMap();

    fireEvent.click(screen.getByRole("button", { name: /map background/i }));
    act(() => {
      fireEvent.click(basemapRadio("streets"));
    });
    act(() => map.failStyle());

    // Something has drawn before, so the resident still has a usable map.
    expect(screen.queryByTestId("portal-map-stage-unavailable")).not.toBeInTheDocument();
    expect(basemapRadio("streets")).toBeDisabled();
    expect(basemapRadio("satellite")).not.toBeDisabled();
  });
});
