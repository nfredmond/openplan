"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

type TrafficVolumeMapProps = {
  modelRunId: string;
  geojsonUrl?: string;
};

/**
 * Renders AequilibraE traffic assignment results as a color-coded line map.
 * Line width and color scale with PCE volume.
 *
 * Color ramp: green (low) → yellow (mid) → red (high)
 */
export function TrafficVolumeMap({
  modelRunId,
  geojsonUrl = "/data/pilot-volumes.geojson",
}: TrafficVolumeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    totalLinks: number;
    maxVolume: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) {
      setError("Mapbox token not configured");
      setLoading(false);
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-121.025, 39.22],
      zoom: 12,
      attributionControl: false,
    });

    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    map.on("load", async () => {
      try {
        const res = await fetch(geojsonUrl);
        if (!res.ok) throw new Error(`Failed to load volume data: ${res.status}`);
        const geojson = await res.json();

        const maxVol = geojson.metadata?.maxVolume ?? 5000;
        setStats({
          totalLinks: geojson.features?.length ?? 0,
          maxVolume: maxVol,
        });

        map.addSource("traffic-volumes", {
          type: "geojson",
          data: geojson,
        });

        // Shadow/glow layer for depth
        map.addLayer({
          id: "traffic-volumes-glow",
          type: "line",
          source: "traffic-volumes",
          paint: {
            "line-color": "#000",
            "line-width": [
              "interpolate",
              ["linear"],
              ["get", "pce_tot"],
              0, 3,
              maxVol * 0.25, 5,
              maxVol * 0.5, 8,
              maxVol, 12,
            ],
            "line-opacity": 0.3,
            "line-blur": 3,
          },
        });

        // Main volume layer
        map.addLayer({
          id: "traffic-volumes-line",
          type: "line",
          source: "traffic-volumes",
          paint: {
            "line-color": [
              "interpolate",
              ["linear"],
              ["get", "pce_tot"],
              0, "#2dd4bf",          // teal (very low)
              maxVol * 0.15, "#22c55e", // green
              maxVol * 0.3, "#eab308",  // yellow
              maxVol * 0.5, "#f97316",  // orange
              maxVol * 0.75, "#ef4444", // red
              maxVol, "#dc2626",        // dark red
            ],
            "line-width": [
              "interpolate",
              ["linear"],
              ["get", "pce_tot"],
              0, 1.5,
              maxVol * 0.25, 3,
              maxVol * 0.5, 5,
              maxVol, 8,
            ],
            "line-opacity": 0.85,
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
        });

        // Hover interaction
        const popup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: "280px",
        });

        map.on("mouseenter", "traffic-volumes-line", () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", "traffic-volumes-line", () => {
          map.getCanvas().style.cursor = "";
          popup.remove();
        });

        map.on("mousemove", "traffic-volumes-line", (e) => {
          if (!e.features?.[0]) return;
          const props = e.features[0].properties ?? {};
          const name = props.name || props.link_type || "Road segment";

          popup
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:system-ui;font-size:13px;line-height:1.5">
                <strong>${name}</strong><br/>
                <span style="color:#22c55e">●</span> Volume: <strong>${Number(props.pce_tot).toLocaleString()}</strong> PCE/day<br/>
                <span style="font-size:11px;color:#888">
                  AB: ${Number(props.pce_ab).toLocaleString()} · BA: ${Number(props.pce_ba).toLocaleString()}<br/>
                  V/C: ${props.voc_max} · Delay: ${props.delay_factor}x
                </span>
              </div>`
            )
            .addTo(map);
        });

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
        setLoading(false);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [geojsonUrl]);

  return (
    <div className="relative rounded-2xl border border-border/70 overflow-hidden bg-zinc-900">
      {/* Header */}
      <div className="absolute top-3 left-3 z-10 rounded-xl bg-zinc-900/90 backdrop-blur px-4 py-2.5 shadow-lg border border-white/10">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Traffic Assignment Results
        </p>
        {stats && (
          <p className="text-xs text-zinc-500 mt-0.5">
            {stats.totalLinks.toLocaleString()} links · Peak {stats.maxVolume.toLocaleString()} PCE/day
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-3 z-10 rounded-xl bg-zinc-900/90 backdrop-blur px-4 py-3 shadow-lg border border-white/10">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
          Daily Volume (PCE)
        </p>
        <div className="flex items-center gap-1">
          <div className="h-2.5 w-8 rounded-sm" style={{ background: "#2dd4bf" }} />
          <div className="h-2.5 w-8 rounded-sm" style={{ background: "#22c55e" }} />
          <div className="h-2.5 w-8 rounded-sm" style={{ background: "#eab308" }} />
          <div className="h-2.5 w-8 rounded-sm" style={{ background: "#f97316" }} />
          <div className="h-2.5 w-8 rounded-sm" style={{ background: "#ef4444" }} />
          <div className="h-2.5 w-8 rounded-sm" style={{ background: "#dc2626" }} />
        </div>
        <div className="flex justify-between text-[10px] text-zinc-500 mt-0.5">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-900/80">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-sky-400" />
            Loading assignment results…
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-900/80">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Map container */}
      <div ref={containerRef} className="h-[520px] w-full" />
    </div>
  );
}
