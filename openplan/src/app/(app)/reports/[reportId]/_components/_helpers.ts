import type { PortfolioFundingSnapshot } from "@/lib/projects/funding";
import { formatDateTime } from "@/lib/reports/catalog";
import type { ReportScenarioSetLink } from "@/lib/reports/scenario-provenance";
import type {
  ProjectStageGateSnapshot,
  StageGateSnapshotGateSummary,
  StageGateWorkflowState,
} from "@/lib/stage-gates/summary";
import type {
  CurrentProjectRecordEntry,
  DriftStatus,
  EngagementCampaignSnapshot,
  ProjectRecordSnapshotEntry,
  RunAuditEntry,
  StageGateSnapshotControlHealth,
} from "./_types";

export function driftTone(
  status: DriftStatus
): "success" | "warning" | "neutral" | "info" {
  if (status === "unchanged") return "success";
  if (status === "gate changed" || status === "count changed") return "warning";
  if (status === "updated") return "info";
  return "neutral";
}

export function asHtmlContent(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  return typeof metadata.htmlContent === "string"
    ? metadata.htmlContent
    : null;
}

export function asRunAudit(
  metadata: Record<string, unknown> | null | undefined
): RunAuditEntry[] {
  if (!metadata || !Array.isArray(metadata.runAudit)) {
    return [];
  }

  return metadata.runAudit.filter((item): item is RunAuditEntry => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const record = item as Record<string, unknown>;
    const gate = record.gate;

    return (
      typeof record.runId === "string" &&
      Boolean(gate) &&
      typeof gate === "object"
    );
  });
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asSourceContext(
  metadata: Record<string, unknown> | null | undefined
) {
  if (!metadata) return null;
  return asRecord(metadata.sourceContext);
}

export function asScenarioSetLinks(value: unknown): ReportScenarioSetLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is ReportScenarioSetLink =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).scenarioSetId === "string" &&
      typeof (item as Record<string, unknown>).scenarioSetTitle === "string" &&
      Array.isArray((item as Record<string, unknown>).matchedEntries)
  );
}

export function asProjectRecordSnapshotEntry(
  value: unknown
): ProjectRecordSnapshotEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    count: asNullableNumber(record.count) ?? 0,
    latestTitle: asNullableString(record.latestTitle),
    latestAt: asNullableString(record.latestAt),
  };
}

export function asStageGateSnapshotGateSummary(
  value: unknown
): StageGateSnapshotGateSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const workflowState = asNullableString(
    record.workflowState
  ) as StageGateWorkflowState | null;
  const missingArtifacts = Array.isArray(record.missingArtifacts)
    ? record.missingArtifacts.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      )
    : [];

  if (
    !workflowState ||
    !["pass", "hold", "not_started"].includes(workflowState)
  ) {
    return null;
  }

  return {
    gateId: asNullableString(record.gateId) ?? "Unknown gate",
    sequence: asNullableNumber(record.sequence) ?? 0,
    name: asNullableString(record.name) ?? "Unknown gate",
    workflowState,
    rationale: asNullableString(record.rationale) ?? "No rationale provided.",
    missingArtifacts,
    requiredEvidenceCount: asNullableNumber(record.requiredEvidenceCount) ?? 0,
    operatorControlEvidenceCount:
      asNullableNumber(record.operatorControlEvidenceCount) ?? 0,
  };
}

export function asStageGateSnapshotControlHealth(
  value: unknown
): StageGateSnapshotControlHealth {
  const record = asRecord(value);

  return {
    totalOperatorControlEvidenceCount:
      asNullableNumber(record?.totalOperatorControlEvidenceCount) ?? 0,
    gatesWithOperatorControlsCount:
      asNullableNumber(record?.gatesWithOperatorControlsCount) ?? 0,
  };
}

