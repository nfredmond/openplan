"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import { useTheme } from "next-themes";
import "mapbox-gl/dist/mapbox-gl.css";

import { aerialMissionFeatureToSelection } from "@/lib/cartographic/mission-feature-to-selection";
import { projectFeatureToSelection } from "@/lib/cartographic/project-feature-to-selection";
import { corridorFeatureToSelection } from "@/lib/cartographic/corridor-feature-to-selection";
import { rtpCycleFeatureToSelection } from "@/lib/cartographic/rtp-cycle-feature-to-selection";
import { tractFeatureToSelection } from "@/lib/cartographic/tract-feature-to-selection";
import { engagementItemFeatureToSelection } from "@/lib/cartographic/engagement-item-feature-to-selection";
import { fitInstructionFromGeometry } from "@/lib/cartographic/geometry-bbox";

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

const RTP_CYCLES_SOURCE_ID = "cartographic-rtp-cycles";
const RTP_CYCLES_CIRCLE_LAYER_ID = "cartographic-rtp-cycles-circle";

const CENSUS_TRACTS_SOURCE_ID = "cartographic-census-tracts";
const CENSUS_TRACTS_FILL_LAYER_ID = "cartographic-census-tracts-fill";
const CENSUS_TRACTS_OUTLINE_LAYER_ID = "cartographic-census-tracts-outline";

const ENGAGEMENT_SOURCE_ID = "cartographic-engagement-items";
const ENGAGEMENT_CIRCLE_LAYER_ID = "cartographic-engagement-items-layer";

const KNOWN_SOURCES = [
  AOI_SOURCE_ID,
  PROJECTS_SOURCE_ID,
  CORRIDORS_SOURCE_ID,
  RTP_CYCLES_SOURCE_ID,
  CENSUS_TRACTS_SOURCE_ID,
  ENGAGEMENT_SOURCE_ID,
] as const;

const FEATURE_LAYERS = [
  AOI_FILL_LAYER_ID,
  PROJECTS_CIRCLE_LAYER_ID,
  CORRIDORS_LINE_LAYER_ID,
  RTP_CYCLES_CIRCLE_LAYER_ID,
  CENSUS_TRACTS_FILL_LAYER_ID,
  ENGAGEMENT_CIRCLE_LAYER_ID,
] as const;

// Sequential teal ramp for the equity choropleth, painted on
// `pctZeroVehicle`. Bins mirror the legend entry so the visual key lines
// up with what the backdrop draws. The `null` fallthrough renders tracts
// with missing data in a neutral mid-gray rather than the lightest bin,
// so viewers can distinguish "no data" from "<5% zero-vehicle".
const EQUITY_RAMP_NULL = "#cccccc";
const EQUITY_RAMP_COLORS = {
  lowest: "#d4e8e5", // <5%
  low: "#8fb5b0", //   5–10%
  mid: "#4d847c", //   10–15%
  high: "#1f544c", // >15%
} as const;

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

