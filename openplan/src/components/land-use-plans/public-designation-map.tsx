"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { keepMapSizedToContainer } from "@/lib/mapbox/keep-map-sized";
import { deploymentMapEngine, labelFontsFor, startMap, styleForEngine } from "@/lib/maps/map-engine";
import { readWgs84Bbox } from "@/lib/geo/wgs84-bounds";
import { readCameraWgs84QueryViewport, type Wgs84QueryViewport } from "@/lib/geo/wgs84-query-viewport";

/**
 * Mapbox with a public key, else MapLibre with the operator's open style. This
 * map is public, so a deployment without a Mapbox key should still show it.
 */
const MAP_ENGINE = deploymentMapEngine();
/** Mapbox's own default label fonts, named so MapLibre can be given the style's instead. */
const MAPBOX_LABEL_FONTS = ["Open Sans Regular", "Arial Unicode MS Regular"];

type MapPayload = {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; id: string; geometry: GeoJSON.Geometry; properties: { attributes: Record<string, unknown> } }>;
  matchedCount: number;
  returnedCount: number;
  tooDenseToDraw: boolean;
  legendField: string | null;
  coverageNotes: string[];
};

function publicViewport(map: mapboxgl.Map): Wgs84QueryViewport | null {
  try {
    const bounds = map.getBounds();
    return bounds ? readCameraWgs84QueryViewport([
      bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
    ]) : null;
  } catch {
    return null;
  }
}

export function PublicDesignationMap({ endpoint, bbox, label }: { endpoint: string; bbox: unknown; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The browser could not start the map library (no WebGL), or MapLibre never arrived.
  const [cannotStart, setCannotStart] = useState(false);
  const extent = useMemo(() => readWgs84Bbox(bbox), [bbox]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current || MAP_ENGINE.kind === "none") return;
    return startMap(MAP_ENGINE, mapboxgl, (gl) => {
      const map = new gl.Map({
        container,
        style: styleForEngine(MAP_ENGINE, "mapbox://styles/mapbox/light-v11") as string,
        center: extent ? [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2] : [0, 20],
        zoom: extent ? 9 : 1.5,
        attributionControl: true,
      });
      mapRef.current = map;
      const stopSizing = keepMapSizedToContainer(map, container);
      map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
      let requestNumber = 0;

      async function refresh() {
        const current = ++requestNumber;
        const source = map.getSource("designations") as mapboxgl.GeoJSONSource | undefined;
        const viewport = publicViewport(map);
        if (!viewport) {
          source?.setData({ type: "FeatureCollection", features: [] });
          setNotice("The map view could not be read. Move or zoom the map to retry.");
          return;
        }
        try {
          const response = await fetch(`${endpoint}?bbox=${viewport.join(",")}`, { cache: "no-store" });
          const payload = await response.json() as MapPayload & { error?: string };
          if (current !== requestNumber) return;
          if (!response.ok) {
            source?.setData({ type: "FeatureCollection", features: [] });
            setNotice(typeof payload.error === "string" ? payload.error : "The frozen designation map could not be loaded.");
            return;
          }
          setNotice(payload.coverageNotes[0] ?? (payload.returnedCount === 0 ? "No designation features intersect this map view." : null));
          const features = payload.features.map((feature) => ({
            ...feature,
            properties: {
              ...feature.properties,
              label: payload.legendField ? String(feature.properties.attributes[payload.legendField] ?? "") : "",
            },
          }));
          source?.setData({ type: "FeatureCollection", features });
        } catch {
          if (current !== requestNumber) return;
          source?.setData({ type: "FeatureCollection", features: [] });
          setNotice("The frozen designation map could not be loaded. Move the map to retry.");
        }
      }

      map.on("load", () => {
        map.addSource("designations", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "designation-fill", type: "fill", source: "designations", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#2563eb", "fill-opacity": 0.24 } });
        map.addLayer({ id: "designation-line", type: "line", source: "designations", filter: ["match", ["geometry-type"], ["Polygon", "LineString"], true, false], paint: { "line-color": "#1d4ed8", "line-width": 2 } });
        map.addLayer({ id: "designation-point", type: "circle", source: "designations", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#2563eb", "circle-radius": 5, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } });
        // Labels only in fonts the style serves; a style with none keeps the shapes and drops the text.
        const labelFonts = labelFontsFor(MAP_ENGINE, map, MAPBOX_LABEL_FONTS);
        if (labelFonts) map.addLayer({ id: "designation-label", type: "symbol", source: "designations", filter: ["!=", ["get", "label"], ""], layout: { "text-field": ["get", "label"], "text-font": labelFonts, "text-size": 12 }, paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
        if (extent && (extent[0] !== extent[2] || extent[1] !== extent[3])) map.fitBounds([[extent[0], extent[1]], [extent[2], extent[3]]], { padding: 36, maxZoom: 14, duration: 0 });
        void refresh();
      });
      map.on("moveend", refresh);

      return () => {
        requestNumber += 1;
        stopSizing();
        map.remove();
        mapRef.current = null;
      };
    }, () => setCannotStart(true));
  }, [extent, endpoint]);

  if (MAP_ENGINE.kind === "none" || cannotStart) {
    return (
      <p className="mt-3 rounded-lg border p-4 text-sm" data-testid="designation-map-unavailable">
        {cannotStart
          ? "The frozen map could not start in this browser."
          : "The frozen map is unavailable because this OpenPlan instance has no map set up."}{" "}
        The retained designation and feature hash are still available.
      </p>
    );
  }
  return <div className="mt-4"><div ref={containerRef} className="h-80 w-full overflow-hidden rounded-lg border" role="img" aria-label={label}/>{!extent ? <p className="mt-2 text-sm text-muted-foreground">The retained designation extent is unavailable. Pan or zoom to choose a map view.</p> : null}{notice ? <p className="mt-2 text-sm text-muted-foreground">{notice}</p> : null}</div>;
}
