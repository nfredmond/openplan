"use client";

import { useEffect, useRef, useState } from "react";
import { keepMapSizedToContainer } from "@/lib/mapbox/keep-map-sized";
import {
  TRAFFIC_VOLUME_CLASSES,
  trafficVolumeClass,
  trafficVolumeColor,
  trafficVolumeWidth,
} from "@/lib/cartographic/traffic-volume-classes";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";

// Both accepted env names, resolved through the shared helper — see the note in
// safety-crash-map.tsx. Reading one name while the rest of the app reads either
// makes token configuration silently partial.
const MAPBOX_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

// The assignment network is fetched asynchronously, so the map has to exist
// before its extent is known. It opens on the shared neutral view and then
// fits to the network that actually loaded — a modeled network can be
// anywhere, so there is no defensible default place to open on.
const INITIAL_ZOOM = 3.4;
const NETWORK_FIT_PADDING = 40;

/**
 * Extend a bounds accumulator with every coordinate in an arbitrarily nested
 * GeoJSON coordinate array. Deliberately shape-agnostic: link geometry comes
 * straight out of SpatiaLite's AsGeoJSON, which emits LineString for most
 * links but MultiLineString for any that were split, and a walker that only
 * understood one of those would silently under-fit the network.
 */
function extendBoundsWithCoordinates(bounds: mapboxgl.LngLatBounds, coordinates: unknown): void {
  if (!Array.isArray(coordinates)) return;
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    if (Number.isFinite(coordinates[0]) && Number.isFinite(coordinates[1])) {
      bounds.extend([coordinates[0], coordinates[1]]);
    }
    return;
  }
  for (const child of coordinates) {
    extendBoundsWithCoordinates(bounds, child);
  }
}

type TrafficVolumeMapProps = {
  geojsonUrl?: string;
};

/**
 * Renders AequilibraE traffic assignment results as a color-coded line map.
 * Line width and color scale with PCE volume.
 *
 * Color ramp: green (low) → yellow (mid) → red (high)
 */
export function TrafficVolumeMap({
  geojsonUrl,
}: TrafficVolumeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    totalLinks: number;
    /** Links that existed before the route kept only the busiest ones. */
    linksAvailable: number | null;
    maxVolume: number;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (!geojsonUrl) {
      setError("Traffic volume data URL not configured");
      setLoading(false);
      return;
    }

    if (!MAPBOX_TOKEN) {
      setError("Mapbox token not configured");
      setLoading(false);
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/dark-v11",
      center: CONTINENTAL_US_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: false,
    });

    mapRef.current = map;
    // This map can be built inside a closed tab, where its container has no
    // size. Re-measure when the tab opens.
    const stopSizing = keepMapSizedToContainer(map, container);

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
        const available = Number(geojson.metadata?.linksAvailable);
        setStats({
          totalLinks: geojson.features?.length ?? 0,
          linksAvailable: Number.isFinite(available) ? available : null,
          maxVolume: maxVol,
        });

        map.addSource("traffic-volumes", {
          type: "geojson",
          data: geojson,
        });

        // Frame the network that actually loaded. Without this the results
        // map would sit at whatever view it was constructed with, which for
        // any network outside that view means the run renders off-screen and
        // reads as "no results".
        const bounds = new mapboxgl.LngLatBounds();
        for (const feature of (geojson.features ?? []) as Array<{ geometry?: { coordinates?: unknown } }>) {
          extendBoundsWithCoordinates(bounds, feature.geometry?.coordinates);
        }
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: NETWORK_FIT_PADDING, duration: 0 });
        }

        // Shadow/glow layer for depth
        map.addLayer({
          id: "traffic-volumes-glow",
          type: "line",
          source: "traffic-volumes",
          paint: {
            "line-color": "#000",
            // Two pixels wider than the line, at every class.
            "line-width": ["+", trafficVolumeWidth(), 2],
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
            "line-color": trafficVolumeColor(),
            "line-width": trafficVolumeWidth(),
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
                <span style="color:${trafficVolumeClass(Number(props.pce_tot)).color}">●</span> Volume: <strong>${Number(props.pce_tot).toLocaleString()}</strong> PCE/day<br/>
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
      stopSizing();
      map.remove();
      mapRef.current = null;
    };
  }, [geojsonUrl]);

  return (
    <div className="relative rounded-[0.5rem] border border-border/70 overflow-hidden bg-zinc-900">
      {/* Header */}
      <div className="absolute top-3 left-3 z-10 rounded-xl bg-zinc-900/90 backdrop-blur px-4 py-2.5 shadow-lg border border-white/10">
        <p className="text-label font-semibold uppercase tracking-wider text-zinc-400">
          Traffic assignment results
        </p>
        {stats && (
          <>
            <p className="mt-0.5 text-label text-zinc-300">
              {stats.linksAvailable !== null && stats.linksAvailable > stats.totalLinks
                ? `The busiest ${stats.totalLinks.toLocaleString("en-US")} of ${stats.linksAvailable.toLocaleString("en-US")} road links`
                : `${stats.totalLinks.toLocaleString("en-US")} road links`}
              {" · "}Peak {stats.maxVolume.toLocaleString("en-US")} PCE/day
            </p>
            {/* Without this, a map of only the busiest links reads as a region
                where every road is busy. */}
            {stats.linksAvailable !== null && stats.linksAvailable > stats.totalLinks ? (
              <p className="mt-0.5 text-label text-zinc-400">Quieter roads are not drawn.</p>
            ) : null}
          </>
        )}
      </div>

      {/* Legend: the same fixed classes the lines are drawn with. */}
      <div className="absolute bottom-4 left-3 z-10 rounded-xl bg-zinc-900/90 backdrop-blur px-4 py-3 shadow-lg border border-white/10">
        <p className="mb-1.5 text-label font-semibold text-zinc-300">Daily volume, passenger-car equivalents</p>
        <ul className="space-y-1">
          {TRAFFIC_VOLUME_CLASSES.map((entry) => (
            <li key={entry.from} className="flex items-center gap-2 text-label text-zinc-300">
              <span
                aria-hidden="true"
                className="inline-block w-6 rounded-full"
                style={{ background: entry.color, height: Math.max(3, entry.width) }}
              />
              {entry.label}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-label text-zinc-400">Same classes on every run.</p>
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
          <p role="alert" className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Map container */}
      <div ref={containerRef} className="h-[520px] w-full" />
    </div>
  );
}
