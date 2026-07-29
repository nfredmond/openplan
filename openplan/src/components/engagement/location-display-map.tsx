"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { readStoredEngagementGeometry, type EngagementGeometry } from "@/lib/engagement/geometry";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";
import { syncContextLayers } from "@/lib/engagement/context-layer-paint";
import { ParticipantMapLegend } from "./participant-map-legend";

const MAPBOX_ACCESS_TOKEN = resolvePublicMapboxToken(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

// Zoom for the first paint before the load handler fits to the full extent.
const SEEDED_ZOOM = 11;
// Only reachable if every item's geometry turns out to be degenerate (no
// usable coordinate). Showing the whole continent is honest there; showing
// somebody else's town would not be.
const NEUTRAL_ZOOM = 3.4;

type MapItem = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  title: string | null;
  body: string;
  geometry?: unknown;
  votesCount?: number;
  /** Category display color (hex). Falls back to the default when absent. */
  color?: string | null;
};

const DEFAULT_MAP_COLOR = "#38bdf8";

/** Accept only a safe hex color to use in inline styles / paint expressions. */
function safeHexColor(value: string | null | undefined): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : null;
}

type SupportHandler = (itemId: string) => Promise<number | null>;

function collectGeometryPositions(geometry: EngagementGeometry): [number, number][] {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString") return geometry.coordinates;
  return geometry.coordinates[0];
}

/**
 * Popup content is ALWAYS built via DOM nodes — title/body are public free
 * text and must never be interpolated into HTML strings.
 */
function buildPopupContent(
  item: MapItem,
  options: {
    onSupport?: SupportHandler;
    hasVoted?: (itemId: string) => boolean;
  }
): HTMLElement {
  const content = document.createElement("div");
  content.style.cssText = "padding: 4px; color: black;";

  if (item.title) {
    const title = document.createElement("strong");
    title.textContent = item.title;
    content.appendChild(title);
  }

  const body = document.createElement("p");
  body.style.cssText = "margin: 4px 0 0; font-size: 13px;";
  body.textContent = item.body;
  content.appendChild(body);

  if (typeof item.votesCount === "number" && options.onSupport) {
    const voteRow = document.createElement("div");
    voteRow.style.cssText = "margin-top: 6px; display: flex; align-items: center; gap: 6px;";

    const voteButton = document.createElement("button");
    voteButton.type = "button";
    voteButton.style.cssText =
      "font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 6px; padding: 2px 8px; background: #f8fafc; cursor: pointer; color: #0f172a;";

    const renderLabel = (count: number, voted: boolean) => {
      voteButton.textContent = voted ? `▲ Supported · ${count}` : `▲ Support · ${count}`;
      voteButton.disabled = voted;
      if (voted) {
        voteButton.style.cursor = "default";
        voteButton.style.opacity = "0.7";
      }
    };

    renderLabel(item.votesCount, options.hasVoted?.(item.id) ?? false);

    voteButton.addEventListener("click", () => {
      if (voteButton.disabled) return;
      voteButton.disabled = true;
      const optimisticCount = (item.votesCount ?? 0) + 1;
      renderLabel(optimisticCount, true);
      void options.onSupport?.(item.id).then((confirmedCount) => {
        if (typeof confirmedCount === "number") {
          item.votesCount = confirmedCount;
          renderLabel(confirmedCount, true);
        }
      });
    });

    voteRow.appendChild(voteButton);
    content.appendChild(voteRow);
  }

  return content;
}

