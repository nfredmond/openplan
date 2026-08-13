"use client";

import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";

import { workspaceGisClickableLayerIds } from "@/lib/cartographic/workspace-gis-map-layers";
import type { WorkspaceGisLayerListing } from "@/lib/workspace-gis/types";

/** What the map stage shows about the shape under the pointer. */
export type HoveredWorkspaceFeature = {
  layerName: string;
  /** The layer's own label field value, when the planner chose one. */
  label: string | null;
  /** A few attributes, in the order the file carried them. */
  attributes: Array<{ field: string; value: string }>;
};

/** How many attributes a hover readout shows before it stops. */
const MAX_HOVER_ATTRIBUTES = 6;

/**
 * Read the workspace layer under the pointer, in Corridor Analysis's own idiom.
 *
 * ═══ WHY HOVER, AND NOT THE SHELL'S INSPECTOR DOCK ═══
 *
 * The shell backdrop answers a click on a workspace feature by opening the
 * inspector dock. That dock is CSS-hidden on this route — Explore owns its map —
 * so wiring a click here would set a selection nothing renders: the planner
 * clicks a parcel and nothing at all happens, which is worse than no
 * interaction. Unhiding the dock over Explore's stage is a second layout problem
 * rather than a bonus.
 *
 * Explore already reads a tract and a crash on hover, and a planner on this page
 * has learned that pointing at a thing tells you about it. This is the same
 * gesture for the agency's own shapes.
 *
 * ═══ WHY ONE MAP-LEVEL HANDLER RATHER THAN ONE PER LAYER ═══
 *
 * `map.on("mousemove", layerId, …)` needs the layer id at registration time, and
 * these ids are rows in a table — a layer uploaded five minutes from now has no
 * id yet. Re-registering every handler whenever the catalog changes drops
 * whatever gesture is in flight, so the handler is registered once and reads the
 * live catalog through refs, exactly as the shell backdrop's click handler does.
 */
export function useExploreWorkspaceGisHover({
  mapRef,
  mapReady,
  layers,
  visibility,
}: {
  mapRef: { current: mapboxgl.Map | null };
  mapReady: boolean;
  layers: WorkspaceGisLayerListing[];
  visibility: Record<string, boolean>;
}): HoveredWorkspaceFeature | null {
  const [hovered, setHovered] = useState<HoveredWorkspaceFeature | null>(null);
  const layersRef = useRef(layers);
  const visibilityRef = useRef(visibility);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    visibilityRef.current = visibility;
  }, [visibility]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    /** The workspace's own drawing layers that are currently on this map. */
    const renderedLayerIds = (): string[] =>
      layersRef.current
        .filter((listing) => visibilityRef.current[listing.layer.id] === true)
        .flatMap((listing) => workspaceGisClickableLayerIds(listing.layer.id))
        .filter((layerId) => map.getLayer(layerId));

    const onMove = (event: mapboxgl.MapMouseEvent) => {
      const layerIds = renderedLayerIds();
      if (layerIds.length === 0) {
        setHovered(null);
        return;
      }

      const hit = map.queryRenderedFeatures(event.point, { layers: layerIds })[0];
      if (!hit) {
        setHovered(null);
        return;
      }

      const properties = (hit.properties ?? {}) as Record<string, unknown>;
      const listing = layersRef.current.find(
        (candidate) => candidate.layer.id === properties.layerId,
      );
      // The layer's NAME comes from the catalog, never from the clicked feature:
      // the feature carries ids, and a name assembled from the data would be a
      // guess about which column is the name.
      if (!listing) {
        setHovered(null);
        return;
      }

      // Attributes arrive as JSON text, because Mapbox's vector-tile encoder
      // carries only scalar property values through a GeoJSON source. See the
      // painter module's header — this is the other half of that fact.
      let attributes: Record<string, unknown> = {};
      const raw = properties.attributes;
      if (typeof raw === "string") {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            attributes = parsed as Record<string, unknown>;
          }
        } catch {
          // A shape whose attributes will not parse still has a layer name and a
          // position, and saying "this is your parcels layer" is worth more than
          // showing nothing at all.
        }
      } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        attributes = raw as Record<string, unknown>;
      }

      const labelField = listing.layer.style.labelField;
      const labelValue = labelField ? attributes[labelField] : undefined;

      setHovered({
        layerName: listing.layer.name,
        label:
          labelValue === null || labelValue === undefined || labelValue === ""
            ? null
            : String(labelValue),
        attributes: Object.entries(attributes)
          .slice(0, MAX_HOVER_ATTRIBUTES)
          .map(([field, value]) => ({
            field,
            // An attribute a file left blank is shown as an em dash rather than
            // dropped: "this column exists and is empty here" and "this column
            // does not exist" are different facts about the data.
            value: value === null || value === undefined || value === "" ? "—" : String(value),
          })),
      });
    };

    const onLeave = () => setHovered(null);

    map.on("mousemove", onMove);
    map.on("mouseout", onLeave);

    return () => {
      map.off("mousemove", onMove);
      map.off("mouseout", onLeave);
    };
  }, [mapRef, mapReady]);

  return hovered;
}
