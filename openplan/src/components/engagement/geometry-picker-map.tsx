"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { cn } from "@/lib/utils";
import {
  ENGAGEMENT_GEOMETRY_MAX_VERTICES,
  type EngagementGeometry,
} from "@/lib/engagement/geometry";

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export type EngagementDrawMode = "point" | "line" | "area";

type DrawState = {
  mode: EngagementDrawMode;
  vertices: [number, number][];
  areaClosed: boolean;
};

const MODE_OPTIONS: Array<{ id: EngagementDrawMode; label: string }> = [
  { id: "point", label: "Point" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
];

const CLOSE_RING_PIXEL_TOLERANCE = 12;

function deriveGeometry(state: DrawState): EngagementGeometry | null {
  if (state.mode === "point") {
    return state.vertices.length === 1 ? { type: "Point", coordinates: state.vertices[0] } : null;
  }

  if (state.mode === "line") {
    return state.vertices.length >= 2 ? { type: "LineString", coordinates: [...state.vertices] } : null;
  }

  if (state.areaClosed && state.vertices.length >= 3) {
    return { type: "Polygon", coordinates: [[...state.vertices, state.vertices[0]]] };
  }

  return null;
}

function buildPreviewFeatureCollection(state: DrawState): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = state.vertices.map((position, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: position },
    properties: { index },
  }));

  if (state.mode === "area" && state.areaClosed && state.vertices.length >= 3) {
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...state.vertices, state.vertices[0]]] },
      properties: {},
    });
  } else if (state.vertices.length >= 2 && state.mode !== "point") {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: state.vertices },
      properties: {},
    });
  }

  return { type: "FeatureCollection", features };
}

function statusCaption(state: DrawState): string {
  if (state.mode === "point") {
    return state.vertices.length === 0
      ? "Click the map to drop a pin."
      : "Pin placed. Click again to move it.";
  }

  if (state.mode === "line") {
    if (state.vertices.length === 0) return "Click the map to start a line along a street or route.";
    if (state.vertices.length === 1) return "1 vertex · click to extend the line";
    return `${state.vertices.length} vertices · line ready (keep clicking to extend)`;
  }

  if (state.areaClosed) return `Area closed (${state.vertices.length} vertices).`;
  if (state.vertices.length === 0) return "Click the map to outline an area.";
  if (state.vertices.length < 3) return `${state.vertices.length} vertex${state.vertices.length === 1 ? "" : "es"} · add at least 3, then close the area`;
  return `${state.vertices.length} vertices · click the first vertex or Close area to finish`;
}

/**
 * Click-to-draw geometry picker for the public engagement submission form.
 * House pattern from src/components/aerial/mission-aoi-editor.tsx — custom
 * click handling on a geojson preview source, no external draw library.
 *
 * Point: click to place/move. Line: click vertices (double-click also adds
 * the final vertex). Area: click vertices, close by clicking the first
 * vertex or the Close area button. Right-click or Undo removes the last
 * vertex; Escape clears the in-progress shape.
 */
