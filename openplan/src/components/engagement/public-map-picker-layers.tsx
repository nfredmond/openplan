"use client";

import { useId, useState } from "react";

import type {
  ParticipantContextLayer,
  ParticipantContextLayerSet,
} from "@/lib/engagement/context-layers";

/**
 * The control a member of the public uses to turn the project's map layers on
 * and off.
 *
 * ═══ WHAT IT MAY SHOW, AND WHY THAT IS ALREADY DECIDED ═══
 *
 * It takes a `ParticipantContextLayerSet` and offers exactly the layers in it —
 * no filtering of its own, no second source. That is deliberate. The publication
 * rule lives in ONE place, `loadParticipantContextLayers`, whose query filters
 * `visible_to_participants = true` against a table anon has no policy on; a
 * picker that re-derived "is this public?" from anything it was handed would be
 * a second answer to a question that must only have one. The type it accepts
 * cannot express an unpublished layer: `ParticipantContextLayer` has no
 * workspace id and no visibility flag, because a field that never crosses the
 * boundary cannot leak across it.
 *
 * WORKSPACE GIS LAYERS ARE NOT OFFERED HERE, and that is a finding rather than
 * an omission. `workspace_gis_layers` carries `default_visible`, which is the
 * planner's own map preference — whether a layer is switched on when THEY open
 * a map. There is no per-layer public-intent flag on that table at all. A
 * planner uploading parcels or right-of-way to their workspace has consented to
 * their colleagues seeing it and to nothing else, so exposing those layers here
 * would publish internal data on the strength of a setting that never meant
 * that. If workspace layers should reach a campaign, the honest route is the
 * one that already exists: the operator attaches the layer to the campaign,
 * where publishing is a decision with a warning attached
 * (`contextLayerPublicationWarning`).
 *
 * ═══ IT IS ALSO THE LEGEND ═══
 *
 * The swatch, the operator's name for the layer, the description, the
 * truncation notes and the read-failure sentence all live here, because a
 * checkbox list beside a separate legend makes a resident read the same layer
 * twice in two places. It therefore inherits the legend's hardest rule: a layer
 * list that could not be READ is not an empty list, and a map that quietly
 * draws only the basemap is stating — confidently, with nobody having checked —
 * that this project has no geometry to show.
 *
 * Turning a layer OFF is a display choice and does not suppress that layer's
 * coverage notes: "you are seeing 500 of 4,000 parcels" stays true whether or
 * not you are currently looking at them.
 *
 * ═══ LANGUAGE ═══
 *
 * OpenPlan's own words arrive through `labels`. The English defaults below are
 * the source of truth for whoever adds `portal.*` catalog keys; until they
 * exist, the caller must pass `lang="en"` (the default) so this element declares
 * the language it is actually written in, even inside a Farsi or Arabic
 * participant surface. The layer NAMES are the operator's words and are rendered
 * as the existing participant legend renders them.
 */

export type PublicMapLayerPickerLabels = {
  /** The group heading. Not "layers", not "basemap" — what a person would say. */
  heading: string;
  /** Sits under the heading. */
  hint: string;
  /** Accessible name for the collapse control when open/closed. */
  toggleLabel: string;
  /** Shown when the operator published no layers but a read failed. */
  readFailure: string;
  showAll: string;
  hideAll: string;
};

export const EN_PUBLIC_MAP_LAYER_PICKER_LABELS: PublicMapLayerPickerLabels = {
  heading: "What's on the map",
  hint: "Turn things on and off. This only changes what you see.",
  toggleLabel: "What's on the map",
  readFailure:
    "The project's map information could not be loaded, so none of it is drawn. That does not mean there is none.",
  showAll: "Show all",
  hideAll: "Hide all",
};

export type PublicMapLayerPickerProps = {
  /** Straight from `loadParticipantContextLayers` — publication already decided. */
  contextLayers: ParticipantContextLayerSet | null | undefined;
  /** Ids currently drawn. The caller owns this state and the map. */
  visibleLayerIds: readonly string[];
  /** Called with the full next set of visible ids. */
  onVisibleLayerIdsChange: (next: string[]) => void;
  labels?: PublicMapLayerPickerLabels;
  /** BCP-47 tag of the words in `labels`. Stamped on the element. */
  lang?: string;
  /** Positioning belongs to the shell, never to this component. */
  className?: string;
};

