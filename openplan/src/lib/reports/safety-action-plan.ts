/**
 * The "Safety action plan" draft section of a report.
 *
 * Built from three things only: the crash summary of the report's selected
 * acquisition, the high-injury network ranked from it, and the countermeasures
 * a planner attached to its segments. Code writes every number; no model is
 * involved. Every figure carries its source line, and the section lists the
 * action plan components it does not cover so nothing reads as complete.
 *
 * Storage is the report's own metadata, beside the acquisition selection it
 * depends on. No table or column is added.
 */

import type { SafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import {
  describeHighInjuryNetworkCoverage,
  describeHighInjuryNetworkMethod,
  describeHighInjuryNetworkUnavailable,
  describeHighInjuryNetworkYears,
  highInjuryNetworkMeasureLabel,
  type HighInjuryNetwork,
} from "@/lib/safety/high-injury-network";
import {
  COUNTERMEASURE_CRASH_TYPE_LABELS,
  describeCountermeasureSource,
  getSafetyCountermeasure,
} from "@/lib/safety/countermeasures";
import { buildPacketSafetyEvidence, type PacketSafetyFigure } from "./safety-evidence-section";

export const REPORT_SAFETY_ACTION_PLAN_VERSION = "openplan.report_safety_action_plan.v1";
export const SAFETY_ACTION_PLAN_SECTION_TITLE = "Safety action plan (draft)";
export const SAFETY_ACTION_PLAN_MAX_ATTACHMENTS = 50;
export const SAFETY_ACTION_PLAN_MAX_COUNTERMEASURES_PER_SEGMENT = 10;

const SEGMENT_ID_PATTERN = /^(?:road:[A-Za-z0-9_.:-]{1,200}|grid:-?\d{1,9}:-?\d{1,9})$/;

export type SafetyActionPlanAttachment = {
  segmentId: string;
  /** The segment's label when it was attached, kept so a stale id still reads. */
  segmentLabel: string;
  countermeasureIds: string[];
};

export type ReportSafetyActionPlan = {
  ingestId: string;
  attachments: SafetyActionPlanAttachment[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Keep only well-formed attachments to known countermeasures. */
export function normalizeSafetyActionPlanAttachments(value: unknown): SafetyActionPlanAttachment[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    const row = record(candidate);
    const segmentId = typeof row?.segmentId === "string" ? row.segmentId : "";
    const segmentLabel = typeof row?.segmentLabel === "string" ? row.segmentLabel.trim().slice(0, 200) : "";
    if (!SEGMENT_ID_PATTERN.test(segmentId) || !segmentLabel || seen.has(segmentId)) return [];
    const ids = Array.isArray(row?.countermeasureIds) ? row.countermeasureIds : [];
    const countermeasureIds = Array.from(new Set(
      ids.filter((id): id is string => typeof id === "string" && getSafetyCountermeasure(id) !== null),
    )).slice(0, SAFETY_ACTION_PLAN_MAX_COUNTERMEASURES_PER_SEGMENT);
    if (countermeasureIds.length === 0) return [];
    seen.add(segmentId);
    return [{ segmentId, segmentLabel, countermeasureIds }];
  }).slice(0, SAFETY_ACTION_PLAN_MAX_ATTACHMENTS);
}

/** Read the plan a planner saved into this report, or null when none was saved. */
export function readReportSafetyActionPlan(metadata: unknown): ReportSafetyActionPlan | null {
  const plan = record(record(metadata)?.safetyActionPlan);
  if (!plan || typeof plan.ingestId !== "string" || !plan.ingestId) return null;
  return { ingestId: plan.ingestId, attachments: normalizeSafetyActionPlanAttachments(plan.attachments) };
}

/** Preserve unrelated report metadata while replacing the saved plan. */
export function writeReportSafetyActionPlan(
  metadata: unknown,
  plan: ReportSafetyActionPlan,
): Record<string, unknown> {
  return {
    ...(record(metadata) ?? {}),
    safetyActionPlanVersion: REPORT_SAFETY_ACTION_PLAN_VERSION,
    safetyActionPlan: {
      ingestId: plan.ingestId,
      attachments: normalizeSafetyActionPlanAttachments(plan.attachments),
    },
  };
}

/** Where the component list below comes from. */
export const SS4A_ACTION_PLAN_COMPONENT_SOURCE = {
  label: "U.S. DOT, Safe Streets and Roads for All, Comprehensive Safety Action Plans",
  url: "https://www.transportation.gov/grants/ss4a/comprehensive-safety-action-plans",
  retrievedOn: "2026-10-13",
  note: "Component names follow the FY25 and FY26 notices as summarized by search results on the retrieval date. [VERIFY] against the current notice of funding opportunity.",
} as const;

export type ActionPlanComponentCoverage = {
  component: string;
  status: "not_covered" | "partial";
  gap: string;
};

/**
 * What this draft does and does not cover. No component is marked covered:
 * the two partial ones are partial on purpose, and saying more would overstate
 * the draft.
 */
export const SAFETY_ACTION_PLAN_COMPONENT_COVERAGE: readonly ActionPlanComponentCoverage[] = [
  {
    component: "Leadership commitment and goal setting",
    status: "not_covered",
    gap: "No public commitment, target date, or reduction goal is recorded here.",
  },
  {
    component: "Planning structure",
    status: "not_covered",
    gap: "No committee or oversight body is recorded here.",
  },
  {
    component: "Safety analysis",
    status: "partial",
    gap: "Has the crash summary and high-injury network. Lacks a systemic risk analysis, trends over time, and crash factor review.",
  },
  {
    component: "Engagement and collaboration",
    status: "not_covered",
    gap: "No public or partner engagement is drawn into this draft.",
  },
  {
    component: "Equity analysis",
    status: "not_covered",
    gap: "Earlier SS4A notices named equity as its own component [VERIFY]. The burden screen in this report is screening context, not an equity analysis.",
  },
  {
    component: "Policy and process changes",
    status: "not_covered",
    gap: "No review of current policies or standards is included.",
  },
  {
    component: "Strategy and project selections",
    status: "partial",
    gap: "Has countermeasures attached to ranked segments. Lacks a prioritized project list, costs, and time ranges.",
  },
  {
    component: "Progress and transparency",
    status: "not_covered",
    gap: "No progress measures or public reporting method is set.",
  },
];

export type SafetyActionPlanNetworkRow = {
  rank: number;
  tied: boolean;
  segmentId: string;
  label: string;
  lengthMiles: number | null;
  crashCount: number;
  fatalCrashCount: number;
  seriousInjuryCrashCount: number | null;
  crashesPerMile: number | null;
  countermeasureNames: string[];
};

export type SafetyActionPlanTreatment = {
  segmentId: string;
  segmentLabel: string;
  /** Null when the segment is no longer in the ranked list. */
  rank: number | null;
  countermeasures: Array<{
    name: string;
    addresses: string;
    crashTypes: string[];
    sourceUrl: string;
    cmfNote: string;
  }>;
};

export type SafetyActionPlanSectionDraft = {
  title: string;
  crashSummary:
    | { kind: "present"; sourceLabel: string; years: string; figures: PacketSafetyFigure[]; caveats: string[]; sourceLine: string }
    | { kind: "absent"; reason: string };
  network:
    | {
        kind: "computed";
        measureLabel: string;
        method: string;
        coverage: string;
        years: string;
        sourceLine: string;
        rows: SafetyActionPlanNetworkRow[];
      }
    | { kind: "unavailable"; reason: string };
  treatments: SafetyActionPlanTreatment[];
  countermeasureSourceLine: string;
  components: readonly ActionPlanComponentCoverage[];
  componentSourceLine: string;
  draftNotice: string;
};

/**
 * Build the draft section. `evidence` null means the crash summary could not be
 * read; `network` undefined means it was not computed for this packet. Both
 * render as stated absences, never as zeros.
 */
export function buildSafetyActionPlanSection(input: {
  plan: ReportSafetyActionPlan;
  evidence: SafetyCrashEvidence | null;
  network: HighInjuryNetwork | undefined;
}): SafetyActionPlanSectionDraft {
  const { plan, evidence, network } = input;
  const sourceLabel = evidence?.sourceLabel ?? "Crash source not recorded";

  const builtEvidence = evidence ? buildPacketSafetyEvidence([evidence]) : null;
  const acquisition = builtEvidence?.kind === "present" ? builtEvidence.acquisitions[0] : null;
  const crashSummary: SafetyActionPlanSectionDraft["crashSummary"] = acquisition && evidence
    ? {
        kind: "present",
        sourceLabel: acquisition.sourceLabel,
        years: acquisition.years,
        figures: acquisition.figures,
        caveats: acquisition.caveats,
        sourceLine: `Source: ${evidence.citationText}`,
      }
    : {
        kind: "absent",
        reason: "The crash summary for this plan's acquisition could not be read. That is a failed read, not a finding that no crashes occurred.",
      };

  const attachmentBySegment = new Map(plan.attachments.map((attachment) => [attachment.segmentId, attachment]));
  const countermeasureNames = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const entry = getSafetyCountermeasure(id);
      return entry ? [entry.name] : [];
    });

  let networkSection: SafetyActionPlanSectionDraft["network"];
  const rankBySegment = new Map<string, number>();
  if (!network) {
    networkSection = { kind: "unavailable", reason: "The high-injury network was not computed for this report." };
  } else if (network.status === "unavailable") {
    networkSection = { kind: "unavailable", reason: describeHighInjuryNetworkUnavailable(network.reason) };
  } else {
    for (const segment of network.segments) rankBySegment.set(segment.id, segment.rank);
    const roads = network.roadSources.length > 0 ? ` Road lines: ${network.roadSources.join("; ")}.` : "";
    networkSection = {
      kind: "computed",
      measureLabel: highInjuryNetworkMeasureLabel(network.basis, network.method),
      method: describeHighInjuryNetworkMethod(network.method, network.parameters),
      coverage: describeHighInjuryNetworkCoverage(network),
      years: describeHighInjuryNetworkYears(network.years),
      sourceLine: `Source: ${sourceLabel}. ${describeHighInjuryNetworkYears(network.years)}.${roads}`,
      rows: network.segments.map((segment) => ({
        rank: segment.rank,
        tied: segment.tied,
        segmentId: segment.id,
        label: segment.label,
        lengthMiles: segment.lengthMiles,
        crashCount: segment.crashCount,
        fatalCrashCount: segment.fatalCrashCount,
        seriousInjuryCrashCount: segment.seriousInjuryCrashCount,
        crashesPerMile: segment.crashesPerMile,
        countermeasureNames: countermeasureNames(attachmentBySegment.get(segment.id)?.countermeasureIds ?? []),
      })),
    };
  }

  const treatments: SafetyActionPlanTreatment[] = plan.attachments.map((attachment) => ({
    segmentId: attachment.segmentId,
    segmentLabel: attachment.segmentLabel,
    rank: rankBySegment.get(attachment.segmentId) ?? null,
    countermeasures: attachment.countermeasureIds.flatMap((id) => {
      const entry = getSafetyCountermeasure(id);
      if (!entry) return [];
      return [{
        name: entry.name,
        addresses: entry.addresses,
        crashTypes: entry.crashTypes.map((type) => COUNTERMEASURE_CRASH_TYPE_LABELS[type]),
        sourceUrl: entry.sourceUrl,
        cmfNote: entry.cmf
          ? `CMF ${entry.cmf.value} for ${entry.cmf.appliesTo} (CMF Clearinghouse ID ${entry.cmf.cmfId}, ${entry.cmf.url})`
          : entry.cmfNote ?? "[VERIFY] No crash modification factor cited.",
      }];
    }),
  }));

  return {
    title: SAFETY_ACTION_PLAN_SECTION_TITLE,
    crashSummary,
    network: networkSection,
    treatments,
    countermeasureSourceLine: describeCountermeasureSource(),
    components: SAFETY_ACTION_PLAN_COMPONENT_COVERAGE,
    componentSourceLine: `Source: ${SS4A_ACTION_PLAN_COMPONENT_SOURCE.label}, ${SS4A_ACTION_PLAN_COMPONENT_SOURCE.url}. Retrieved ${SS4A_ACTION_PLAN_COMPONENT_SOURCE.retrievedOn}. ${SS4A_ACTION_PLAN_COMPONENT_SOURCE.note}`,
    draftNotice: "This is a draft section for staff review. It is not an adopted safety action plan, and several required components are missing below.",
  };
}
