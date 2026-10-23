import { getReportPacketFreshness, resolveReportPacketSourceUpdatedAt, type ReportJurisdictionState } from "./catalog";
import { PACKET_FRESHNESS_LABELS } from "./packet-labels";
import { completeReportSourceReviewSummary, type ReportDriftSummary } from "./source-review-posture";
import { guidedReportCanonicalJson, readGuidedComparisonSelection } from "./guided-comparison";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A generated packet recorded that its project crash evidence read failed. */
export function artifactSafetyEvidenceReadFailed(
  artifactMetadata: Record<string, unknown> | null | undefined
): boolean {
  return asRecord(artifactMetadata?.sourceContext)?.safetyEvidenceReadStatus === "failed";
}

/** Absent on legacy artifacts; explicit pending or unreadable receipts stay incomplete. */
export function artifactGenerationWritebackIsCurrent(metadata: Record<string, unknown> | null | undefined, reportUpdatedAt: string | null | undefined): boolean | undefined {
  if (!metadata || !Object.hasOwn(metadata, "generationWriteback")) return undefined;
  const receipt = asRecord(metadata.generationWriteback);
  return receipt?.schema === "openplan.report-generation-writeback.v1" &&
    typeof receipt.reportUpdatedAt === "string" && Number.isFinite(Date.parse(receipt.reportUpdatedAt)) &&
    receipt.reportUpdatedAt === reportUpdatedAt;
}

const REPORT_WRITEBACK_GRACE_MS = 15 * 60 * 1000;

function hasMaterialReportWritebackAfterGeneration(
  generatedAt: string | null | undefined,
  updatedAt: string | null | undefined
) {
  if (!generatedAt || !updatedAt) return false;
  const generatedMs = new Date(generatedAt).getTime();
  const updatedMs = new Date(updatedAt).getTime();
  return Number.isFinite(generatedMs) && Number.isFinite(updatedMs)
    ? updatedMs - generatedMs > REPORT_WRITEBACK_GRACE_MS
    : false;
}

function isTimestampAfter(
  value: string | null | undefined,
  baseline: string | null | undefined
) {
  if (!value || !baseline) return false;
  const valueMs = new Date(value).getTime();
  const baselineMs = new Date(baseline).getTime();
  return Number.isFinite(valueMs) && Number.isFinite(baselineMs) && valueMs > baselineMs;
}

export function buildReportRegistryDriftSummary(input: {
  packetFreshnessLabel: string;
  generatedAt: string | null | undefined;
  reportUpdatedAt: string | null | undefined;
  rtpCycleUpdatedAt: string | null | undefined;
  safetyUpdatedAt?: string | null;
  safetyEvidenceReadFailed?: boolean;
  jurisdictionState?: ReportJurisdictionState;
  generationWritebackCurrent?: boolean;
  unassessedLabels?: string[];
}): ReportDriftSummary {
  const labels: string[] = [];
  if (isTimestampAfter(input.rtpCycleUpdatedAt, input.generatedAt)) labels.push("RTP cycle");
  if (isTimestampAfter(input.safetyUpdatedAt, input.generatedAt)) labels.push("Crash evidence");

  if (input.generationWritebackCurrent !== true && hasMaterialReportWritebackAfterGeneration(input.generatedAt, input.reportUpdatedAt)) {
    labels.push("Report metadata");
  }
  const summary = completeReportSourceReviewSummary({ changedCount: labels.length, totalCount: labels.length, labels }, {
    jurisdictionState: input.jurisdictionState,
    generationWritebackCurrent: input.generationWritebackCurrent,
    unassessedLabels: [...(input.unassessedLabels ?? []), ...(input.safetyEvidenceReadFailed ? ["Retained crash evidence read failed"] : [])],
  });
  if (input.packetFreshnessLabel === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED &&
      !summary.changedCount && !summary.unassessedLabels?.length && !summary.reviewLabels?.length) {
    summary.reviewLabels = ["Packet freshness requires review"];
  }
  return summary;
}

