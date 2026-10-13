import type mapboxgl from "mapbox-gl";

import { resolveOpenMapStyleUrl } from "@/lib/cartographic/open-map-style";
import { hasInvalidPublicMapboxToken, resolvePublicMapboxToken } from "@/lib/mapbox/public-token";

/**
 * WHICH LIBRARY DRAWS A MAP ON THIS DEPLOYMENT.
 *
 * Taken from the public engagement map (`public-map-stage.tsx`), which was the
 * only map that could draw without a Mapbox key. Shared here so the staff maps
 * make the same choice in the same order:
 *
 *   1. Mapbox, when a public `pk.` token is set. A secret `sk.` token is never
 *      sent to the browser.
 *   2. MapLibre, when the operator names a style in
 *      `NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL` (see `open-map-style.ts` and
 *      docs/SELF_HOSTING.md).
 *   3. No engine. The caller shows `MapUnavailableNotice` instead of a blank box.
 */
export type MapEngine =
  | { kind: "mapbox"; token: string }
  | { kind: "maplibre"; styleUrl: string }
  | { kind: "none"; unusableToken: boolean };

export type MapEngineSettings = {
  mapboxAccessToken?: string | null;
  legacyMapboxToken?: string | null;
  openStyleUrl?: string | null;
};

/**
 * The library both engines are called through. MapLibre is typed as Mapbox's
 * module: callers use only the API the two share (Map, controls, Popup, Marker,
 * LngLatBounds, sources and layers).
 */
export type MapLibrary = typeof mapboxgl;

export function chooseMapEngine(settings: MapEngineSettings): MapEngine {
  const token = resolvePublicMapboxToken(settings.mapboxAccessToken, settings.legacyMapboxToken);
  if (token) return { kind: "mapbox", token };
  const styleUrl = resolveOpenMapStyleUrl(settings.openStyleUrl);
  if (styleUrl) return { kind: "maplibre", styleUrl };
  return {
    kind: "none",
    unusableToken: hasInvalidPublicMapboxToken(settings.mapboxAccessToken, settings.legacyMapboxToken),
  };
}

/**
 * This build's engine. Each `NEXT_PUBLIC_*` name is spelled out in full because
 * Next.js inlines them at build time, so the answer cannot change while a page
 * is open. Components read it once, at module scope.
 */
export function deploymentMapEngine(): MapEngine {
  return chooseMapEngine({
    mapboxAccessToken: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
    legacyMapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    openStyleUrl: process.env.NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL,
  });
}

/**
 * The style to hand the engine. Mapbox gets the caller's `mapbox://` style;
 * MapLibre cannot load those and always gets the operator's style.
 */
export function styleForEngine(engine: MapEngine, mapboxStyleUrl: string): string | null {
  if (engine.kind === "maplibre") return engine.styleUrl;
  if (engine.kind === "mapbox") return mapboxStyleUrl || null;
  return null;
}

/**
 * MapLibre, loaded only on a deployment that uses it, with the `pmtiles://`
 * protocol registered once so a style can point at a local `.pmtiles` file.
 */
let mapLibreLoad: Promise<MapLibrary> | null = null;
export function loadMapLibre(): Promise<MapLibrary> {
  mapLibreLoad ??= Promise.all([import("maplibre-gl"), import("pmtiles")]).then(([maplibre, pmtiles]) => {
    // The bundler may hand the module over as its namespace or under `default`.
    const loaded = maplibre as unknown as { default?: unknown };
    const gl = (loaded.default ?? maplibre) as unknown as MapLibrary & {
      addProtocol: (name: string, load: unknown) => void;
      setWorkerUrl: (url: string) => void;
    };
    // MapLibre finds its tile worker beside its own file, which a bundle moves.
    // The bundler emits the worker as a file and hands back where it put it.
    gl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
    gl.addProtocol("pmtiles", new pmtiles.Protocol().tile);
    return gl;
  });
  // A failed chunk load must not stick: the next map on the page may try again.
  mapLibreLoad.catch(() => {
    mapLibreLoad = null;
  });
  return mapLibreLoad;
}

/**
 * Build a map with whichever engine this deployment has, and say so if it
 * cannot start.
 *
 * Mapbox is built synchronously, as every caller always did. MapLibre is
 * fetched first and then built the same way. `build` constructs the map and
 * returns its teardown.
 *
 * A construction failure goes to `onCannotStart` instead of the error boundary.
 * Both libraries throw from `new Map()` when the browser has no usable WebGL
 * (MapLibre 5 needs WebGL2), and a notice that says so is better than a broken
 * map or a crashed page. So does a MapLibre chunk that never arrives.
 *
 * Returns the teardown for the effect that called it.
 */
export function startMap(
  engine: MapEngine,
  mapbox: MapLibrary,
  build: (gl: MapLibrary) => () => void,
  onCannotStart: (error: unknown) => void,
): () => void {
  if (engine.kind === "none") return () => undefined;

  const attempt = (gl: MapLibrary): (() => void) | null => {
    try {
      return build(gl);
    } catch (error) {
      console.error("[map] the map could not start", error);
      onCannotStart(error);
      return null;
    }
  };

  if (engine.kind === "mapbox") {
    mapbox.accessToken = engine.token;
    const stop = attempt(mapbox);
    return () => stop?.();
  }

  let cancelled = false;
  let stop: (() => void) | null = null;
  loadMapLibre().then(
    (gl) => {
      if (cancelled) return;
      stop = attempt(gl);
    },
    (error) => {
      if (cancelled) return;
      console.error("[map] MapLibre could not load", error);
      onCannotStart(error);
    },
  );
  return () => {
    cancelled = true;
    stop?.();
  };
}

/**
 * Fonts for a text layer drawn on top of the basemap.
 *
 * Mapbox serves its own. An operator's style serves only the fonts its own
 * labels use, so borrow those; a style with no glyphs at all gets null, and the
 * caller leaves the text layer off rather than adding one that fails.
 */
export function labelFontsFor(
  engine: MapEngine,
  map: Pick<mapboxgl.Map, "getStyle">,
  mapboxFonts: string[],
): string[] | null {
  // Only MapLibre draws an operator's style; a map that exists otherwise is Mapbox.
  if (engine.kind !== "maplibre") return mapboxFonts;
  const style = map.getStyle() as { glyphs?: string; layers?: Array<{ layout?: Record<string, unknown> }> } | undefined;
  if (!style?.glyphs) return null;
  for (const layer of style.layers ?? []) {
    const font = layer.layout?.["text-font"];
    if (Array.isArray(font) && font.length > 0 && font.every((name) => typeof name === "string")) return font;
  }
  return ["Noto Sans Regular"];
}
