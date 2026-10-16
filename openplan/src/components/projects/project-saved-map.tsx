"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { MapUnavailableNotice } from "@/components/ui/map-unavailable-notice";
import { applyFitInstruction } from "@/lib/cartographic/geometry-bbox";
import { fitInstructionFromSavedGeometry } from "@/lib/cartographic/saved-geometry-frame";
import { keepMapSizedToContainer } from "@/lib/mapbox/keep-map-sized";
import { deploymentMapEngine, startMap, styleForEngine } from "@/lib/maps/map-engine";
import { whenStyleAccepts } from "@/lib/maps/when-style-accepts";

const MAP_ENGINE = deploymentMapEngine();
const SOURCE = "project-saved-geography";

/**
 * Draw the validated project-record features supplied by the export inventory.
 * This map reads saved geometry only. Location and corridor drafts stay in their
 * editors until the server confirms them and refreshes the project record.
 */
export function ProjectSavedMap({ collection }: { collection: GeoJSON.FeatureCollection }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const latestCollectionRef = useRef(collection);
  const schedulePaintRef = useRef<(() => void) | null>(null);
  const [cannotStart, setCannotStart] = useState(false);
  const hasFeatures = collection.features.length > 0;

  useEffect(() => {
    latestCollectionRef.current = collection;
    schedulePaintRef.current?.();
  }, [collection]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasFeatures || cannotStart || MAP_ENGINE.kind === "none") return;

    return startMap(MAP_ENGINE, mapboxgl, (gl) => {
      const map = new gl.Map({
        container,
        style: styleForEngine(MAP_ENGINE, "mapbox://styles/mapbox/light-v11") as string,
        attributionControl: false,
      });
      let stopSizing = () => {};
      let cancelPaint = () => {};
      let framedCollection: GeoJSON.FeatureCollection | null = null;

      const paint = () => {
        const current = latestCollectionRef.current;
        const source = map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined;
        if (source) source.setData(current);
        else map.addSource(SOURCE, { type: "geojson", data: current });

        const layers: mapboxgl.AnyLayer[] = [
          { id: `${SOURCE}-area`, type: "fill", source: SOURCE, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#2563eb", "fill-opacity": 0.16 } },
          { id: `${SOURCE}-boundary`, type: "line", source: SOURCE, filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": "#2563eb", "line-width": 2 } },
          { id: `${SOURCE}-corridors`, type: "line", source: SOURCE, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#b45309", "line-width": 4 } },
          { id: `${SOURCE}-location`, type: "circle", source: SOURCE, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#1f6b5e", "circle-radius": 7, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } },
        ];
        for (const layer of layers) {
          if (!map.getLayer(layer.id)) map.addLayer(layer);
        }

        // Reframe for changed saved records, without moving the camera again
        // when a style reload restores the same geometry.
        if (framedCollection !== current && container.clientWidth > 0 && container.clientHeight > 0) {
          const instruction = fitInstructionFromSavedGeometry(current);
          if (instruction) applyFitInstruction(map, instruction);
          framedCollection = current;
        }
      };
      const schedulePaint = () => {
        cancelPaint();
        cancelPaint = whenStyleAccepts(map, paint);
      };

      try {
        stopSizing = keepMapSizedToContainer(map, container);
        map.addControl(new gl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new gl.AttributionControl({ compact: true }), "bottom-right");
        map.on("style.load", schedulePaint);
        // A closed project tab has no viewport to fit. The sizing helper's
        // first visible resize retries framing after the tab opens.
        map.on("resize", schedulePaint);
        map.on("error", () => {
          if (!map.getSource(SOURCE)) setCannotStart(true);
        });
        schedulePaintRef.current = schedulePaint;
        schedulePaint();
      } catch (error) {
        cancelPaint();
        stopSizing();
        map.remove();
        schedulePaintRef.current = null;
        throw error;
      }

      return () => {
        schedulePaintRef.current = null;
        cancelPaint();
        map.off("style.load", schedulePaint);
        map.off("resize", schedulePaint);
        stopSizing();
        map.remove();
      };
    }, () => setCannotStart(true));
  }, [hasFeatures, cannotStart]);

  if (!hasFeatures) return <p className="text-sm text-muted-foreground">No saved project shapes are available to draw.</p>;

  if (MAP_ENGINE.kind === "none" || cannotStart) {
    return (
      <MapUnavailableNotice
        cause={cannotStart ? "cannot_start" : "not_set_up"}
        unusableToken={MAP_ENGINE.kind === "none" && MAP_ENGINE.unusableToken}
        stillWorks="The saved layer inventory and GeoPackage download remain available."
      />
    );
  }

  return (
    <figure className="space-y-2">
      <div ref={containerRef} className="h-[360px] w-full overflow-hidden rounded-lg border border-border" role="img" aria-label="Saved project study area, site marker and corridors" />
      <figcaption className="text-xs text-muted-foreground">
        Saved project shapes: blue project boundary, green site marker, amber corridors.
        These shapes do not establish jurisdiction or surveyed boundaries. Map sources appear on the map.
      </figcaption>
    </figure>
  );
}
