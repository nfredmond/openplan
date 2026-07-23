"use client";

import { useEffect, useId, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { CONTINENTAL_US_CENTER } from "@/lib/models/study-area";

const MAPBOX_ACCESS_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

/** Zoom for an existing AOI's first paint, before fitBounds frames its ring. */
const EXISTING_AOI_ZOOM = 10;
// A mission with no AOI yet has no geography to show. Opening wide and neutral
// says "pick your area"; opening on a specific town would have told every
// operator, anywhere, that they were somewhere they are not.
const NEUTRAL_ZOOM = 3.4;

export type AoiPolygon = {
  type: "Polygon";
  coordinates: [number, number][][];
};

type EditorStatus = "idle" | "drawing" | "closed";

const KEYBOARD_PAN_STEP_PX = 64;

/**
 * Mission AOI polygon editor. Keyboard support follows the house pattern from
 * src/components/engagement/geometry-picker-map.tsx (E7, WCAG 2.1.1): the map
 * container is the single focusable widget (Mapbox's own keyboard handling
 * disabled, canvas out of the tab order); arrow keys pan, +/− zoom, Enter or
 * Space adds a vertex at the center crosshair, Backspace removes the last,
 * C closes the polygon, Escape clears. Changes announce via a live region.
 *
 * Pointer path is unchanged: click adds vertices, double-click closes,
 * right-click removes the last vertex.
 */
export function MissionAoiEditor({
  missionId,
  initialPolygon,
  onSaved,
}: {
  missionId: string;
  initialPolygon: AoiPolygon | null;
  onSaved?: (polygon: AoiPolygon | null) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [vertices, setVertices] = useState<[number, number][]>(() =>
    initialPolygon && initialPolygon.coordinates[0]
      ? dropClosingVertex(initialPolygon.coordinates[0])
      : []
  );
  const [status, setStatus] = useState<EditorStatus>(() =>
    initialPolygon && initialPolygon.coordinates[0] ? "closed" : "idle"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const instructionsId = useId();

  // Map handlers are registered once at mount; they read current state via
  // refs. (The previous closure-over-state version froze `status` at its
  // mount value — editing an existing AOI left clicks dead even after Clear.)
  const verticesRef = useRef(vertices);
  const statusRef = useRef(status);
  useEffect(() => {
    verticesRef.current = vertices;
    statusRef.current = status;
  }, [vertices, status]);

  const announceSeqRef = useRef(0);
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
  // Zero-width-space nonce: identical repeat messages still mutate the DOM so
  // the live region re-announces them. U+200B is invisible and not spoken.
  const announce = (message: string) => {
    announceSeqRef.current += 1;
    setAnnouncement(message + ZERO_WIDTH_SPACE.repeat(announceSeqRef.current % 2));
  };

  // Shared by map click and keyboard Enter at the crosshair.
  const commitVertex = (coord: [number, number]) => {
    if (statusRef.current === "closed") {
      setError("Polygon is closed. Clear it (or press Escape) to draw a different area.");
      announce("Polygon is already closed. Clear it to draw a different area.");
      return;
    }
    const nextCount = verticesRef.current.length + 1;
    setVertices((prev) => [...prev, coord]);
    setStatus("drawing");
    setError(null);
    setSavedMessage(null);
    announce(`Vertex ${nextCount} added at the map center.`);
  };

  const closePolygon = () => {
    if (statusRef.current === "closed") return;
    if (verticesRef.current.length < 3) {
      setError("Draw at least 3 vertices before closing the polygon.");
      announce("Add at least 3 vertices before closing the polygon.");
      return;
    }
    setStatus("closed");
    setError(null);
    announce(`Polygon closed with ${verticesRef.current.length} vertices.`);
  };

  const undo = () => {
    if (verticesRef.current.length === 0) return;
    const remaining = verticesRef.current.length - 1;
    setVertices((prev) => prev.slice(0, -1));
    setStatus(remaining > 0 ? "drawing" : "idle");
    setError(null);
    setSavedMessage(null);
    announce(remaining > 0 ? "Last vertex removed." : "Last vertex removed. Polygon is empty.");
  };

  const clear = () => {
    setVertices([]);
    setStatus("idle");
    setError(null);
    setSavedMessage(null);
    if (verticesRef.current.length > 0) {
      announce("Polygon cleared.");
    }
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    // An existing AOI seeds the first paint (the load handler then fits to its
    // bbox); a mission without one opens neutral rather than on a guess.
    const center = initialPolygon ? polygonCenter(initialPolygon.coordinates[0] ?? []) : null;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: center ?? CONTINENTAL_US_CENTER,
      zoom: center ? EXISTING_AOI_ZOOM : NEUTRAL_ZOOM,
      attributionControl: false,
    });

    // The wrapping <div> is the single keyboard widget; pan/zoom comes from
    // our handler so there is no duplicate tab stop or double-handled key.
    map.keyboard.disable();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      const canvas = map.getCanvas();
      canvas.setAttribute("tabindex", "-1");
      canvas.setAttribute("aria-hidden", "true");

      map.addSource("aoi-preview", {
        type: "geojson",
        data: buildPreviewFeatureCollection([], "idle"),
      });
      map.addLayer({
        id: "aoi-preview-fill",
        type: "fill",
        source: "aoi-preview",
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.2 },
        filter: ["==", ["geometry-type"], "Polygon"],
      });
      map.addLayer({
        id: "aoi-preview-outline",
        type: "line",
        source: "aoi-preview",
        paint: { "line-color": "#38bdf8", "line-width": 2 },
      });
      map.addLayer({
        id: "aoi-preview-points",
        type: "circle",
        source: "aoi-preview",
        paint: {
          "circle-radius": 4,
          "circle-color": "#38bdf8",
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 1.5,
        },
        filter: ["==", ["geometry-type"], "Point"],
      });

      if (initialPolygon && initialPolygon.coordinates[0]) {
        const bbox = polygonBbox(initialPolygon.coordinates[0]);
        if (bbox) {
          map.fitBounds(bbox, { padding: 48, duration: 0 });
        }
      }
    });

    map.on("click", (event) => {
      commitVertex([
        Number(event.lngLat.lng.toFixed(6)),
        Number(event.lngLat.lat.toFixed(6)),
      ]);
    });

    map.on("dblclick", (event) => {
      event.preventDefault();
      closePolygon();
    });

    map.on("contextmenu", (event) => {
      event.preventDefault();
      undo();
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Handlers read state via refs, so a single registration is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("aoi-preview") as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(buildPreviewFeatureCollection(vertices, status));
  }, [vertices, status]);

  const handleMapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Mapbox inserts the zoom controls (real <button>s) into this container;
    // without this guard a keydown on a focused zoom button bubbles here and
    // would commit a stray vertex while cancelling the button's activation.
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
        event.preventDefault();
        closePolygon();
        break;
      case "Escape":
        if (verticesRef.current.length > 0) {
          event.preventDefault();
          clear();
        }
        break;
      default:
        break;
    }
  };

  const save = async () => {
    setError(null);
    setSavedMessage(null);

    const polygon =
      status === "closed" && vertices.length >= 3
        ? ({
            type: "Polygon",
            coordinates: [[...vertices, vertices[0]]],
          } as AoiPolygon)
        : null;

    if (status === "drawing") {
      setError("Double-click the map (or press C) to close the polygon before saving.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/aerial/missions/${missionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aoiGeojson: polygon }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? `Save failed (${response.status})`);
      }
      setSavedMessage(polygon ? "AOI saved." : "AOI cleared.");
      onSaved?.(polygon);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error while saving AOI.");
    } finally {
      setSaving(false);
    }
  };

  if (!MAPBOX_ACCESS_TOKEN) {
    return (
      <StateBlock
        title="Map unavailable"
        description="NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN is not set. AOI drawing requires a Mapbox token."
        tone="warning"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl border border-border">
        <div
          ref={mapContainerRef}
          role="application"
          tabIndex={0}
          aria-roledescription="Interactive AOI drawing map"
          aria-label="Mission area-of-interest drawing map"
          aria-describedby={instructionsId}
          onKeyDown={handleMapKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="h-[420px] w-full bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        {isFocused ? (
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2">
            <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary/80 shadow" />
            <span className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-primary/80" />
            <span className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-primary/80" />
          </div>
        ) : null}
        <div className="absolute bottom-3 left-3 max-w-[85%] rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
          {status === "idle" && vertices.length === 0
            ? "Click the map or press Enter to add vertices. Double-click or press C to close. Right-click or Backspace removes the last vertex."
            : null}
          {status === "drawing"
            ? `${vertices.length} vertex${vertices.length === 1 ? "" : "es"} · double-click or press C to close`
            : null}
          {status === "closed" ? `Polygon closed (${vertices.length} vertices).` : null}
        </div>
      </div>

      <p id={instructionsId} className="text-xs text-muted-foreground">
        Mouse: click to add vertices, double-click to close, right-click to remove the last vertex.
        Keyboard: focus the map, use arrow keys to pan and +/− to zoom, Enter to add a vertex at the
        center crosshair, Backspace to remove the last, C to close the polygon, Escape to clear.
      </p>

      {error ? (
        <StateBlock title="Editor error" description={error} tone="danger" compact />
      ) : null}
      {savedMessage ? (
        <StateBlock title="Saved" description={savedMessage} tone="info" compact />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving…" : status === "closed" ? "Save AOI" : "Save (closes polygon)"}
        </Button>
        <Button type="button" variant="outline" onClick={clear} disabled={saving}>
          Clear
        </Button>
      </div>

      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

function dropClosingVertex(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1);
  }
  return ring;
}

function buildPreviewFeatureCollection(
  vertices: [number, number][],
  status: EditorStatus
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = vertices.map((position, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: position },
    properties: { index },
  }));

  if (status === "closed" && vertices.length >= 3) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[...vertices, vertices[0]]],
      },
      properties: {},
    });
  } else if (status === "drawing" && vertices.length >= 2) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: vertices },
      properties: {},
    });
  }

  return { type: "FeatureCollection", features };
}

// Returns null for an empty ring: an AOI with no vertices has no center, and
// inventing one would put the operator somewhere they never drew.
function polygonCenter(ring: [number, number][]): [number, number] | null {
  if (ring.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  const positions = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  for (const [lng, lat] of positions) {
    sumLng += lng;
    sumLat += lat;
  }
  return [sumLng / positions.length, sumLat / positions.length];
}

function polygonBbox(
  ring: [number, number][]
): [[number, number], [number, number]] | null {
  if (ring.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng)) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