export function PublicMapLayerPicker({
  contextLayers,
  visibleLayerIds,
  onVisibleLayerIdsChange,
  labels = EN_PUBLIC_MAP_LAYER_PICKER_LABELS,
  lang = "en",
  className,
}: PublicMapLayerPickerProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const layers = contextLayers?.layers ?? [];
  const readFailure = contextLayers?.readFailure ?? null;

  // Nothing published and nothing broken is the ordinary case for a campaign,
  // and an empty control over a map is noise.
  if (layers.length === 0 && !readFailure) return null;

  const visible = new Set(visibleLayerIds);
  const coverageNotes = layers.flatMap((layer) => layer.coverageNotes);
  const allOn = layers.length > 0 && layers.every((layer) => visible.has(layer.id));

  const toggle = (layerId: string) => {
    const next = layers
      .map((layer) => layer.id)
      .filter((id) => (id === layerId ? !visible.has(id) : visible.has(id)));
    onVisibleLayerIdsChange(next);
  };

  return (
    <section
      lang={lang}
      className={className}
      data-testid="public-map-layer-picker"
      aria-label={labels.heading}
    >
      <button
        type="button"
        // A single tap target on a phone: the panel is closed until asked for,
        // so the control costs one button's worth of map and no more.
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-sm font-semibold text-foreground shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span>{labels.heading}</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="mt-1 max-h-[50dvh] overflow-y-auto rounded-lg border border-border/60 bg-background/95 p-3 text-xs shadow-sm backdrop-blur-sm"
      >
        <p className="text-muted-foreground">{labels.hint}</p>

        {layers.length > 1 ? (
          <button
            type="button"
            className="mt-2 min-h-11 rounded-md border border-border/60 px-2 py-1 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() =>
              onVisibleLayerIdsChange(allOn ? [] : layers.map((layer) => layer.id))
            }
          >
            {allOn ? labels.hideAll : labels.showAll}
          </button>
        ) : null}

        {layers.length > 0 ? (
          <ul role="list" className="mt-2 space-y-1">
            {layers.map((layer) => (
              <li key={layer.id}>
                <label className="flex min-h-11 cursor-pointer items-start gap-2 py-1">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={visible.has(layer.id)}
                    onChange={() => toggle(layer.id)}
                  />
                  <PublicMapLayerSwatch layer={layer} />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{layer.name}</span>
                    {layer.description ? (
                      <span className="block text-muted-foreground">{layer.description}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}

        {coverageNotes.length > 0 ? (
          <ul role="list" className="mt-2 space-y-1 border-t border-border/60 pt-2 text-muted-foreground">
            {coverageNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}

        {readFailure ? (
          <p className="mt-2 border-t border-border/60 pt-2 text-muted-foreground">
            {labels.readFailure}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Shape carries the geometry kind, colour carries identity — the same rule the
 * participant legend uses, and the same rendering.
 *
 * EXPORTED SO THE DUPLICATION CAN BE ENDED IN ONE EDIT. `participant-map-legend.tsx`
 * has an identical `LegendSwatch` and is owned by another lane right now; when
 * the picker replaces the legend on the public map, that file should import this
 * and delete its copy, or the two will drift and the swatch will stop matching
 * the line on the map for one of them.
 */
export function PublicMapLayerSwatch({ layer }: { layer: ParticipantContextLayer }) {
  const kinds = new Set(layer.geometryKinds);
  const color = layer.color;

  if (kinds.has("Polygon")) {
    return (
      <span
        aria-hidden
        className="mt-1 inline-block h-3 w-3 shrink-0 rounded-[2px] border"
        style={{ backgroundColor: `${color}40`, borderColor: color }}
      />
    );
  }

  if (kinds.has("LineString")) {
    return (
      <span
        aria-hidden
        className="mt-2 inline-block h-[3px] w-3 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}
