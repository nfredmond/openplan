/**
 * SS4A evidence appendices for the packaged application.
 *
 * Each appendix restates one saved record for the application's linked
 * project: the frozen Safety snapshot an SS4A seed came from (high-injury
 * network, crash summary, countermeasures), the latest saved benefit-cost
 * analysis, and the lead engagement campaign. Code writes every figure from the
 * stored record. Nothing here decides eligibility or restates a notice
 * requirement OpenPlan has not sourced.
 *
 * Honesty rules this module enforces structurally:
 *  - Every appendix renders. A record that does not exist is "missing", a read
 *    that failed or a record that fails its own checks is "unreadable", and an
 *    appendix the planner turned off is "omitted". None silently disappears.
 *  - Stored values render as stored. A count the record does not carry prints
 *    "Not recorded", never zero, and a fatality-census source says so.
 *  - The map is drawn only when recomputing from stored records reproduces the
 *    frozen ranking exactly; otherwise the frozen table stands alone and the
 *    reason is printed.
 *
 * The appendix states, the benefit-cost and engagement appendices and the
 * markup are shared with other programs (`evidence-appendices.ts`).
 *
 * Pure: no I/O. The loader beside it reads the records.
 */

import type { SafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import type { HighInjuryNetwork } from "@/lib/safety/high-injury-network";
import { readCrashPublicationEvidence } from "@/lib/safety/publication-evidence";
import {
  crashAreaBasisLabel,
  crashBoundaryCountLabel,
  describeCrashStudyArea,
  readCrashStudyAreaCoverage,
} from "@/lib/safety/crash-study-area";
import type { SafetyRoadContextFeature } from "@/lib/safety/road-context";
import { SS4A_APPENDIX_KEYS, SS4A_APPENDIX_TITLES, type Ss4aAppendixKey } from "@/lib/grants/ss4a-appendix-keys";
import {
  absentEvidenceAppendix,
  appendixShell,
  bcaEvidenceAppendix,
  describeSeverityCoverage,
  engagementEvidenceAppendix,
  NO_PROJECT_REASON,
  type EvidenceAppendix,
  type EvidenceAppendixFrame,
  type EvidenceAppendixSource,
  type EvidenceAppendixStatus,
  type ProjectBcaRead,
  type ProjectEngagementRead,
} from "@/lib/grants/evidence-appendices";
import {
  renderSafetyStreetContextSvg,
  SAFETY_STREET_CONTEXT_PROJECTION_NOTE,
} from "@/lib/safety/street-context-svg";

/** How the SS4A appendices open: what they are, and what to verify against the notice. */
export const SS4A_APPENDIX_FRAME: EvidenceAppendixFrame = {
  intro:
    "Each appendix restates a saved OpenPlan record for the linked project, with its source record, date and stored hash where one exists. Missing records are listed as missing. These appendices do not establish eligibility, award readiness or that this package meets the current notice.",
  verify: "[VERIFY] Confirm the required attachments against the current SS4A notice of funding opportunity.",
};
const COUNTERMEASURE_CANDIDATE_NOTE =
  "Proposed by staff for review. Attaching a countermeasure is not an engineering finding, and no crash reduction is estimated here.";
const HIN_MAP_DRAWN_NOTE =
  "Drawn at export from the stored crash records and cached road lines for this acquisition. The recomputed ranks and counts match the frozen Safety snapshot for every listed segment. No tile service was used.";
export const HIN_MAP_MISMATCH_REASON =
  "Recomputing from the stored crash records and cached road lines does not reproduce the frozen ranking, so no geometry can be tied to this snapshot. The ranked table is the frozen record.";

/** The render model of one SS4A appendix. */
export type Ss4aAppendix = EvidenceAppendix<Ss4aAppendixKey>;

/** The Safety snapshot the SS4A seed came from, as the loader found it. */
export type Ss4aSafetySourceRead =
  | { status: "no_project" }
  | { status: "absent" }
  | { status: "unreadable"; reason: string }
  | { status: "ready"; snapshot: SafetyPlanSnapshot; otherSeededArtifactCount: number };

/** The export-time recomputation of the network, for the map only. */
export type Ss4aHinRecomputeRead =
  | { status: "not_attempted" }
  | { status: "unreadable"; reason: string }
  | { status: "computed"; network: Extract<HighInjuryNetwork, { status: "computed" }>; roads: SafetyRoadContextFeature[] };

export type Ss4aEvidenceRecords = {
  projectId: string | null;
  projectName: string | null;
  safety: Ss4aSafetySourceRead;
  hinRecompute: Ss4aHinRecomputeRead;
  bca: ProjectBcaRead;
  engagement: ProjectEngagementRead;
};

const NO_SEED_REASON =
  "No saved Safety plan has been seeded into this application. Seed it from a Safety report to cite its frozen snapshot.";

function shell(key: Ss4aAppendixKey, index: number) {
  return appendixShell(key, index, SS4A_APPENDIX_TITLES);
}

function absentAppendix(
  key: Ss4aAppendixKey,
  index: number,
  status: Exclude<EvidenceAppendixStatus, "included">,
  statusNote: string
): Ss4aAppendix {
  return absentEvidenceAppendix(shell(key, index), status, statusNote);
}

function stored(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "Not recorded";
}

/**
 * Why a ranked row has no serious-injury count, from the acquisition's own
 * severity coverage. A fatality census and an injury source that does not
 * split serious injuries are different facts; both rank on fatal crashes.
 */
function seriousInjuryAbsence(severityCompleteness: unknown): string {
  if (severityCompleteness === "fatal_only") return "Not in source (fatal crashes only)";
  if (severityCompleteness === "fatal_injury_only") return "Not separated in source (injury crashes not split by severity)";
  return "Not available; severity coverage not recorded";
}

/** The publication line as the frozen caveats state it: a file update is never a cutoff. */
function publicationCutoff(acquisition: Record<string, unknown>): string {
  const provenance = acquisition.published_through_provenance && typeof acquisition.published_through_provenance === "object" && !Array.isArray(acquisition.published_through_provenance)
    ? (acquisition.published_through_provenance as Record<string, unknown>)
    : null;
  const publication = readCrashPublicationEvidence(
    typeof acquisition.published_through === "string" && acquisition.published_through ? acquisition.published_through : null,
    provenance
  );
  return publication.resourceUpdateNote ?? publication.publishedThrough ?? "Not recorded by the source";
}

function safetySource(safety: Extract<Ss4aSafetySourceRead, { status: "ready" }>): EvidenceAppendixSource {
  const { snapshot, otherSeededArtifactCount } = safety;
  const acquisition = snapshot.acquisition;
  return {
    record: "Safety report artifact",
    id: snapshot.artifactId,
    date: snapshot.generatedAt,
    dateLabel: "Generated",
    hash: snapshot.hash,
    hashLabel: "Snapshot SHA-256",
    link: `/reports/${snapshot.reportId}#artifact-${snapshot.artifactId}`,
    details: [
      `Report ${snapshot.reportId}.`,
      `Crash acquisition ${String(acquisition.id)}, retrieved ${String(acquisition.created_at)}.`,
      ...(otherSeededArtifactCount > 0
        ? [`This is the most recently generated of ${otherSeededArtifactCount + 1} seeded Safety artifacts; all are listed under Safety seed sources.`]
        : []),
    ],
  };
}

/** Exact agreement on every listed segment: identity, rank, tie and counts. */
function recomputedNetworkMatchesSnapshot(
  snapshot: SafetyPlanSnapshot,
  network: Extract<HighInjuryNetwork, { status: "computed" }>
): boolean {
  const frozen = snapshot.draft.network;
  if (frozen.kind !== "computed" || frozen.rows.length !== network.segments.length) return false;
  return frozen.rows.every((row, index) => {
    const segment = network.segments[index];
    return (
      segment.id === row.segmentId &&
      segment.rank === row.rank &&
      segment.tied === row.tied &&
      segment.crashCount === row.crashCount &&
      segment.fatalCrashCount === row.fatalCrashCount &&
      segment.seriousInjuryCrashCount === row.seriousInjuryCrashCount
    );
  });
}

function hinAppendix(index: number, records: Ss4aEvidenceRecords): Ss4aAppendix {
  const key = "hin_map" as const;
  const safety = records.safety;
  if (safety.status !== "ready") return safetyNotReady(key, index, safety);
  const network = safety.snapshot.draft.network;
  const severityCompleteness = safety.snapshot.acquisition.severity_completeness;
  if (network.kind === "unavailable") return absentAppendix(key, index, "missing", network.reason);

  const table = network.rows.length > 0
    ? {
        headers: ["Rank", "Location", "Miles", "Fatal", "Serious injury", "Per mile"],
        rows: network.rows.map((row) => [
          row.tied ? `${row.rank} (tie)` : String(row.rank),
          row.label,
          row.lengthMiles === null ? "Not a road piece" : row.lengthMiles.toFixed(2),
          row.fatalCrashCount.toLocaleString("en-US"),
          row.seriousInjuryCrashCount === null ? seriousInjuryAbsence(severityCompleteness) : row.seriousInjuryCrashCount.toLocaleString("en-US"),
          row.crashesPerMile === null ? `${row.crashCount.toLocaleString("en-US")} in square` : row.crashesPerMile.toFixed(1),
        ]),
      }
    : null;

  let figureSvg: string | null = null;
  let statusNote: string | null = null;
  const recompute = records.hinRecompute;
  if (network.rows.length === 0) {
    statusNote = "Map not drawn. No segment is ranked in the frozen snapshot, so there is nothing to map.";
  } else if (recompute.status === "not_attempted") {
    statusNote = "Map not drawn. The acquisition's stored bounds or years could not be read.";
  } else if (recompute.status === "unreadable") {
    statusNote = `Map not drawn. ${recompute.reason}`;
  } else if (!recomputedNetworkMatchesSnapshot(safety.snapshot, recompute.network)) {
    statusNote = `Map not drawn. ${HIN_MAP_MISMATCH_REASON}`;
  } else {
    figureSvg = renderSafetyStreetContextSvg({
      roads: recompute.roads,
      crashLocations: [],
      projectGeometry: null,
      highlights: recompute.network.segments.map((segment) => ({ rank: segment.rank, geometry: segment.geometry })),
      ariaLabel: "Ranked high-injury network segments, numbered by rank",
    });
    if (!figureSvg) statusNote = "Map not drawn. The ranked segments carry no drawable coordinates.";
  }

  return {
    ...shell(key, index),
    status: "included",
    statusNote,
    source: safetySource(safety),
    facts: [
      { label: "Measure", value: network.measureLabel },
      { label: "Source severity coverage", value: describeSeverityCoverage(severityCompleteness) },
      { label: "Years", value: network.years },
      { label: "Method", value: network.method },
      { label: "Coverage", value: network.coverage },
      { label: "Crash area", value: crashAreaBasisLabel(readCrashStudyAreaCoverage(safety.snapshot.acquisition.dimension_coverage)) },
    ],
    table,
    figureSvg,
    notes: [
      ...(figureSvg ? [HIN_MAP_DRAWN_NOTE, SAFETY_STREET_CONTEXT_PROJECTION_NOTE, "Numbered marks are the ranks in the table."] : []),
      network.sourceLine,
    ],
  };
}

function crashAppendix(index: number, records: Ss4aEvidenceRecords): Ss4aAppendix {
  const key = "crash_summary" as const;
  const safety = records.safety;
  if (safety.status !== "ready") return safetyNotReady(key, index, safety);
  const summary = safety.snapshot.draft.crashSummary;
  if (summary.kind === "absent") return absentAppendix(key, index, "unreadable", summary.reason);
  const acquisition = safety.snapshot.acquisition;
  const yearsRequested = Array.isArray(acquisition.years_requested) && acquisition.years_requested.length > 0
    ? acquisition.years_requested.map(String).join(", ")
    : "Not recorded";
  // Read from the acquisition the snapshot froze, so a packet generated
  // before the boundary check still says its counts are by rectangle.
  const studyArea = readCrashStudyAreaCoverage(acquisition.dimension_coverage);
  const areaSentence = describeCrashStudyArea(studyArea);
  const boundaryCounts = crashBoundaryCountLabel(studyArea);

  return {
    ...shell(key, index),
    status: "included",
    statusNote: null,
    source: safetySource(safety),
    facts: [
      { label: "Source", value: summary.sourceLabel },
      { label: "Severity coverage", value: describeSeverityCoverage(acquisition.severity_completeness) },
      { label: "Recorded severity coverage", value: typeof acquisition.severity_completeness === "string" && acquisition.severity_completeness ? acquisition.severity_completeness : "Not recorded" },
      { label: "Years requested", value: yearsRequested },
      { label: "Crash area", value: crashAreaBasisLabel(studyArea) },
      ...(studyArea.outsideBoundaryCount !== null
        ? [{ label: "Crashes outside the boundary, left out", value: studyArea.outsideBoundaryCount.toLocaleString("en-US") }]
        : []),
      ...(boundaryCounts ? [{ label: "Boundary counts", value: boundaryCounts }] : []),
      ...(studyArea.rectangleReportedCount !== null
        ? [{ label: "Crashes reported in the bounding rectangle", value: studyArea.rectangleReportedCount.toLocaleString("en-US") }]
        : []),
      { label: "Crashes reported", value: stored(acquisition.crash_count) },
      { label: "Crashes geocoded", value: stored(acquisition.geocoded_count) },
      { label: "Crashes stored", value: stored(acquisition.stored_count) },
      { label: "Retrieval truncated", value: acquisition.truncated === true ? "Yes; every count is a floor" : acquisition.truncated === false ? "No" : "Not recorded" },
      { label: "Source publication cutoff", value: publicationCutoff(acquisition) },
      ...summary.figures.map((figure) => ({
        label: figure.label,
        value: figure.value === null ? `Not available. ${figure.absentBecause ?? "No reason recorded."}` : figure.value.toLocaleString("en-US"),
      })),
    ],
    table: null,
    figureSvg: null,
    notes: [...summary.caveats.filter((caveat) => caveat !== areaSentence), areaSentence, summary.sourceLine],
  };
}

function countermeasureAppendix(index: number, records: Ss4aEvidenceRecords): Ss4aAppendix {
  const key = "countermeasures" as const;
  const safety = records.safety;
  if (safety.status !== "ready") return safetyNotReady(key, index, safety);
  const draft = safety.snapshot.draft;
  if (draft.treatments.length === 0) {
    return absentAppendix(key, index, "missing", "No candidate countermeasures are recorded in this snapshot. This does not establish that the agency has none.");
  }
  return {
    ...shell(key, index),
    status: "included",
    statusNote: null,
    source: safetySource(safety),
    facts: [],
    table: {
      headers: ["Location", "Network rank", "Countermeasure", "Addresses", "Crash types", "Crash modification factor", "Source"],
      rows: draft.treatments.flatMap((treatment) =>
        treatment.countermeasures.map((item) => [
          treatment.segmentLabel,
          treatment.rank === null ? "Not in the frozen ranked list" : String(treatment.rank),
          item.name,
          item.addresses,
          item.crashTypes.join(", "),
          item.cmfNote,
          item.sourceUrl,
        ])
      ),
    },
    figureSvg: null,
    notes: [COUNTERMEASURE_CANDIDATE_NOTE, draft.countermeasureSourceLine],
  };
}

function safetyNotReady(
  key: Ss4aAppendixKey,
  index: number,
  safety: Exclude<Ss4aSafetySourceRead, { status: "ready" }>
): Ss4aAppendix {
  if (safety.status === "no_project") return absentAppendix(key, index, "missing", NO_PROJECT_REASON);
  if (safety.status === "absent") return absentAppendix(key, index, "missing", NO_SEED_REASON);
  return absentAppendix(key, index, "unreadable", safety.reason);
}

function bcaAppendix(index: number, records: Ss4aEvidenceRecords): Ss4aAppendix {
  return bcaEvidenceAppendix(shell("bca", index), records.bca, records.projectId);
}

function engagementAppendix(index: number, records: Ss4aEvidenceRecords): Ss4aAppendix {
  return engagementEvidenceAppendix(shell("engagement", index), records.engagement, records.projectName);
}

const BUILDERS: Record<Ss4aAppendixKey, (index: number, records: Ss4aEvidenceRecords) => Ss4aAppendix> = {
  hin_map: hinAppendix,
  crash_summary: crashAppendix,
  countermeasures: countermeasureAppendix,
  bca: bcaAppendix,
  engagement: engagementAppendix,
};

/** Every appendix, in a fixed order, whether included, missing, unreadable or omitted. */
export function buildSs4aEvidenceAppendices(
  records: Ss4aEvidenceRecords,
  selected: ReadonlySet<Ss4aAppendixKey>
): Ss4aAppendix[] {
  return SS4A_APPENDIX_KEYS.map((key, index) =>
    selected.has(key)
      ? BUILDERS[key](index, records)
      : absentAppendix(key, index, "omitted", "Not selected for this export.")
  );
}
