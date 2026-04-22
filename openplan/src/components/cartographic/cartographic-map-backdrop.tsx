"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import { useTheme } from "next-themes";
import "mapbox-gl/dist/mapbox-gl.css";

import { aerialMissionFeatureToSelection } from "@/lib/cartographic/mission-feature-to-selection";
import { projectFeatureToSelection } from "@/lib/cartographic/project-feature-to-selection";
import { corridorFeatureToSelection } from "@/lib/cartographic/corridor-feature-to-selection";

import { useCartographicLayers, useCartographicSelection } from "./cartographic-context";

const MAPBOX_ACCESS_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

// Routes that own their own map and should suppress the shell backdrop.
const MAP_OWNING_ROUTES = ["/explore"];

// Default map center when a map has no data attached to it yet. Grass Valley, CA —
// seat of Nevada County and the home-region reference point for the NCTC demo.
const DEFAULT_CENTER: [number, number] = [-121.033982, 39.239137];
const DEFAULT_ZOOM = 9.5;

const AOI_SOURCE_ID = "cartographic-aerial-mission-aois";
const AOI_FILL_LAYER_ID = "cartographic-aerial-mission-aois-fill";
const AOI_OUTLINE_LAYER_ID = "cartographic-aerial-mission-aois-outline";

const PROJECTS_SOURCE_ID = "cartographic-projects";
const PROJECTS_CIRCLE_LAYER_ID = "cartographic-projects-circle";

const CORRIDORS_SOURCE_ID = "cartographic-corridors";
const CORRIDORS_LINE_LAYER_ID = "cartographic-corridors-line";

// LOS-driven color ramp. Lower grades degrade from calm blue-slate toward
// congestion red, matching planning convention. `null` falls through to the
// neutral base, keeping the ramp layer-agnostic for corridors without LOS.
const CORRIDOR_LOS_COLOR: Record<string, string> = {
  A: "#4a7a9e",
  B: "#4a7a9e",
  C: "#c8962f",
  D: "#c8962f",
  E: "#b45239",
  F: "#8a2e24",
};
const CORRIDOR_BASE_COLOR = "#4a7a9e";

type MissionAoiFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string;
    geometry: unknown;
    properties: Record<string, unknown>;
  }>;
};

type ProjectFeatureCollection = MissionAoiFeatureCollection;
type CorridorFeatureCollection = MissionAoiFeatureCollection;

