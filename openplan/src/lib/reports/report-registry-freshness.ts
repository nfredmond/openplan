import { resolveReportPacketSourceUpdatedAt } from "./catalog";
import { PACKET_FRESHNESS_LABELS } from "./packet-labels";
import type { ReportDriftSummary } from "./source-review-posture";

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
}): ReportDriftSummary {
  if (input.packetFreshnessLabel !== PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED) {
    return { changedCount: 0, totalCount: 0, labels: [] };
  }

  const labels: string[] = [];
  if (isTimestampAfter(input.rtpCycleUpdatedAt, input.generatedAt)) labels.push("RTP cycle");
  if (isTimestampAfter(input.safetyUpdatedAt, input.generatedAt)) labels.push("Crash evidence");
  if (input.safetyEvidenceReadFailed) labels.push("Crash evidence read");
  if (hasMaterialReportWritebackAfterGeneration(input.generatedAt, input.reportUpdatedAt)) {
    labels.push("Report metadata");
  }
  if (labels.length === 0) labels.push("Tracked source context");
  return { changedCount: labels.length, totalCount: labels.length, labels };
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
  if (!trackedSourceUpdatedAt) return input.reportUpdatedAt;
  return hasMaterialReportWritebackAfterGeneration(input.generatedAt, input.reportUpdatedAt)
    ? resolveReportPacketSourceUpdatedAt([trackedSourceUpdatedAt, input.reportUpdatedAt])
    : trackedSourceUpdatedAt;
}