export function GeometryPickerMap({
  onGeometryChange,
}: {
  onGeometryChange: (geometry: EngagementGeometry | null) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [draw, setDraw] = useState<DrawState>({ mode: "point", vertices: [], areaClosed: false });
  const [hint, setHint] = useState<string | null>(null);
  const drawRef = useRef(draw);
  const onGeometryChangeRef = useRef(onGeometryChange);

  useEffect(() => {
    drawRef.current = draw;
    onGeometryChangeRef.current = onGeometryChange;
  }, [draw, onGeometryChange]);

  const applyDraw = (updater: (previous: DrawState) => DrawState) => {
    setDraw((previous) => {
      const next = updater(previous);
      onGeometryChangeRef.current(deriveGeometry(next));
      return next;
    });
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-121.033982, 39.239137], // Grass Valley, CA — Nevada County seat (NCTC default)
      zoom: 9.5,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource("engagement-draw", {
        type: "geojson",
        data: buildPreviewFeatureCollection(drawRef.current),
      });
      map.addLayer({
        id: "engagement-draw-fill",
        type: "fill",
        source: "engagement-draw",
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.2 },
        filter: ["==", ["geometry-type"], "Polygon"],
      });
      map.addLayer({
        id: "engagement-draw-line",
        type: "line",
        source: "engagement-draw",
        paint: { "line-color": "#38bdf8", "line-width": 3 },
        filter: ["!=", ["geometry-type"], "Point"],
      });
      map.addLayer({
        id: "engagement-draw-points",
        type: "circle",
        source: "engagement-draw",
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#38bdf8",
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 1.5,
        },
        filter: ["==", ["geometry-type"], "Point"],
      });
    });

    map.on("click", (event) => {
      const current = drawRef.current;
      const next: [number, number] = [
        Number(event.lngLat.lng.toFixed(6)),
        Number(event.lngLat.lat.toFixed(6)),
      ];

      setHint(null);

      if (current.mode === "point") {
        applyDraw((previous) => ({ ...previous, vertices: [next], areaClosed: false }));
        return;
      }

      if (current.mode === "area" && current.areaClosed) {
        setHint("Area is closed. Clear it to draw a different shape.");
        return;
      }

      // Area mode: clicking near the first vertex closes the ring.
      if (current.mode === "area" && current.vertices.length >= 3) {
        const firstPixel = map.project(current.vertices[0]);
        const clickPixel = map.project(next);
        const distance = Math.hypot(firstPixel.x - clickPixel.x, firstPixel.y - clickPixel.y);
        if (distance <= CLOSE_RING_PIXEL_TOLERANCE) {
          applyDraw((previous) => ({ ...previous, areaClosed: true }));
          return;
        }
      }

      if (current.vertices.length >= ENGAGEMENT_GEOMETRY_MAX_VERTICES) {
        setHint(`Vertex limit reached (${ENGAGEMENT_GEOMETRY_MAX_VERTICES}). Close or clear the shape.`);
        return;
      }

      applyDraw((previous) => ({ ...previous, vertices: [...previous.vertices, next] }));
    });

    map.on("dblclick", (event) => {
      event.preventDefault();
      const current = drawRef.current;
      if (current.mode === "area") {
        if (current.vertices.length < 3) {
          setHint("Add at least 3 vertices before closing the area.");
          return;
        }
        applyDraw((previous) => ({ ...previous, areaClosed: true }));
      }
    });

    // Right-click removes the last vertex (house pattern).
    map.on("contextmenu", (event) => {
      event.preventDefault();
      applyDraw((previous) => ({
        ...previous,
        vertices: previous.vertices.slice(0, -1),
        areaClosed: false,
      }));
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Handlers read state via drawRef, so a single registration is safe.
  }, []);

  // Escape clears the in-progress shape.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (drawRef.current.vertices.length === 0) return;
      applyDraw((previous) => ({ ...previous, vertices: [], areaClosed: false }));
      setHint(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // applyDraw is stable per render semantics (uses setState + refs).
  }, []);

  // Sync the preview source with draw state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("engagement-draw") as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(buildPreviewFeatureCollection(draw));
  }, [draw]);

  const setMode = (mode: EngagementDrawMode) => {
    if (mode === draw.mode) return;
    setHint(null);
    applyDraw(() => ({ mode, vertices: [], areaClosed: false }));
  };

  const clear = () => {
    setHint(null);
    applyDraw((previous) => ({ ...previous, vertices: [], areaClosed: false }));
  };

  const undo = () => {
    setHint(null);
    applyDraw((previous) => ({
      ...previous,
      vertices: previous.vertices.slice(0, -1),
      areaClosed: false,
    }));
  };

  const closeArea = () => {
    if (draw.vertices.length < 3) {
      setHint("Add at least 3 vertices before closing the area.");
      return;
    }
    applyDraw((previous) => ({ ...previous, areaClosed: true }));
  };

  if (!MAPBOX_ACCESS_TOKEN) {
    return (
      <div className="flex h-[200px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground p-4 text-center">
        Map is unavailable because Mapbox access token is missing.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-border" role="group" aria-label="Drawing mode">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-pressed={draw.mode === option.id}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold transition",
                draw.mode === option.id
                  ? "bg-primary/15 text-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {draw.mode === "area" && !draw.areaClosed && draw.vertices.length >= 3 ? (
          <button type="button" onClick={closeArea} className="text-xs font-medium text-primary hover:underline">
            Close area
          </button>
        ) : null}
        {draw.vertices.length > 0 ? (
          <>
            <button type="button" onClick={undo} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
              Undo vertex
            </button>
            <button type="button" onClick={clear} className="text-xs font-medium text-destructive hover:underline">
              Clear
            </button>
          </>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border">
        <div ref={mapContainerRef} className="h-[260px] w-full bg-muted/10" />
        <div className="absolute bottom-3 left-3 max-w-[85%] rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
          <span className="text-muted-foreground">{hint ?? statusCaption(draw)}</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Right-click removes the last vertex. Escape clears the shape. Lines and areas support up to {ENGAGEMENT_GEOMETRY_MAX_VERTICES} vertices.
      </p>
    </div>
  );
}
