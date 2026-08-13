/**
 * THE WORDS ON THE MAP-BACKGROUND PICKER, in the resident's language.
 *
 * ═══ THE DEFECT THIS CLOSES ═══
 *
 * `basemaps.ts` carries a `label` and a `description` per background — "Streets",
 * "Roads, place names and landmarks." — as English literals, because it is the
 * registry the SERVER reads and it must be able to answer for a background with
 * no participant surface anywhere near it (the operator console, a
 * configuration-notes screen). Nothing routed those two strings through the
 * participant catalog, so the picker rendered its heading in all 22 languages
 * and every option inside it in English. A control a resident can find and
 * cannot read is worse than one they never find.
 *
 * ═══ WHY A TRANSLATED COPY RATHER THAN A LABEL PROP ═══
 *
 * The alternative was a `choiceWords` prop threaded into `PublicBasemapPicker`
 * beside its existing `labels`. This is smaller and it preserves the picker's
 * one real invariant — it holds no words and no style ids of its own, it renders
 * what it is handed. A `PublicBasemapChoice` with translated words is still a
 * `PublicBasemapChoice`: `id`, `styleUrl` and `dark` are copied through
 * untouched, so every id-to-style lookup downstream is unaffected.
 *
 * ═══ AN ID WITH NO WORDS MUST NOT REACH THE PUBLIC ═══
 *
 * `PORTAL_BASEMAP_MESSAGE_KEYS` is typed `Record<PublicBasemapId, …>`, so adding
 * an id to `PUBLIC_BASEMAP_IDS` without adding its two keys here does not
 * compile, and adding a key name the catalog does not carry does not compile
 * either. `portal-basemap-words.test.ts` additionally checks that the English
 * catalog still says exactly what the registry says, so the two cannot drift
 * into disagreeing about what "Terrain" means.
 */

import type { PublicBasemapChoice, PublicBasemapId } from "@/lib/cartographic/basemaps";
import type { PortalMessageKey } from "./messages";
import type { PortalTranslator } from "./translator";

export type PortalBasemapMessageKeys = { label: PortalMessageKey; description: PortalMessageKey };

/**
 * `satisfies` rather than a type annotation, deliberately: the annotation would
 * widen every value to `PortalMessageKey`, and `t()` is typed so that a key
 * which MIGHT carry a `{placeholder}` requires a values argument. Keeping the
 * literal key types is what lets these two calls be argument-free — and it is
 * still a compile error to leave an id out or to name a key the catalog lacks.
 */
export const PORTAL_BASEMAP_MESSAGE_KEYS = {
  streets: {
    label: "portal.background.streets.label",
    description: "portal.background.streets.description",
  },
  satellite: {
    label: "portal.background.satellite.label",
    description: "portal.background.satellite.description",
  },
  terrain: {
    label: "portal.background.terrain.label",
    description: "portal.background.terrain.description",
  },
  light: {
    label: "portal.background.light.label",
    description: "portal.background.light.description",
  },
  dark: {
    label: "portal.background.dark.label",
    description: "portal.background.dark.description",
  },
} as const satisfies Record<PublicBasemapId, PortalBasemapMessageKeys>;

/**
 * The same backgrounds, described in the participant's language.
 *
 * Call it once per render of a participant map and hand the result to the
 * picker. Order, ids, style URLs and the `dark` flag are preserved exactly.
 */
export function translatePublicBasemapChoices(
  choices: readonly PublicBasemapChoice[],
  translator: Pick<PortalTranslator, "t">
): PublicBasemapChoice[] {
  return choices.map((choice) => {
    const keys = PORTAL_BASEMAP_MESSAGE_KEYS[choice.id];
    // An id the catalog has never heard of cannot be invented a name for here.
    // Falling back to the registry's English is the honest answer and is the
    // state the compiler already prevents in this repository's own code.
    if (!keys) return choice;
    return {
      ...choice,
      label: translator.t(keys.label),
      description: translator.t(keys.description),
    };
  });
}
