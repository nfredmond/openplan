import { getReportPacketWorkStatus } from "@/lib/reports/catalog";
import {
  PACKET_FRESHNESS_LABELS,
  PACKET_POSTURE_LABELS,
} from "@/lib/reports/packet-labels";
import { formatRtpDateTime } from "@/lib/rtp/catalog";
import { formatUsdWholeAmount } from "./_helpers";
import type {
  PacketAttention,
  PacketAttentionFilter,
  QueueActionFilter,
  QueueTraceStateFilter,
  RtpPacketReportRow,
} from "./_types";

const RECENT_QUEUE_ACTION_WINDOW_MS = 1000 * 60 * 60 * 24;

export function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(message ?? "");
}

export function normalizePacketAttentionFilter(value: string | null | undefined): PacketAttentionFilter {
  switch (value) {
    case "generate":
    case "refresh":
    case "missing":
    case "reset":
    case "current":
      return value;
    default:
      return "all";
  }
}

export function normalizeRecentQueueFilter(value: string | null | undefined) {
  return value === "1";
}

export function normalizeQueueActionFilter(value: string | null | undefined): QueueActionFilter {
  switch (value) {
    case "create_record":
    case "reset_layout":
    case "generate_first_artifact":
    case "refresh_artifact":
      return value;
    default:
      return "all";
  }
}

export function matchesQueueActionFilter(filter: QueueActionFilter, action: string | null | undefined) {
  if (filter === "all") {
    return true;
  }
  return filter === action;
}

export function normalizeQueueTraceStateFilter(value: string | null | undefined): QueueTraceStateFilter {
  switch (value) {
    case "outpaced":
    case "aligned":
    case "unrecorded":
      return value;
    default:
      return "all";
  }
}

export function matchesQueueTraceStateFilter(filter: QueueTraceStateFilter, state: string | null | undefined) {
  if (filter === "all") {
    return true;
  }
  return filter === state;
}

export function getPacketAttentionPriority(packetAttention: PacketAttention) {
  switch (packetAttention) {
    case "reset":
      return 0;
    case "missing":
      return 1;
    case "generate":
      return 2;
    case "refresh":
      return 3;
    default:
      return 4;
  }
}

export function getQueueTraceStatePriority(queueTraceState: QueueTraceStateFilter) {
  switch (queueTraceState) {
    case "outpaced":
      return 0;
    case "unrecorded":
      return 1;
    case "aligned":
      return 2;
    default:
      return 3;
  }
}

export function matchesPacketAttentionFilter(filter: PacketAttentionFilter, packetAttention: PacketAttention) {
  if (filter === "all") {
    return true;
  }
  return filter === packetAttention;
}

export function buildPacketFundingReview(input: {
  linkedProjectCount: number;
  fundedProjectCount: number;
  likelyCoveredProjectCount: number;
  unfundedProjectCount: number;
  reimbursementInFlightCount: number;
  outstandingReimbursementAmount: number;
  uninvoicedAwardAmount: number;
}) {
  if (input.linkedProjectCount === 0) {
    return {
      label: "No linked projects",
      tone: "neutral" as const,
      detail: "This RTP cycle does not yet have linked projects, so funding-backed release review is not active here.",
      needsAttention: false,
    };
  }

  if (input.unfundedProjectCount > 0) {
    return {
      label: "Funding gap review",
      tone: "warning" as const,
      detail: `${input.unfundedProjectCount} linked project${input.unfundedProjectCount === 1 ? " still carries" : "s still carry"} an uncovered funding gap. Release review should acknowledge that packet readiness and funding readiness are diverging.`,
      needsAttention: true,
    };
  }

  if (input.uninvoicedAwardAmount > 0) {
    return {
      label: "Award follow-through pending",
      tone: "info" as const,
      detail: `${formatUsdWholeAmount(input.uninvoicedAwardAmount)} in awarded funding has not been invoiced yet, so packet release review should flag reimbursement follow-through before the cycle looks financially settled.`,
      needsAttention: true,
    };
  }

  if (input.outstandingReimbursementAmount > 0 || input.reimbursementInFlightCount > 0) {
    return {
      label: "Reimbursement in flight",
      tone: "info" as const,
      detail: `${formatUsdWholeAmount(input.outstandingReimbursementAmount)} remains outstanding across ${input.reimbursementInFlightCount} linked project${input.reimbursementInFlightCount === 1 ? " reimbursement request" : " reimbursement requests"} in flight.`,
      needsAttention: true,
    };
  }

  if (input.likelyCoveredProjectCount > 0) {
    return {
      label: "Pipeline-backed review",
      tone: "info" as const,
      detail: `${input.likelyCoveredProjectCount} linked project${input.likelyCoveredProjectCount === 1 ? " looks" : "s look"} likely coverable through pursued funding, but the packet still depends on pipeline conversion rather than secured money.`,
      needsAttention: true,
    };
  }

  if (input.fundedProjectCount > 0) {
    return {
      label: "Funding posture aligned",
      tone: "success" as const,
      detail: "Linked projects are fully funded or reimbursed with no visible funding follow-through pressure blocking packet release review.",
      needsAttention: false,
    };
  }

  return {
    label: "Funding posture not anchored",
    tone: "neutral" as const,
    detail: "Linked projects exist, but no durable funding posture is anchored yet, so release review remains packet-heavy instead of truly integrated.",
    needsAttention: false,
  };
}

