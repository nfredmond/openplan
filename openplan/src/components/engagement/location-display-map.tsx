"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { readStoredEngagementGeometry, type EngagementGeometry } from "@/lib/engagement/geometry";

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type MapItem = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  title: string | null;
  body: string;
  geometry?: unknown;
  votesCount?: number;
};

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
}: {
  items: MapItem[];
  onSupport?: SupportHandler;
  hasVoted?: (itemId: string) => boolean;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const onSupportRef = useRef(onSupport);
  const hasVotedRef = useRef(hasVoted);

  useEffect(() => {
    onSupportRef.current = onSupport;
    hasVotedRef.current = hasVoted;
  }, [onSupport, hasVoted]);

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

    if (pointItems.length === 0 && shapeItems.length === 0) return;

    let center: [number, number] = [-121.033982, 39.239137];
    let zoom = 9.5;
    if (pointItems.length > 0) {
      center = [pointItems[0].longitude, pointItems[0].latitude];
      zoom = 11;
    } else if (shapeItems.length > 0) {
      const firstPosition = collectGeometryPositions(shapeItems[0].parsedGeometry)[0];
      center = [firstPosition[0], firstPosition[1]];
      zoom = 11;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center,
      zoom,
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
              properties: { itemId: item.id },
            })),
          },
        });

        map.addLayer({
          id: "engagement-shapes-fill",
          type: "fill",
          source: "engagement-shapes",
          paint: { "fill-color": "#38bdf8", "fill-opacity": 0.2 },
          filter: ["==", ["geometry-type"], "Polygon"],
        });
        map.addLayer({
          id: "engagement-shapes-outline",
          type: "line",
          source: "engagement-shapes",
          paint: { "line-color": "#38bdf8", "line-width": 2 },
          filter: ["==", ["geometry-type"], "Polygon"],
        });
        map.addLayer({
          id: "engagement-shapes-line",
          type: "line",
          source: "engagement-shapes",
          paint: { "line-color": "#38bdf8", "line-width": 3 },
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
        el.className = 'w-4 h-4 bg-primary rounded-full border-2 border-background shadow-sm cursor-pointer';

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([item.longitude, item.latitude])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.push(marker);
      });

      const positionCount = pointItems.length + shapeItems.length;
      if (positionCount > 1 || shapeItems.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        pointItems.forEach((item) => bounds.extend([item.longitude, item.latitude]));
        shapeItems.forEach((item) => {
          collectGeometryPositions(item.parsedGeometry).forEach((position) => bounds.extend(position));
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

  if (!MAPBOX_ACCESS_TOKEN) {
    return null;
  }

  const hasMappedItems = items.some(
    (item) =>
      (item.latitude !== null && item.longitude !== null) ||
      readStoredEngagementGeometry(item.geometry ?? null) !== null
  );
  if (!hasMappedItems) {
    return null; // No need to show map if no items have locations
  }

  return (
    <div className="relative overflow-hidden rounded-[0.5rem] border border-border/70 mb-4">
      <div ref={mapContainerRef} className="h-[300px] w-full bg-muted/10" />
      <div className="absolute top-3 left-3 flex items-center gap-2 rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
        <span className="font-medium text-foreground">Community Input Map</span>
      </div>
    </div>
  );
}
