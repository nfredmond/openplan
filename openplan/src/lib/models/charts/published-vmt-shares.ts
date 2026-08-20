/**
 * Published VMT shares by road type, for comparison against a model run.
 *
 * ====================================================== WHERE THESE COME FROM
 *
 * FHWA Highway Statistics 2022, table VM-2 ("Vehicle miles of travel, by
 * functional system"), summed over rural and urban and divided by the total.
 * Read from the published table on 2026-08-17, not recalled — an earlier
 * version of this comparison used remembered figures and was wrong by 10-15
 * points on two rows.
 *
 * WHY A CONSTANT AND NOT A FETCH. FHWA publishes annually as an HTML table
 * whose shape changes between years; a run that silently failed to reach it
 * would compare against nothing, and a run that reached a differently-shaped
 * table would compare against garbage. A dated constant is checkable, and the
 * date is what tells a reader when to refresh it.
 *
 * ================================================ THE OSM CLASSES THEY MAP TO
 *
 * OpenPlan's network comes from OpenStreetMap, whose road classes are not
 * FHWA's functional system, so the mapping below is a judgement — stated here
 * rather than hidden, and DECIDED BY THE COUNTS rather than by taste.
 *
 * `trunk` was first placed with freeways, which is the natural reading of the
 * OSM tag. The count stations disagree. Median model-over-observed across the
 * 24 study counties, 1,998 stations:
 *
 *     motorway   242 stations   0.78
 *     trunk      498 stations   2.38
 *     primary    826 stations   2.05
 *     secondary  334 stations   1.30
 *     tertiary    98 stations   0.07
 *
 * `trunk` behaves like `primary`, not like `motorway`, so it sits with the
 * principal arterials. A test holds that grouping against those figures, so
 * moving it back requires disagreeing with the measurement in writing.
 *
 * The comparison is still drawn as two distributions rather than a per-row
 * error, because the mapping is a judgement however well evidenced.
 *
 * ============================ HOW MUCH THAT JUDGEMENT MOVES, MEASURED
 *
 * Enough that the two arterial rows carry no information on their own.
 * Across the twelve development runs, 113,029,728 daily vehicle-miles
 * (2026-08-20, `docs/modeling/VMT_BY_CLASS_2026-08-20.md`):
 *
 *                              trunk here      trunk with freeway
 *     Freeway ................ 0.74x           1.18x
 *     Principal arterial ..... 2.01x           1.08x
 *
 * "The model puts twice the published share on principal arterials" and "both
 * arterial rows are within 20% of published" are the same measurement read
 * under two placements of one OSM tag. Neither is evidence about the model, and
 * a claim resting on those rows is a claim about this mapping.
 *
 * The three rows BELOW them do not contain `trunk` and do not move: minor
 * arterial 0.89x, collector 0.72x, local 0.33x. Those are the rows a finding
 * can rest on, and they agree with an independent measurement — 96-100% of
 * local links and about a third of collector links carry no assigned traffic
 * (`docs/modeling/UNLOADED_LINK_COVERAGE_2026-08-20.md`).
 */

export type PublishedVmtShare = {
  label: string;
  /** Share of vehicle miles, 0-1. */
  share: number;
  /** The OSM link types counted into this row. */
  osmClasses: readonly string[];
};

export const FHWA_VMT_SOURCE = {
  title: "FHWA Highway Statistics 2022, table VM-2",
  url: "https://www.fhwa.dot.gov/policyinformation/statistics/2022/vm2.cfm",
  readOn: "2026-08-17",
  /** The states these shares were summed over. */
  states: ["California", "Colorado", "Oregon", "Washington"] as const,
  note:
    "Shares are summed over the four states whose DOT count feeds OpenPlan can read, rural and " +
    "urban combined. A study area in another state is being compared against those four, which " +
    "is a reasonable reference and not that state's own figure.",
} as const;

export const PUBLISHED_VMT_SHARES: readonly PublishedVmtShare[] = [
  { label: "Freeway", share: 0.448, osmClasses: ["motorway"] },
  { label: "Principal arterial", share: 0.21, osmClasses: ["trunk", "primary"] },
  { label: "Minor arterial", share: 0.158, osmClasses: ["secondary"] },
  { label: "Collector", share: 0.113, osmClasses: ["tertiary"] },
  { label: "Local", share: 0.071, osmClasses: ["residential", "unclassified", "service", "living_street"] },
];

/**
 * A run's own VMT by OSM class, folded into the published categories.
 *
 * Returns null when the run recorded no breakdown — an absent comparison is
 * not a comparison of zeroes, and drawing one would tell a planner their model
 * puts no traffic anywhere.
 */
export function compareToPublishedShares(
  vmtByOsmClass: Record<string, number> | null | undefined
): Array<{ label: string; model: number; published: number }> | null {
  if (!vmtByOsmClass) return null;
  const total = Object.values(vmtByOsmClass).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  if (total <= 0) return null;

  return PUBLISHED_VMT_SHARES.map((row) => {
    const modelled = row.osmClasses.reduce((sum, osmClass) => sum + (vmtByOsmClass[osmClass] ?? 0), 0);
    return { label: row.label, model: modelled / total, published: row.share };
  });
}
