"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { SEVERITY_LABELS, type SafetyCrashCollection } from "@/lib/safety/client-types";
import {
  CRASH_SEVERITY_COLOR,
  CRASH_SEVERITY_LEGEND_ORDER,
  CRASH_SEVERITY_UNKNOWN_COLOR,
} from "@/lib/cartographic/crash-severity-palette";
import { isCrashSeverity } from "@/lib/safety/vocabulary";
// The casualty sentence is SHARED with the shell map's inspector. Both used to
// own a copy and both got it wrong the same way — a null count rendered as 0.
import { describeCrashCasualtyLine } from "@/lib/cartographic/crash-feature-to-selection";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import { OperatorDetail } from "@/components/ui/read-failure-notice";

// Both accepted env names, resolved through the shared helper so this map has
// the same token story as every other one. Reading only the newer name meant an
// operator who had set the legacy `NEXT_PUBLIC_MAPBOX_TOKEN` got a working shell
// map and a blank crash map, with nothing saying why.
const MAPBOX_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

// Crashes are only queried once a study area exists, so the constructed view
// is strictly the "no study area chosen yet" state — the bbox effect below
// frames every state that has data. A place-shaped default here would have
// shown a California town to a planner working anywhere else.
const INITIAL_ZOOM = 3.4;

/**
 * Severity paint, BUILT FROM THE SHARED PALETTE rather than from a local copy.
 *
 * This file used to hold its own `match` expression, and the palette module said
 * so in a standing note: the two agreed on the real bands but not on the
 * fallback, because this map had no explicit `pdo` case, so property-damage-only
 * and every unrecognised severity painted the same slate. That mattered the
 * moment a fifth band arrived — `unknown`, for a collision whose casualty counts
 * the source never supplied — because a hand-written expression that has not
 * heard of it paints it as property damage, which is the precise falsehood the
 * band was added to stop. Generating the expression means a band added to the
 * vocabulary cannot be silently mis-painted here.
 */
const SEVERITY_COLOR: mapboxgl.ExpressionSpecification = [
  "match",
  ["get", "severity"],
  ...CRASH_SEVERITY_LEGEND_ORDER.flatMap((severity) => [severity, CRASH_SEVERITY_COLOR[severity]]),
  CRASH_SEVERITY_UNKNOWN_COLOR,
] as mapboxgl.ExpressionSpecification;

type SafetyCrashMapProps = {
  collection: SafetyCrashCollection | null;
  /** [minLon, minLat, maxLon, maxLat] — the study area to frame on load. */
  bbox: [number, number, number, number] | null;
  /**
   * Called with a feature id when a planner clicks a collision, or null when
   * they click empty map. Optional so the map stays usable without a detail
   * surface to open.
   */
  onSelect?: (crashId: string | null) => void;
};

/** Popup content is assembled as HTML, so every interpolated value is escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function SafetyCrashMap({ collection, bbox, onSelect }: SafetyCrashMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const loadedRef = useRef(false);
  // The map is built once, so the click handlers close over a ref rather than
  // over the prop — otherwise selecting a collision would call whichever
  // callback existed at mount forever.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
        const date = typeof props.collisionDate === "string" ? props.collisionDate : "Date not reported";
        // The band's own label, not a de-underscored raw value. `unknown` reads
        // "Not classified — no casualty count reported", which is a sentence
        // that has to survive into the popup: "unknown" alone would be taken for
        // an unknown SEVERITY rather than for an absent report.
        const severity = isCrashSeverity(props.severity)
          ? SEVERITY_LABELS[props.severity]
          : "Severity not recognised";
        const modes = [
          props.pedestrianInvolved ? "pedestrian" : null,
          props.bicyclistInvolved ? "bicyclist" : null,
          props.motorcyclistInvolved ? "motorcyclist" : null,
        ].filter(Boolean);

        popup
          .setLngLat(event.lngLat)
          .setHTML(
            `<div style="font-size:12px;line-height:1.4">
               <strong>${escapeHtml(severity)}</strong><br/>
               ${escapeHtml(date)}<br/>
               ${escapeHtml(describeCrashCasualtyLine(props.killedCount, props.injuredCount))}
               ${modes.length ? `<br/>Involved: ${escapeHtml(modes.join(", "))}` : ""}
             </div>`
          )
          .addTo(map);
      });

      // Clicking a collision opens its full record; clicking empty map closes
      // it. The popup is a summary and cannot state which fields the source
      // omitted — that distinction needs the acquisition's coverage declaration,
      // which lives on the page, not on the point.
      map.on("click", "safety-crash-core", (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id === "string") onSelectRef.current?.(id);
      });

      map.on("click", (event) => {
        const hits = map.queryRenderedFeatures(event.point, { layers: ["safety-crash-core"] });
        if (hits.length === 0) onSelectRef.current?.(null);
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
      // What is off, what still works, and who can turn it on — before any
      // variable name a planner has no way to set.
      <div
        className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
        data-testid="safety-crash-map-unavailable"
      >
        <p className="font-medium text-foreground">The crash map can&apos;t be drawn</p>
        <p>
          This OpenPlan deployment has no map key configured. The crash counts and rates on this
          page are unaffected — only the map is missing. Whoever runs this deployment can add the
          key.
        </p>
        <OperatorDetail className="text-left">
          <p>
            Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a public Mapbox token (it begins with pk.) and
            rebuild.
          </p>
        </OperatorDetail>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full rounded-lg" />;
}