export function resolveTrackedReportSourceUpdatedAt(input: {
  generatedAt: string | null;
  reportUpdatedAt: string | null;
  cycleUpdatedAt: string | null;
  artifactMetadata: Record<string, unknown> | null;
  safetyUpdatedAt?: string | null;
}) {
  const sourceContext = asRecord(input.artifactMetadata?.sourceContext);
  const projectFundingSnapshot = asRecord(sourceContext?.projectFundingSnapshot);
  const trackedSourceUpdatedAt = resolveReportPacketSourceUpdatedAt([
    input.cycleUpdatedAt,
    typeof sourceContext?.projectUpdatedAt === "string" ? sourceContext.projectUpdatedAt : null,
    typeof sourceContext?.rtpCycleUpdatedAt === "string" ? sourceContext.rtpCycleUpdatedAt : null,
    typeof projectFundingSnapshot?.latestSourceUpdatedAt === "string"
      ? projectFundingSnapshot.latestSourceUpdatedAt
      : null,
    input.safetyUpdatedAt ?? null,
  ]);
  if (input.artifactMetadata && Object.hasOwn(input.artifactMetadata, "generationWriteback")) {
    // New artifacts match the exact writeback, never a grace period.
    return artifactGenerationWritebackIsCurrent(input.artifactMetadata, input.reportUpdatedAt)
      ? trackedSourceUpdatedAt ?? input.generatedAt
      : resolveReportPacketSourceUpdatedAt([trackedSourceUpdatedAt, input.reportUpdatedAt]);
  }
  if (!trackedSourceUpdatedAt) return input.reportUpdatedAt;
  return hasMaterialReportWritebackAfterGeneration(input.generatedAt, input.reportUpdatedAt)
    ? resolveReportPacketSourceUpdatedAt([trackedSourceUpdatedAt, input.reportUpdatedAt])
    : trackedSourceUpdatedAt;
}

/** Shared row adapter keeps overview and registry writeback handling consistent. */
export function resolveReportPacketRowFreshness(
  report: { latest_artifact_kind: string | null; generated_at: string | null; updated_at: string; metadata_json?: Record<string, unknown> | null },
  artifact: { generated_at: string; metadata_json: Record<string, unknown> | null } | null | undefined,
  jurisdictionState?: ReportJurisdictionState,
) {
  const generatedAt = artifact?.generated_at ?? report.generated_at;
  if (generatedAt && report.metadata_json !== undefined) {
    try {
      readGuidedComparisonSelection(report.metadata_json);
      readGuidedComparisonSelection(artifact?.metadata_json);
    } catch {
      return { label: PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED, tone: "warning" as const,
        detail: "A saved guided comparison binding is unavailable or unsupported. Reopen the report to review it. Historical files remain available." };
    }
  }
  if (generatedAt && report.metadata_json !== undefined && guidedReportCanonicalJson(report.metadata_json?.guidedComparisonSelectionV1 ?? null) !==
      guidedReportCanonicalJson(artifact?.metadata_json?.guidedComparisonSelectionV1 ?? null)) {
    return { label: PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED, tone: "warning" as const,
      detail: "The saved guided comparison differs from the retained artifact. Reopen the report to verify current evidence before generating again. Historical files keep their original comparison." };
  }
  const writebackCurrent = artifactGenerationWritebackIsCurrent(artifact?.metadata_json, report.updated_at);
  return getReportPacketFreshness({ latestArtifactKind: report.latest_artifact_kind, generatedAt,
    generationWritebackCurrent: writebackCurrent, jurisdictionState,
    updatedAt: writebackCurrent === undefined ? report.updated_at : resolveTrackedReportSourceUpdatedAt({ generatedAt, reportUpdatedAt: report.updated_at,
      cycleUpdatedAt: null, artifactMetadata: artifact?.metadata_json ?? null }),
  });
}
