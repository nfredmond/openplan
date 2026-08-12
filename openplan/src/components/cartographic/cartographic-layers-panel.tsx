"use client";

import { useEffect, useState } from "react";

import {
  LAYER_KEYS,
  useCartographicLayers,
  useCartographicLayerStatus,
  useWorkspaceMapLayers,
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
  const {
    workspaceLayers,
    workspaceLayerVisibility,
    toggleWorkspaceLayer,
    workspaceLayerStatus,
    workspaceCatalogError,
  } = useWorkspaceMapLayers();
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
  const coverageNotes = [
    ...LAYER_KEYS.flatMap((key) => {
      const status = layerStatus[key];
      if (!status) return [];
      if (status.workspaceId !== workspaceId) return [];
      return status.notes;
    }),
    /*
      The workspace's own layers put their sentences in the SAME block, not a
      section of their own.

      This is where "Parcels: 214,391 shapes in this view — more than OpenPlan
      draws at once. Zoom in." appears, and it is the most important sentence on
      this panel: it is the only thing on screen distinguishing a layer that is
      too dense to draw from a layer that is empty. Putting it beside the built-in
      layers' caveats rather than in a separate list is deliberate — a planner
      reading "N coverage notes" should find every reason the map is not showing
      them everything, from one summary, in one place.

      A note carried by a version — an asserted coordinate system, a NAD27 datum
      caveat — rides in this same list, because the route sends it with every
      viewport read for exactly that reason.
    */
    ...workspaceLayers.flatMap((listing) => {
      const status = workspaceLayerStatus[listing.layer.id];
      if (!status) return [];
      if (status.workspaceId !== workspaceId) return [];
      return status.notes;
    }),
  ];

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
      {workspaceLayers.length > 0 || workspaceCatalogError ? (
        /*
          THE AGENCY'S OWN LAYERS, in their own group under their own heading.

          Separated from the nine above because they are a different KIND of
          thing and the distinction is load-bearing: everything above is a record
          OpenPlan keeps, and everything here is a file the agency uploaded. A
          planner who cannot tell those apart cannot tell whether a wrong shape
          is OpenPlan's fault or their own shapefile's.

          The swatch carries the layer's actual drawn colour rather than a
          generic bullet, so the list is readable against a map with four layers
          on it — which is the whole reason a colour control exists.
        */
        <>
          <div className="op-cart-layers__hd op-cart-layers__hd--sub">Your map layers</div>
          {/*
            A FAILED READ SAYS SO, rather than rendering as an empty list.

            These two states produce the same empty array and mean opposite
            things: "this agency has uploaded nothing" and "OpenPlan could not
            find out". Shown ABOVE the list and as an alert, because whatever
            follows it — nothing, or a partial list from an earlier read — has
            to be read in its light.
          */}
          {workspaceCatalogError ? (
            <p className="op-cart-layer-item__note" role="alert">
              {workspaceCatalogError}
            </p>
          ) : null}
          <ul className="op-cart-layers__list" role="list">
            {workspaceLayers.map((listing) => {
              const layer = listing.layer;
              const version = layer.currentVersion;
              return (
                <li key={layer.id}>
                  <label className="op-cart-layer-item">
                    <input
                      type="checkbox"
                      checked={workspaceLayerVisibility[layer.id] === true}
                      onChange={() => toggleWorkspaceLayer(layer.id)}
                    />
                    <span
                      className="op-cart-layer-item__swatch"
                      style={{ backgroundColor: layer.style.color }}
                      aria-hidden
                    />
                    <span className="op-cart-layer-item__label">{layer.name}</span>
                    {/*
                      The chip is the layer's STORED shape count, not the number
                      drawn in this window — those differ constantly as the map
                      moves, and a chip that changed on every pan would read as
                      the layer gaining and losing shapes. A layer with no
                      finished upload gets no chip at all, and says so in words
                      instead, because a "0" here would read as an empty file.
                    */}
                    {version ? (
                      <span className="op-cart-layer-item__chip">
                        {formatChip(version.featureCount)}
                      </span>
                    ) : null}
                  </label>
                  {!version ? (
                    <p className="op-cart-layer-item__note" role="note">
                      No finished upload yet — nothing is drawn for this layer.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {coverageNotes.length > 0 ? (
        /*
          COLLAPSED BY DEFAULT, BUT PRESENT AND COUNTED.

          These are the honest disclosures — "this is not a finding that Columbus
          has no census tracts", "no crash source covers this area". They are
          paragraphs, and several of them turned the layers panel into the
          tallest thing on the map, which is how it ended up under the legend.

          A <details> is the right shape rather than dropping any of them: the
          summary states HOW MANY there are and that coverage is limited, so the
          existence of a caveat is never hidden — only its wording is one click
          away. Silently truncating a coverage disclosure would be the defect
          these notes exist to prevent.
        */
        <details className="op-cart-layers__notes" aria-label="Map layer coverage">
          <summary className="op-cart-layers__notes-summary">
            {coverageNotes.length === 1
              ? "1 coverage note"
              : `${coverageNotes.length} coverage notes`}
          </summary>
          <div role="note">
            {coverageNotes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </details>
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
