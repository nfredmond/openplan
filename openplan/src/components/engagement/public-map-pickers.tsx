"use client";

import type { PublicBasemapChoice, PublicBasemapId } from "@/lib/cartographic/basemaps";
import type { ParticipantContextLayerSet } from "@/lib/engagement/context-layers";

import {
  PublicBasemapPicker,
  type PublicBasemapPickerLabels,
} from "./public-map-picker-basemap";
import {
  PublicMapLayerPicker,
  type PublicMapLayerPickerLabels,
} from "./public-map-picker-layers";

/**
 * Both map controls, docked together.
 *
 * WHY THEY SHIP AS A PAIR. They are the same kind of thing to the person using
 * them — "change what I'm looking at" — and two separately-placed floating
 * panels on a 390px phone is how a map ends up with no map left. Docked, they
 * are one column of collapsed buttons, roughly 2.5rem tall in total, and only
 * one panel is ever open because a resident opens the one they want.
 *
 * IT MUST NOT COVER THE MAP, and that is a layout property this component can
 * only half-guarantee: the dock is width-capped (`min(16rem, calc(100% - 1.5rem))`)
 * and its open panels scroll internally at `max-h-[50dvh]`, so it can never grow
 * to fill the viewport. Whether the remaining map is *usable* is a question
 * about a real browser at a real size — jsdom has no box model and Mapbox GL
 * does not run in it, so no test in this repo can answer it. It has to be looked
 * at once at 390×844 and once at 2560×1440.
 *
 * PLACEMENT IS THE SHELL'S. The default puts the dock top-left, clear of the
 * `NavigationControl` at top-right; pass `className` to move it. Whoever mounts
 * this owns where Mapbox's attribution goes so the two do not stack.
 */

export type PublicMapPickersProps = {
  /** Layer picker — omit `contextLayers` entirely and it renders nothing. */
  contextLayers: ParticipantContextLayerSet | null | undefined;
  visibleLayerIds: readonly string[];
  onVisibleLayerIdsChange: (next: string[]) => void;

  /** Background picker — empty or single-element `basemapChoices` renders nothing. */
  basemapChoices: readonly PublicBasemapChoice[];
  selectedBasemapId: PublicBasemapId;
  onBasemapSelect: (choice: PublicBasemapChoice) => void;
  failedBasemapId?: PublicBasemapId | null;

  layerLabels?: PublicMapLayerPickerLabels;
  basemapLabels?: PublicBasemapPickerLabels;
  /** BCP-47 tag of the words in the labels above. */
  lang?: string;
  className?: string;
};

const DEFAULT_DOCK_CLASS =
  "pointer-events-none absolute left-3 top-3 z-10 flex w-[min(16rem,calc(100%-1.5rem))] flex-col gap-2";

export function PublicMapPickers({
  contextLayers,
  visibleLayerIds,
  onVisibleLayerIdsChange,
  basemapChoices,
  selectedBasemapId,
  onBasemapSelect,
  failedBasemapId = null,
  layerLabels,
  basemapLabels,
  lang = "en",
  className,
}: PublicMapPickersProps) {
  return (
    <div className={className ?? DEFAULT_DOCK_CLASS} data-testid="public-map-pickers">
      {/*
        `pointer-events-none` on the dock and `auto` on each control: the gap
        between the two buttons is map, and a resident dragging through it must
        pan the map rather than hit an invisible wrapper.
      */}
      <PublicMapLayerPicker
        className="pointer-events-auto"
        contextLayers={contextLayers}
        visibleLayerIds={visibleLayerIds}
        onVisibleLayerIdsChange={onVisibleLayerIdsChange}
        labels={layerLabels}
        lang={lang}
      />
      <PublicBasemapPicker
        className="pointer-events-auto"
        choices={basemapChoices}
        selectedId={selectedBasemapId}
        onSelect={onBasemapSelect}
        failedChoiceId={failedBasemapId}
        labels={basemapLabels}
        lang={lang}
      />
    </div>
  );
}
