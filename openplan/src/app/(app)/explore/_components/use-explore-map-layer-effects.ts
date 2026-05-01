"use client";

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { GeoJSONSource, Map as MapboxMap, MapboxGeoJSONFeature, MapMouseEvent } from "mapbox-gl";
import type {
  CrashSeverityFilter,
  CrashUserFilter,
} from "@/lib/analysis/map-view-state";
import type {
  AnalysisContextResponse,
  AnalysisResult,
  CorridorGeometry,
  HoveredCrash,
  HoveredTract,
  TractMetric,
} from "./_types";
import { buildCrashLayerFilter, getBoundsFromGeometry } from "./_helpers";
import { buildHoveredCrash } from "./explore-crash-hover-state";
import { syncDatasetOverlayMap } from "./explore-dataset-overlay-map";
import { resolveActiveDatasetOverlay } from "./explore-page-state";
import { buildHoveredTract, buildTractMetricPaintExpression } from "./explore-tract-layer-state";

type UseExploreMapLayerEffectsParams = {
  mapRef: RefObject<MapboxMap | null>;
  mapReady: boolean;
  analysisContext: AnalysisContextResponse | null;
  activeDatasetOverlayId: string | null;
  analysisResult: AnalysisResult | null;
  corridorGeojson: CorridorGeometry | null;
  cameraMode: "regional" | "cinematic";
  showPolygonFill: boolean;
  showPoints: boolean;
  showTracts: boolean;
  showCrashes: boolean;
  tractMetric: TractMetric;
  crashSeverityFilter: CrashSeverityFilter;
  crashUserFilter: CrashUserFilter;
  setHoveredTract: Dispatch<SetStateAction<HoveredTract | null>>;
  setHoveredCrash: Dispatch<SetStateAction<HoveredCrash | null>>;
};

