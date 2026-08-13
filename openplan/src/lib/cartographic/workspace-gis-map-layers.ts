/**
 * How a workspace's uploaded GIS layers are DRAWN on a Mapbox map — once, for
 * every map in the product.
 *
 * ═══ WHY THIS IS A MODULE AND NOT A FUNCTION INSIDE THE BACKDROP ═══
 *
 * It was a function inside the backdrop until Corridor Analysis needed it. The
 * backdrop is the shell's map and suppresses itself on `/explore`, which owns
 * its own `mapboxgl.Map` — so the page a planner opens *in order to read a map*
 * was the one page that never drew the agency's own layers. The obvious repair
 * is to paint them in Explore too, and the obvious way to do that is to write a
 * second painter next to Explore's other layer installs.
 *
 * That is the failure this repository has recorded more than once: a shared
 * capability living inside one of its two callers gets reimplemented, slightly
 * wrong, by the other. The two would drift on the parts that matter least
 * visibly and most — the z-order that keeps a parcel fabric from eating every
 * click, the fill opacity that keeps a zoning layer from being an opaque sheet,
 * the label property lift that is the difference between labels and silence.
 *
 * So the paint moved here VERBATIM first, and only then gained the casing. Both
 * maps now draw a layer identically, and a fix to either is a fix to both.
 *
 * ═══ WHAT THIS MODULE IS NOT ═══
 *
 * It does not fetch, does not know about React, and does not decide WHICH
 * layers are on. It is given a catalog, the geometry read for the current
 * window, and the layer to sit beneath; it makes the map match. The fetching
 * and the viewport bookkeeping are `use-workspace-gis-map-binding.ts`.
 *
 * NOTHING HERE NAMES A PLACE, AN AGENCY, A JURISDICTION OR A DATA SOURCE.
 */

import type { AnyLayer } from "mapbox-gl";

import {
  WORKSPACE_GIS_CASING_COLOR,
  WORKSPACE_GIS_CASING_EXTRA_WIDTH,
} from "./workspace-gis-default-style";
import type {
  WorkspaceGisFeatureCollection,
  WorkspaceGisLayerListing,
} from "@/lib/workspace-gis/types";

/**
 * The part of a Mapbox map this module touches.
 *
 * Structural rather than `mapboxgl.Map` for one reason that is about evidence
 * rather than taste: a test that has to construct a real Mapbox map to check
 * the z-order cannot run in jsdom, and a test that casts a stub through `as
 * unknown as mapboxgl.Map` is asserting against a lie. This type is the honest
 * contract — these nine calls, nothing else — so a stub that satisfies it is a
 * real subject rather than a cast. A real `mapboxgl.Map` satisfies it too.
 */
export type WorkspaceGisMapTarget = {
  getSource(id: string): unknown;
  addSource(id: string, source: { type: "geojson"; data: GeoJSON.FeatureCollection }): unknown;
  getLayer(id: string): unknown;
  addLayer(layer: AnyLayer, before?: string): unknown;
  removeLayer(id: string): unknown;
  moveLayer(id: string, before?: string): unknown;
  setPaintProperty(layer: string, name: string, value: unknown): unknown;
  setLayoutProperty(layer: string, name: string, value: unknown): unknown;
};

// ── Ids ─────────────────────────────────────────────────────────────────────
//
// Unlike every built-in layer, these are not a fixed set: their ids are rows in
// `workspace_gis_layers`, so their Mapbox source and layer ids are DERIVED from
// the layer id rather than declared. One source per layer, and up to five
// drawing layers over it — fill, casing, line, circle, label — because one
// uploaded shapefile can legitimately hold polygons, lines and points at once
// and Mapbox needs a layer per geometry class.

export const workspaceGisSourceId = (layerId: string) => `cartographic-workspace-gis-${layerId}`;
export const workspaceGisFillLayerId = (layerId: string) => `${workspaceGisSourceId(layerId)}-fill`;
/**
 * The halo drawn UNDER the coloured line, in the theme's own background ink.
 *
 * A coloured line with no casing is unreadable over a busy basemap in one theme
 * or the other — vermilion vanishes into a warm parchment road, blue vanishes
 * into dark-v11 water. The halo separates the layer from whatever is beneath it
 * WITHOUT changing the layer's colour, which is what keeps the swatch in the
 * panel and the ink on the map the same colour. The crash layer already uses
 * this glow/core idiom, so this is the house pattern rather than a new
 * invention.
 */
export const workspaceGisCasingLayerId = (layerId: string) =>
  `${workspaceGisSourceId(layerId)}-casing`;