export function LocationDisplayMap({
  items,
  onSupport,
  hasVoted,
  contextLayers = null,
}: {
  items: MapItem[];
  onSupport?: SupportHandler;
  hasVoted?: (itemId: string) => boolean;
  /**
   * Operator-published GIS context, drawn under the community's own input.
   *
   * Its presence also decides whether this map exists at all: a campaign that
   * has published a proposed alignment but collected no comments yet still has
   * something a resident needs to see, and the old "no located items → render
   * nothing" rule would have hidden it.
   */
  contextLayers?: ParticipantContextLayerSet | null;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const onSupportRef = useRef(onSupport);
  const hasVotedRef = useRef(hasVoted);
  // Read inside the map-creation effect for the opening frame only; the paint
  // effect below owns keeping the drawn layers in step.
  const contextLayersRef = useRef(contextLayers);

  useEffect(() => {
    onSupportRef.current = onSupport;
    hasVotedRef.current = hasVoted;
    contextLayersRef.current = contextLayers;
  }, [onSupport, hasVoted, contextLayers]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const popupOptions = {
      onSupport: onSupportRef.current
        ? (itemId: string) => onSupportRef.current?.(itemId) ?? Promise.resolve(null)
        : undefined,
      hasVoted: (itemId: string) => hasVotedRef.current?.(itemId) ?? false,
    };

    // Split items into marker points (Point geometry or legacy lat/lng) and
    // shape items (LineString/Polygon rendered as styled layers).
    const pointItems: (MapItem & { latitude: number; longitude: number })[] = [];
    const shapeItems: (MapItem & { parsedGeometry: EngagementGeometry })[] = [];

    for (const item of items) {
      const geometry = readStoredEngagementGeometry(item.geometry ?? null);
      if (geometry && geometry.type !== "Point") {
        shapeItems.push({ ...item, parsedGeometry: geometry });
      } else if (item.latitude !== null && item.longitude !== null) {
        pointItems.push({ ...item, latitude: item.latitude, longitude: item.longitude });
      }
    }

    const openingContextLayers = contextLayersRef.current?.layers ?? [];
    if (pointItems.length === 0 && shapeItems.length === 0 && openingContextLayers.length === 0) return;

    // Seed the first paint from the campaign's own data — the load handler
    // below fits to the full extent once the style is up. There is no
    // place-shaped default here: this map belongs to whichever agency's
    // campaign rendered it. The shape branch is safe because the guard above
    // has already returned when all three collections are empty; the remaining
    // `?? null` covers a shape whose ring parsed to no positions at all, and
    // the third branch covers a campaign whose only geometry so far is the
    // context the operator published.
    const contextSeed = openingContextLayers.find((layer) => layer.bbox)?.bbox ?? null;
    const seed: [number, number] | null =
      pointItems.length > 0
        ? [pointItems[0].longitude, pointItems[0].latitude]
        : shapeItems.length > 0
          ? (collectGeometryPositions(shapeItems[0].parsedGeometry)[0] ?? null)
          : contextSeed
            ? [(contextSeed[0] + contextSeed[2]) / 2, (contextSeed[1] + contextSeed[3]) / 2]
            : null;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: seed ?? CONTINENTAL_US_CENTER,
      zoom: seed ? SEEDED_ZOOM : NEUTRAL_ZOOM,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    const shapeItemById = new Map(shapeItems.map((item) => [item.id, item]));

    map.on("load", () => {
      // Lines and areas render as styled layers with click popups.
      if (shapeItems.length > 0) {
        map.addSource("engagement-shapes", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: shapeItems.map((item) => ({
              type: "Feature" as const,
              id: item.id,
              geometry: item.parsedGeometry,
              properties: { itemId: item.id, color: safeHexColor(item.color) ?? DEFAULT_MAP_COLOR },
            })),
          },
        });

        // Data-driven color: each feature carries its category color (default
        // when absent), so lines/areas render per-category, not one uniform hue.
        const shapeColor = ["coalesce", ["get", "color"], DEFAULT_MAP_COLOR] as unknown as mapboxgl.Expression;

        map.addLayer({
          id: "engagement-shapes-fill",
          type: "fill",
          source: "engagement-shapes",
          paint: { "fill-color": shapeColor, "fill-opacity": 0.2 },
          filter: ["==", ["geometry-type"], "Polygon"],
        });
        map.addLayer({
          id: "engagement-shapes-outline",
          type: "line",
          source: "engagement-shapes",
          paint: { "line-color": shapeColor, "line-width": 2 },
          filter: ["==", ["geometry-type"], "Polygon"],
        });
        map.addLayer({
          id: "engagement-shapes-line",
          type: "line",
          source: "engagement-shapes",
          paint: { "line-color": shapeColor, "line-width": 3 },
          filter: ["==", ["geometry-type"], "LineString"],
        });

        const openShapePopup = (event: mapboxgl.MapMouseEvent) => {
          const feature = event.features?.[0];
          const itemId = feature?.properties?.itemId as string | undefined;
          const item = itemId ? shapeItemById.get(itemId) : undefined;
          if (!item) return;

          new mapboxgl.Popup({ offset: 12, maxWidth: "300px" })
            .setLngLat(event.lngLat)
            .setDOMContent(buildPopupContent(item, popupOptions))
            .addTo(map);
        };

        for (const layerId of ["engagement-shapes-fill", "engagement-shapes-line"]) {
          map.on("click", layerId, openShapePopup);
          map.on("mouseenter", layerId, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", layerId, () => {
            map.getCanvas().style.cursor = "";
          });
        }
      }

      // Points stay markers with attached popups.
      pointItems.forEach((item) => {
        const popup = new mapboxgl.Popup({ offset: 25, maxWidth: "300px" }).setDOMContent(
          buildPopupContent(item, popupOptions)
        );

        const el = document.createElement('div');
        el.className = 'w-4 h-4 rounded-full border-2 border-background shadow-sm cursor-pointer';
        el.style.backgroundColor = safeHexColor(item.color) ?? DEFAULT_MAP_COLOR;

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([item.longitude, item.latitude])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.push(marker);
      });

      // Frame everything the map carries, community input and operator context
      // alike. A campaign whose only geometry is the published alignment still
      // gets framed on it rather than on the continent.
      const positionCount = pointItems.length + shapeItems.length;
      if (positionCount > 1 || shapeItems.length > 0 || openingContextLayers.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        pointItems.forEach((item) => bounds.extend([item.longitude, item.latitude]));
        shapeItems.forEach((item) => {
          collectGeometryPositions(item.parsedGeometry).forEach((position) => bounds.extend(position));
        });
        openingContextLayers.forEach((layer) => {
          if (!layer.bbox) return;
          bounds.extend([layer.bbox[0], layer.bbox[1]]);
          bounds.extend([layer.bbox[2], layer.bbox[3]]);
        });
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 40, maxZoom: 14 });
        }
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [items]);

  // Operator context, painted UNDER the community's shapes. `beforeId` is the
  // first shape layer when one exists; a campaign with only points has no
  // canvas layer to sit below, and DOM markers always draw above the canvas.
  // Re-runs on `style.load` for the same reason the cartographic backdrop does:
  // a style swap wipes the source and layer registry.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Nothing to do when the caller has not wired the campaign's layers through
    // at all. That is the difference between "this map shows no context" and
    // "this map was told there is none": a null prop means the render site never
    // supplied them, and touching the map's source registry to say so would be
    // work with no observable purpose.
    if (!contextLayers) return;
    const layers = contextLayers.layers;

    const paint = () => {
      const beforeId = map.getLayer("engagement-shapes-fill")
        ? "engagement-shapes-fill"
        : map.getLayer("engagement-shapes-line")
          ? "engagement-shapes-line"
          : undefined;
      syncContextLayers(map, layers, { beforeId });
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [contextLayers, items]);

  if (!MAPBOX_ACCESS_TOKEN) {
    return null;
  }

  const hasMappedItems = items.some(
    (item) =>
      (item.latitude !== null && item.longitude !== null) ||
      readStoredEngagementGeometry(item.geometry ?? null) !== null
  );
  // A campaign that has published context but collected no located input yet
  // still has something a resident needs to see. The old rule — render nothing
  // unless somebody has already commented — hid the project from the very
  // people being asked about it.
  //
  // A FAILED layer read counts too, and for the stronger reason: returning null
  // there would turn "we could not load this campaign's layers" into "this
  // campaign has no map", which is a confident claim nobody checked.
  const hasContextLayers = (contextLayers?.layers.length ?? 0) > 0;
  const contextLayersFailed = Boolean(contextLayers?.readFailure);
  if (!hasMappedItems && !hasContextLayers && !contextLayersFailed) {
    return null;
  }

  return (
    <div className="relative overflow-hidden rounded-[0.5rem] border border-border/70 mb-4">
      <div ref={mapContainerRef} className="h-[300px] w-full bg-muted/10" />
      <div className="absolute top-3 left-3 flex items-center gap-2 rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
        <span className="font-medium text-foreground">Community Input Map</span>
      </div>
      <ParticipantMapLegend contextLayers={contextLayers} />
    </div>
  );
}
