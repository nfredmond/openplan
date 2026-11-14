"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { Bbox } from "@/lib/geo/crs/area-of-use";
import { deploymentMapEngine, startMap, styleForEngine } from "@/lib/maps/map-engine";
import { whenStyleAccepts } from "@/lib/maps/when-style-accepts";

/** Mapbox with a public key, else MapLibre with the operator's open style. */
const MAP_ENGINE = deploymentMapEngine();

const EXTENT_SOURCE_ID = "gis-preview-extent";
const EXTENT_FILL_LAYER_ID = "gis-preview-extent-fill";
const EXTENT_LINE_LAYER_ID = "gis-preview-extent-line";
/** The overlay colour the Mapbox static image uses. */
const EXTENT_COLOR = "#c1440e";

function extentFeature(bbox: Bbox): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [bbox.west, bbox.south],
          [bbox.east, bbox.south],
          [bbox.east, bbox.north],
          [bbox.west, bbox.north],
          [bbox.west, bbox.south],
        ],
      ],
    },
  };
}

function extentBounds(bbox: Bbox): [[number, number], [number, number]] {
  return [
    [bbox.west, bbox.south],
    [bbox.east, bbox.north],
  ];
}

/**
 * The file's extent on the operator's open style, for a deployment with no
 * Mapbox key.
 *
 * Mapbox draws this picture with its static image API. MapLibre has none, so
 * the same rectangle goes on a small map that does not pan or zoom: still one
 * glance at one question. Loaded only on a deployment that uses it.
 */
export function ExtentPreviewMap({
  bbox,
  label,
  onCannotStart,
}: {
  bbox: Bbox;
  label: string;
  /** The browser could not start MapLibre; the caller says so in words. */
  onCannotStart: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const bboxRef = useRef(bbox);
  const onCannotStartRef = useRef(onCannotStart);
  // Set once the extent layers exist, so a later bbox can be drawn into them.
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    bboxRef.current = bbox;
    onCannotStartRef.current = onCannotStart;
  }, [bbox, onCannotStart]);

  useEffect(() => {
    const container = containerRef.current;
    const style = styleForEngine(MAP_ENGINE, "");
    if (!container || !style) return;

    return startMap(MAP_ENGINE, mapboxgl, (gl) => {
      const map = new gl.Map({
        container,
        style,
        bounds: extentBounds(bboxRef.current),
        fitBoundsOptions: { padding: 40 },
        interactive: false,
        attributionControl: false,
      });
      mapRef.current = map;
      // The style's own sources are credited, as the static image credits Mapbox's.
      map.addControl(new gl.AttributionControl({ compact: true }), "bottom-right");

      // Bound at construction, so it cannot miss the event.
      map.on("load", () => {
        map.addSource(EXTENT_SOURCE_ID, { type: "geojson", data: extentFeature(bboxRef.current) });
        map.addLayer({
          id: EXTENT_FILL_LAYER_ID,
          type: "fill",
          source: EXTENT_SOURCE_ID,
          paint: { "fill-color": EXTENT_COLOR, "fill-opacity": 0.25 },
        });
        map.addLayer({
          id: EXTENT_LINE_LAYER_ID,
          type: "line",
          source: EXTENT_SOURCE_ID,
          paint: { "line-color": EXTENT_COLOR, "line-width": 3 },
        });
        setMapReady(true);
      });

      return () => {
        map.remove();
        mapRef.current = null;
        setMapReady(false);
      };
    }, () => onCannotStartRef.current());
  }, []);

  // A different coordinate system moves the extent. Waits for the style rather
  // than asking `isStyleLoaded()` once, which answers false while tiles stream.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    return whenStyleAccepts(map, () => {
      const source = map.getSource(EXTENT_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      source?.setData(extentFeature(bbox));
      map.fitBounds(extentBounds(bbox), { padding: 40, duration: 0 });
    });
  }, [bbox, mapReady]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={label}
      className="op-gis-preview__live-map"
      data-testid="gis-preview-extent-map"
    />
  );
}
