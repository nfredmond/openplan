"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl, { type Map } from "mapbox-gl";
import { deploymentMapEngine, startMap, styleForEngine } from "@/lib/maps/map-engine";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import { installAnalysisLayers } from "./explore-analysis-layer-install";

/** Mapbox with a public key, else MapLibre with the operator's open style. */
const MAP_ENGINE = deploymentMapEngine();

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
export type ExploreMapUnavailableReason = "no_token" | "unusable_token" | "cannot_start";

const MAP_UNAVAILABLE_REASON: ExploreMapUnavailableReason | null =
  MAP_ENGINE.kind !== "none" ? null : MAP_ENGINE.unusableToken ? "unusable_token" : "no_token";

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
  // The browser could not start the map library (no WebGL), or MapLibre never arrived.
  const [cannotStart, setCannotStart] = useState(false);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current || MAP_ENGINE.kind === "none") {
      return;
    }

    // The basemap follows the page's colour mode when the map is created
    // (October 11, 2026). The pre-paint script has already set the class on
    // <html>. Switching mode later keeps this basemap until the next load:
    // a live setStyle would drop the analysis layers' data until the next
    // result arrived. MapLibre draws the operator's one style in either mode.
    const prefersLight = !document.documentElement.classList.contains("dark");
    const style = styleForEngine(
      MAP_ENGINE,
      prefersLight ? "mapbox://styles/mapbox/light-v11" : "mapbox://styles/mapbox/dark-v11",
    ) as string;
    return startMap(MAP_ENGINE, mapboxgl, (gl) => {
      const map = new gl.Map({
        container,
        style,
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
        map.addControl(new gl.NavigationControl({ visualizePitch: true }), "top-right");
        map.addControl(new gl.FullscreenControl(), "top-right");
        map.addControl(new gl.ScaleControl({ unit: "imperial" }), "bottom-left");
        // Mapbox, OpenStreetMap and any open style's sources require visible attribution.
        map.addControl(new gl.AttributionControl({ compact: true }), "bottom-right");
        setMapReady(true);
      });

      mapRef.current = map;

      return () => {
        window.clearTimeout(resizeTimerId);
        map.remove();
        mapRef.current = null;
        setMapReady(false);
      };
    }, () => setCannotStart(true));
  }, []);

  return {
    mapContainerRef,
    mapRef,
    mapReady,
    mapUnavailableReason: cannotStart ? "cannot_start" : MAP_UNAVAILABLE_REASON,
  };
}
