import type { SafetyCrashEvidence } from "@/lib/safety/crash-evidence";

/**
 * The packet's safety section — the crash evidence a board is entitled to see.
 *
 * WHERE THIS CAME FROM. A tester attached real crash data to a project, named
 * the project "Safety Study", regenerated the Board/Binder packet, and got a
 * document with ZERO safety content. The generator pulled project records,
 * funding and governance and never asked the safety module anything. A board
 * member reading only the PDF could not see that any crash work had been done.
 *
 * WHAT THIS WILL NOT DO, and each of these is a way the section could have been
 * more impressive and less true:
 *
 *   1. NO FIGURE WITHOUT ITS QUALIFICATION. Every acquisition carries its own
 *      caveats and a single-sentence narrative caveat, written for exactly this
 *      purpose. They render beside the numbers, never in a footnote — a figure
 *      separated from its caveat is the one that gets quoted.
 *   2. NULL IS NOT ZERO. A source that cannot separate serious injuries reports
 *      `ksi: null`, and unreadable counts report `severityCounts: null`. Both
 *      say so. Printing 0 killed or seriously injured because nobody could
 *      count is the most flattering possible reading and the least defensible.
 *   3. NO SILENT TRUNCATION. A retrieval that stopped at the record cap makes
 *      every figure a floor, and the section says the word "floor".
 *   4. THE UNGEOCODED GAP IS STATED. Reported and mapped are different numbers;
 *      quoting the mapped one as the total understates the problem being funded.
 */

export const PROJECT_SAFETY_SECTION_KEY = "project_safety_evidence";
export const PROJECT_SAFETY_SECTION_TITLE = "Reported collisions";

export type PacketSafetyFigure = {
  label: string;
  /** Null renders as the absence sentence, never as a number. */
  value: number | null;
  /** Why the value is absent, when it is. */
  absentBecause: string | null;
};

export type PacketSafetyAcquisition = {
  ingestId: string;
  sourceLabel: string;
  years: string;
  figures: PacketSafetyFigure[];
  /** Every disclosure this acquisition carries, rendered with the figures. */
  caveats: string[];
  citation: string;
  publishedThrough: string | null;
  publishedThroughSourceUrl: string | null;
  publishedThroughSourceLabel: string | null;
};

export type PacketSafetyEvidence =
  | { kind: "none" }
  | { kind: "unreadable" }
  | { kind: "present"; acquisitions: PacketSafetyAcquisition[] };

function figure(label: string, value: number | null, absentBecause: string): PacketSafetyFigure {
  return { label, value, absentBecause: value === null ? absentBecause : null };
}

/**
 * Turn what the safety module knows into what the packet prints.
 *
 * Pure, so the decisions above can be tested without a database or a PDF. Pass
 * `null` for a read that FAILED — distinct from an empty list, which means the
 * project genuinely has no crash data attached.
 */
export function buildPacketSafetyEvidence(
  evidence: readonly SafetyCrashEvidence[] | null
): PacketSafetyEvidence {
  if (evidence === null) return { kind: "unreadable" };
  if (evidence.length === 0) return { kind: "none" };

  const acquisitions = evidence.map((item): PacketSafetyAcquisition => {
    const counts = item.severityCounts;
    const figures: PacketSafetyFigure[] = [
      figure("Reported collisions", item.reportedTotal, "The source returned no count."),
      figure(
        "Of those, mapped",
        item.mappedTotal,
        "No collisions carried coordinates, so none could be placed."
      ),
      figure(
        "Killed or seriously injured",
        item.ksi,
        "This source does not separate suspected serious injuries, so a KSI figure cannot be formed from it."
      ),
      figure(
        "Fatal",
        counts ? (counts.fatal ?? null) : null,
        "The severity breakdown could not be read."
      ),
      figure(
        "Serious injury",
        counts ? (counts.severe_injury ?? null) : null,
        "The severity breakdown could not be read."
      ),
      figure(
        "No casualty detail recorded",
        item.unclassifiedCount,
        "The severity breakdown could not be read."
      ),
    ];

    // The acquisition's own disclosures, plus the two that only matter once a
    // figure is being printed in a document somebody signs.
    const caveats = [...item.caveats];
    if (item.truncated) {
      caveats.unshift(
        "This retrieval stopped at the source's record cap, so every figure here is a floor rather than a full count."
      );
    }
    if (item.mappedTotal < item.reportedTotal) {
      caveats.push(
        `${(item.reportedTotal - item.mappedTotal).toLocaleString()} reported collisions carried no coordinates. They are real collisions that cannot be placed on a map, and they are included in the reported total above.`
      );
    }

    return {
      ingestId: item.ingestId,
      sourceLabel: item.sourceLabel ?? "Source not recorded",
      years: item.years.length > 0 ? item.years.join(", ") : "Years not recorded",
      figures,
      caveats,
      citation: item.citationText,
      publishedThrough: item.publishedThrough,
      publishedThroughSourceUrl:
        typeof item.publishedThroughProvenance?.sourceUrl === "string" &&
        /^https?:\/\//i.test(item.publishedThroughProvenance.sourceUrl)
          ? item.publishedThroughProvenance.sourceUrl
          : null,
      publishedThroughSourceLabel:
        typeof item.publishedThroughProvenance?.label === "string"
          ? item.publishedThroughProvenance.label
          : null,
    };
  });

  return { kind: "present", acquisitions };
}