export function buildPacketOperatorStatus(input: {
  packetReport: RtpPacketReportRow | null;
  packetFreshness: { label: string };
  packetPresetPosture: { label: string };
  packetQueueTraceState: { state: QueueTraceStateFilter; label: string };
  packetFundingReview: { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger"; detail: string; needsAttention: boolean };
}) {
  if (!input.packetReport) {
    return {
      label: "Queue-ready",
      tone: "warning" as const,
      detail: "Create the first RTP packet record from the queue board.",
    };
  }

  if (input.packetPresetPosture.label === PACKET_POSTURE_LABELS.NEEDS_RESET) {
    return {
      label: "Intervention needed",
      tone: "warning" as const,
      detail: "Reset the packet layout, then regenerate the stale artifact.",
    };
  }

  if (input.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED) {
    const workStatus = getReportPacketWorkStatus(input.packetFreshness.label);
    return {
      label: workStatus.label,
      tone: workStatus.tone,
      detail: workStatus.detail,
    };
  }

  if (input.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET) {
    const workStatus = getReportPacketWorkStatus(input.packetFreshness.label);
    return {
      label: workStatus.label,
      tone: workStatus.tone,
      detail: workStatus.detail,
    };
  }

  if (input.packetQueueTraceState.state === "outpaced") {
    return {
      label: "Trace follow-up",
      tone: "warning" as const,
      detail: "The cycle changed after the last recorded queue action, so the saved operator trace needs review against current packet state.",
    };
  }

  if (input.packetQueueTraceState.state === "unrecorded") {
    return {
      label: "Trace gap",
      tone: "neutral" as const,
      detail: "Packet state is visible, but this cycle still lacks durable queue-action trace coverage.",
    };
  }

  if (input.packetFundingReview.needsAttention) {
    return {
      label: "Funding-backed release review",
      tone: input.packetFundingReview.tone === "warning" ? ("warning" as const) : ("info" as const),
      detail: `Packet record and latest artifact are aligned with current cycle state, but ${input.packetFundingReview.detail.charAt(0).toLowerCase()}${input.packetFundingReview.detail.slice(1)}`,
    };
  }

  const workStatus = getReportPacketWorkStatus(input.packetFreshness.label);
  return {
    label: workStatus.label,
    tone: workStatus.tone,
    detail: workStatus.detail,
  };
}

export function buildPacketActivityTrace(input: {
  packetReport: RtpPacketReportRow | null;
  packetFreshness: { label: string };
  packetAttention: PacketAttention;
}) {
  if (!input.packetReport) {
    return {
      label: "No packet activity",
      tone: "warning" as const,
      detail: "No linked RTP packet record exists yet for this cycle.",
    };
  }

  if (!input.packetReport.generated_at || input.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET) {
    return {
      label: "Record created",
      tone: "info" as const,
      detail: `Packet record updated ${formatRtpDateTime(input.packetReport.updated_at)} and still awaiting its first generated artifact.`,
    };
  }

  if (input.packetAttention === "reset") {
    return {
      label: "Artifact drift detected",
      tone: "warning" as const,
      detail: `Latest ${input.packetReport.latest_artifact_kind ?? "packet"} artifact was generated ${formatRtpDateTime(input.packetReport.generated_at)}, but layout drift now requires a preset reset.`,
    };
  }

  if (input.packetAttention === "refresh") {
    return {
      label: "Artifact behind source",
      tone: "info" as const,
      detail: `Latest ${input.packetReport.latest_artifact_kind ?? "packet"} artifact was generated ${formatRtpDateTime(input.packetReport.generated_at)} and should be refreshed from current cycle state.`,
    };
  }

  return {
    label: "Artifact current",
    tone: "success" as const,
    detail: `Latest ${input.packetReport.latest_artifact_kind ?? "packet"} artifact was generated ${formatRtpDateTime(input.packetReport.generated_at)}, remains current, and is ready for release review.`,
  };
}

export function buildPacketQueueTrace(packetReport: RtpPacketReportRow | null) {
  const finalize = (input: {
    action?: string | null;
    label: string;
    tone: "neutral" | "info" | "success" | "warning" | "danger";
    detail: string;
    actedAt?: string | null;
  }) => {
    const actedAt = input.actedAt ?? null;
    const actedAtTimestamp = actedAt ? new Date(actedAt).getTime() : Number.NaN;
    const sortTimestamp = Number.isFinite(actedAtTimestamp) ? actedAtTimestamp : 0;

    return {
      ...input,
      action: input.action ?? null,
      actedAt,
      sortTimestamp,
      isRecent: sortTimestamp > 0 && Date.now() - sortTimestamp <= RECENT_QUEUE_ACTION_WINDOW_MS,
    };
  };

  if (!packetReport) {
    return finalize({
      label: "No queue trace",
      tone: "neutral" as const,
      detail: "No packet record exists yet, so there is no recorded queue action.",
    });
  }

  const queueTrace =
    packetReport.metadata_json && typeof packetReport.metadata_json === "object"
      ? (packetReport.metadata_json as { queueTrace?: Record<string, unknown> }).queueTrace
      : null;

  const action = typeof queueTrace?.action === "string" ? queueTrace.action : null;
  const actedAt = typeof queueTrace?.actedAt === "string" ? queueTrace.actedAt : null;
  const detail = typeof queueTrace?.detail === "string" ? queueTrace.detail : null;

  if (!action) {
    return finalize({
      label: "Not recorded",
      tone: "neutral" as const,
      detail: "This packet record has no persisted queue action trace yet.",
    });
  }

  switch (action) {
    case "create_record":
      return finalize({
        action,
        label: "Record created",
        tone: "info" as const,
        detail: detail ?? "Packet record created.",
        actedAt,
      });
    case "reset_layout":
      return finalize({
        action,
        label: "Preset reset",
        tone: "warning" as const,
        detail: detail ?? "Packet layout preset reapplied.",
        actedAt,
      });
    case "generate_first_artifact":
      return finalize({
        action,
        label: "First artifact generated",
        tone: "success" as const,
        detail: detail ?? "First packet artifact generated.",
        actedAt,
      });
    case "refresh_artifact":
      return finalize({
        action,
        label: "Artifact refreshed",
        tone: "success" as const,
        detail: detail ?? "Packet artifact refreshed.",
        actedAt,
      });
    default:
      return finalize({
        action,
        label: "Recorded action",
        tone: "neutral" as const,
        detail: detail ?? `Last recorded queue action: ${action}.`,
        actedAt,
      });
  }
}

export function buildPacketQueueTraceState(input: {
  actedAt?: string | null;
  sortTimestamp?: number;
  cycleUpdatedAt: string;
}) {
  if (!input.actedAt || !input.sortTimestamp) {
    return {
      state: "unrecorded" as const,
      label: "Trace not recorded",
      tone: "neutral" as const,
      detail: "This cycle does not yet have a durable queue-action timestamp to compare against source changes.",
    };
  }

  const cycleUpdatedAtTimestamp = new Date(input.cycleUpdatedAt).getTime();
  if (Number.isFinite(cycleUpdatedAtTimestamp) && cycleUpdatedAtTimestamp > input.sortTimestamp) {
    return {
      state: "outpaced" as const,
      label: "Outpaced by source",
      tone: "warning" as const,
      detail: "The RTP cycle changed after the last recorded queue action, so that trace no longer reflects the latest source state by itself.",
    };
  }

  return {
    state: "aligned" as const,
    label: "Aligned to source",
    tone: "success" as const,
    detail: "No cycle changes have landed since the last recorded queue action.",
  };
}
