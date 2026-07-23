"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { SafetyCrashCollection } from "@/lib/safety/client-types";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

// Crashes are only queried once a study area exists, so the constructed view
// is strictly the "no study area chosen yet" state — the bbox effect below
// frames every state that has data. A place-shaped default here would have
// shown a California town to a planner working anywhere else.
const INITIAL_ZOOM = 3.4;

/**
 * Severity palette, matched to the Explore crash overlay
 * (explore-analysis-layer-install.ts) so the same crash reads the same colour
 * wherever it appears. PDO is the one addition — Explore's SWITRS lane drops
 * property-damage-only entirely, while CCRS reports it.
 */
const SEVERITY_COLOR: mapboxgl.ExpressionSpecification = [
  "match",
  ["get", "severity"],
  "fatal",
  "#ef4444",
  "severe_injury",
  "#fb923c",
  "injury",
  "#facc15",
  "#64748b",
];

type SafetyCrashMapProps = {
  collection: SafetyCrashCollection | null;
  /** [minLon, minLat, maxLon, maxLat] — the study area to frame on load. */
  bbox: [number, number, number, number] | null;
};

export function SafetyCrashMap({ collection, bbox }: SafetyCrashMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const loadedRef = useRef(false);

  // Create the map once; data updates are handled by the effect below so a
  // filter change never tears down and rebuilds the map.
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: CONTINENTAL_US_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("safety-crashes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Soft halo beneath the core dot, so dense clusters read as intensity
      // without the individual points disappearing.
      map.addLayer({
        id: "safety-crash-halo",
        type: "circle",
        source: "safety-crashes",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 11, 12],
          "circle-color": SEVERITY_COLOR,
          "circle-opacity": 0.18,
          "circle-blur": 0.8,
        },
      });

      map.addLayer({
        id: "safety-crash-core",
        type: "circle",
        source: "safety-crashes",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 11, 7],
          "circle-color": SEVERITY_COLOR,
          "circle-stroke-color": "#fff7ed",
          "circle-stroke-width": 1,
          "circle-opacity": 0.95,
        },
      });

      const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });

      map.on("mouseenter", "safety-crash-core", (event) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = event.features?.[0];
        if (!feature) return;
        const props = feature.properties ?? {};
        const date = typeof props.collisionDate === "string" ? props.collisionDate : "Date unknown";
        const severity = String(props.severity ?? "unknown").replace(/_/g, " ");
        const killed = Number(props.killedCount ?? 0);
        const injured = Number(props.injuredCount ?? 0);
        const modes = [
          props.pedestrianInvolved ? "pedestrian" : null,
          props.bicyclistInvolved ? "bicyclist" : null,
        ].filter(Boolean);

        popup
          .setLngLat(event.lngLat)
          .setHTML(
            `<div style="font-size:12px;line-height:1.4">
               <strong style="text-transform:capitalize">${severity}</strong><br/>
               ${date}<br/>
               ${killed} killed · ${injured} injured
               ${modes.length ? `<br/>Involved: ${modes.join(", ")}` : ""}
             </div>`
          )
          .addTo(map);
      });

      map.on("mouseleave", "safety-crash-core", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      loadedRef.current = true;
      const source = map.getSource("safety-crashes") as mapboxgl.GeoJSONSource | undefined;
      if (source && collection) source.setData(collection);
    });

    return () => {
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // Intentionally mount-only: data and framing are applied by the effects
    // below, so re-renders never recreate the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource("safety-crashes") as mapboxgl.GeoJSONSource | undefined;
    source?.setData(collection ?? { type: "FeatureCollection", features: [] });
  }, [collection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bbox) return;
    map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 40, duration: 0 });
  }, [bbox]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Mapbox token not configured — set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to view the crash map.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full rounded-lg" />;
}
