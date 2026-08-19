"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";

const MAPBOX_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function extendBounds(bounds: mapboxgl.LngLatBounds, coordinates: unknown): void {
  if (!Array.isArray(coordinates)) return;
  if (coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    bounds.extend([coordinates[0], coordinates[1]]);
    return;
  }
  coordinates.forEach((child) => extendBounds(bounds, child));
}

export function DemandAgreementMap({ geojsonUrl }: { geojsonUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) {
      setError(MAPBOX_TOKEN ? "Agreement map container is unavailable" : "Mapbox token not configured");
      return;
    }
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: CONTINENTAL_US_CENTER,
      zoom: 3.4,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", async () => {
      try {
        const response = await fetch(geojsonUrl);
        if (!response.ok) throw new Error(`Failed to load agreement map: ${response.status}`);
        const geojson = await response.json();
        map.addSource("demand-agreement", { type: "geojson", data: geojson });
        const bounds = new mapboxgl.LngLatBounds();
        for (const feature of geojson.features ?? []) extendBounds(bounds, feature.geometry?.coordinates);
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, duration: 0 });

        map.addLayer({
          id: "demand-agreement-lines",
          type: "line",
          source: "demand-agreement",
          paint: {
            "line-color": ["match", ["get", "agreement"], "agree", "#22c55e", "marginal", "#f59e0b", "diverge", "#ef4444", "#64748b"],
            "line-width": ["interpolate", ["linear"], ["max", ["get", "first_volume"], ["get", "second_volume"]], 0, 1, 10000, 4, 50000, 8],
            "line-opacity": ["case", ["get", "carries_meaningful_traffic"], 0.9, 0.22],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });

        const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "240px" });
        map.on("mouseenter", "demand-agreement-lines", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "demand-agreement-lines", () => { map.getCanvas().style.cursor = ""; popup.remove(); });
        map.on("mousemove", "demand-agreement-lines", (event) => {
          const props = event.features?.[0]?.properties;
          if (!props) return;
          const label = props.name || props.link_type || "Road segment";
          popup.setLngLat(event.lngLat).setHTML(
            `<div class="op-map-popup" style="font-family:system-ui;font-size:13px;line-height:1.55"><strong>${escapeHtml(label)}</strong><br/>` +
            `Trip-based volume: <strong>${Number(props.first_volume).toLocaleString()}</strong><br/>` +
            `ActivitySim volume: <strong>${Number(props.second_volume).toLocaleString()}</strong><br/>` +
            `Sensitivity: <strong>${escapeHtml(props.agreement)}</strong> · GEH ${Number(props.geh).toLocaleString()}</div>`,
          ).addTo(map);
          popup.getElement()?.style.setProperty("z-index", "20");
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to load agreement map");
      }
    });
    return () => map.remove();
  }, [geojsonUrl]);

  return (
    <div className="relative overflow-hidden rounded-[0.5rem] border border-border/70 bg-zinc-900" data-testid="demand-agreement-map">
      <div className="absolute left-3 top-3 z-10 rounded-xl border border-white/10 bg-zinc-900/90 px-4 py-3 shadow-lg backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Demand-method sensitivity</p>
        <p className="mt-1 text-xs text-zinc-400">Agreement is concurrence, not evidence that either method is correct.</p>
      </div>
      <div className="absolute bottom-4 left-3 z-10 flex flex-wrap gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-zinc-900/90 px-4 py-2 text-xs text-zinc-300">
        <span><b className="text-green-500">●</b> Agree</span><span><b className="text-amber-500">●</b> Marginal</span><span><b className="text-red-500">●</b> Diverge</span>
      </div>
      {error ? <div className="flex h-[520px] items-center justify-center p-6 text-sm text-red-300">{error}</div> : <div ref={containerRef} className="h-[520px] w-full" />}
    </div>
  );
}