export const workspaceGisLineLayerId = (layerId: string) => `${workspaceGisSourceId(layerId)}-line`;
export const workspaceGisCircleLayerId = (layerId: string) =>
  `${workspaceGisSourceId(layerId)}-circle`;
export const workspaceGisLabelLayerId = (layerId: string) =>
  `${workspaceGisSourceId(layerId)}-label`;

/**
 * Every drawing layer one uploaded layer owns, BOTTOM TO TOP.
 *
 * The order is the z-order within a layer and it is not arbitrary: a polygon
 * fill under its own casing under its own outline under any points, so a layer
 * holding all three reads as one thing rather than as points buried under their
 * own fill. The label rides on top of its own geometry.
 *
 * EVERY LOOP THAT ACTS ON A LAYER READS THIS LIST — visibility, removal,
 * re-stacking. A drawing layer missing from here renders as an orphan the
 * toggle cannot switch off: a floating casing under a layer the planner
 * believes they hid.
 */
export function workspaceGisDrawingLayerIds(layerId: string): string[] {
  return [
    workspaceGisFillLayerId(layerId),
    workspaceGisCasingLayerId(layerId),
    workspaceGisLineLayerId(layerId),
    workspaceGisCircleLayerId(layerId),
    workspaceGisLabelLayerId(layerId),
  ];
}

/**
 * The clickable ones. A label is not a click target; the shape under it is.
 * Neither is the casing — it is 2px wider than the line it sits under, so
 * including it would make the click target subtly larger than the thing drawn.
 */
export function workspaceGisClickableLayerIds(layerId: string): string[] {
  return [
    workspaceGisFillLayerId(layerId),
    workspaceGisLineLayerId(layerId),
    workspaceGisCircleLayerId(layerId),
  ];
}

/** Round a viewport to four decimals (~11 m) so a one-pixel pan is not a refetch. */
export function viewportKeyFor(bbox: [number, number, number, number]): string {
  return bbox.map((value) => value.toFixed(4)).join(",");
}

/**
 * How much a layer dims while a DIFFERENT layer is being pointed at.
 *
 * Transient, never a mode: it lasts exactly as long as a pointer rests on a row
 * or a keyboard focus sits in it. A planner comparing a bike network against a
 * zoning fill needs to pick one out for a moment, and needs the other still
 * present enough to compare against — 0.35 is visible-but-receded rather than
 * gone. Built-in record layers are never dimmed by this: the workspace's own
 * projects and crashes are the subject, and dimming the subject to emphasise
 * the reference would invert what the map is about.
 */
const EMPHASIS_DIM_FACTOR = 0.35;
/** How much wider the emphasised layer draws while it is being pointed at. */
const EMPHASIS_WIDTH_FACTOR = 1.6;
/**
 * The fill is deliberately WEAKER than the planner's chosen opacity, which
 * governs the outline. A zoning layer at full opacity is an opaque sheet over
 * the basemap, and the streets underneath are how a planner knows where they
 * are.
 */
const FILL_OPACITY_FACTOR = 0.35;

export type WorkspaceGisPaintOptions = {
  /** The catalog, in the planner's own order. */
  layers: WorkspaceGisLayerListing[];
  /** One viewport read per layer id. A layer with no entry is simply not drawn. */
  collections: Record<string, WorkspaceGisFeatureCollection>;
  /**
   * The layer these all sit immediately BELOW, or undefined for "on top".
   *
   * Resolved by the CALLER because the answer differs per map and both answers
   * are load-bearing. See `workspaceGisAnchorLayerId` in the shell backdrop and
   * `exploreWorkspaceGisAnchorLayerId` in Explore — same doctrine (reference
   * under subject), different layer names.
   */
  anchorLayerId: string | undefined;
  /** Which casing ink to use. The basemap's theme, not the app chrome's. */
  theme: "light" | "dark";
};

/**
 * Make the map match the catalog: one source per layer, up to five layers over
 * it, stacked beneath `anchorLayerId`.
 *
 * ── WHY THE LABEL VALUE IS COPIED TO A TOP-LEVEL PROPERTY ──
 *
 * A feature's attributes arrive nested, as `properties.attributes`. Mapbox GL
 * feeds a GeoJSON source through its own vector-tile encoder, and that encoder
 * carries only SCALAR property values — a nested object survives as its JSON
 * text. So `["get", field, ["get", "attributes"]]` in a text-field expression
 * reads a string and yields nothing, silently: the layer draws, the labels
 * simply never appear, and no error is raised anywhere. The label value is
 * therefore lifted to a flat property here, where the failure would be a
 * visible wrong label rather than an invisible missing one. The nested object
 * is left in place for the inspector, which parses it back.
 */
