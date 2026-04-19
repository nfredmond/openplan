import type { DominantActionKey } from "@/components/rtp/rtp-registry-next-action-shortcut";

export type PacketAttentionFilter = "all" | "generate" | "refresh" | "missing" | "reset" | "current";
export type PacketAttention = Exclude<PacketAttentionFilter, "all">;
export type QueueActionFilter = "all" | "create_record" | "reset_layout" | "generate_first_artifact" | "refresh_artifact";
export type QueueTraceStateFilter = "all" | "outpaced" | "aligned" | "unrecorded";
export type QueueTraceState = Exclude<QueueTraceStateFilter, "all">;
export type { DominantActionKey };

export type StatusBadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export type RtpPacketReportRow = {
  id: string;
  rtp_cycle_id: string;
  title: string;
  report_type: string;
  status: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
  metadata_json?: Record<string, unknown> | null;
  updated_at: string;
};

export type PacketFreshnessInfo = {
  label: string;
  tone: StatusBadgeTone;
  detail: string;
};

export type PacketPresetPosture = {
  label: string;
  tone: StatusBadgeTone;
  detail: string;
};

export type PacketFundingReview = {
  label: string;
  tone: StatusBadgeTone;
  detail: string;
  needsAttention: boolean;
};

export type PacketOperatorStatus = {
  label: string;
  tone: StatusBadgeTone;
  detail: string;
};

export type PacketActivityTrace = {
  label: string;
  tone: StatusBadgeTone;
  detail: string;
};

export type PacketQueueTrace = {
  action: string | null;
  actedAt: string | null;
  label: string;
  tone: StatusBadgeTone;
  detail: string;
  sortTimestamp: number;
  isRecent: boolean;
};

export type PacketQueueTraceStateInfo = {
  state: QueueTraceState;
  label: string;
  tone: StatusBadgeTone;
  detail: string;
};

export type RtpReadiness = {
  ready: boolean;
  label: string;
  tone: StatusBadgeTone;
  detail?: string;
};

export type RtpWorkflowSummary = {
  label: string;
  detail: string;
  actionItems: string[];
};

export type GrantsFollowThrough = {
  href: string;
  actionLabel: string;
} | null;

export type RtpRegistryCycle = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
  adoption_target_date: string | null;
  public_review_open_at: string | null;
  public_review_close_at: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
  linkedProjectCount: number;
  constrainedProjectCount: number;
  illustrativeProjectCount: number;
  fundedProjectCount: number;
  likelyCoveredProjectCount: number;
  unfundedProjectCount: number;
  paidReimbursementAmount: number;
  outstandingReimbursementAmount: number;
  uninvoicedAwardAmount: number;
  reimbursementInFlightCount: number;
  packetReport: RtpPacketReportRow | null;
  packetFreshness: PacketFreshnessInfo;
  packetPresetPosture: PacketPresetPosture;
  packetAttention: PacketAttention;
  packetOperatorStatus: PacketOperatorStatus;
  packetFundingReview: PacketFundingReview;
  packetQueueTrace: PacketQueueTrace;
  packetQueueTraceState: PacketQueueTraceStateInfo;
  packetActivityTrace: PacketActivityTrace;
  packetNavigationHref: string;
  grantsFollowThrough: GrantsFollowThrough;
  readiness: RtpReadiness;
  workflow: RtpWorkflowSummary;
  comparisonBackedProjectCount: number;
  staleModelingProjectCount: number;
};

export type PacketAttentionCounts = {
  reset: number;
  generate: number;
  refresh: number;
  missing: number;
  current: number;
};

export type QueueActionCounts = {
  createRecord: number;
  resetLayout: number;
  generateFirstArtifact: number;
  refreshArtifact: number;
};

export type QueueTraceStateCounts = {
  outpaced: number;
  aligned: number;
  unrecorded: number;
};

export type QueueActionMix = {
  reset: number;
  refresh: number;
  generate: number;
  current: number;
  missing?: number;
};

export type DominantAction = {
  key: DominantActionKey;
  label: string;
  count: number;
};
