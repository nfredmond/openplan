/**
 * THE CRASH MAP: ITS LAYERS SURVIVE A BACKGROUND SWITCH, AND ITS POPUP IS
 * READABLE IN THE DARK.
 *
 * ═══ THE TWO DEFECTS THIS FILE PINS ═══
 *
 * 1. THE POPUP NOBODY COULD READ IN DARK MODE. The collision popup was built
 *    with `setHTML` and one inline style — `font-size:12px;line-height:1.4` —
 *    and no colour and no background. Mapbox's own stylesheet paints
 *    `.mapboxgl-popup-content` white and lets the text colour INHERIT from the
 *    page. Measured in Chrome on this page on 2026-08-13: in a dark palette the
 *    popup's text computed to rgb(240,237,230) on rgb(255,255,255) — a contrast
 *    ratio of about 1.1:1, which is to say invisible — while the same markup in
 *    a light palette was fine. That is exactly the report: "hard to read in dark
 *    mode and fine in light".
 *
 *    WHY `surface-text-stays-legible.test.ts` COULD NOT SEE IT, confirmed by
 *    reading it: that guard parses `globals.css` for the cartographic palettes
 *    and measures `--muted` and `--ink` composited over `--panel`. It never
 *    renders a component, and a Mapbox popup is not a React child anyway — it is
 *    a node Mapbox appends to the map container, wearing the LIBRARY's
 *    stylesheet, which no palette arithmetic in this repo was looking at. The
 *    extension is in `safety-map-first-popup-legibility.test.ts`: the popup's
 *    real background (`--panel-solid`, from the themed popup family) measured
 *    against the ink colours in every palette, plus a ratchet over every
 *    component that builds a `mapboxgl.Popup`.
 *
 * 2. THE LAYERS THAT WOULD HAVE VANISHED ON THE FIRST BACKGROUND SWITCH. The
 *    map registered its source and layers on `load`, which fires once. A style
 *    swap throws away every source and layer the app added, so the moment the
 *    new background picker was added, switching to satellite would have wiped
 *    the crashes with nothing on screen saying so. They are registered on
 *    `style.load` now, which fires for the first style and for every one after.
 *
 * ═══ WHAT THIS FILE CANNOT PROVE ═══
 *
 * jsdom applies no stylesheet, has no box model and runs no WebGL, and the
 * Mapbox fake renders nothing and validates no style URL. Nothing here is
 * evidence that the popup is legible ON SCREEN — that was measured in a real
 * browser, and the numbers are in the header above. What is proved here is
 * OpenPlan's side of the boundary: which layers exist after which lifecycle
 * event, and what the popup node actually contains.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePublicBasemapConfig } from "@/lib/cartographic/basemaps";
import type { SafetyCrashCollection } from "@/lib/safety/client-types";
import { lastFakeMap, resetFakeMaps } from "@/test/helpers/mapbox-gl-fake";

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const BASEMAPS = resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} });

function styleUrlFor(id: string): string {
  const choice = BASEMAPS.choices.find((entry) => entry.id === id);
  if (!choice) throw new Error(`the test's own basemap fixture has no ${id}`);
  return choice.styleUrl;
}

/** One fatal collision, in the shape the query route really returns. */
const COLLECTION: SafetyCrashCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-83.0, 39.96] },
      properties: {
        id: "crash-1",
        externalId: "EXT-1",
        sourceId: "fars-us",
        severity: "fatal",
        collisionDate: "2024-03-04",
        collisionYear: 2024,
        killedCount: 1,
        injuredCount: null,
        pedestrianInvolved: true,
        bicyclistInvolved: false,
        motorcyclistInvolved: false,
      },
    },
  ],
} as unknown as SafetyCrashCollection;

async function renderMap(styleUrl: string) {
  const { SafetyCrashMap } = await import("@/components/safety/safety-crash-map");
  const view = render(
    <SafetyCrashMap collection={COLLECTION} bbox={null} styleUrl={styleUrl} onSelect={() => {}} />
  );
  const map = lastFakeMap();
  act(() => map.loadStyle());
  return { view, map };
}

beforeEach(() => {
  vi.resetModules();
  resetFakeMaps();
  // Read at module scope by the component, so it has to be stubbed BEFORE the
  // dynamic import above — this is why every render here goes through one.
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-crash-map");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  resetFakeMaps();
});

