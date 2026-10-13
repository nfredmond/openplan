import type mapboxgl from "mapbox-gl";

type StyleEvents = "load" | "styledata" | "idle";

/** The three calls this helper makes, so a plain object can stand in for a map. */
export type StyleAcceptingMap = {
  isStyleLoaded(): boolean;
  on(type: StyleEvents, listener: () => void): unknown;
  off(type: StyleEvents, listener: () => void): unknown;
};

/**
 * Run `paint` as soon as the map's style can take sources and layers.
 *
 * ═══ THE RACE THIS REPLACES ═══
 *
 * Twelve call sites painted at once when `isStyleLoaded()` was true and
 * otherwise waited for one `style.load` with `once`. `style.load` fires once per style, early, and `isStyleLoaded()` keeps
 * answering false for a while after it while tiles and sprites stream in. Data
 * that arrived inside that window waited for an event that had already fired,
 * and the layer never drew for the life of the page. Measured on /safety on
 * 2026-08-13: 2 of 5 loads never added the source
 * (`use-workspace-gis-map-binding.ts`, where the first fix landed).
 *
 * So this re-checks on the map's own `load`, on every `styledata` while the
 * style settles, and on `idle` as the backstop for a style that stops emitting
 * `styledata` before it reports loaded. The first check that passes paints, and
 * all three listeners come off.
 *
 * Returns a cancel function. Return it from the effect, so a map torn down or a
 * newer paint does not leave an old closure waiting.
 *
 * It does not repaint after a later `setStyle`: a caller that swaps styles must
 * listen for `style.load` with `on`, as the Safety crash map does.
 */
export function whenStyleAccepts(map: StyleAcceptingMap | mapboxgl.Map, paint: () => void): () => void {
  const target = map as StyleAcceptingMap;
  if (target.isStyleLoaded()) {
    paint();
    return () => undefined;
  }

  let settled = false;
  const detach = () => {
    target.off("load", check);
    target.off("styledata", check);
    target.off("idle", check);
  };
  function check() {
    if (settled || !target.isStyleLoaded()) return;
    settled = true;
    detach();
    paint();
  }

  target.on("load", check);
  target.on("styledata", check);
  target.on("idle", check);
  return () => {
    if (settled) return;
    settled = true;
    detach();
  };
}
