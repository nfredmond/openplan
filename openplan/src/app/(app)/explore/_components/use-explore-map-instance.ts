"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl, {
  FullscreenControl,
  NavigationControl,
  ScaleControl,
  type Map,
} from "mapbox-gl";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { installAnalysisLayers } from "./explore-analysis-layer-install";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

export function useExploreMapInstance() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) {
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-121.033982, 39.239137],
      zoom: 7,
      pitch: 36,
      bearing: -10,
      antialias: true,
      attributionControl: false,
    });

    window.setTimeout(() => {
      map.resize();
    }, 180);

    map.on("style.load", () => installAnalysisLayers(map));
    map.on("load", () => {
      map.resize();
      installAnalysisLayers(map);
      map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
      map.addControl(new FullscreenControl(), "top-right");
      map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-left");
      setMapReady(true);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  return { mapContainerRef, mapRef, mapReady };
}