export function paintWorkspaceGisLayers(
  map: WorkspaceGisMapTarget,
  { layers, collections, anchorLayerId, theme }: WorkspaceGisPaintOptions,
): void {
  const casingColor = WORKSPACE_GIS_CASING_COLOR[theme];

  /**
   * Bottom to top: polygons, then lines, then points — across ALL layers, not
   * within each — so a bike network drawn over a zoning fill stays visible
   * whatever order the layers were uploaded in. `sortOrder` then settles ties
   * within a geometry class, which is the only place a planner's own ordering
   * can change anything.
   */
  const ordered = [...layers].sort((left, right) => left.layer.sortOrder - right.layer.sortOrder);

  for (const listing of ordered) {
    const layer = listing.layer;
    const collection = collections[layer.id];
    if (!collection) continue;

    const sourceId = workspaceGisSourceId(layer.id);
    const labelField = layer.style.labelField;
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: collection.features.map((feature) => {
        const attributes = feature.properties.attributes ?? {};
        const labelValue = labelField ? attributes[labelField] : undefined;
        return {
          type: "Feature",
          // The feature index is the stable id within a version, and it is what
          // a selection's `featureRef` carries.
          id: feature.properties.featureIndex,
          geometry: feature.geometry as GeoJSON.Geometry,
          properties: {
            ...feature.properties,
            label: labelValue === null || labelValue === undefined ? "" : String(labelValue),
          },
        };
      }),
    };

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "geojson", data });
    } else {
      (map.getSource(sourceId) as { setData?: (value: GeoJSON.FeatureCollection) => void })?.setData?.(
        data,
      );
    }

    const color = layer.style.color;
    const opacity = layer.style.opacity;
    const lineWidth = layer.style.lineWidth;

    const fillLayerId = workspaceGisFillLayerId(layer.id);
    if (!map.getLayer(fillLayerId)) {
      map.addLayer(
        {
          id: fillLayerId,
          type: "fill",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": color, "fill-opacity": opacity * FILL_OPACITY_FACTOR },
        },
        anchorLayerId,
      );
    } else {
      map.setPaintProperty(fillLayerId, "fill-color", color);
      map.setPaintProperty(fillLayerId, "fill-opacity", opacity * FILL_OPACITY_FACTOR);
    }

    // The casing is added BEFORE the line and therefore sits under it. Both
    // carry the same filter, so a polygon's edge gets a halo exactly where its
    // outline is.
    const casingLayerId = workspaceGisCasingLayerId(layer.id);
    if (!map.getLayer(casingLayerId)) {
      map.addLayer(
        {
          id: casingLayerId,
          type: "line",
          source: sourceId,
          filter: ["match", ["geometry-type"], ["LineString", "Polygon"], true, false],
          paint: {
            "line-color": casingColor,
            "line-opacity": opacity,
            "line-width": lineWidth + WORKSPACE_GIS_CASING_EXTRA_WIDTH,
          },
        },
        anchorLayerId,
      );
    } else {
      map.setPaintProperty(casingLayerId, "line-color", casingColor);
      map.setPaintProperty(casingLayerId, "line-opacity", opacity);
      map.setPaintProperty(
        casingLayerId,
        "line-width",
        lineWidth + WORKSPACE_GIS_CASING_EXTRA_WIDTH,
      );
    }

    const lineLayerId = workspaceGisLineLayerId(layer.id);
    if (!map.getLayer(lineLayerId)) {
      map.addLayer(
        {
          id: lineLayerId,
          type: "line",
          source: sourceId,
          // Lines AND polygon outlines: a polygon's edge is what makes a parcel
          // readable, and a `fill` alone at 35% opacity has none.
          filter: ["match", ["geometry-type"], ["LineString", "Polygon"], true, false],
          paint: { "line-color": color, "line-opacity": opacity, "line-width": lineWidth },
        },
        anchorLayerId,
      );
    } else {
      map.setPaintProperty(lineLayerId, "line-color", color);
      map.setPaintProperty(lineLayerId, "line-opacity", opacity);
      map.setPaintProperty(lineLayerId, "line-width", lineWidth);
    }

    const circleLayerId = workspaceGisCircleLayerId(layer.id);
    if (!map.getLayer(circleLayerId)) {
      map.addLayer(
        {
          id: circleLayerId,
          type: "circle",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": color,
            "circle-opacity": opacity,
            // Derived from the line width so one control moves both: a planner
            // who thickened a bike network expects its nodes to follow, and a
            // second hidden constant would drift from it.
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              lineWidth,
              16,
              lineWidth * 3,
            ],
            "circle-stroke-color": casingColor,
            "circle-stroke-width": 1,
          },
        },
        anchorLayerId,
      );
    } else {
      map.setPaintProperty(circleLayerId, "circle-color", color);
      map.setPaintProperty(circleLayerId, "circle-opacity", opacity);
      map.setPaintProperty(circleLayerId, "circle-stroke-color", casingColor);
    }

    const labelLayerId = workspaceGisLabelLayerId(layer.id);
    if (labelField) {
      if (!map.getLayer(labelLayerId)) {
        map.addLayer(
          {
            id: labelLayerId,
            type: "symbol",
            source: sourceId,
            layout: {
              "text-field": ["get", "label"],
              "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
              "text-size": 11,
              // Never `text-allow-overlap`: a parcels layer labelled by APN
              // would render a solid block of overlapping text. Mapbox drops the
              // ones that collide, which reads as a labelled map rather than as
              // ink.
              "text-optional": true,
            },
            paint: {
              "text-color": color,
              "text-halo-color": casingColor,
              "text-halo-width": 1.2,
            },
          },
          anchorLayerId,
        );
      } else {
        map.setPaintProperty(labelLayerId, "text-color", color);
        map.setPaintProperty(labelLayerId, "text-halo-color", casingColor);
      }
    } else if (map.getLayer(labelLayerId)) {
      // The planner cleared the label field. The layer goes, rather than being
      // left drawing the last field they chose.
      map.removeLayer(labelLayerId);
    }
  }

  // ENFORCE the stacking every pass rather than only at insertion. A layer added
  // while the anchor was absent sits above it forever otherwise, and re-ordering
  // by `sortOrder` would never take effect on a layer that already existed.
  if (anchorLayerId) {
    for (const listing of ordered) {
      for (const drawingLayerId of workspaceGisDrawingLayerIds(listing.layer.id)) {
        if (map.getLayer(drawingLayerId)) {
          try {
            map.moveLayer(drawingLayerId, anchorLayerId);
          } catch {
            // Best-effort ordering; a failure here is a cosmetic z-order, never
            // a wrong position on the ground.
          }
        }
      }
    }
  }
}

