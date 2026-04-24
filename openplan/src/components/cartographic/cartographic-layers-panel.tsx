"use client";

import { useEffect, useState } from "react";

import { LAYER_KEYS, useCartographicLayers, type LayerKey } from "./cartographic-context";
import type { MapFeatureCounts } from "@/app/api/map-features/counts/route";

const LAYER_LABELS: Record<LayerKey, string> = {
  projects: "Projects",
  rtp: "RTP cycles",
  corridors: "Study corridors",
  engagement: "Engagement pins",
  aerial: "Aerial missions",
  transit: "GTFS transit",
  crashes: "Crash density",
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

export function CartographicLayersPanel() {
  const { layers, toggleLayer } = useCartographicLayers();
  const [counts, setCounts] = useState<MapFeatureCounts | null>(null);

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
  }, []);

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
      <div className="op-cart-layers__ft">
        Basemap: <strong>Civic parchment</strong>
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
