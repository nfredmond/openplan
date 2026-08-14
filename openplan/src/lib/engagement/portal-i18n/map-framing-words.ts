/**
 * WHERE THE MAP OPENS, IN THE RESIDENT'S LANGUAGE — one sentence, one
 * implementation, every surface that shows a map to a member of the public.
 *
 * ===================== WHY THIS IS A MODULE AND NOT A BLOCK IN A COMPONENT
 *
 * `resolvePortalMapFraming` composes an English `summary` server-side, in an
 * administrator's vocabulary: "No study area has been set for this campaign"
 * names two things that exist in this software and nowhere in a resident's life.
 * The map-first shell stopped printing it on 2026-08-13 and rebuilt the sentence
 * from catalog keys instead — but it did so INSIDE `public-map-shell.tsx`, so
 * the classic form on `/engage/<token>/about` and `/embed/<token>` went on
 * printing the English prose to a Spanish reader.
 *
 * That is this repository's most repeated defect in its exact canonical form: a
 * shared capability living inside one of its callers gets reimplemented, wrongly,
 * by the other. So the sentence lives here, and neither surface owns it.
 *
 * WHAT IS DELIBERATELY NOT HERE. `framing.unreadableNote` and
 * `framing.submissionRule` are still English prose composed server-side and are
 * still rendered as the English they are, marked `lang="en"` by their call
 * sites. Rebuilding those from the catalog needs structure the resolver does not
 * carry yet (which candidate failed, and the rule's own numbers); inventing a
 * translation for them here would be worse than disclosing them.
 */

import type { PortalMapFraming } from "@/lib/engagement/public-portal-data";
import type { PortalTranslator } from "./translator";
import type { PortalMessageKey } from "./messages";

type FramingSourceKey = Extract<PortalMessageKey, `portal.mapFramingSource${string}`>;

/**
 * SPELLED OUT rather than built with a template literal and a cast. A template
 * literal compiles for any `origin` the resolver might grow later, including one
 * whose catalog key nobody wrote — and `t()` on a key the bundle does not carry
 * renders the literal word "undefined" inside a sentence on a public page. A
 * `Record` over the union makes a new origin a build error instead.
 *
 * `"none"` maps to null because "nothing framed this map" is not a source; it
 * takes one of the two sentences below.
 */
const FRAMING_SOURCE_KEYS: Record<PortalMapFraming["origin"], FramingSourceKey | null> = {
  campaign_place: "portal.mapFramingSourceCampaign",
  project_place: "portal.mapFramingSourceProject",
  workspace_home: "portal.mapFramingSourceWorkspace",
  approved_pins: "portal.mapFramingSourcePins",
  none: null,
};

/**
 * The one sentence that says where a resident's map opens and why.
 *
 * A NAMED PLACE IS NEVER TRANSLATED: `originLabel` is the agency's own name for
 * the area, and putting it through the catalog would be inventing a name.
 *
 * The two unframed states must not share a sentence. "Nobody set an area" is a
 * claim about the world that is only ours to make when every candidate was
 * actually checked; a lookup that FAILED leaves us knowing less than that, and
 * saying the first when the second is true tells a resident their agency was
 * careless when in fact we could not read the record.
 */
export function portalMapFramingSentence(
  framing: PortalMapFraming,
  translator: PortalTranslator
): string {
  const sourceKey = FRAMING_SOURCE_KEYS[framing.origin];

  if (!sourceKey) {
    return translator.t(
      framing.unreadable.length > 0 ? "portal.mapFramingUnknownArea" : "portal.mapFramingNoArea"
    );
  }

  return framing.originLabel
    ? translator.t("portal.mapFramingOn", {
        place: framing.originLabel,
        source: translator.t(sourceKey),
      })
    : translator.t("portal.mapFramingOnUnnamed", { source: translator.t(sourceKey) });
}
