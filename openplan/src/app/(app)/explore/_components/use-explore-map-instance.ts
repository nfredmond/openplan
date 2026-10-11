"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl, {
  FullscreenControl,
  NavigationControl,
  ScaleControl,
  type Map,
} from "mapbox-gl";
import { hasInvalidPublicMapboxToken, resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import { installAnalysisLayers } from "./explore-analysis-layer-install";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

/**
 * Why the map stage cannot draw, or null when it can.
 *
 * Before this existed the hook simply never created the map, and Explore
 * rendered a permanently empty pane with no explanation — the 2026-08-03
 * review's finding #6. "Silently empty" reads as broken software (or worse, as
 * a map with nothing on it); the workbench uses this to say what is actually
 * wrong. `unusable_token` is distinguished from `no_token` because the
 * operator who set a value needs to hear the value is wrong, not missing.
 */
export type ExploreMapUnavailableReason = "no_token" | "unusable_token";

const MAP_UNAVAILABLE_REASON: ExploreMapUnavailableReason | null = MAPBOX_ACCESS_TOKEN
  ? null
  : hasInvalidPublicMapboxToken(
        process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
        process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
      )
    ? "unusable_token"
    : "no_token";

// Explore opens before the planner has chosen a study area. Once they pick a
// corridor, use-explore-map-layer-effects fits the map to it — so this view
// only ever frames the "nothing selected yet" state, and it must not pretend
// to know where the planner works.
const INITIAL_CENTER = CONTINENTAL_US_CENTER;
const INITIAL_ZOOM = 3.4;

export function useExploreMapInstance() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) {
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    // The basemap follows the page's colour mode when the map is created
    // (October 11, 2026). The pre-paint script has already set the class on
    // <html>. Switching mode later keeps this basemap until the next load:
    // a live setStyle would drop the analysis layers' data until the next
    // result arrived.
    const prefersLight = !document.documentElement.classList.contains("dark");
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: prefersLight ? "mapbox://styles/mapbox/light-v11" : "mapbox://styles/mapbox/dark-v11",
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: 36,
      bearing: -10,
      antialias: true,
      attributionControl: false,
    });

    const resizeTimerId = window.setTimeout(() => {
      map.resize();
    }, 180);

    map.on("style.load", () => installAnalysisLayers(map));
    map.on("load", () => {
      map.resize();
      installAnalysisLayers(map);
      map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
      map.addControl(new FullscreenControl(), "top-right");
      map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-left");
      // Mapbox and OpenStreetMap require visible attribution on every map.
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
      setMapReady(true);
    });

    mapRef.current = map;

    return () => {
      window.clearTimeout(resizeTimerId);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  return { mapContainerRef, mapRef, mapReady, mapUnavailableReason: MAP_UNAVAILABLE_REASON };
}
