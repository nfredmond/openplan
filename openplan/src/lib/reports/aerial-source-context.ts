import {
  summarizeAerialEvidenceAttachmentReadiness,
  type AerialEvidenceAttachmentReadiness,
  type AerialEvidenceAttachmentUse,
} from "@/lib/aerial/catalog";

export type ReportAerialMissionSourceRow = {
  id: string;
  title: string | null;
  status: string | null;
  mission_type: string | null;
  project_id: string | null;
  aoi_geojson: unknown;
  updated_at: string | null;
};

export type ReportAerialEvidencePackageSourceRow = {
  id: string;
  mission_id: string;
  title: string | null;
  status: string | null;
  verification_readiness: string | null;
  notes: string | null;
  updated_at: string | null;
};

export type ReportAerialMissionSourceSummary = {
  missionId: string;
  title: string;
  status: string | null;
  missionType: string | null;
  updatedAt: string | null;
  packageCount: number;
  readiness: AerialEvidenceAttachmentReadiness;
  label: string;
  detail: string;
  sourceContext: string;
  attachmentReadyPackageCount: number;
  sourceContextPackageCount: number;
  readyUses: AerialEvidenceAttachmentUse[];
  blockers: string[];
};

export type ReportAerialEvidenceSourceContext = {
  metadataSchemaVersion: "2026-05-aerial-report-source-context";
  missionCount: number;
  packageCount: number;
  orphanPackageCount: number;
  attachmentReadyPackageCount: number;
  sourceContextPackageCount: number;
  readiness: AerialEvidenceAttachmentReadiness;
  label: string;
  detail: string;
  readyUses: AerialEvidenceAttachmentUse[];
  blockedUses: AerialEvidenceAttachmentUse[];
  sourceContext: string;
  blockers: string[];
  caveat: string;
  operatorAssisted: true;
  autonomousPhotogrammetryClaim: false;
  regulatoryComplianceClaim: false;
  surveyGradeCertificationClaim: false;
  missionSummaries: ReportAerialMissionSourceSummary[];
};

const AERIAL_ATTACHMENT_USES: AerialEvidenceAttachmentUse[] = [
  "project",
  "grant",
  "report",
  "public_response",
];

const AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT =
  "Operator-assisted aerial evidence only; attach the cited package and human review notes before using it in a grant, report, or public comment response. No autonomous photogrammetry, regulatory compliance, or survey-grade certification is implied.";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function missionTitle(row: ReportAerialMissionSourceRow, index: number): string {
  return row.title?.trim() || `Aerial mission ${index + 1}`;
}

function missionHasAoi(row: ReportAerialMissionSourceRow): boolean {
  return row.aoi_geojson != null;
}

function dominantReadiness(
  summaries: ReportAerialMissionSourceSummary[],
  orphanPackageCount: number
): AerialEvidenceAttachmentReadiness {
  if (summaries.some((summary) => summary.readiness === "ready")) {
    return "ready";
  }

  if (summaries.some((summary) => summary.readiness === "needs_source_context")) {
    return "needs_source_context";
  }

  return orphanPackageCount > 0 || summaries.length > 0 ? "blocked" : "blocked";
}

function summarizeMission(
  mission: ReportAerialMissionSourceRow,
  packages: ReportAerialEvidencePackageSourceRow[],
  index: number
): ReportAerialMissionSourceSummary {
  const title = missionTitle(mission, index);
  const summary = summarizeAerialEvidenceAttachmentReadiness({
    missionTitle: title,
    missionStatus: mission.status,
    missionType: mission.mission_type,
    hasProjectLink: Boolean(mission.project_id),
    hasAoi: missionHasAoi(mission),
    packages: packages.map((pkg) => ({
      title: pkg.title,
      status: pkg.status ?? "processing",
      verification_readiness: pkg.verification_readiness ?? "pending",
      notes: pkg.notes,
      updated_at: pkg.updated_at,
    })),
  });

  return {
    missionId: mission.id,
    title,
    status: mission.status,
    missionType: mission.mission_type,
    updatedAt: mission.updated_at,
    packageCount: packages.length,
    readiness: summary.readiness,
    label: summary.label,
    detail: summary.detail,
    sourceContext: summary.sourceContext,
    attachmentReadyPackageCount: summary.attachmentReadyPackageCount,
    sourceContextPackageCount: summary.sourceContextPackageCount,
    readyUses: summary.readyUses,
    blockers: summary.blockers,
  };
}