describe("the crash layers and a background switch", () => {
  it("draws the crashes once the style is up", async () => {
    const { map } = await renderMap(styleUrlFor("streets"));

    expect(map.options.style).toBe(styleUrlFor("streets"));
    expect(map.sourceIds()).toContain("safety-crashes");
    expect(map.layerIds()).toEqual(
      expect.arrayContaining(["safety-crash-halo", "safety-crash-core"])
    );
    expect(map.sourceData("safety-crashes")).toEqual(COLLECTION);
  });

  it("PUTS THE CRASHES BACK after the background changes", async () => {
    const { view, map } = await renderMap(styleUrlFor("streets"));
    const { SafetyCrashMap } = await import("@/components/safety/safety-crash-map");

    view.rerender(
      <SafetyCrashMap
        collection={COLLECTION}
        bbox={null}
        styleUrl={styleUrlFor("satellite")}
        onSelect={() => {}}
      />
    );

    // The swap really did discard them — the fake wipes its registry the way a
    // real style load does. Without this assertion the next one could pass on a
    // map that never switched style at all.
    expect(map.setStyleCalls).toEqual([styleUrlFor("satellite")]);
    expect(map.layerIds()).toEqual([]);
    expect(map.sourceIds()).toEqual([]);

    act(() => map.loadStyle());

    expect(map.sourceIds()).toContain("safety-crashes");
    expect(map.layerIds()).toEqual(
      expect.arrayContaining(["safety-crash-halo", "safety-crash-core"])
    );
    // And with the crashes that are on screen NOW, not the ones that were on
    // screen when the map was built.
    expect(map.sourceData("safety-crashes")).toEqual(COLLECTION);
  });

  it("does not throw the style away when nothing about it changed", async () => {
    const { view, map } = await renderMap(styleUrlFor("streets"));
    const { SafetyCrashMap } = await import("@/components/safety/safety-crash-map");

    view.rerender(
      <SafetyCrashMap
        collection={COLLECTION}
        bbox={null}
        styleUrl={styleUrlFor("streets")}
        onSelect={() => {}}
      />
    );

    expect(map.setStyleCalls).toEqual([]);
    expect(map.layerIds()).toEqual(
      expect.arrayContaining(["safety-crash-halo", "safety-crash-core"])
    );
  });
});

describe("the collision popup", () => {
  async function hoverACrash() {
    const { map } = await renderMap(styleUrlFor("streets"));
    act(() =>
      map.emitOnLayer("mouseenter", "safety-crash-core", {
        lngLat: [-83, 39.96],
        features: [{ properties: COLLECTION.features[0].properties }],
      })
    );
    const popup = map.openPopups.at(-1);
    if (!popup) throw new Error("hovering a collision opened no popup at all");
    return popup;
  }

  it("wears OpenPlan's themed popup family instead of the library's default chrome", async () => {
    const popup = await hoverACrash();
    const root = popup.content;

    // `.op-map-popup` is the hook `cartographic.css` styles by `:has()` —
    // `--panel-solid` behind the card and `--ink` in front of it, in every
    // palette. Without this class the popup renders on Mapbox's white card with
    // the page's inherited text colour, which is the dark-mode defect.
    expect(root?.className).toContain("op-map-popup");
    expect(root?.querySelector(".op-map-popup__title")).not.toBeNull();
    expect(root?.querySelector(".op-map-popup__line")).not.toBeNull();
  });

  it("still says everything it said before, and never a fabricated zero", async () => {
    const popup = await hoverACrash();
    const text = popup.content?.textContent ?? "";

    expect(text).toContain("Fatal");
    expect(text).toContain("2024-03-04");
    // `injuredCount` is null on this record. "0 injured" would be an invented
    // count, and the shared casualty helper is what stops it.
    expect(text).not.toMatch(/\b0 (people )?injured/i);
    expect(text.toLowerCase()).toContain("not reported");
    expect(text).toContain("pedestrian");
  });

  it("is built as DOM, so nothing in a source record can be parsed as markup", async () => {
    const { map } = await renderMap(styleUrlFor("streets"));
    act(() =>
      map.emitOnLayer("mouseenter", "safety-crash-core", {
        lngLat: [-83, 39.96],
        features: [
          {
            properties: {
              ...COLLECTION.features[0].properties,
              collisionDate: "<img src=x onerror=alert(1)>",
            },
          },
        ],
      })
    );
    const root = map.openPopups.at(-1)?.content;

    expect(root?.querySelector("img")).toBeNull();
    expect(root?.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
