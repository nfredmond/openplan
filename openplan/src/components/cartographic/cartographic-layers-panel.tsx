"use client";

import { useEffect, useState } from "react";

import { LAYER_KEYS, useCartographicLayers, type LayerKey } from "./cartographic-context";
import { useTheme } from "@/components/theme-provider";
import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import type { MapFeatureCounts } from "@/app/api/map-features/counts/route";

const HAS_MAPBOX_BASEMAP = Boolean(
  resolvePublicMapboxToken(
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  ),
);

const LAYER_LABELS: Record<LayerKey, string> = {
  projects: "Projects",
  rtp: "RTP cycles",
  corridors: "Study corridors",
  engagement: "Engagement pins",
  aerial: "Aerial missions",
  equity: "Equity priority",
};

const COMPACT_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatChip(count: number | null | undefined): string | undefined {
  if (count === null || count === undefined) return undefined;
  if (count === 0) return "0";
  return count < 1000 ? String(count) : COMPACT_FORMATTER.format(count);
}

/**
 * The equity layer's coverage sentences.
 *
 * Fetched here rather than read from the backdrop's own request because the
 * note has to be visible whether or not the layer is toggled on: the chip is
 * rendered for every row regardless of the checkbox, so a number without its
 * explanation is exactly the unexplained figure this disclosure exists to
 * prevent.
 */
type EquityCoverage = { scopeState: string; coverageNotes: string[] };

export function CartographicLayersPanel({ workspaceId = null }: { workspaceId?: string | null }) {
  const { layers, toggleLayer } = useCartographicLayers();
  const { resolvedTheme } = useTheme();
  const [counts, setCounts] = useState<MapFeatureCounts | null>(null);
  const [equityCoverage, setEquityCoverage] = useState<EquityCoverage | null>(null);
  const [themeMounted, setThemeMounted] = useState(false);

  useEffect(() => {
    // One-shot mount gate so the theme-dependent basemap label matches SSR output.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeMounted(true);
  }, []);

  const basemapLabel = HAS_MAPBOX_BASEMAP
    ? `Mapbox ${themeMounted && resolvedTheme === "dark" ? "dark" : "light"}`
    : "Civic parchment";

  // `workspaceId` is in the dep array so a workspace switch — which is a soft
  // RSC refresh, not a remount — refetches. Without it the panel would keep
  // showing the previous workspace's counts and, worse, a scope sentence naming
  // the previous workspace's county under the new workspace's map.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/map-features/counts", { signal: controller.signal, credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) return null;
        return response.json() as Promise<MapFeatureCounts>;
      })
      .then((payload) => {
        if (payload) setCounts(payload);
      })
      .catch((error) => {
        if ((error as { name?: string }).name === "AbortError") return;
        if (process.env.NODE_ENV !== "production") {
          console.warn("[cartographic-layers-panel] counts fetch failed", error);
        }
      });
    return () => controller.abort();
  }, [workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/map-features/census-tracts", { signal: controller.signal, credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<EquityCoverage>) : null))
      .then((payload) => {
        if (!payload || !Array.isArray(payload.coverageNotes)) return;
        setEquityCoverage({ scopeState: payload.scopeState, coverageNotes: payload.coverageNotes });
      })
      .catch((error) => {
        if ((error as { name?: string }).name === "AbortError") return;
        if (process.env.NODE_ENV !== "production") {
          console.warn("[cartographic-layers-panel] equity coverage fetch failed", error);
        }
      });
    return () => controller.abort();
  }, [workspaceId]);

  return (
    <aside className="op-cart-layers" aria-label="Map layers">
      <div className="op-cart-layers__hd">Layers</div>
      <ul className="op-cart-layers__list" role="list">
        {LAYER_KEYS.map((key) => {
          const chipValue = chipForLayer(key, counts);
          return (
            <li key={key}>
              <label className="op-cart-layer-item">
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={() => toggleLayer(key)}
                />
                <span className="op-cart-layer-item__label">{LAYER_LABELS[key]}</span>
                {chipValue !== undefined ? (
                  <span className="op-cart-layer-item__chip">{chipValue}</span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
      {equityCoverage && equityCoverage.coverageNotes.length > 0 ? (
        <div className="op-cart-layers__notes" role="note" aria-label="Equity layer coverage">
          {equityCoverage.coverageNotes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}
      <div className="op-cart-layers__ft">
        Basemap: <strong>{basemapLabel}</strong>
      </div>
    </aside>
  );
}

function chipForLayer(key: LayerKey, counts: MapFeatureCounts | null): string | undefined {
  if (!counts) return undefined;
  if (key === "projects") return formatChip(counts.projects);
  if (key === "aerial") return formatChip(counts.aerial);
  if (key === "corridors") return formatChip(counts.corridors);
  if (key === "rtp") return formatChip(counts.rtp);
  if (key === "equity") return formatChip(counts.equity);
  if (key === "engagement") return formatChip(counts.engagement);
  return undefined;
}
