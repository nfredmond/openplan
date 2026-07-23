"use client";

import { useEffect, useId, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { cn } from "@/lib/utils";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";
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
const KEYBOARD_PAN_STEP_PX = 64;

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

/**
 * Append a vertex, honoring point-mode replace semantics, the closed-area lock,
 * and the vertex cap. Pure so both the pointer and keyboard paths share it and
 * it is unit-testable without a live map. `outcome` drives screen-reader text.
 */
function appendVertex(
  state: DrawState,
  coord: [number, number]
): { next: DrawState; outcome: "placed" | "added" | "closed-locked" | "limit" } {
  if (state.mode === "point") {
    return { next: { ...state, vertices: [coord], areaClosed: false }, outcome: "placed" };
  }
  if (state.mode === "area" && state.areaClosed) {
    return { next: state, outcome: "closed-locked" };
  }
  if (state.vertices.length >= ENGAGEMENT_GEOMETRY_MAX_VERTICES) {
    return { next: state, outcome: "limit" };
  }
  return { next: { ...state, vertices: [...state.vertices, coord] }, outcome: "added" };
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
      ? "Click the map or press Enter to drop a pin at the crosshair."
      : "Pin placed. Click or press Enter again to move it.";
  }

  if (state.mode === "line") {
    if (state.vertices.length === 0) return "Click the map or press Enter to start a line along a street or route.";
    if (state.vertices.length === 1) return "1 vertex · click or press Enter to extend the line";
    return `${state.vertices.length} vertices · line ready (keep adding to extend)`;
  }

  if (state.areaClosed) return `Area closed (${state.vertices.length} vertices).`;
  if (state.vertices.length === 0) return "Click the map or press Enter to outline an area.";
  if (state.vertices.length < 3) return `${state.vertices.length} vertex${state.vertices.length === 1 ? "" : "es"} · add at least 3, then close the area`;
  return `${state.vertices.length} vertices · click the first vertex or press C to close the area`;
}

const LIMIT_MESSAGE = `Vertex limit reached (${ENGAGEMENT_GEOMETRY_MAX_VERTICES}). Close or clear the shape.`;

/**
 * Geometry picker for the public engagement submission form. House pattern from
 * src/components/aerial/mission-aoi-editor.tsx — custom handling on a geojson
 * preview source, no external draw library.
 *
 * Pointer: Point = click to place/move; Line = click vertices (double-click adds
 * the final one); Area = click vertices, close by clicking the first vertex, the
 * Close area button, or C. Right-click / Undo removes the last vertex; Escape clears.
 *
 * Keyboard (WCAG 2.1.1 — the map is a single focusable widget): arrow keys pan,
 * +/- zoom, Enter/Space places a vertex at the center crosshair, Backspace removes
 * the last, C closes an area, Escape clears. Changes are announced via a live region.
 */
