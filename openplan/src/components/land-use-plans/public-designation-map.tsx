"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { keepMapSizedToContainer } from "@/lib/mapbox/keep-map-sized";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

type MapPayload = {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; id: string; geometry: GeoJSON.Geometry; properties: { attributes: Record<string, unknown> } }>;
  matchedCount: number;
  returnedCount: number;
  tooDenseToDraw: boolean;
  legendField: string | null;
  coverageNotes: string[];
};

function publicViewport(map: mapboxgl.Map): [number, number, number, number] {
  const bounds = map.getBounds();
  if (!bounds) return [-180, -90, 180, 90];
  return [
    Math.max(-180, bounds.getWest()),
    Math.max(-90, bounds.getSouth()),
    Math.min(180, bounds.getEast()),
    Math.min(90, bounds.getNorth()),
  ];
}

export function PublicDesignationMap({ endpoint, bbox, label }: { endpoint: string; bbox: unknown; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current || !MAPBOX_ACCESS_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
    const extent = Array.isArray(bbox) && bbox.length === 4 && bbox.every((value) => typeof value === "number")
      ? bbox as [number, number, number, number]
      : null;
    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/light-v11",
      center: extent ? [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2] : [0, 20],
      zoom: extent ? 9 : 1.5,
      attributionControl: true,
    });
    mapRef.current = map;
    const stopSizing = keepMapSizedToContainer(map, container);
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    let requestNumber = 0;

    async function refresh() {
      const current = ++requestNumber;
      const viewport = publicViewport(map);
      if (viewport[0] >= viewport[2] || viewport[1] >= viewport[3]) return;
      const response = await fetch(`${endpoint}?bbox=${viewport.join(",")}`, { cache: "no-store" });
      const payload = await response.json() as MapPayload & { error?: string };
      if (current !== requestNumber) return;
      if (!response.ok) {
        setNotice(payload.error ?? "The frozen designation map could not be loaded.");
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
      const source = map.getSource("designations") as mapboxgl.GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features });
    }

    map.on("load", () => {
      map.addSource("designations", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "designation-fill", type: "fill", source: "designations", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#2563eb", "fill-opacity": 0.24 } });
      map.addLayer({ id: "designation-line", type: "line", source: "designations", filter: ["match", ["geometry-type"], ["Polygon", "LineString"], true, false], paint: { "line-color": "#1d4ed8", "line-width": 2 } });
      map.addLayer({ id: "designation-point", type: "circle", source: "designations", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#2563eb", "circle-radius": 5, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } });
      map.addLayer({ id: "designation-label", type: "symbol", source: "designations", filter: ["!=", ["get", "label"], ""], layout: { "text-field": ["get", "label"], "text-size": 12 }, paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
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
  }, [bbox, endpoint]);

  if (!MAPBOX_ACCESS_TOKEN) {
    return <p className="mt-3 rounded-lg border p-4 text-sm">The frozen map is unavailable because this OpenPlan instance has no public Mapbox token. The designation and feature hash remain available below.</p>;
  }
  return <div className="mt-4"><div ref={containerRef} className="h-80 w-full overflow-hidden rounded-lg border" role="img" aria-label={label}/>{notice ? <p className="mt-2 text-sm text-muted-foreground">{notice}</p> : null}</div>;
}