export function useExploreMapLayerEffects({
  mapRef,
  mapReady,
  analysisContext,
  activeDatasetOverlayId,
  analysisResult,
  corridorGeojson,
  cameraMode,
  showPolygonFill,
  showPoints,
  showTracts,
  showCrashes,
  tractMetric,
  crashSeverityFilter,
  crashUserFilter,
  setHoveredTract,
  setHoveredCrash,
}: UseExploreMapLayerEffectsParams): void {
  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const source = mapRef.current.getSource("analysis-result") as
      | GeoJSONSource
      | undefined;

    if (source) {
      source.setData(
        analysisResult?.geojson ||
          (corridorGeojson
            ? {
                type: "FeatureCollection",
                features: [{ type: "Feature", properties: { preview: true }, geometry: corridorGeojson }],
              }
            : { type: "FeatureCollection", features: [] })
      );
    }

    if (corridorGeojson) {
      const bounds = getBoundsFromGeometry(corridorGeojson);
      if (bounds) {
        mapRef.current.fitBounds(bounds, { padding: 56, duration: 650, pitch: cameraMode === "cinematic" ? 54 : 34 });
      }
    }
  }, [analysisResult, cameraMode, corridorGeojson, mapRef]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    if (mapRef.current.getLayer("analysis-fill")) {
      mapRef.current.setLayoutProperty("analysis-fill", "visibility", showPolygonFill ? "visible" : "none");
    }

    if (mapRef.current.getLayer("analysis-outline")) {
      mapRef.current.setLayoutProperty("analysis-outline", "visibility", showPolygonFill ? "visible" : "none");
    }

    if (mapRef.current.getLayer("analysis-outline-highlight")) {
      mapRef.current.setLayoutProperty("analysis-outline-highlight", "visibility", showPolygonFill ? "visible" : "none");
    }
  }, [mapRef, showPolygonFill]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    if (mapRef.current.getLayer("tract-fill")) {
      mapRef.current.setLayoutProperty("tract-fill", "visibility", showTracts ? "visible" : "none");
    }

    if (mapRef.current.getLayer("tract-outline")) {
      mapRef.current.setLayoutProperty("tract-outline", "visibility", showTracts ? "visible" : "none");
    }

    if (!showTracts) {
      setHoveredTract(null);
    }
  }, [mapRef, setHoveredTract, showTracts]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.getLayer("analysis-points")) {
      return;
    }

    mapRef.current.setLayoutProperty("analysis-points", "visibility", showPoints ? "visible" : "none");
  }, [mapRef, showPoints]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const visibility = showCrashes ? "visible" : "none";
    if (mapRef.current.getLayer("crash-points-glow")) {
      mapRef.current.setLayoutProperty("crash-points-glow", "visibility", visibility);
    }
    if (mapRef.current.getLayer("crash-points-core")) {
      mapRef.current.setLayoutProperty("crash-points-core", "visibility", visibility);
    }

    if (!showCrashes) {
      setHoveredCrash(null);
    }
  }, [mapRef, setHoveredCrash, showCrashes]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.getLayer("crash-points-core")) {
      return;
    }

    const crashFilterExpression = buildCrashLayerFilter(crashSeverityFilter, crashUserFilter);

    mapRef.current.setFilter("crash-points-core", crashFilterExpression);
    if (mapRef.current.getLayer("crash-points-glow")) {
      mapRef.current.setFilter("crash-points-glow", crashFilterExpression);
    }

    setHoveredCrash(null);
  }, [crashSeverityFilter, crashUserFilter, mapRef, setHoveredCrash]);

  useEffect(() => {
    if (!mapRef.current || !mapReady || !mapRef.current.getLayer("crash-points-core")) {
      return;
    }

    const map = mapRef.current;

    const handleCrashEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handleCrashLeave = () => {
      map.getCanvas().style.cursor = "";
      setHoveredCrash(null);
    };

    const handleCrashMove = (event: MapMouseEvent & { features?: MapboxGeoJSONFeature[] }) => {
      setHoveredCrash(buildHoveredCrash(event.features?.[0]?.properties));
    };

    map.on("mouseenter", "crash-points-core", handleCrashEnter);
    map.on("mousemove", "crash-points-core", handleCrashMove);
    map.on("mouseleave", "crash-points-core", handleCrashLeave);

    return () => {
      if (!map.getLayer("crash-points-core")) {
        return;
      }

      map.off("mouseenter", "crash-points-core", handleCrashEnter);
      map.off("mousemove", "crash-points-core", handleCrashMove);
      map.off("mouseleave", "crash-points-core", handleCrashLeave);
      map.getCanvas().style.cursor = "";
    };
  }, [mapReady, mapRef, setHoveredCrash]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    syncDatasetOverlayMap({
      map: mapRef.current,
      selectedDataset: resolveActiveDatasetOverlay(analysisContext, activeDatasetOverlayId),
      analysisResult,
      corridorGeojson,
    });
  }, [activeDatasetOverlayId, analysisContext, analysisResult, corridorGeojson, mapRef]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    mapRef.current.easeTo({
      pitch: cameraMode === "cinematic" ? 54 : 34,
      bearing: cameraMode === "cinematic" ? -18 : -10,
      duration: 700,
    });
  }, [cameraMode, mapRef]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.getLayer("tract-fill")) {
      return;
    }

    mapRef.current.setPaintProperty("tract-fill", "fill-color", buildTractMetricPaintExpression(tractMetric));
  }, [mapRef, tractMetric]);

  useEffect(() => {
    if (!mapRef.current || !mapReady || !mapRef.current.getLayer("tract-fill")) {
      return;
    }

    const map = mapRef.current;

    const handleTractEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handleTractLeave = () => {
      map.getCanvas().style.cursor = "";
      setHoveredTract(null);
    };

    const handleTractMove = (event: MapMouseEvent & { features?: MapboxGeoJSONFeature[] }) => {
      setHoveredTract(buildHoveredTract(event.features?.[0]?.properties));
    };

    map.on("mouseenter", "tract-fill", handleTractEnter);
    map.on("mousemove", "tract-fill", handleTractMove);
    map.on("mouseleave", "tract-fill", handleTractLeave);

    return () => {
      if (!map.getLayer("tract-fill")) {
        return;
      }

      map.off("mouseenter", "tract-fill", handleTractEnter);
      map.off("mousemove", "tract-fill", handleTractMove);
      map.off("mouseleave", "tract-fill", handleTractLeave);
      map.getCanvas().style.cursor = "";
    };
  }, [mapReady, mapRef, setHoveredTract]);
}