export function GeometryPickerMap({
  onGeometryChange,
  initialMode = "point",
  allowedModes = ["point", "line", "area"],
  // Neutral by default. This component is rendered on the PUBLIC, embeddable
  // resident-facing engagement portal, so a place-specific default meant
  // residents everywhere opened their agency's map on rural California.
  // Callers that know their geography pass initialCenter; nobody inherits
  // somebody else's town.
  initialCenter = CONTINENTAL_US_CENTER,
  initialZoom = 3.5,
}: {
  onGeometryChange: (geometry: EngagementGeometry | null) => void;
  /** Starting draw mode (default "point" for the engagement submission form). */
  initialMode?: EngagementDrawMode;
  /** Which mode toggles to show; a single mode hides the selector entirely. */
  allowedModes?: EngagementDrawMode[];
  /** Initial map center [lng, lat] (default Grass Valley, CA for engagement). */
  initialCenter?: [number, number];
  initialZoom?: number;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [draw, setDraw] = useState<DrawState>({ mode: initialMode, vertices: [], areaClosed: false });
  const visibleModes = MODE_OPTIONS.filter((option) => allowedModes.includes(option.id));
  const [hint, setHint] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const drawRef = useRef(draw);
  const onGeometryChangeRef = useRef(onGeometryChange);
  const instructionsId = useId();

  useEffect(() => {
    drawRef.current = draw;
    onGeometryChangeRef.current = onGeometryChange;
  }, [draw, onGeometryChange]);

  const announceSeqRef = useRef(0);
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
  // A zero-width space nonce toggles the live-region text on every call, so
  // repeat actions with identical wording (e.g. moving a point twice) still
  // mutate the DOM and get re-announced. U+200B is invisible and not spoken.
  const announce = (message: string) => {
    announceSeqRef.current += 1;
    setAnnouncement(message + ZERO_WIDTH_SPACE.repeat(announceSeqRef.current % 2));
  };

  const applyDraw = (updater: (previous: DrawState) => DrawState) => {
    setDraw((previous) => {
      const next = updater(previous);
      onGeometryChangeRef.current(deriveGeometry(next));
      return next;
    });
  };

  // Shared commit used by both a map click and a keyboard Enter at the crosshair.
  // For clicks, the caller handles the area-close pixel test first.
  const commitVertex = (coord: [number, number]) => {
    setHint(null);
    const { outcome } = appendVertex(drawRef.current, coord);
    if (outcome === "closed-locked") {
      setHint("Area is closed. Clear it to draw a different shape.");
      announce("Area is already closed. Clear it to draw a different shape.");
      return;
    }
    if (outcome === "limit") {
      setHint(LIMIT_MESSAGE);
      announce(LIMIT_MESSAGE);
      return;
    }
    const before = drawRef.current.vertices.length;
    applyDraw((previous) => appendVertex(previous, coord).next);
    announce(
      outcome === "placed"
        ? "Point placed at the map center."
        : `Vertex ${before + 1} added${drawRef.current.mode === "point" ? "" : " at the map center"}.`
    );
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: false,
    });

    // The wrapping <div> is the single keyboard widget; drive pan/zoom from our
    // own handler so there is no duplicate tab stop or double-handled key.
    map.keyboard.disable();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      const canvas = map.getCanvas();
      canvas.setAttribute("tabindex", "-1");
      canvas.setAttribute("aria-hidden", "true");

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

      // Area mode: clicking near the first vertex closes the ring (pointer-only
      // shortcut; keyboard users press C).
      if (current.mode === "area" && !current.areaClosed && current.vertices.length >= 3) {
        const firstPixel = map.project(current.vertices[0]);
        const clickPixel = map.project(next);
        const distance = Math.hypot(firstPixel.x - clickPixel.x, firstPixel.y - clickPixel.y);
        if (distance <= CLOSE_RING_PIXEL_TOLERANCE) {
          setHint(null);
          applyDraw((previous) => ({ ...previous, areaClosed: true }));
          announce(`Area closed with ${current.vertices.length} vertices.`);
          return;
        }
      }

      commitVertex(next);
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
        announce(`Area closed with ${current.vertices.length} vertices.`);
      }
    });

    // Right-click removes the last vertex (house pattern).
    map.on("contextmenu", (event) => {
      event.preventDefault();
      undo();
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Handlers read state via drawRef, so a single registration is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    announce(`${mode.charAt(0).toUpperCase()}${mode.slice(1)} mode. Existing shape cleared.`);
  };

  const clear = () => {
    setHint(null);
    if (drawRef.current.vertices.length === 0) return;
    applyDraw((previous) => ({ ...previous, vertices: [], areaClosed: false }));
    announce("Shape cleared.");
  };

  const undo = () => {
    setHint(null);
    if (drawRef.current.vertices.length === 0) return;
    applyDraw((previous) => ({
      ...previous,
      vertices: previous.vertices.slice(0, -1),
      areaClosed: false,
    }));
    announce("Last vertex removed.");
  };

  const closeArea = () => {
    if (drawRef.current.mode !== "area") return;
    if (drawRef.current.vertices.length < 3) {
      setHint("Add at least 3 vertices before closing the area.");
      announce("Add at least 3 vertices before closing the area.");
      return;
    }
    applyDraw((previous) => ({ ...previous, areaClosed: true }));
    announce(`Area closed with ${drawRef.current.vertices.length} vertices.`);
  };

  const handleMapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Only handle keys aimed at the widget itself. Mapbox inserts the zoom
    // controls (real <button>s) into this same container; without this guard a
    // keydown on a focused zoom button bubbles here and would commit a stray
    // vertex while cancelling the button's own activation.
    if (event.target !== event.currentTarget) return;
    const map = mapRef.current;
    if (!map) return;
    switch (event.key) {
      case "ArrowUp":
        map.panBy([0, -KEYBOARD_PAN_STEP_PX]);
        event.preventDefault();
        break;
      case "ArrowDown":
        map.panBy([0, KEYBOARD_PAN_STEP_PX]);
        event.preventDefault();
        break;
      case "ArrowLeft":
        map.panBy([-KEYBOARD_PAN_STEP_PX, 0]);
        event.preventDefault();
        break;
      case "ArrowRight":
        map.panBy([KEYBOARD_PAN_STEP_PX, 0]);
        event.preventDefault();
        break;
      case "+":
      case "=":
        map.zoomIn();
        event.preventDefault();
        break;
      case "-":
      case "_":
        map.zoomOut();
        event.preventDefault();
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        const c = map.getCenter();
        commitVertex([Number(c.lng.toFixed(6)), Number(c.lat.toFixed(6))]);
        break;
      }
      case "Backspace":
      case "Delete":
        event.preventDefault();
        undo();
        break;
      case "c":
      case "C":
        if (drawRef.current.mode === "area") {
          event.preventDefault();
          closeArea();
        }
        break;
      case "Escape":
        if (drawRef.current.vertices.length > 0) {
          event.preventDefault();
          clear();
        }
        break;
      default:
        break;
    }
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
        <div
          className="inline-flex overflow-hidden rounded-lg border border-border"
          role="group"
          aria-label="Drawing mode"
          hidden={visibleModes.length <= 1}
        >
          {visibleModes.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-pressed={draw.mode === option.id}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          <button type="button" onClick={closeArea} className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Close area
          </button>
        ) : null}
        {draw.vertices.length > 0 ? (
          <>
            <button type="button" onClick={undo} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Undo vertex
            </button>
            <button type="button" onClick={clear} className="text-xs font-medium text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Clear
            </button>
          </>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border">
        <div
          ref={mapContainerRef}
          role="application"
          tabIndex={0}
          aria-roledescription="Interactive drawing map"
          aria-label={`Drawing map, ${draw.mode} mode`}
          aria-describedby={instructionsId}
          onKeyDown={handleMapKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="h-[260px] w-full bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        {isFocused ? (
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2">
            <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary/80 shadow" />
            <span className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-primary/80" />
            <span className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-primary/80" />
          </div>
        ) : null}
        <div className="absolute bottom-3 left-3 max-w-[85%] rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
          <span className="text-muted-foreground">{hint ?? statusCaption(draw)}</span>
        </div>
      </div>

      <p id={instructionsId} className="text-xs text-muted-foreground">
        Mouse: click to add points; right-click removes the last vertex. Keyboard: focus the map, use arrow
        keys to pan and +/− to zoom, Enter to place a vertex at the center crosshair, Backspace to remove the
        last, {ENGAGEMENT_GEOMETRY_MAX_VERTICES}-vertex max. In area mode, press C to close the shape. Escape clears.
      </p>

      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
