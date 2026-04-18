"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";

const MAPBOX_ACCESS_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export type AoiPolygon = {
  type: "Polygon";
  coordinates: [number, number][][];
};

type EditorStatus = "idle" | "drawing" | "closed";

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

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const center = initialPolygon && initialPolygon.coordinates[0]
      ? polygonCenter(initialPolygon.coordinates[0])
      : ([-121.0, 39.2] as [number, number]);

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center,
      zoom: 10,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
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
      if (status === "closed") return;
      const next: [number, number] = [
        Number(event.lngLat.lng.toFixed(6)),
        Number(event.lngLat.lat.toFixed(6)),
      ];
      setVertices((prev) => [...prev, next]);
      setStatus("drawing");
      setError(null);
      setSavedMessage(null);
    });

    map.on("dblclick", (event) => {
      event.preventDefault();
      setVertices((prev) => {
        if (prev.length < 3) {
          setError("Draw at least 3 vertices before closing the polygon.");
          return prev;
        }
        setStatus("closed");
        return prev;
      });
    });

    map.on("contextmenu", (event) => {
      event.preventDefault();
      setVertices((prev) => {
        if (prev.length === 0) return prev;
        if (status === "closed") setStatus(prev.length > 1 ? "drawing" : "idle");
        return prev.slice(0, -1);
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("aoi-preview") as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(buildPreviewFeatureCollection(vertices, status));
  }, [vertices, status]);

  const clear = () => {
    setVertices([]);
    setStatus("idle");
    setError(null);
    setSavedMessage(null);
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
      setError("Double-click the map to close the polygon before saving.");
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
        <div ref={mapContainerRef} className="h-[420px] w-full bg-muted/10" />
        <div className="absolute bottom-3 left-3 rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
          {status === "idle" && vertices.length === 0
            ? "Click the map to add vertices. Double-click to close. Right-click removes the last vertex."
            : null}
          {status === "drawing"
            ? `${vertices.length} vertex${vertices.length === 1 ? "" : "es"} · double-click to close`
            : null}
          {status === "closed" ? `Polygon closed (${vertices.length} vertices).` : null}
        </div>
      </div>

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

function polygonCenter(ring: [number, number][]): [number, number] {
  if (ring.length === 0) return [-121.0, 39.2];
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