export function asStageGateSnapshot(
  value: unknown
): ProjectStageGateSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const templateId = asNullableString(record.templateId);
  const templateVersion = asNullableString(record.templateVersion);

  if (!templateId || !templateVersion) {
    return null;
  }

  return {
    templateId,
    templateVersion,
    passCount: asNullableNumber(record.passCount) ?? 0,
    holdCount: asNullableNumber(record.holdCount) ?? 0,
    notStartedCount: asNullableNumber(record.notStartedCount) ?? 0,
    blockedGate: asStageGateSnapshotGateSummary(record.blockedGate),
    nextGate: asStageGateSnapshotGateSummary(record.nextGate),
    controlHealth: asStageGateSnapshotControlHealth(record.controlHealth),
  };
}

export function asPortfolioFundingSnapshot(
  value: unknown
): PortfolioFundingSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    capturedAt: asNullableString(record.capturedAt),
    latestSourceUpdatedAt: asNullableString(record.latestSourceUpdatedAt),
    linkedProjectCount: asNullableNumber(record.linkedProjectCount) ?? 0,
    trackedProjectCount: asNullableNumber(record.trackedProjectCount) ?? 0,
    fundedProjectCount: asNullableNumber(record.fundedProjectCount) ?? 0,
    likelyCoveredProjectCount:
      asNullableNumber(record.likelyCoveredProjectCount) ?? 0,
    gapProjectCount: asNullableNumber(record.gapProjectCount) ?? 0,
    committedFundingAmount:
      asNullableNumber(record.committedFundingAmount) ?? 0,
    likelyFundingAmount: asNullableNumber(record.likelyFundingAmount) ?? 0,
    totalPotentialFundingAmount:
      asNullableNumber(record.totalPotentialFundingAmount) ?? 0,
    unfundedAfterLikelyAmount:
      asNullableNumber(record.unfundedAfterLikelyAmount) ?? 0,
    paidReimbursementAmount:
      asNullableNumber(record.paidReimbursementAmount) ?? 0,
    outstandingReimbursementAmount:
      asNullableNumber(record.outstandingReimbursementAmount) ?? 0,
    uninvoicedAwardAmount:
      asNullableNumber(record.uninvoicedAwardAmount) ?? 0,
    awardRiskCount: asNullableNumber(record.awardRiskCount) ?? 0,
    label: asNullableString(record.label) ?? "Unknown funding posture",
    reason:
      asNullableString(record.reason) ??
      "No RTP funding posture was captured on this packet artifact.",
    reimbursementLabel:
      asNullableString(record.reimbursementLabel) ??
      "Unknown reimbursement posture",
    reimbursementReason:
      asNullableString(record.reimbursementReason) ??
      "No RTP reimbursement posture was captured on this packet artifact.",
  };
}

export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function maxTimestamp(
  ...values: Array<string | null | undefined>
): string | null {
  const timestamps = values
    .map((value) => parseTimestamp(value))
    .filter((value): value is number => value !== null);

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

export function formatCompactDateTime(value: string | null | undefined): string {
  return value ? formatDateTime(value) : "Unavailable";
}

export function formatCurrency(value: number | null | undefined): string {
  const numeric = typeof value === "number" ? value : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function asEngagementCampaignSnapshot(
  value: unknown
): EngagementCampaignSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = asNullableString(record.id);
  const title = asNullableString(record.title);

  if (!id || !title) {
    return null;
  }

  return {
    id,
    title,
    status: asNullableString(record.status),
    updatedAt: asNullableString(record.updatedAt),
  };
}

export function buildCurrentProjectRecordEntry<
  T extends { title: string | null; created_at: string | null },
>(
  items: T[],
  getAt: (item: T) => string | null
): CurrentProjectRecordEntry {
  return {
    count: items.length,
    latestTitle: items[0]?.title ?? null,
    latestAt: items[0] ? getAt(items[0]) : null,
  };
}

export function summarizeProjectRecordDrift(changes: string[]): string {
  if (changes.length === 0) {
    return "Snapshot counts and latest record timing still match live project records.";
  }

  return changes.join(" ");
}
