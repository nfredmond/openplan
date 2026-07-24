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

/** Why some tracts have no record: CEJST keys on 2010 tracts; the app uses 2020 tracts. */
const VINTAGE_NOTE =
  "CEJST keys on 2010-vintage census tracts while this analysis uses 2020-vintage tracts, so a renumbered tract has no CEJST record.";

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

  switch (det.status) {
    case "disadvantaged":
      return (
        `**Federal Justice40 / CEJST determination:** ${c.disadvantagedTracts} of ${c.determinedTracts} matched ` +
        `tract(s) are designated disadvantaged in ${label(det)}. ${PROGRAM_DISCONTINUED_CAVEAT}${undeterminedNote}`
      );
    case "not_disadvantaged":
      return (
        `**Federal Justice40 / CEJST determination:** No study-area tract is designated disadvantaged in ` +
        `${label(det)} (${c.determinedTracts} of ${c.totalTracts} tract(s) matched a record). Historical ` +
        `snapshot of a discontinued program; not a current federal determination.${undeterminedNote}`
      );
    default: {
      // A named source means it COVERED the area but held no record for these
      // tracts — the true vintage gap. A null source means no designation source
      // covered the area (or the dataset failed to load); attributing THAT to
      // tract renumbering would be a false explanation.
      const reason =
        det.source === null
          ? "No official disadvantaged-community designation source covered this study area."
          : `No CEJST record matched the study-area tracts (${c.undeterminedTracts} of ${c.totalTracts} had no record). ${VINTAGE_NOTE}`;
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
