"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import { useTheme } from "next-themes";
import "mapbox-gl/dist/mapbox-gl.css";

import { aerialMissionFeatureToSelection } from "@/lib/cartographic/mission-feature-to-selection";

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

type MissionAoiFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string;
    geometry: unknown;
    properties: Record<string, unknown>;
  }>;
};

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
  const { layers } = useCartographicLayers();
  const { setSelection } = useCartographicSelection();
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
            "fill-opacity": 0.18,
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
            "line-width": 1.75,
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

  // Click + hover handlers on the AOI fill layer. Handlers are registered on
  // the map once ready and torn down on unmount. They survive style swaps
  // because the registration is layer-id-scoped, not source-scoped.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const onClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const selection = aerialMissionFeatureToSelection(feature.properties, {
        navigate: (path) => navigateRef.current(path),
      });
      if (selection) setSelection(selection);
    };
    const onMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", AOI_FILL_LAYER_ID, onClick);
    map.on("mouseenter", AOI_FILL_LAYER_ID, onMouseEnter);
    map.on("mouseleave", AOI_FILL_LAYER_ID, onMouseLeave);

    return () => {
      map.off("click", AOI_FILL_LAYER_ID, onClick);
      map.off("mouseenter", AOI_FILL_LAYER_ID, onMouseEnter);
      map.off("mouseleave", AOI_FILL_LAYER_ID, onMouseLeave);
    };
  }, [ready, setSelection]);

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