/**
 * Honour each layer's toggle. All of a layer's drawing layers move together, so
 * a layer never renders as labels floating over nothing — or, since the casing
 * arrived, as a white halo tracing a line the planner switched off.
 */
export function applyWorkspaceGisVisibility(
  map: WorkspaceGisMapTarget,
  layers: WorkspaceGisLayerListing[],
  visibility: Record<string, boolean>,
): void {
  for (const listing of layers) {
    const value = visibility[listing.layer.id] ? "visible" : "none";
    for (const drawingLayerId of workspaceGisDrawingLayerIds(listing.layer.id)) {
      if (map.getLayer(drawingLayerId)) {
        try {
          map.setLayoutProperty(drawingLayerId, "visibility", value);
        } catch {
          // no-op: the workspace layer toggle is best-effort
        }
      }
    }
  }
}

/**
 * Bring one layer forward while a planner points at its row, and let the others
 * recede — or restore every layer when `emphasisLayerId` is null.
 *
 * ALWAYS RESTORES FROM THE LAYER'S OWN STORED STYLE rather than from a
 * remembered "previous" value. A remembered value is a second source of truth
 * for how a layer looks, and the moment a planner changes a colour mid-hover the
 * two disagree and the restore writes back the old one.
 */
export function applyWorkspaceGisEmphasis(
  map: WorkspaceGisMapTarget,
  layers: WorkspaceGisLayerListing[],
  emphasisLayerId: string | null,
): void {
  for (const listing of layers) {
    const id = listing.layer.id;
    const style = listing.layer.style;
    const emphasised = emphasisLayerId === id;
    const dimmed = emphasisLayerId !== null && !emphasised;

    const opacity = dimmed ? style.opacity * EMPHASIS_DIM_FACTOR : style.opacity;
    const width = emphasised ? style.lineWidth * EMPHASIS_WIDTH_FACTOR : style.lineWidth;

    const set = (layerId: string, property: string, value: unknown) => {
      if (!map.getLayer(layerId)) return;
      try {
        map.setPaintProperty(layerId, property, value);
      } catch {
        // Emphasis is a hover affordance; a failure must never be an error a
        // planner sees, and the layer stays drawn either way.
      }
    };

    set(workspaceGisFillLayerId(id), "fill-opacity", opacity * FILL_OPACITY_FACTOR);
    set(workspaceGisCasingLayerId(id), "line-opacity", opacity);
    set(workspaceGisCasingLayerId(id), "line-width", width + WORKSPACE_GIS_CASING_EXTRA_WIDTH);
    set(workspaceGisLineLayerId(id), "line-opacity", opacity);
    set(workspaceGisLineLayerId(id), "line-width", width);
    set(workspaceGisCircleLayerId(id), "circle-opacity", opacity);
  }
}
