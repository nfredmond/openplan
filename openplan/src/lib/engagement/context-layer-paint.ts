/**
 * Drawing operator context layers onto a participant map.
 *
 * WHY THIS IS SHARED RATHER THAN INLINED. Three engagement maps need the same
 * thing — the map a resident draws on, the map that displays what everyone
 * submitted, and the operator's own point picker — and every one of them
 * previously registered exactly ONE geojson source in its `load` handler.
 * Multi-source registration that survives a style swap is the part that is
 * genuinely fiddly, and `cartographic-map-backdrop.tsx` already solved it for
 * the operator-side map: add-or-setData per source, guard every `addLayer` with
 * `getLayer`, and re-run the whole paint on `style.load` because `setStyle()`
 * wipes the source and layer registry. This module is that pattern, generalized
 * over a LIST of layers whose membership changes, so the three engagement maps
 * inherit it instead of each growing their own.
 *
 * ORDERING. Context is context: it goes UNDER the resident's own sketch and
 * under the community's submitted pins, or the thing the map exists to collect
 * disappears beneath the basemap the operator uploaded. Callers pass `beforeId`.
 *
 * NO MAPBOX AT RUNTIME. The functions take a structural target, so the whole
 * registration path is exercised in tests against a recording double. That
 * matters more than usual: this repo's recurring defect is a capability that is
 * complete and untested at the seam where it becomes visible, and "did a source
 * and a paint layer actually get registered for this layer" is exactly that
 * seam. The one Mapbox import is TYPE-ONLY and is erased in the build; it is
 * here because a hand-written layer-spec type would have to be looser than
 * Mapbox's own, and a looser one lets a malformed paint expression compile.
 */

import type { AnyLayer } from "mapbox-gl";

import type { ParticipantContextLayer } from "./context-layers";

/**
 * The subset of a Mapbox map this module touches.
 *
 * Written with method shorthand deliberately: TypeScript compares method
 * parameters bivariantly, which is what lets a real `mapboxgl.Map` satisfy this
 * narrower shape without a cast at any call site. Keep `data` typed as GeoJSON
 * rather than `unknown` for the same reason — `unknown` is assignable in neither
 * direction, and the whole structural match fails on it.
 */
export type ContextLayerMapTarget = {
  getSource(id: string): unknown;
  addSource(id: string, source: { type: "geojson"; data: GeoJSON.GeoJSON }): void;
  removeSource(id: string): void;
  getLayer(id: string): unknown;
  addLayer(layer: AnyLayer, beforeId?: string): void;
  removeLayer(id: string): void;
  getStyle(): { layers?: Array<{ id: string }> } | undefined;
};

/** Namespaced so a sync can find and retire only the sources it owns. */
export const CONTEXT_LAYER_SOURCE_PREFIX = "engagement-context-";

export function contextLayerSourceId(layerId: string): string {
  return `${CONTEXT_LAYER_SOURCE_PREFIX}${layerId}`;
}

export function contextLayerPaintIds(layerId: string): {
  fill: string;
  outline: string;
  line: string;
  point: string;
} {
  const source = contextLayerSourceId(layerId);
  return {
    fill: `${source}-fill`,
    outline: `${source}-outline`,
    line: `${source}-line`,
    point: `${source}-point`,
  };
}

/** The suffix `contextLayerPaintIds` appends, so a paint id can name its source. */
const PAINT_SUFFIX = /-(fill|outline|line|point)$/;

/** Only a #RRGGBB literal reaches a paint expression. */
const FALLBACK_COLOR = "#94a3b8";
function safeColor(value: string | null | undefined): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : FALLBACK_COLOR;
}

/**
 * Register (or refresh) every context layer, and retire any this map still
 * carries that the current list no longer contains.
 *
 * Idempotent by construction: safe to call on data change, on `style.load`, and
 * on both in the same frame.
 */
export function syncContextLayers(
  map: ContextLayerMapTarget,
  layers: ParticipantContextLayer[],
  options: { beforeId?: string } = {}
): void {
  const wanted = new Set(layers.map((layer) => contextLayerSourceId(layer.id)));

  // Retire first, so a layer that was removed and re-added in one update does
  // not lose its fresh registration to the sweep.
  //
  // THE TWO PASSES ARE THE POINT. A polygon layer registers a fill AND an
  // outline against one source, so removing the source the moment its first
  // paint layer goes leaves the second one referencing a source that no longer
  // exists. Mapbox 3.x reports that as an ErrorEvent rather than by throwing, so
  // the loop appeared to self-correct while spraying "source is in use" into the
  // console of a resident's browser. Sources are dropped only after every paint
  // layer that named them is gone.
  const existing = map.getStyle()?.layers ?? [];
  const retiredSources = new Set<string>();

  for (const styleLayer of existing) {
    if (!styleLayer.id.startsWith(CONTEXT_LAYER_SOURCE_PREFIX)) continue;
    // Derived from the paint suffix rather than by prefix-matching the wanted
    // set: a `startsWith` test would also keep a layer whose source id merely
    // begins with a wanted one.
    const sourceId = styleLayer.id.replace(PAINT_SUFFIX, "");
    if (wanted.has(sourceId)) continue;
    map.removeLayer(styleLayer.id);
    retiredSources.add(sourceId);
  }

  for (const sourceId of retiredSources) {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }

  for (const layer of layers) {
    const sourceId = contextLayerSourceId(layer.id);
    const paintIds = contextLayerPaintIds(layer.id);
    const color = safeColor(layer.color);

    const source = map.getSource(sourceId) as { setData?: (data: unknown) => void } | undefined;
    if (!source) {
      map.addSource(sourceId, { type: "geojson", data: layer.featureCollection });
    } else if (typeof source.setData === "function") {
      source.setData(layer.featureCollection);
    }

    const kinds = new Set(layer.geometryKinds);

    if (kinds.has("Polygon") && !map.getLayer(paintIds.fill)) {
      map.addLayer(
        {
          id: paintIds.fill,
          type: "fill",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": color, "fill-opacity": 0.18 },
        },
        options.beforeId
      );
    }

    if (kinds.has("Polygon") && !map.getLayer(paintIds.outline)) {
      map.addLayer(
        {
          id: paintIds.outline,
          type: "line",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "line-color": color, "line-width": 1.5, "line-opacity": 0.9 },
        },
        options.beforeId
      );
    }

    if (kinds.has("LineString") && !map.getLayer(paintIds.line)) {
      map.addLayer(
        {
          id: paintIds.line,
          type: "line",
          source: sourceId,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": color, "line-width": 3, "line-opacity": 0.9 },
        },
        options.beforeId
      );
    }

    if (kinds.has("Point") && !map.getLayer(paintIds.point)) {
      map.addLayer(
        {
          id: paintIds.point,
          type: "circle",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 4,
            "circle-color": color,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 1,
          },
        },
        options.beforeId
      );
    }
  }
}
