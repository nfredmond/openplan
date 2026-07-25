/**
 * User-facing disclosure copy for the federal Justice40 / CEJST determination.
 *
 * Centralized so the analysis narrative, the report equity table, and the PDF
 * all say the same thing — and so the single highest-stakes string in this
 * feature (the "disadvantaged" claim) always carries the discontinued-program
 * caveat. Trading a proxy-lie for a stale-federal-lie is the failure mode this
 * module exists to prevent.
 */

import type { Justice40Determination } from "./types";

/** The rescission facts, stated once. */
export const PROGRAM_DISCONTINUED_CAVEAT =
  "The federal Justice40 Initiative and CEJST were rescinded (Executive Order 14008 revoked 2025-01-20; the tool was taken offline ~2025-01-22) — this is a frozen historical snapshot, NOT a current federal eligibility or funding determination.";

/**
 * Why a residual set of tracts still has no record: CEJST keys on 2010 tracts and
 * the app uses 2020 tracts. Renumbered tracts are resolved through a 2020→2010
 * crosswalk, so this now affects only the few tracts with no 2010 equivalent
 * (e.g. new 2020 tracts).
 */
const VINTAGE_NOTE =
  "CEJST keys on 2010-vintage census tracts; renumbered tracts are matched via a 2020→2010 crosswalk, so this affects only tracts with no 2010 equivalent (e.g. new 2020 tracts).";

function label(det: Justice40Determination): string {
  return det.datasetLabel ?? `CEJST v${det.version ?? "1.0"}`;
}

/** Compact status for a PDF line or a table cell. */
export function federalJustice40ShortStatus(det: Justice40Determination): string {
  switch (det.status) {
    case "disadvantaged":
      return `Disadvantaged (${label(det)} — historical snapshot)`;
    case "not_disadvantaged":
      return `Not disadvantaged (${label(det)})`;
    default:
      return "Not determined — no CEJST record matched";
  }
}

/** Full markdown sentence for the analysis narrative + report AI context. */
export function federalJustice40NarrativeLine(det: Justice40Determination): string {
  const c = det.coverage;
  const undeterminedNote =
    c.undeterminedTracts > 0
      ? ` ${c.undeterminedTracts} of ${c.totalTracts} tract(s) had no CEJST record (${VINTAGE_NOTE}).`
      : "";
  // Crosswalk-resolved determinations are INFERENCES (a renumbered 2020 tract →
  // its 2010 parent[s], disadvantaged if ANY parent is), not direct records —
  // disclose it so a crosswalk inference is never read as a definitive record.
  const inferredNote =
    c.crosswalkInferredTracts > 0
      ? ` ${c.crosswalkInferredTracts} determination(s) were matched via the 2020→2010 tract crosswalk (disadvantaged if any overlapping 2010 tract is), not a direct CEJST record.`
      : "";

  switch (det.status) {
    case "disadvantaged":
      return (
        `**Federal Justice40 / CEJST determination:** ${c.disadvantagedTracts} of ${c.determinedTracts} matched ` +
        `tract(s) are designated disadvantaged in ${label(det)}. ${PROGRAM_DISCONTINUED_CAVEAT}${undeterminedNote}${inferredNote}`
      );
    case "not_disadvantaged":
      return (
        `**Federal Justice40 / CEJST determination:** No study-area tract is designated disadvantaged in ` +
        `${label(det)} (${c.determinedTracts} of ${c.totalTracts} tract(s) matched a record). Historical ` +
        `snapshot of a discontinued program; not a current federal determination.${undeterminedNote}${inferredNote}`
      );
    default: {
      // State the TRUE cause. Blaming the tract vintage when the source was
      // unavailable, or when no source covered the area, would be a false
      // explanation of the missing determination.
      const reason =
        det.notDeterminedCause === "source_unavailable"
          ? "The CEJST dataset could not be loaded for this run."
          : det.notDeterminedCause === "no_matching_record"
            ? `No CEJST record matched the study-area tracts (${c.undeterminedTracts} of ${c.totalTracts} had no record). ${VINTAGE_NOTE}`
            : "No official disadvantaged-community designation source covered this study area.";
      return `**Federal Justice40 / CEJST determination:** Not determined — ${reason} A proxy screening was computed instead.`;
    }
  }
}

/** The proxy line — always shown, always labeled a proxy, never "Justice40". */
export function proxyEquityNarrativeLine(input: {
  disadvantagedTracts: number;
  totalTracts: number;
}): string {
  return (
    `**Equity (proxy screening):** ${input.disadvantagedTracts} of ${input.totalTracts} tract(s) flagged by an ` +
    `ACS income + burden proxy (median household income <$50k plus at least one of: poverty ≥30%, minority ≥50%, ` +
    `zero-vehicle ≥10%, transit commute ≥15%). This is a screening proxy, not a federal designation. Method: proxy-census.`
  );
}
