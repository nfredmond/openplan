/**
 * ONE explanation of "screening-grade", in one place.
 *
 * The phrase is asserted on twenty-odd surfaces — model runs, the CEQA screen,
 * the equity overlay, engagement synthesis, county-run KPIs, published public
 * pages — and until now it was defined nowhere a planner could click. The one
 * useful number attached to it (the published error envelope) lived on /legal,
 * a PUBLIC page that nothing inside the app linked to. A planner met a caveat
 * with no way to find out what it permitted them to conclude.
 *
 * The rules this module exists to hold:
 *
 *  1. **One source.** Every badge links here. Nothing restates this prose.
 *  2. **The NUMBER is cited, never copied.** The published error envelope is
 *     computed from `publishedValidationCeiling()` — the example records — so
 *     adding a published validation record updates it everywhere at once. A
 *     figure typed into a second page is a figure that goes stale silently, and
 *     `published-ceiling.test.tsx` fails a page that restates it.
 *  3. **A run's OWN figures are not this.** The envelope below is the worst
 *     across everything OpenPlan has published; it is not a statement about the
 *     run on the planner's screen. Run-specific figures belong on the run.
 */

import { publishedValidationCeiling } from "@/lib/examples/published-ceiling";

/**
 * Where the explanation lives. Every badge, popover, and caveat that says
 * "screening-grade" points at this, so moving the section means changing one
 * constant.
 */
export const SCREENING_GRADE_HELP_HREF = "/help#screening-grade";

/** The heading the anchor lands on, reused by the link's accessible name. */
export const SCREENING_GRADE_TITLE = "What “screening-grade” means";

/** The one-sentence answer, short enough to sit inside a popover. */
export const SCREENING_GRADE_SUMMARY =
  "Screening-grade means the result is good enough to compare options and set priorities, and not good enough to design, permit, or certify anything.";

/** What a planner may legitimately do with a screening-grade result. */
export const SCREENING_GRADE_SAFE_TO_CONCLUDE: readonly string[] = [
  "Compare options against each other — which corridor, which project, which alternative looks better on this measure.",
  "Rank or prioritize a project list, and say in writing why one project came out ahead.",
  "Support a narrative in a grant application, a staff report, or a plan chapter, with the caveat carried alongside the number.",
  "Decide where to spend money on a closer look — a screening result is a good argument for a real study.",
];

/** What it may NOT be used for, stated as plainly as the permissions above. */
export const SCREENING_GRADE_NOT_SAFE_TO_CONCLUDE: readonly string[] = [
  "It is not a forecast. The number describes the modeled situation, not what will happen in 2045.",
  "It is not an engineering result. Nothing here sizes a lane, a signal, a culvert, or a structure.",
  "It is not a CEQA determination, and not a substitute for one — a screening VMT figure informs the analysis; a qualified reviewer makes the finding.",
  "It is not comparable across study areas. Two screening runs over different places were built from different inputs at different resolutions; the difference between them is not a finding.",
  "It is not calibrated to observed counts unless a surface says it is. Calibration is a separate, labeled step.",
];

/**
 * The published error envelope, DERIVED. The worst validation figure OpenPlan
 * has published, with the record it came from — so the sentence names its own
 * source and cannot quietly age.
 */
export function describePublishedErrorEnvelope(): string {
  const ceiling = publishedValidationCeiling();
  return (
    `The worst validation figure OpenPlan has published is a maximum absolute percent error of ` +
    `${ceiling.maxApePercent}% (${ceiling.label}, ${ceiling.runDate}). That is the envelope for the ` +
    `published examples as a whole — it is not a measurement of any particular run in your workspace, ` +
    `and a run of your own may be better or worse. It updates whenever a new validation example is published.`
  );
}

/**
 * Why a screening result on a planner's screen may still be worse than the
 * envelope above, and where to look for the run's own numbers.
 */
export const SCREENING_GRADE_YOUR_RUN_NOTE =
  "Each model run reports its own figures — how much of its travel stays inside a single zone (which sets whether road-by-road results mean anything), and how its totals compare against reference benchmarks. Those are on the run itself, under “What screening-grade means for this run”. Read them before quoting a number outside your agency.";
