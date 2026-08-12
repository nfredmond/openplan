/**
 * Attributed crash evidence for the RTP "why" engine — the safety criterion's
 * half of what `modeling-evidence.ts` does for VMT and GHG.
 *
 * THE DEAD SEAM THIS CLOSES. `priority-criteria.ts` scores eight criteria, and
 * "Improves safety — reduces fatalities and severe injuries under a Safe System
 * approach" carried `evidence: "manual"`, which meant a planner rated it from
 * memory while the workspace held an acquisition of the actual collisions in
 * that corridor. The modeling criteria have shown their run's numbers beside the
 * rating since the engine shipped; safety showed nothing.
 *
 * IT INFORMS, IT NEVER SETS THE SCORE — and that is a refusal, not an omission.
 * Nothing in this module returns a rating, a rank, a tier, or a recommendation,
 * and nothing may be added that does. Three reasons, in order of how much they
 * would cost to get wrong:
 *
 *   1. A priority score is an adopted-plan judgement about which projects a
 *      region funds. It is the planner's, and a derived one would be a machine
 *      authoring a judgement into a document that goes to a board.
 *   2. Observed collisions are not a project's expected benefit. A corridor with
 *      many crashes may be the right place to invest or may already be funded;
 *      a corridor with none may be a place people have stopped walking. The
 *      correlation runs both ways and no arithmetic here can tell which.
 *   3. The counts are systematically incomplete in ways that vary by place — the
 *      geocoded share of one state's 2025 file was 77.7% statewide and 99.6% in
 *      one rural county of it. A score derived from them would carry that
 *      variation silently into a funding decision.
 *
 * DISCLOSE, NEVER RESTRICT — inherited verbatim from `modeling-evidence.ts`. A
 * planner may cite ANY acquisition: any source, any coverage state, any
 * completeness. Refusing a partial citation sends the work to a spreadsheet
 * nobody reviews. The deal is that the citation always travels with what is
 * wrong with it, and nothing in this module or its callers may block one.
 *
 * The numbers and their caveats are computed in
 * `src/lib/safety/crash-evidence.ts`; this file decides how the safety criterion
 * SAYS them. Everything here is pure except `loadProjectRtpSafetyEvidence` at the
 * bottom, which is a four-line composition of that module's loader and exists so
 * a server page can ask for "this project's observed collisions" in one call
 * rather than assembling the three steps itself — the assembly is where a second
 * caller gets one of them wrong.
 */

import {
  latestReadyIngestByProject,
  loadSafetyCrashEvidence,
  readSafetyCrashEvidenceIngest,
  totalCountedCrashes,
  type SafetyCrashEvidence,
  type SafetyCrashEvidenceSupabaseLike,
} from "@/lib/safety/crash-evidence";

/**
 * What the safety criterion shows beside its 0–3 rating.
 *
 * Every count is nullable and each null is a different sentence on screen, never
 * a blank and never a zero. `null` for `ksi` in particular means the source
 * cannot separate suspected serious injuries AT ALL — printing 0 there would
 * report "no serious injuries" on the exact measure a safety grant is scored on.
 */
export interface RtpSafetyEvidence {
  ingestId: string;
  sourceLabel: string | null;
  years: number[];
  /** Collisions in which someone was killed. Null when the counts could not be read. */
  fatalCount: number | null;
  /** Suspected serious injury collisions, or null when the source cannot separate them. */
  severeInjuryCount: number | null;
  /** Killed or seriously injured collisions, or null when the source cannot separate them. */
  ksi: number | null;
  /** Collisions the source reported no casualty count for. Null when unreadable. */
  unclassifiedCount: number | null;
  /** Stored collisions the bands cover. Null when unreadable. */
  countedTotal: number | null;
  /** Reported collisions, geocoded or not. */
  reportedTotal: number;
  /** People who were walking / cycling / riding a motorcycle, or null when person rows were not retrieved. */
  vulnerableRoadUsers: number | null;
  citationText: string;
  /** Non-blocking disclosures. Never empty. */
  warnings: string[];
  /** The one sentence a drafted narrative must reproduce beside any figure here. */
  narrativeCaveat: string;
}

/**
 * Project one acquisition's evidence onto the safety criterion.
 *
 * A projection of `SafetyCrashEvidence`, not a second reading of the database:
 * every number below is already computed and already carries its caveats, and a
 * second count query for the same acquisition is how two screens in one product
 * come to disagree about how many people died on a road.
 */
