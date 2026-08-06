"use client";

import { useEffect, useState } from "react";

import {
  LAYER_KEYS,
  useCartographicLayers,
  useCartographicLayerStatus,
  type LayerKey,
} from "./cartographic-context";
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
  // "Areas", not "Boundaries": this is the area a project studies, which is a
  // different fact from the project's site marker on the `projects` layer.
  projectAreas: "Project areas",
  rtp: "RTP cycles",
  corridors: "Study corridors",
  engagement: "Engagement pins",
  aerial: "Aerial missions",
  equity: "Equity priority",
  // "Acquired" is load-bearing. This layer draws collisions this workspace has
  // pulled into its own record — not everything a source knows about the area —
  // and the label is the first place a planner can learn that.
  crashes: "Crashes (acquired)",
  // Every word here is doing work. "Stops" says what is drawn and, by omission,
  // what is not — there are no route lines, because an alignment needs
  // shapes.txt and this product does not parse it. "Ingested feeds" says whose
  // transit: the feeds this workspace brought in, never the region's operators
  // as a whole. A planner who reads only the checkbox still learns both.
  transit: "Transit stops (ingested feeds)",
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

export function CartographicLayersPanel({ workspaceId = null }: { workspaceId?: string | null }) {
  const { layers, toggleLayer } = useCartographicLayers();
  const { layerStatus } = useCartographicLayerStatus();
  const { resolvedTheme } = useTheme();
  const [counts, setCounts] = useState<MapFeatureCounts | null>(null);
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

  /**
   * Notes for every layer, not just the toggled-on ones: chips render for every
   * row regardless of the checkbox, so a number without its explanation is the
   * unexplained figure this disclosure exists to prevent. A status recorded for
   * a DIFFERENT workspace is dropped rather than shown — a switch is a soft RSC
   * refresh, and a note naming the previous workspace's data under the new
   * workspace's map would be an affirmatively false claim.
   */
  const coverageNotes = LAYER_KEYS.flatMap((key) => {
    const status = layerStatus[key];
    if (!status) return [];
    if (status.workspaceId !== workspaceId) return [];
    return status.notes;
  });

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
      {coverageNotes.length > 0 ? (
        <div className="op-cart-layers__notes" role="note" aria-label="Map layer coverage">
          {coverageNotes.map((note) => (
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
  if (key === "projectAreas") return formatChip(counts.projectAreas);
  if (key === "aerial") return formatChip(counts.aerial);
  if (key === "corridors") return formatChip(counts.corridors);
  if (key === "rtp") return formatChip(counts.rtp);
  if (key === "equity") return formatChip(counts.equity);
  if (key === "engagement") return formatChip(counts.engagement);
  // Null until an acquisition exists, so no chip is rendered rather than a "0"
  // that would read as a crash finding — see the counts route.
  if (key === "crashes") return formatChip(counts.crashes);
  // No chip for transit, deliberately. `/api/map-features/counts` carries no
  // transit figure, and the number that would belong here is not the one a
  // planner would read off it: the drawn count is stops on ONE representative
  // weekday from the versions currently in use, so a bare "2,821" beside a
  // checkbox would be a service-level figure with none of its qualifications
  // attached. The layer's coverage notes carry the number with its sentence.
  return undefined;
}
