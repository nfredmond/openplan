/**
 * THE THREE COLOURS THE TRANSIT STOP LAYER PAINTS, AND WHAT EACH ONE MEANS.
 *
 * EXTRACTED BECAUSE IT HAD TWO CALLERS AND LIVED INSIDE ONE OF THEM. The map
 * backdrop painted a stop in one of three meaning-bearing colours — meets the
 * frequent-service headway, meets the wider basic one, no interval could be
 * derived at all — and the legend had no transit entry whatsoever. A planner saw
 * three colours of dot and nothing on screen said what any of them meant, so the
 * only readings available were "guess" and "assume darker is better". A colour
 * that carries a claim and has no key is worse than an unpainted one: it is a
 * finding the reader invents.
 *
 * The same shape as `crash-severity-palette.ts`, for the same reason. A palette
 * that lives inside one of its two callers gets reimplemented by the other, and
 * then the swatch and the dot describe the same stop differently — which nothing
 * in a screenshot review can catch.
 *
 * NEITHER THRESHOLD IS A LITERAL HERE, and that is a product rule rather than a
 * style preference: 15 and 30 minutes are the reporting vocabulary the whole
 * transit lane is built on (see `service-levels.ts`), and a jurisdiction with a
 * 20-minute statutory test must be able to change one constant rather than hunt
 * for a number typed into a paint expression or a legend label.
 */

import {
  BASIC_SERVICE_HEADWAY_MINUTES,
  FREQUENT_SERVICE_HEADWAY_MINUTES,
} from "@/lib/gtfs/service-levels";

export type TransitServiceTierKey = "frequent" | "basic" | "untiered";

export const TRANSIT_SERVICE_TIER_COLOR: Record<TransitServiceTierKey, string> = {
  frequent: "#4c3fa8",
  basic: "#8078c9",
  /**
   * A stop with NO derivable peak headway — a place with a single daily trip has
   * no interval. Deliberately muted rather than the wider tier's colour, so
   * "not frequent enough to tier" never borrows the meaning of "meets the
   * 30-minute tier".
   */
  untiered: "#9c9ab0",
};

/** Strongest service first, which is how the ramp reads left to right. */
export const TRANSIT_SERVICE_TIER_LEGEND_ORDER: readonly TransitServiceTierKey[] = [
  "frequent",
  "basic",
  "untiered",
];

/**
 * The key beside each swatch, DERIVED from the same two constants the paint
 * expression matches on. A label typed as "≤15 min" would keep saying 15 in a
 * jurisdiction that changed the threshold, which is the failure this whole file
 * exists to make impossible.
 */
export const TRANSIT_SERVICE_TIER_LEGEND_LABEL: Record<TransitServiceTierKey, string> = {
  frequent: `≤${FREQUENT_SERVICE_HEADWAY_MINUTES} min`,
  basic: `≤${BASIC_SERVICE_HEADWAY_MINUTES} min`,
  untiered: "No interval",
};

/**
 * What the legend calls the ramp.
 *
 * It says PEAK HEADWAY rather than "frequency" or "service", because the number
 * behind the colour is a peak-hour interval derived from one representative
 * service day — not a timetable, not an average across the day, and not a
 * statement about today's service. The transit lane's claim boundary is that
 * nothing in this product answers "when does the next one leave", and a legend
 * label is exactly the kind of small surface that quietly implies it does.
 */
export const TRANSIT_SERVICE_TIER_LEGEND_TITLE = "Transit stops by peak headway";