export function summarizeRtpSafetyEvidence(evidence: SafetyCrashEvidence): RtpSafetyEvidence {
  const counts = evidence.severityCounts;
  const roles = evidence.roleCounts;

  return {
    ingestId: evidence.ingestId,
    sourceLabel: evidence.sourceLabel,
    years: evidence.years,
    fatalCount: counts ? counts.fatal : null,
    // Only meaningful when the source separates them; `evidence.ksi` is already
    // null in that case, and this field follows it rather than reporting the
    // raw zero the band would hold.
    severeInjuryCount: counts && evidence.ksi !== null ? counts.severe_injury : null,
    ksi: evidence.ksi,
    unclassifiedCount: evidence.unclassifiedCount,
    countedTotal: totalCountedCrashes(counts),
    reportedTotal: evidence.reportedTotal,
    vulnerableRoadUsers: roles
      ? roles.pedestrian + roles.bicyclist + roles.motorcyclist
      : null,
    citationText: evidence.citationText,
    warnings: evidence.caveats,
    narrativeCaveat: evidence.narrativeCaveat,
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/**
 * One line of observed safety facts, e.g.
 * "4 fatal · 21 serious injury · 25 KSI · 1,089 collisions, 2021–2025 (observed, screening-grade)".
 *
 * ABSENCES ARE STATED, NEVER BLANKED. A source that cannot separate serious
 * injuries says so in this line rather than omitting the term, because a reader
 * who does not see "KSI" assumes it was zero far more often than they assume it
 * was unavailable.
 */
export function formatRtpSafetyEvidenceLine(evidence: RtpSafetyEvidence): string {
  if (evidence.countedTotal === null) {
    return "This acquisition's crash counts could not be read — a lookup failure, not evidence that no collisions occurred.";
  }
  if (evidence.countedTotal === 0) {
    return evidence.reportedTotal > 0
      ? `No collisions from this acquisition could be mapped, though ${plural(evidence.reportedTotal, "was", "were")} reported. Nothing here says the road is safe.`
      : "This acquisition stored no collisions.";
  }

  const parts: string[] = [];
  if (evidence.fatalCount !== null) parts.push(`${evidence.fatalCount.toLocaleString("en-US")} fatal`);
  parts.push(
    evidence.ksi === null
      ? "serious injuries not separated by this source"
      : `${evidence.ksi.toLocaleString("en-US")} killed or seriously injured`
  );
  parts.push(plural(evidence.countedTotal, "collision mapped", "collisions mapped"));
  if (evidence.vulnerableRoadUsers !== null) {
    parts.push(
      `${plural(evidence.vulnerableRoadUsers, "person", "people")} walking, cycling or riding a motorcycle`
    );
  }

  const span =
    evidence.years.length === 0
      ? ""
      : evidence.years.length === 1
        ? `, ${evidence.years[0]}`
        : `, ${evidence.years[0]}–${evidence.years[evidence.years.length - 1]}`;

  return `${parts.join(" · ")}${span} (observed, screening-grade)`;
}

/**
 * The sentence shown where a project has no crash acquisition at all.
 *
 * Not "no crashes". A project nobody has retrieved crash data for is a project
 * nobody has looked at, and the two must never render the same — this is the
 * same distinction the whole Safety module is built on, one level up.
 */
export const RTP_SAFETY_NO_ACQUISITION_LINE =
  "No crash acquisition is linked to this project, so there is nothing observed to show here. That is a gap in what has been retrieved, not a finding that no collisions occurred.";

/**
 * The sentence stating what this evidence is FOR, rendered with it.
 *
 * It exists because the failure mode is a reader treating the numbers as the
 * score. The VMT/GHG criteria carry the same statement and it has held.
 */
export const RTP_SAFETY_EVIDENCE_INFORMS_ONLY =
  "These are observed collisions in the acquisition's study area. They inform this rating; they do not set it, and OpenPlan will not derive a priority score from them.";

/**
 * One project's observed collisions, from ingest rows the caller already read.
 *
 * Takes the rows rather than querying for them because the project page reads
 * `safety_crash_ingests` anyway (for its coverage board) and a second read of
 * the same table on the same request is how two panels on one screen come to
 * describe different acquisitions. The caller must have selected
 * `SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION`.
 *
 * Returns null when the project has no finished acquisition. Null here means
 * "nothing has been retrieved", which the surface renders as
 * `RTP_SAFETY_NO_ACQUISITION_LINE` — never as "no collisions occurred".
 */
export async function loadProjectRtpSafetyEvidence(
  supabase: SafetyCrashEvidenceSupabaseLike,
  input: { workspaceId: string; projectId: string; ingestRows: readonly unknown[] }
): Promise<RtpSafetyEvidence | null> {
  const ingests = input.ingestRows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const ingest = readSafetyCrashEvidenceIngest(row as Record<string, unknown>);
    return ingest ? [ingest] : [];
  });

  const latest = latestReadyIngestByProject(ingests).get(input.projectId);
  if (!latest) return null;

  const evidence = await loadSafetyCrashEvidence(supabase, input.workspaceId, [latest]);
  const found = evidence.get(latest.id);
  return found ? summarizeRtpSafetyEvidence(found) : null;
}