function routeOwnsMap(pathname: string): boolean {
  return MAP_OWNING_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function CartographicMapBackdrop() {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(() => !MAPBOX_ACCESS_TOKEN);
  const [aois, setAois] = useState<MissionAoiFeatureCollection | null>(null);
  const [projectMarkers, setProjectMarkers] = useState<ProjectFeatureCollection | null>(null);
  const [corridors, setCorridors] = useState<CorridorFeatureCollection | null>(null);
  const { layers } = useCartographicLayers();
  const { selection, setSelection } = useCartographicSelection();
  const router = useRouter();
  const navigateRef = useRef<(path: string) => void>((path) => router.push(path));
  useEffect(() => {
    navigateRef.current = (path: string) => router.push(path);
  }, [router]);

  const suppressed = routeOwnsMap(pathname);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (suppressed) {
      document.body.dataset.mapOwner = "true";
    } else {
      delete document.body.dataset.mapOwner;
    }
    return () => {
      if (typeof document !== "undefined") {
        delete document.body.dataset.mapOwner;
      }
    };
  }, [suppressed]);

  useEffect(() => {
    if (suppressed) return;
    if (!containerRef.current || mapRef.current) return;
    if (!MAPBOX_ACCESS_TOKEN) {
      // Fall back to the CSS parchment gradient (no Mapbox) — still visually on-brand.
      return;
    }

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const styleUrl =
      resolvedTheme === "dark"
        ? "mapbox://styles/mapbox/dark-v11"
        : "mapbox://styles/mapbox/light-v11";

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      logoPosition: "bottom-left",
      interactive: true,
      pitchWithRotate: false,
      dragRotate: false,
    });

    map.on("load", () => setReady(true));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [suppressed, resolvedTheme]);

  // Swap style when theme toggles (without tearing down the whole map).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const styleUrl =
      resolvedTheme === "dark"
        ? "mapbox://styles/mapbox/dark-v11"
        : "mapbox://styles/mapbox/light-v11";
    try {
      map.setStyle(styleUrl);
    } catch {
      // no-op: style change is best-effort
    }
  }, [resolvedTheme]);

  // Fetch workspace-scoped mission AOIs once the shell is mounted. Unauthenticated
  // calls return 401 and we silently render no polygons — the public landing
  // routes don't use the shell backdrop, so this only fires for signed-in sessions.
  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/aerial-missions", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          // 401 on anon sessions is expected and silent; surface everything
          // else so a real 500 is at least greppable in devtools.
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] aerial-missions fetch returned ${response.status}`,
            );
          }
          return;
        }
        const payload = (await response.json()) as MissionAoiFeatureCollection;
        if (cancelled) return;
        if (payload && payload.type === "FeatureCollection") {
          setAois(payload);
        }
      } catch (error) {
        // Network failures render as "no AOIs" rather than surfacing error UI,
        // but still log so the failure is diagnosable.
        console.warn("[cartographic-backdrop] aerial-missions fetch failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppressed]);

  // Same pattern for project markers — separate source + circle layer.
  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/projects", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] projects fetch returned ${response.status}`,
            );
          }
          return;
        }
        const payload = (await response.json()) as ProjectFeatureCollection;
        if (cancelled) return;
        if (payload && payload.type === "FeatureCollection") {
          setProjectMarkers(payload);
        }
      } catch (error) {
        console.warn("[cartographic-backdrop] projects fetch failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppressed]);

  // Same pattern for project corridors — separate source + line layer.
  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/corridors", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] corridors fetch returned ${response.status}`,
            );
          }
          return;
        }
        const payload = (await response.json()) as CorridorFeatureCollection;
        if (cancelled) return;
        if (payload && payload.type === "FeatureCollection") {
          setCorridors(payload);
        }
      } catch (error) {
        console.warn("[cartographic-backdrop] corridors fetch failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppressed]);

  // Paint AOIs onto the map once both the map and the data are ready.
  // Runs again on style swaps because setStyle() wipes the source/layer registry.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !aois) return;

    const paint = () => {
      if (!map.getSource(AOI_SOURCE_ID)) {
        map.addSource(AOI_SOURCE_ID, {
          type: "geojson",
          data: aois as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(AOI_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(aois as unknown as GeoJSON.FeatureCollection);
      }

      if (!map.getLayer(AOI_FILL_LAYER_ID)) {
        map.addLayer({
          id: AOI_FILL_LAYER_ID,
          type: "fill",
          source: AOI_SOURCE_ID,
          paint: {
            "fill-color": "#e45635",
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              0.36,
              0.18,
            ],
          },
        });
      }

      if (!map.getLayer(AOI_OUTLINE_LAYER_ID)) {
        map.addLayer({
          id: AOI_OUTLINE_LAYER_ID,
          type: "line",
          source: AOI_SOURCE_ID,
          paint: {
            "line-color": "#e45635",
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              2.75,
              1.75,
            ],
            "line-opacity": 0.85,
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, aois, resolvedTheme]);

  // Paint project markers onto the map once both the map and the data are
  // ready. Separate source from AOIs so feature-state highlight never
  // cross-contaminates between the two layers. Accent-2 green (#1f6b5e)
  // keeps projects visually distinct from AOI orange.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !projectMarkers) return;

    const paint = () => {
      if (!map.getSource(PROJECTS_SOURCE_ID)) {
        map.addSource(PROJECTS_SOURCE_ID, {
          type: "geojson",
          data: projectMarkers as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(PROJECTS_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(projectMarkers as unknown as GeoJSON.FeatureCollection);
      }

      if (!map.getLayer(PROJECTS_CIRCLE_LAYER_ID)) {
        map.addLayer({
          id: PROJECTS_CIRCLE_LAYER_ID,
          type: "circle",
          source: PROJECTS_SOURCE_ID,
          paint: {
            "circle-color": "#1f6b5e",
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              9,
              6,
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              2.5,
              1.5,
            ],
            "circle-opacity": 0.92,
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, projectMarkers, resolvedTheme]);

  // Paint corridor LineStrings onto the map once both the map and the data
  // are ready. Separate source from AOIs + projects so feature-state
  // highlight never cross-contaminates. LOS-driven color via a match
  // expression on feature properties — lines without LOS fall back to the
  // calm base color so un-graded corridors still render legibly.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !corridors) return;

    const paint = () => {
      if (!map.getSource(CORRIDORS_SOURCE_ID)) {
        map.addSource(CORRIDORS_SOURCE_ID, {
          type: "geojson",
          data: corridors as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(CORRIDORS_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(corridors as unknown as GeoJSON.FeatureCollection);
      }

      if (!map.getLayer(CORRIDORS_LINE_LAYER_ID)) {
        map.addLayer({
          id: CORRIDORS_LINE_LAYER_ID,
          type: "line",
          source: CORRIDORS_SOURCE_ID,
          paint: {
            "line-color": [
              "match",
              ["get", "losGrade"],
              "A",
              CORRIDOR_LOS_COLOR.A,
              "B",
              CORRIDOR_LOS_COLOR.B,
              "C",
              CORRIDOR_LOS_COLOR.C,
              "D",
              CORRIDOR_LOS_COLOR.D,
              "E",
              CORRIDOR_LOS_COLOR.E,
              "F",
              CORRIDOR_LOS_COLOR.F,
              CORRIDOR_BASE_COLOR,
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              5,
              3,
            ],
            "line-opacity": 0.9,
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
        });
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, corridors, resolvedTheme]);

  // Honor the layers.aerial toggle from the cartographic context.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.aerial ? "visible" : "none";
    for (const layerId of [AOI_FILL_LAYER_ID, AOI_OUTLINE_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        try {
          map.setLayoutProperty(layerId, "visibility", visibility);
        } catch {
          // no-op: layers.aerial toggle is best-effort
        }
      }
    }
  }, [layers.aerial, ready, aois]);

  // Honor the layers.projects toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.projects ? "visible" : "none";
    if (map.getLayer(PROJECTS_CIRCLE_LAYER_ID)) {
      try {
        map.setLayoutProperty(PROJECTS_CIRCLE_LAYER_ID, "visibility", visibility);
      } catch {
        // no-op: layers.projects toggle is best-effort
      }
    }
  }, [layers.projects, ready, projectMarkers]);

  // Honor the layers.corridors toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.corridors ? "visible" : "none";
    if (map.getLayer(CORRIDORS_LINE_LAYER_ID)) {
      try {
        map.setLayoutProperty(CORRIDORS_LINE_LAYER_ID, "visibility", visibility);
      } catch {
        // no-op: layers.corridors toggle is best-effort
      }
    }
  }, [layers.corridors, ready, corridors]);

  // Click + hover handlers on the AOI fill layer. Handlers are registered on
  // the map once ready and torn down on unmount. They survive style swaps
  // because the registration is layer-id-scoped, not source-scoped.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const onClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = aerialMissionFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: AOI_SOURCE_ID,
      });
      if (nextSelection) setSelection(nextSelection);
    };
    const onMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    const onProjectClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = projectFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: PROJECTS_SOURCE_ID,
      });
      if (nextSelection) setSelection(nextSelection);
    };

    const onCorridorClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = corridorFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: CORRIDORS_SOURCE_ID,
      });
      if (nextSelection) setSelection(nextSelection);
    };

    map.on("click", AOI_FILL_LAYER_ID, onClick);
    map.on("mouseenter", AOI_FILL_LAYER_ID, onMouseEnter);
    map.on("mouseleave", AOI_FILL_LAYER_ID, onMouseLeave);
    map.on("click", PROJECTS_CIRCLE_LAYER_ID, onProjectClick);
    map.on("mouseenter", PROJECTS_CIRCLE_LAYER_ID, onMouseEnter);
    map.on("mouseleave", PROJECTS_CIRCLE_LAYER_ID, onMouseLeave);
    map.on("click", CORRIDORS_LINE_LAYER_ID, onCorridorClick);
    map.on("mouseenter", CORRIDORS_LINE_LAYER_ID, onMouseEnter);
    map.on("mouseleave", CORRIDORS_LINE_LAYER_ID, onMouseLeave);

    return () => {
      map.off("click", AOI_FILL_LAYER_ID, onClick);
      map.off("mouseenter", AOI_FILL_LAYER_ID, onMouseEnter);
      map.off("mouseleave", AOI_FILL_LAYER_ID, onMouseLeave);
      map.off("click", PROJECTS_CIRCLE_LAYER_ID, onProjectClick);
      map.off("mouseenter", PROJECTS_CIRCLE_LAYER_ID, onMouseEnter);
      map.off("mouseleave", PROJECTS_CIRCLE_LAYER_ID, onMouseLeave);
      map.off("click", CORRIDORS_LINE_LAYER_ID, onCorridorClick);
      map.off("mouseenter", CORRIDORS_LINE_LAYER_ID, onMouseEnter);
      map.off("mouseleave", CORRIDORS_LINE_LAYER_ID, onMouseLeave);
    };
  }, [ready, setSelection]);

  // Highlight the selected feature by writing feature-state.selected = true.
  // Paint expressions on every source-backed layer read from feature-state,
  // so the visual lift happens without re-adding layers. Re-runs on data
  // + selection change because setStyle() wipes feature-state along with
  // sources/layers. Dispatch on sourceId so a project selection never
  // lights up an AOI and vice-versa.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const KNOWN_SOURCES = [AOI_SOURCE_ID, PROJECTS_SOURCE_ID, CORRIDORS_SOURCE_ID] as const;

    const apply = () => {
      for (const sourceId of KNOWN_SOURCES) {
        if (!map.getSource(sourceId)) continue;
        try {
          map.removeFeatureState({ source: sourceId });
        } catch {
          // no-op: nothing to clear
        }
      }
      const ref = selection?.featureRef;
      if (ref && (KNOWN_SOURCES as readonly string[]).includes(ref.sourceId)) {
        try {
          map.setFeatureState(
            { source: ref.sourceId, id: ref.featureId },
            { selected: true },
          );
        } catch {
          // no-op: feature may not yet be loaded on this source
        }
      }
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once("style.load", apply);
    }
  }, [selection, ready, aois, projectMarkers, corridors]);

  if (suppressed) return null;

  const usingMapbox = Boolean(MAPBOX_ACCESS_TOKEN);

  return (
    <div
      aria-hidden
      className="op-map-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        // D2 parchment fallback — radial gradients over base bg
        background: usingMapbox
          ? "var(--bg)"
          : [
              "radial-gradient(1200px 700px at 70% 40%, var(--map-park) 0%, transparent 45%)",
              "radial-gradient(900px 500px at 20% 70%, var(--map-water) 0%, transparent 40%)",
              "radial-gradient(700px 400px at 80% 80%, var(--map-2) 0%, transparent 60%)",
              "var(--map-1)",
            ].join(","),
      }}
    >
      {usingMapbox ? (
        <div
          ref={containerRef}
          className="op-map-backdrop__canvas"
          style={{
            position: "absolute",
            inset: 0,
            opacity: ready ? 1 : 0,
            transition: "opacity 300ms ease",
            filter:
              resolvedTheme === "dark"
                ? "saturate(0.8) brightness(0.95)"
                : "saturate(0.7) contrast(0.95)",
          }}
        />
      ) : null}
      {/* Parchment warm-tint overlay so Mapbox light style feels cartographic. */}
      {usingMapbox ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              resolvedTheme === "dark"
                ? "linear-gradient(180deg, rgba(17,22,24,0.2) 0%, rgba(17,22,24,0.35) 100%)"
                : "linear-gradient(180deg, rgba(244,241,236,0.3) 0%, rgba(244,241,236,0.12) 100%)",
          }}
        />
      ) : null}
    </div>
  );
}
