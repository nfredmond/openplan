/**
 * THE OTHER DRAWING MAP SPOKE ENGLISH, IN A SURVEYOR'S VOCABULARY.
 *
 * `/engage/<token>` renders the new translated rail. `/engage/<token>/about` and
 * `/embed/<token>` render the OLD `PublicEngagementPortal`, which mounts
 * `GeometryPickerMap` — and every sentence that component produced was an
 * English literal: "Click the map or press Enter to drop a pin at the
 * crosshair", "2 vertices · line ready (keep adding to extend)", "Vertex limit
 * reached". Three defects in one string: English on a page declaring Spanish, a
 * mouse verb on a surface most people reach by phone, and "vertex" — a word for
 * the corner of a shape that nobody outside a GIS office uses.
 *
 * WHY THE ENGLISH STILL LIVES IN THE COMPONENT, and why that needs a test. The
 * operator console mounts the same picker where no portal locale exists, and
 * importing the catalog into that client component would ship all 22 locales to
 * a resident's phone to render one. So there are two copies of the same English,
 * and the FIRST test below is the only thing stopping them drifting: an edit to
 * the catalog that is not mirrored in `EN_GEOMETRY_PICKER_WORDS` gives an
 * English reader and a Spanish reader two different products.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom applies no stylesheet, has no box model and
 * does not run Mapbox GL — the map itself is a double. Nothing here is evidence
 * that any of this is visible, legible, or reachable by thumb on a 390px screen.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GeometryPickerWords } from "@/components/engagement/geometry-picker-map";
import { buildGeometryPickerWords } from "@/lib/engagement/portal-i18n/drawing-map-words";
import { resolvePortalLocale } from "@/lib/engagement/portal-i18n/locales";
import { buildPortalMessageBundle } from "@/lib/engagement/portal-i18n/messages";
import { createPortalTranslator } from "@/lib/engagement/portal-i18n/translator";

vi.mock("mapbox-gl", () => {
  class MockMap {
    keyboard = { disable: vi.fn() };
    addControl = vi.fn();
    on = vi.fn();
    once = vi.fn();
    remove = vi.fn();
    resize = vi.fn();
    getCanvas = vi.fn(() => ({ setAttribute: vi.fn(), style: {} }));
    getCenter = vi.fn(() => ({ lng: 0, lat: 0 }));
    getSource = vi.fn(() => undefined);
    getLayer = vi.fn(() => undefined);
    addSource = vi.fn();
    addLayer = vi.fn();
    isStyleLoaded = vi.fn(() => false);
    project = vi.fn(() => ({ x: 0, y: 0 }));
    panBy = vi.fn();
    zoomIn = vi.fn();
    zoomOut = vi.fn();
  }
  return {
    default: { Map: MockMap, NavigationControl: class {}, accessToken: "" },
    Map: MockMap,
    NavigationControl: class {},
  };
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const translatorFor = (locale: string) =>
  createPortalTranslator(buildPortalMessageBundle(resolvePortalLocale({ requested: locale })));

/**
 * The picker reads its Mapbox token at MODULE scope, so the token has to exist
 * before the import. Without one it renders the no-map branch and every
 * assertion below would be about a component that never drew anything — a
 * green-either-way suite.
 */
let GeometryPickerMap: typeof import("@/components/engagement/geometry-picker-map").GeometryPickerMap;
let EN_GEOMETRY_PICKER_WORDS: GeometryPickerWords;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token");
  const mod = await import("@/components/engagement/geometry-picker-map");
  GeometryPickerMap = mod.GeometryPickerMap;
  EN_GEOMETRY_PICKER_WORDS = mod.EN_GEOMETRY_PICKER_WORDS;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the drawing map's words", () => {
  /**
   * THE ANTI-DRIFT TEST. Two copies of the same English exist for a stated
   * reason; this makes disagreeing between them a failure rather than a
   * discovery.
   */
  it("says the same thing in the component's defaults as in the English catalog", () => {
    const fromCatalog = buildGeometryPickerWords(translatorFor("en"));

    for (const [key, value] of Object.entries(EN_GEOMETRY_PICKER_WORDS)) {
      const other = fromCatalog[key as keyof typeof fromCatalog];
      if (typeof value === "function") {
        expect(typeof other, key).toBe("function");
        expect((other as (n: string) => string)("7"), key).toBe(value("7"));
      } else {
        expect(other, key).toBe(value);
      }
    }
  });

  it("uses no term of art a resident would have to look up", () => {
    const everyEnglishSentence = Object.values(EN_GEOMETRY_PICKER_WORDS)
      .map((value) => (typeof value === "function" ? value("3") : value))
      .join(" ")
      .toLowerCase();

    // Each of these was in the component's copy before 2026-08-13.
    for (const word of ["vertex", "vertices", "crosshair", "basemap", "geometry", "polygon"]) {
      expect(everyEnglishSentence, `"${word}" is back in the drawing map's copy`).not.toContain(word);
    }
  });

  it("renders the words it is handed, in the language it is told they are in", () => {
    const words = buildGeometryPickerWords(translatorFor("es"));
    const { container } = render(
      <GeometryPickerMap onGeometryChange={() => {}} words={words} lang="es" />
    );

    // The starting hint under the map, and the mode buttons above it.
    expect(screen.getByText(words.hintPoint)).toBeTruthy();
    expect(screen.getByRole("button", { name: words.modePoint })).toBeTruthy();
    expect(screen.getByRole("button", { name: words.modeArea })).toBeTruthy();
    expect(screen.getByRole("group", { name: words.modeGroupLabel })).toBeTruthy();

    // And the element carrying them declares the language they are written in —
    // without this a screen reader pronounces Spanish with English phonology.
    expect(container.querySelector('[lang="es"]')).not.toBeNull();

    // Nothing English left behind by a half-done replacement.
    expect(container.textContent).not.toContain("Click the map");
    expect(container.textContent).not.toContain("Undo vertex");
  });

  it("still speaks English for the operator console, which passes no words", () => {
    render(<GeometryPickerMap onGeometryChange={() => {}} />);
    expect(screen.getByText(EN_GEOMETRY_PICKER_WORDS.hintPoint)).toBeTruthy();
  });
});