function orphanPackageBlocker(count: number): string | null {
  if (count === 0) return null;
  return `${count} aerial evidence package${count === 1 ? " references" : "s reference"} a mission that was not loaded into the report source context.`;
}

export function buildReportAerialEvidenceSourceContext(input: {
  missions: ReportAerialMissionSourceRow[];
  packages: ReportAerialEvidencePackageSourceRow[];
}): ReportAerialEvidenceSourceContext | null {
  if (input.missions.length === 0 && input.packages.length === 0) {
    return null;
  }

  const packagesByMissionId = new Map<string, ReportAerialEvidencePackageSourceRow[]>();
  for (const pkg of input.packages) {
    packagesByMissionId.set(pkg.mission_id, [
      ...(packagesByMissionId.get(pkg.mission_id) ?? []),
      pkg,
    ]);
  }

  const missionIds = new Set(input.missions.map((mission) => mission.id));
  const orphanPackageCount = input.packages.filter((pkg) => !missionIds.has(pkg.mission_id)).length;
  const missionSummaries = input.missions.map((mission, index) =>
    summarizeMission(mission, packagesByMissionId.get(mission.id) ?? [], index)
  );

  const readiness = dominantReadiness(missionSummaries, orphanPackageCount);
  const readyUses = AERIAL_ATTACHMENT_USES.filter((use) =>
    missionSummaries.some((summary) => summary.readyUses.includes(use))
  );
  const blockedUses = AERIAL_ATTACHMENT_USES.filter((use) => !readyUses.includes(use));
  const attachmentReadyPackageCount = missionSummaries.reduce(
    (sum, summary) => sum + summary.attachmentReadyPackageCount,
    0
  );
  const sourceContextPackageCount = missionSummaries.reduce(
    (sum, summary) => sum + summary.sourceContextPackageCount,
    0
  );
  const blockers = uniqueStrings([
    ...missionSummaries.flatMap((summary) => summary.blockers),
    orphanPackageBlocker(orphanPackageCount) ?? "",
  ]);
  const sourceContextParts = missionSummaries.map((summary) => summary.sourceContext);
  if (orphanPackageCount > 0) {
    sourceContextParts.push(
      `${orphanPackageCount} aerial evidence package${orphanPackageCount === 1 ? " is" : "s are"} not traceable to a loaded mission record. ${AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT}`
    );
  }

  const label =
    readiness === "ready"
      ? "Aerial evidence source context attached"
      : readiness === "needs_source_context"
        ? "Aerial evidence source context needed"
        : "Aerial evidence blocked for report attachment";
  const detail =
    readiness === "ready"
      ? `${attachmentReadyPackageCount} operator-reviewed aerial package${attachmentReadyPackageCount === 1 ? "" : "s"} can be cited after human report review.`
      : blockers[0] ?? "Complete aerial evidence source context before report attachment.";

  return {
    metadataSchemaVersion: "2026-05-aerial-report-source-context",
    missionCount: input.missions.length,
    packageCount: input.packages.length,
    orphanPackageCount,
    attachmentReadyPackageCount,
    sourceContextPackageCount,
    readiness,
    label,
    detail,
    readyUses,
    blockedUses,
    sourceContext: sourceContextParts.join(" ") || `Aerial evidence source context is incomplete. ${AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT}`,
    blockers,
    caveat: AERIAL_REPORT_SOURCE_CONTEXT_CAVEAT,
    operatorAssisted: true,
    autonomousPhotogrammetryClaim: false,
    regulatoryComplianceClaim: false,
    surveyGradeCertificationClaim: false,
    missionSummaries,
  };
}
