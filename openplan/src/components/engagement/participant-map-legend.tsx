"use client";

import { useState } from "react";

import type { ParticipantContextLayer, ParticipantContextLayerSet } from "@/lib/engagement/context-layers";

/**
 * The legend for operator-supplied context on a participant map.
 *
 * WHY THIS IS NOT OPTIONAL. A resident looking at an unlabelled blue line learns
 * nothing from it, and may well assume it is a street. The operator names the
 * layer; that name has to reach the person being asked for an opinion, or the
 * geometry is decoration. So every drawn layer appears here, with the colour it
 * is drawn in, and the swatch shape says whether it is an area, a line, or a
 * point.
 *
 * IT ALSO CARRIES THE BAD NEWS. Two things a map must never hide:
 *
 *   - a layer that was TRUNCATED at this deployment's feature cap draws fewer
 *     parcels than the file held, and "where the parcels stop" is exactly the
 *     kind of thing a resident reads as a boundary;
 *   - a layer list that could not be READ at all is not an empty list. Without
 *     the disclosure, a failed query renders as a bare basemap, which states —
 *     confidently, and without anyone having checked — that this project has no
 *     geometry to show.
 *
 * Rendering nothing when there is nothing to say is deliberate: an empty legend
 * box over a map is noise, and a campaign with no context layers is the ordinary
 * case.
 */
export function ParticipantMapLegend({
  contextLayers,
  className,
}: {
  contextLayers: ParticipantContextLayerSet | null | undefined;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const layers = contextLayers?.layers ?? [];
  const readFailure = contextLayers?.readFailure ?? null;
  if (layers.length === 0 && !readFailure) return null;

  const coverageNotes = layers.flatMap((layer) => layer.coverageNotes);

  return (
    <aside
      aria-label="Map layers"
      className={
        className ??
        "absolute bottom-3 right-3 z-10 max-w-[min(20rem,70%)] rounded-lg border border-border/60 bg-background/95 text-xs shadow-sm backdrop-blur-sm"
      }
    >
      <button
        type="button"
        onClick={() => setCollapsed((previous) => !previous)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-3 px-3 py-1.5 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>Map layers</span>
        <span aria-hidden>{collapsed ? "▸" : "▾"}</span>
      </button>

      {collapsed ? null : (
        <div className="space-y-2 px-3 pb-2">
          {layers.length > 0 ? (
            <ul role="list" className="space-y-1.5">
              {layers.map((layer) => (
                <li key={layer.id} className="flex items-start gap-2">
                  <LegendSwatch layer={layer} />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{layer.name}</span>
                    {layer.description ? (
                      <span className="block text-muted-foreground">{layer.description}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {coverageNotes.length > 0 ? (
            <ul role="list" className="space-y-1 border-t border-border/60 pt-2 text-muted-foreground">
              {coverageNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          {readFailure ? (
            <p className="border-t border-border/60 pt-2 text-muted-foreground">
              The project layers for this map could not be loaded, so none are drawn. That is not a finding that
              there are none. ({readFailure})
            </p>
          ) : null}
        </div>
      )}
    </aside>
  );
}

/**
 * Shape carries the geometry kind, colour carries identity. A layer with mixed
 * geometry gets the shape of its heaviest kind — an area reads as an area even
 * when a few labelled points ride along with it.
 */
function LegendSwatch({ layer }: { layer: ParticipantContextLayer }) {
  const kinds = new Set(layer.geometryKinds);
  const color = layer.color;

  if (kinds.has("Polygon")) {
    return (
      <span
        aria-hidden
        className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-[2px] border"
        style={{ backgroundColor: `${color}40`, borderColor: color }}
      />
    );
  }

  if (kinds.has("LineString")) {
    return (
      <span aria-hidden className="mt-[0.4rem] inline-block h-[3px] w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
    );
  }

  return (
    <span aria-hidden className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
  );
}
