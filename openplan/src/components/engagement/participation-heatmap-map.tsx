"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { HotspotFeatureCollection } from "@/lib/engagement/hotspots";

const MAPBOX_ACCESS_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export type HeatmapPoint = { lng: number; lat: number; weight: number; negative: boolean };

type HeatMode = "participation" | "concern";

const HEATMAP_COLOR = [
  "interpolate",
  ["linear"],
  ["heatmap-density"],
  0,
  "rgba(0,0,0,0)",
  0.2,
  "#2c7fb8",
  0.4,
  "#7fcdbb",
  0.6,
  "#c7e9b4",
  0.8,
  "#fecc5c",
  1,
  "#e45635",
] as unknown as mapboxgl.Expression;

const DENSITY_WEIGHT = ["coalesce", ["get", "weight"], 1] as unknown as mapboxgl.Expression;
// Concern mode leans the heat toward negative-sentiment pins (a proxy — see the
// screening caveat); non-negative pins keep a small baseline weight for context.
const CONCERN_WEIGHT = ["case", ["get", "negative"], 4, 0.5] as unknown as mapboxgl.Expression;

const HOTSPOT_FILL = ["case", ["get", "significant"], "#dc2626", "#64748b"] as unknown as mapboxgl.Expression;
const HOTSPOT_FILL_OPACITY = ["case", ["get", "significant"], 0.32, 0.12] as unknown as mapboxgl.Expression;
const HOTSPOT_LINE = ["case", ["get", "significant"], "#dc2626", "#94a3b8"] as unknown as mapboxgl.Expression;

function pointsFeatureCollection(points: HeatmapPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: { weight: p.weight, negative: p.negative },
    })),
  };
}

function buildHotspotPopup(props: Record<string, unknown>): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "padding: 4px; color: black; font-size: 12px; max-width: 220px;";
  const n = Number(props.nItems ?? 0);
  const share = props.negativeSharePct;
  const z = props.zScore;
  const significant = Boolean(props.significant);

  const heading = document.createElement("strong");
  heading.textContent = significant ? "Elevated-concern cluster (screening)" : "Comment cluster";
  el.appendChild(heading);

  const body = document.createElement("p");
  body.style.cssText = "margin: 4px 0 0;";
  const bits = [`${n} comment${n === 1 ? "" : "s"}`];
  if (typeof share === "number") bits.push(`${share}% negative`);
  if (typeof z === "number") bits.push(`z=${z}`);
  body.textContent = bits.join(" · ");
  el.appendChild(body);
  return el;
}

export function ParticipationHeatmapMap({
  points,
  hotspots,
  sentimentAvailable,
}: {
  points: HeatmapPoint[];
  hotspots: HotspotFeatureCollection;
  sentimentAvailable: boolean;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mode, setMode] = useState<HeatMode>("participation");
  const modeRef = useRef<HeatMode>(mode);

  // Rebuild only when the underlying data actually changes (not on mode toggle).
  const dataSig = useMemo(
    () => `${points.length}:${hotspots.features.length}:${points.map((p) => `${p.lng},${p.lat}`).join("|")}`,
    [points, hotspots]
  );

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!mapContainerRef.current || !MAPBOX_ACCESS_TOKEN) return;
    if (points.length === 0 && hotspots.features.length === 0) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const center: [number, number] = points.length > 0 ? [points[0].lng, points[0].lat] : [-121.033982, 39.239137];
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center,
      zoom: 10.5,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource("engagement-heat-src", { type: "geojson", data: pointsFeatureCollection(points) });
      map.addLayer({
        id: "engagement-heat",
        type: "heatmap",
        source: "engagement-heat-src",
        paint: {
          "heatmap-weight": modeRef.current === "concern" ? CONCERN_WEIGHT : DENSITY_WEIGHT,
          "heatmap-intensity": 1,
          "heatmap-radius": 34,
          "heatmap-opacity": 0.75,
          "heatmap-color": HEATMAP_COLOR,
        },
      });

      if (hotspots.features.length > 0) {
        map.addSource("engagement-hotspots-src", { type: "geojson", data: hotspots });
        map.addLayer({
          id: "engagement-hotspots-fill",
          type: "fill",
          source: "engagement-hotspots-src",
          paint: { "fill-color": HOTSPOT_FILL, "fill-opacity": HOTSPOT_FILL_OPACITY },
        });
        map.addLayer({
          id: "engagement-hotspots-outline",
          type: "line",
          source: "engagement-hotspots-src",
          paint: { "line-color": HOTSPOT_LINE, "line-width": 1.5, "line-dasharray": [2, 1] },
        });

        map.on("click", "engagement-hotspots-fill", (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          new mapboxgl.Popup({ offset: 8, maxWidth: "260px" })
            .setLngLat(event.lngLat)
            .setDOMContent(buildHotspotPopup(feature.properties ?? {}))
            .addTo(map);
        });
        map.on("mouseenter", "engagement-hotspots-fill", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "engagement-hotspots-fill", () => {
          map.getCanvas().style.cursor = "";
        });
      }

      // Fit to all points + hotspot vertices.
      const bounds = new mapboxgl.LngLatBounds();
      points.forEach((p) => bounds.extend([p.lng, p.lat]));
      for (const feature of hotspots.features) {
        const geom = feature.geometry;
        const rings = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
        for (const ring of rings) for (const position of ring) bounds.extend(position as [number, number]);
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 14 });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [dataSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mode toggle: swap the heatmap weight expression without a rebuild.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer("engagement-heat")) return;
    map.setPaintProperty("engagement-heat", "heatmap-weight", mode === "concern" ? CONCERN_WEIGHT : DENSITY_WEIGHT);
  }, [mode]);

  if (!MAPBOX_ACCESS_TOKEN) {
    return (
      <p className="text-xs text-muted-foreground">
        Map unavailable — set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to render the participation heatmap.
      </p>
    );
  }
  if (points.length === 0 && hotspots.features.length === 0) {
    return null;
  }

  return (
    <div className="relative overflow-hidden rounded-[0.5rem] border border-border/70">
      <div ref={mapContainerRef} className="h-[320px] w-full bg-muted/10" />
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
        <span className="font-medium text-foreground">Participation heatmap</span>
        {sentimentAvailable ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <button
              type="button"
              onClick={() => setMode("participation")}
              className={mode === "participation" ? "font-semibold text-foreground" : "hover:text-foreground"}
            >
              Density
            </button>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={() => setMode("concern")}
              className={mode === "concern" ? "font-semibold text-foreground" : "hover:text-foreground"}
            >
              Concern
            </button>
          </span>
        ) : null}
      </div>
      {hotspots.features.length > 0 ? (
        <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-[0.7rem] text-muted-foreground shadow-sm backdrop-blur-sm">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#dc2626", opacity: 0.6 }} />
            Elevated concern
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#64748b", opacity: 0.5 }} />
            Cluster
          </span>
        </div>
      ) : null}
    </div>
  );
}