// Fit-to-selection viewport targets. maxZoom keeps a tiny feature (single
// small polygon, short corridor) from punching past neighborhood scale on
// fitBounds; padding leaves room for UI chrome on the sides. POINT_ZOOM
// lands projects at neighborhood scale so the marker has spatial context.
const FIT_PADDING = 64;
const FIT_MAX_ZOOM = 15;
const FIT_DURATION_MS = 400;
const POINT_FIT_ZOOM = 14;

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
type RtpCycleFeatureCollection = MissionAoiFeatureCollection;
type CensusTractFeatureCollection = MissionAoiFeatureCollection;
type EngagementFeatureCollection = MissionAoiFeatureCollection;

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
  const [rtpCycles, setRtpCycles] = useState<RtpCycleFeatureCollection | null>(null);
  const [censusTracts, setCensusTracts] =
    useState<CensusTractFeatureCollection | null>(null);
  const [engagementItems, setEngagementItems] =
    useState<EngagementFeatureCollection | null>(null);
  const { layers } = useCartographicLayers();
  const { selection, setSelection, clearSelection } = useCartographicSelection();
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

  // Same pattern for RTP cycle pins — separate source + circle layer.
  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/rtp-cycles", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] rtp-cycles fetch returned ${response.status}`,
            );
          }
          return;
        }
        const payload = (await response.json()) as RtpCycleFeatureCollection;
        if (cancelled) return;
        if (payload && payload.type === "FeatureCollection") {
          setRtpCycles(payload);
        }
      } catch (error) {
        console.warn("[cartographic-backdrop] rtp-cycles fetch failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppressed]);

  // Same pattern for the equity census-tract choropleth. Public data, but the
  // route still auth-gates so public landing pages don't pull a large GeoJSON
  // payload for no reason. Payload is workspace-agnostic.
  useEffect(() => {
    if (suppressed) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/map-features/census-tracts", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] census-tracts fetch returned ${response.status}`,
            );
          }
          return;
        }
        const payload = (await response.json()) as CensusTractFeatureCollection;
        if (cancelled) return;
        if (payload && payload.type === "FeatureCollection") {
          setCensusTracts(payload);
        }
      } catch (error) {
        console.warn("[cartographic-backdrop] census-tracts fetch failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppressed]);

  // Same pattern for approved engagement items — low-weight point features
  // that keep community input visible without overwhelming heavier geometry.
  useEffect(() => {
    if (suppressed) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/map-features/engagement", {
          method: "GET",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status !== 401) {
            console.warn(
              `[cartographic-backdrop] engagement fetch returned ${response.status}`,
            );
          }
          return;
        }
        const payload = (await response.json()) as EngagementFeatureCollection;
        if (controller.signal.aborted) return;
        if (payload && payload.type === "FeatureCollection") {
          setEngagementItems(payload);
        }
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        console.warn("[cartographic-backdrop] engagement fetch failed", error);
      }
    })();
    return () => controller.abort();
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

  // Paint RTP cycle pins onto the map once both the map and the data are
  // ready. Distinct muted-plum color separates the single-cycle pin from
  // project markers (green) and AOIs (orange). Larger base radius because
  // RTP cycles are typically 1-2 per workspace — the pin should read as a
  // prominent anchor, not a minor dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !rtpCycles) return;

    const paint = () => {
      if (!map.getSource(RTP_CYCLES_SOURCE_ID)) {
        map.addSource(RTP_CYCLES_SOURCE_ID, {
          type: "geojson",
          data: rtpCycles as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(RTP_CYCLES_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(rtpCycles as unknown as GeoJSON.FeatureCollection);
      }

      if (!map.getLayer(RTP_CYCLES_CIRCLE_LAYER_ID)) {
        map.addLayer({
          id: RTP_CYCLES_CIRCLE_LAYER_ID,
          type: "circle",
          source: RTP_CYCLES_SOURCE_ID,
          paint: {
            "circle-color": "#6b4a9e",
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              12,
              8,
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              3,
              2,
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
  }, [ready, rtpCycles, resolvedTheme]);

  // Paint census tracts as an equity choropleth once both the map and the
  // data are ready. Separate source so feature-state highlight never
  // cross-contaminates. Step expression bins `pctZeroVehicle` into 4 teal
  // shades; null values render in neutral gray so "no data" reads as
  // distinct from "<5% zero-vehicle". Tracts paint beneath all other
  // data-driven layers so point/line features remain picker-friendly —
  // `beforeId` wiring uses the first existing feature layer it finds to
  // force z-order regardless of source add-order.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !censusTracts) return;

    const paint = () => {
      if (!map.getSource(CENSUS_TRACTS_SOURCE_ID)) {
        map.addSource(CENSUS_TRACTS_SOURCE_ID, {
          type: "geojson",
          data: censusTracts as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(CENSUS_TRACTS_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(censusTracts as unknown as GeoJSON.FeatureCollection);
      }

      // Force tracts beneath point/line layers so a clicked AOI, project,
      // corridor, or RTP pin still picks up first. Pick the first rendered
      // feature-layer id that currently exists on the style.
      const beforeId = [
        AOI_FILL_LAYER_ID,
        PROJECTS_CIRCLE_LAYER_ID,
        CORRIDORS_LINE_LAYER_ID,
        RTP_CYCLES_CIRCLE_LAYER_ID,
        ENGAGEMENT_CIRCLE_LAYER_ID,
      ].find((id) => map.getLayer(id));

      if (!map.getLayer(CENSUS_TRACTS_FILL_LAYER_ID)) {
        map.addLayer(
          {
            id: CENSUS_TRACTS_FILL_LAYER_ID,
            type: "fill",
            source: CENSUS_TRACTS_SOURCE_ID,
            paint: {
              "fill-color": [
                "case",
                ["==", ["get", "pctZeroVehicle"], null],
                EQUITY_RAMP_NULL,
                [
                  "step",
                  ["get", "pctZeroVehicle"],
                  EQUITY_RAMP_COLORS.lowest,
                  5,
                  EQUITY_RAMP_COLORS.low,
                  10,
                  EQUITY_RAMP_COLORS.mid,
                  15,
                  EQUITY_RAMP_COLORS.high,
                ],
              ],
              "fill-opacity": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                0.7,
                0.45,
              ],
            },
          },
          beforeId,
        );
      }

      if (!map.getLayer(CENSUS_TRACTS_OUTLINE_LAYER_ID)) {
        map.addLayer(
          {
            id: CENSUS_TRACTS_OUTLINE_LAYER_ID,
            type: "line",
            source: CENSUS_TRACTS_SOURCE_ID,
            paint: {
              "line-color": "#1f544c",
              "line-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                1.75,
                0.75,
              ],
              "line-opacity": 0.55,
            },
          },
          beforeId,
        );
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, censusTracts, resolvedTheme]);

  // Paint approved engagement points above the equity choropleth but below
  // primary project/RTP pins when those layers are present.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !engagementItems) return;

    const paint = () => {
      if (!map.getSource(ENGAGEMENT_SOURCE_ID)) {
        map.addSource(ENGAGEMENT_SOURCE_ID, {
          type: "geojson",
          data: engagementItems as unknown as GeoJSON.FeatureCollection,
        });
      } else {
        const source = map.getSource(ENGAGEMENT_SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.setData(engagementItems as unknown as GeoJSON.FeatureCollection);
      }

      const beforeId = [
        PROJECTS_CIRCLE_LAYER_ID,
        RTP_CYCLES_CIRCLE_LAYER_ID,
      ].find((id) => map.getLayer(id));

      if (!map.getLayer(ENGAGEMENT_CIRCLE_LAYER_ID)) {
        map.addLayer(
          {
            id: ENGAGEMENT_CIRCLE_LAYER_ID,
            type: "circle",
            source: ENGAGEMENT_SOURCE_ID,
            paint: {
              "circle-color": "#c24a7f",
              "circle-radius": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                8,
                5,
              ],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                2.25,
                1.25,
              ],
              "circle-opacity": 0.9,
            },
          },
          beforeId,
        );
      }
    };

    if (map.isStyleLoaded()) {
      paint();
    } else {
      map.once("style.load", paint);
    }
  }, [ready, engagementItems, resolvedTheme]);

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

  // Honor the layers.rtp toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.rtp ? "visible" : "none";
    if (map.getLayer(RTP_CYCLES_CIRCLE_LAYER_ID)) {
      try {
        map.setLayoutProperty(RTP_CYCLES_CIRCLE_LAYER_ID, "visibility", visibility);
      } catch {
        // no-op: layers.rtp toggle is best-effort
      }
    }
  }, [layers.rtp, ready, rtpCycles]);

  // Honor the layers.equity toggle. Fill + outline toggled together so the
  // choropleth reads as a single layer from the user's perspective.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.equity ? "visible" : "none";
    for (const layerId of [CENSUS_TRACTS_FILL_LAYER_ID, CENSUS_TRACTS_OUTLINE_LAYER_ID]) {
      if (map.getLayer(layerId)) {
        try {
          map.setLayoutProperty(layerId, "visibility", visibility);
        } catch {
          // no-op: layers.equity toggle is best-effort
        }
      }
    }
  }, [layers.equity, ready, censusTracts]);

  // Honor the layers.engagement toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const visibility = layers.engagement ? "visible" : "none";
    if (map.getLayer(ENGAGEMENT_CIRCLE_LAYER_ID)) {
      try {
        map.setLayoutProperty(ENGAGEMENT_CIRCLE_LAYER_ID, "visibility", visibility);
      } catch {
        // no-op: layers.engagement toggle is best-effort
      }
    }
  }, [layers.engagement, ready, engagementItems]);

  // Click + hover handlers on the AOI fill layer. Handlers are registered on
  // the map once ready and torn down on unmount. They survive style swaps
  // because the registration is layer-id-scoped, not source-scoped.
  //
  // Fit-on-click uses the feature geometry directly from the click event
  // rather than reading it back from the source — avoids any round-trip
  // through `queryRenderedFeatures` and stays decoupled from the selection
  // state (so fitting fires on user-initiated clicks only, never from list
  // row hovers that `setSelection` without touching the map).
  //
  // Background click-to-clear fires on the map-level click. Mapbox dispatches
  // layer clicks before the map click, but the map click still fires for
  // every click, so the handler uses `queryRenderedFeatures` against the
  // three known feature layers to distinguish feature hits from background
  // hits.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const fitToFeatureGeometry = (geometry: unknown) => {
      const instruction = fitInstructionFromGeometry(geometry);
      if (!instruction) return;
      if (instruction.kind === "center") {
        map.easeTo({
          center: instruction.center,
          zoom: POINT_FIT_ZOOM,
          duration: FIT_DURATION_MS,
        });
        return;
      }
      map.fitBounds(instruction.bbox, {
        padding: FIT_PADDING,
        maxZoom: FIT_MAX_ZOOM,
        duration: FIT_DURATION_MS,
      });
    };

    const onClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = aerialMissionFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: AOI_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
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
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    const onCorridorClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = corridorFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: CORRIDORS_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    const onRtpClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = rtpCycleFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: RTP_CYCLES_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    const onTractClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = tractFeatureToSelection(feature.properties, {
        sourceId: CENSUS_TRACTS_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    const onEngagementClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const nextSelection = engagementItemFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
        sourceId: ENGAGEMENT_SOURCE_ID,
      });
      if (nextSelection) {
        setSelection(nextSelection);
        fitToFeatureGeometry(feature.geometry);
      }
    };

    const onBackgroundClick = (e: mapboxgl.MapMouseEvent) => {
      const renderedLayers = FEATURE_LAYERS.filter((layerId) => map.getLayer(layerId));
      if (renderedLayers.length === 0) {
        // No feature layers mounted yet — any click is background.
        clearSelection();
        return;
      }
      const hits = map.queryRenderedFeatures(e.point, { layers: renderedLayers });
      if (hits.length === 0) {
        clearSelection();
      }
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
    map.on("click", RTP_CYCLES_CIRCLE_LAYER_ID, onRtpClick);
    map.on("mouseenter", RTP_CYCLES_CIRCLE_LAYER_ID, onMouseEnter);
    map.on("mouseleave", RTP_CYCLES_CIRCLE_LAYER_ID, onMouseLeave);
    map.on("click", CENSUS_TRACTS_FILL_LAYER_ID, onTractClick);
    map.on("mouseenter", CENSUS_TRACTS_FILL_LAYER_ID, onMouseEnter);
    map.on("mouseleave", CENSUS_TRACTS_FILL_LAYER_ID, onMouseLeave);
    map.on("click", ENGAGEMENT_CIRCLE_LAYER_ID, onEngagementClick);
    map.on("mouseenter", ENGAGEMENT_CIRCLE_LAYER_ID, onMouseEnter);
    map.on("mouseleave", ENGAGEMENT_CIRCLE_LAYER_ID, onMouseLeave);
    map.on("click", onBackgroundClick);

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
      map.off("click", RTP_CYCLES_CIRCLE_LAYER_ID, onRtpClick);
      map.off("mouseenter", RTP_CYCLES_CIRCLE_LAYER_ID, onMouseEnter);
      map.off("mouseleave", RTP_CYCLES_CIRCLE_LAYER_ID, onMouseLeave);
      map.off("click", CENSUS_TRACTS_FILL_LAYER_ID, onTractClick);
      map.off("mouseenter", CENSUS_TRACTS_FILL_LAYER_ID, onMouseEnter);
      map.off("mouseleave", CENSUS_TRACTS_FILL_LAYER_ID, onMouseLeave);
      map.off("click", ENGAGEMENT_CIRCLE_LAYER_ID, onEngagementClick);
      map.off("mouseenter", ENGAGEMENT_CIRCLE_LAYER_ID, onMouseEnter);
      map.off("mouseleave", ENGAGEMENT_CIRCLE_LAYER_ID, onMouseLeave);
      map.off("click", onBackgroundClick);
    };
  }, [ready, setSelection, clearSelection]);

  // Highlight the selected feature by writing feature-state.selected = true.
  // Paint expressions on every source-backed layer read from feature-state,
  // so the visual lift happens without re-adding layers. Re-runs on data
  // + selection change because setStyle() wipes feature-state along with
  // sources/layers. Dispatch on sourceId so a project selection never
  // lights up an AOI and vice-versa.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

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
  }, [selection, ready, aois, projectMarkers, corridors, rtpCycles, censusTracts, engagementItems]);

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
