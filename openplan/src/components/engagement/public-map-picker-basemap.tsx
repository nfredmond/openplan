"use client";

import { useId, useState } from "react";

import type { PublicBasemapChoice, PublicBasemapId } from "@/lib/cartographic/basemaps";

/**
 * The control that changes what the map looks like underneath everything else.
 *
 * ═══ IT HOLDS NO STYLE IDS ═══
 *
 * Every choice arrives as a `PublicBasemapChoice` resolved on the server by
 * `resolvePublicBasemapConfig`. This component cannot name a Mapbox style, and
 * a test asserts that its source contains no `mapbox://` literal. The reason is
 * the product's existing failure mode rather than a style preference: twelve map
 * call sites each spell their own style URL, none of them can see the others,
 * and they have drifted. A picker that carried a thirteenth list would put that
 * drift on a resident's screen, and would also let an option reach the public
 * that this deployment's token cannot actually load.
 *
 * ═══ THE WORDS ═══
 *
 * A resident does not know what a "basemap" is, has never chosen a "style", and
 * will not recognise "Mapbox Standard Satellite". The heading is "Map
 * background" and every option is named for what a person will SEE — Streets,
 * Satellite, Terrain — with one sentence under it. Those words come from the
 * registry, so the map background is described the same way everywhere it is
 * offered.
 *
 * ═══ WHAT IT DOES WHEN THERE IS NOTHING TO CHOOSE ═══
 *
 * `choices` is empty when the deployment has no usable Mapbox token, and one
 * choice is not a choice. Both render nothing. A background picker over a map
 * that does not exist, or one that offers a single option, is a control that
 * claims to do something it does not.
 *
 * ═══ AN OPTION THAT FAILS MUST SAY SO ═══
 *
 * Mapbox reports a style that will not load as an `error` event, not by
 * throwing, so a failed switch otherwise looks exactly like a slow one: the old
 * background stays up and the radio moves. The caller passes `failedChoiceId`
 * when the map reported an error for a style, and the option is then marked
 * unavailable and disabled instead of being silently useless.
 *
 * Language: OpenPlan's own words come through `labels`; the English defaults are
 * the source of truth for whoever adds the `portal.*` catalog keys, and `lang`
 * stamps what these words are actually written in.
 */

export type PublicBasemapPickerLabels = {
  heading: string;
  hint: string;
  /** Suffix on an option the map could not load. */
  unavailable: string;
};

export const EN_PUBLIC_BASEMAP_PICKER_LABELS: PublicBasemapPickerLabels = {
  heading: "Map background",
  hint: "Change what the map looks like underneath.",
  unavailable: "not available on this site",
};

export type PublicBasemapPickerProps = {
  /** From `resolvePublicBasemapConfig` on the server. Empty renders nothing. */
  choices: readonly PublicBasemapChoice[];
  selectedId: PublicBasemapId;
  onSelect: (choice: PublicBasemapChoice) => void;
  /** A choice the map reported an error loading; disabled and marked. */
  failedChoiceId?: PublicBasemapId | null;
  labels?: PublicBasemapPickerLabels;
  lang?: string;
  className?: string;
};

export function PublicBasemapPicker({
  choices,
  selectedId,
  onSelect,
  failedChoiceId = null,
  labels = EN_PUBLIC_BASEMAP_PICKER_LABELS,
  lang = "en",
  className,
}: PublicBasemapPickerProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const groupName = useId();

  if (choices.length < 2) return null;

  return (
    <section
      lang={lang}
      className={className}
      data-testid="public-basemap-picker"
      aria-label={labels.heading}
    >
      <button
        type="button"
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
        <ul role="list" className="mt-2 space-y-1">
          {choices.map((choice) => {
            const failed = failedChoiceId === choice.id;
            return (
              <li key={choice.id}>
                <label
                  className={`flex min-h-11 items-start gap-2 py-1 ${
                    failed ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-1 h-4 w-4 shrink-0"
                    name={groupName}
                    value={choice.id}
                    checked={selectedId === choice.id}
                    disabled={failed}
                    onChange={() => onSelect(choice)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">
                      {choice.label}
                      {failed ? ` — ${labels.unavailable}` : ""}
                    </span>
                    <span className="block text-muted-foreground">{choice.description}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
