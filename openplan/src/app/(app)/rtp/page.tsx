import { redirect } from "next/navigation";
import { ArrowRight, Compass, FolderKanban, Route as RouteIcon, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { RtpCycleCreator } from "@/components/rtp/rtp-cycle-creator";
import { RtpRegistryPacketBulkGenerateActions } from "@/components/rtp/rtp-registry-packet-bulk-generate-actions";
import { RtpRegistryPacketBulkRefreshActions } from "@/components/rtp/rtp-registry-packet-bulk-refresh-actions";
import { RtpRegistryPacketBulkActions } from "@/components/rtp/rtp-registry-packet-bulk-actions";
import { RtpRegistryPacketQueueCommandBoard } from "@/components/rtp/rtp-registry-packet-queue-command-board";
import {
  RtpRegistryNextActionShortcut,
  type DominantActionKey,
} from "@/components/rtp/rtp-registry-next-action-shortcut";
import { RtpRegistryPacketRowAction } from "@/components/rtp/rtp-registry-packet-row-action";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildProjectFundingStackSummary, projectFundingReimbursementTone } from "@/lib/projects/funding";
import { resolveRtpFundingFollowThrough } from "@/lib/operations/grants-links";
import {
  formatReportStatusLabel,
  getReportNavigationHref,
  getReportPacketFreshness,
  getReportPacketWorkStatus,
  getRtpPacketPresetAlignment,
  resolveReportPacketSourceUpdatedAt,
} from "@/lib/reports/catalog";
import { buildProjectGrantModelingEvidenceByProjectId } from "@/lib/grants/modeling-evidence";
import { createClient } from "@/lib/supabase/server";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  formatRtpDate,
  formatRtpDateTime,
  formatRtpCycleStatusLabel,
  rtpCycleStatusTone,
  RTP_CYCLE_STATUS_OPTIONS,
} from "@/lib/rtp/catalog";
import {
  PACKET_FRESHNESS_DETAIL,
  PACKET_FRESHNESS_LABELS,
  PACKET_POSTURE_DETAIL,
  PACKET_POSTURE_LABELS,
} from "@/lib/reports/packet-labels";
import {
  loadCurrentWorkspaceMembership,
} from "@/lib/workspaces/current";

type RtpPageSearchParams = Promise<{
  status?: string;
  packet?: string;
  recent?: string;
  queueAction?: string;
  queueTraceState?: string;
}>;

type RtpCycleRow = {
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
};

type ProjectRtpLinkRow = {
  id: string;
  project_id: string;
  rtp_cycle_id: string;
  portfolio_role: string;
};

type ProjectFundingProfileRow = {
  project_id: string;
  funding_need_amount: number | null;
  local_match_need_amount: number | null;
};

type FundingAwardRow = {
  project_id: string;
  awarded_amount: number | string;
  match_amount: number | string;
  risk_flag: string;
  obligation_due_at: string | null;
};

type FundingOpportunityRow = {
  project_id: string;
  decision_state: string;
  opportunity_status: string;
  expected_award_amount: number | string | null;
};

type BillingInvoiceRow = {
  project_id: string;
  funding_award_id: string | null;
  status: string;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
  due_date: string | null;
};

type RtpPacketReportRow = {
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

type ReportSectionRow = {
  id: string;
  report_id: string;
  section_key: string;
  enabled: boolean;
  sort_order: number;
};

type ProjectReportRow = {
  id: string;
  project_id: string;
  title: string;
  updated_at: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
};

type ProjectReportArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

type PacketAttentionFilter = "all" | "generate" | "refresh" | "missing" | "reset" | "current";
type QueueActionFilter = "all" | "create_record" | "reset_layout" | "generate_first_artifact" | "refresh_artifact";
type QueueTraceStateFilter = "all" | "outpaced" | "aligned" | "unrecorded";

const RECENT_QUEUE_ACTION_WINDOW_MS = 1000 * 60 * 60 * 24;

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(message ?? "");
}

function normalizePacketAttentionFilter(value: string | null | undefined): PacketAttentionFilter {
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

function buildRtpRegistryHref(filters: {
  status?: string | null;
  packet?: PacketAttentionFilter | null;
  recent?: boolean | null;
  queueAction?: QueueActionFilter | null;
  queueTraceState?: QueueTraceStateFilter | null;
}) {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.packet && filters.packet !== "all") {
    params.set("packet", filters.packet);
  }
  if (filters.recent) {
    params.set("recent", "1");
  }
  if (filters.queueAction && filters.queueAction !== "all") {
    params.set("queueAction", filters.queueAction);
  }
  if (filters.queueTraceState && filters.queueTraceState !== "all") {
    params.set("queueTraceState", filters.queueTraceState);
  }
  const query = params.toString();
  return query ? `/rtp?${query}` : "/rtp";
}

function normalizeRecentQueueFilter(value: string | null | undefined) {
  return value === "1";
}

function normalizeQueueActionFilter(value: string | null | undefined): QueueActionFilter {
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

function matchesQueueActionFilter(filter: QueueActionFilter, action: string | null | undefined) {
  if (filter === "all") {
    return true;
  }
  return filter === action;
}

function normalizeQueueTraceStateFilter(value: string | null | undefined): QueueTraceStateFilter {
  switch (value) {
    case "outpaced":
    case "aligned":
    case "unrecorded":
      return value;
    default:
      return "all";
  }
}

function matchesQueueTraceStateFilter(filter: QueueTraceStateFilter, state: string | null | undefined) {
  if (filter === "all") {
    return true;
  }
  return filter === state;
}

function getPacketAttentionPriority(packetAttention: Exclude<PacketAttentionFilter, "all">) {
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

function getQueueTraceStatePriority(queueTraceState: QueueTraceStateFilter) {
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

function matchesPacketAttentionFilter(filter: PacketAttentionFilter, packetAttention: Exclude<PacketAttentionFilter, "all">) {
  if (filter === "all") {
    return true;
  }
  return filter === packetAttention;
}

function formatUsdWholeAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildPacketFundingReview(input: {
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

function buildPacketOperatorStatus(input: {
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

function buildPacketActivityTrace(input: {
  packetReport: RtpPacketReportRow | null;
  packetFreshness: { label: string };
  packetAttention: Exclude<PacketAttentionFilter, "all">;
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

function buildPacketQueueTrace(packetReport: RtpPacketReportRow | null) {
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

function buildPacketQueueTraceState(input: {
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

export default async function RtpPage({ searchParams }: { searchParams: RtpPageSearchParams }) {
  const filters = await searchParams;
  const selectedPacketFilter = normalizePacketAttentionFilter(filters.packet);
  const recentOnly = normalizeRecentQueueFilter(filters.recent);
  const selectedQueueActionFilter = normalizeQueueActionFilter(filters.queueAction);
  const selectedQueueTraceStateFilter = normalizeQueueTraceStateFilter(filters.queueTraceState);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="RTP"
        title="RTP cycles need a provisioned workspace"
        description="RTP cycles only appear inside a real workspace. You are signed in, but no workspace membership was found for this account, so the registry would otherwise look empty for ambiguous reasons."
      />
    );
  }

  const { data: rtpCyclesData } = await supabase
    .from("rtp_cycles")
    .select(
      "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, created_at, updated_at"
    )
    .order("updated_at", { ascending: false });

  const rtpCycleIds = ((rtpCyclesData ?? []) as RtpCycleRow[]).map((cycle) => cycle.id);
  const [projectRtpLinksResult, initialPacketReportsResult] = await Promise.all([
    rtpCycleIds.length
      ? supabase
          .from("project_rtp_cycle_links")
          .select("id, project_id, rtp_cycle_id, portfolio_role")
          .in("rtp_cycle_id", rtpCycleIds)
      : Promise.resolve({ data: [], error: null }),
    rtpCycleIds.length
      ? supabase
          .from("reports")
          .select("id, rtp_cycle_id, title, report_type, status, generated_at, latest_artifact_kind, metadata_json, updated_at")
          .in("rtp_cycle_id", rtpCycleIds)
          .eq("report_type", "board_packet")
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const packetReportsResult =
    initialPacketReportsResult.error && looksLikePendingSchema(initialPacketReportsResult.error.message)
      ? await supabase
          .from("reports")
          .select("id, rtp_cycle_id, title, report_type, status, generated_at, latest_artifact_kind, updated_at")
          .in("rtp_cycle_id", rtpCycleIds)
          .eq("report_type", "board_packet")
          .order("updated_at", { ascending: false })
      : initialPacketReportsResult;

  const projectRtpLinks = looksLikePendingSchema(projectRtpLinksResult.error?.message)
    ? []
    : ((projectRtpLinksResult.data ?? []) as ProjectRtpLinkRow[]);
  const linkedProjectIds = [...new Set(projectRtpLinks.map((link) => link.project_id))];

  const [fundingProfilesResult, fundingAwardsResult, fundingOpportunitiesResult, billingInvoicesResult, linkedProjectReportsResult] = await Promise.all([
    linkedProjectIds.length
      ? supabase
          .from("project_funding_profiles")
          .select("project_id, funding_need_amount, local_match_need_amount")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("funding_awards")
          .select("project_id, awarded_amount, match_amount, risk_flag, obligation_due_at")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("funding_opportunities")
          .select("project_id, decision_state, opportunity_status, expected_award_amount")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("billing_invoice_records")
          .select("project_id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date")
          .in("project_id", linkedProjectIds)
      : Promise.resolve({ data: [], error: null }),
    linkedProjectIds.length
      ? supabase
          .from("reports")
          .select("id, project_id, title, updated_at, generated_at, latest_artifact_kind")
          .in("project_id", linkedProjectIds)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const fundingProfiles = looksLikePendingSchema(fundingProfilesResult.error?.message)
    ? []
    : ((fundingProfilesResult.data ?? []) as ProjectFundingProfileRow[]);
  const fundingAwards = looksLikePendingSchema(fundingAwardsResult.error?.message)
    ? []
    : ((fundingAwardsResult.data ?? []) as FundingAwardRow[]);
  const fundingOpportunities = looksLikePendingSchema(fundingOpportunitiesResult.error?.message)
    ? []
    : ((fundingOpportunitiesResult.data ?? []) as FundingOpportunityRow[]);
  const billingInvoices = looksLikePendingSchema(billingInvoicesResult.error?.message)
    ? []
    : ((billingInvoicesResult.data ?? []) as BillingInvoiceRow[]);

  const linkedProjectReports = (linkedProjectReportsResult.data ?? []) as ProjectReportRow[];
  const linkedProjectReportIds = linkedProjectReports.map((r) => r.id);
  const linkedProjectReportArtifactsResult = linkedProjectReportIds.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in("report_id", linkedProjectReportIds)
        .order("generated_at", { ascending: false })
    : { data: [], error: null };
  const linkedProjectReportArtifacts = (linkedProjectReportArtifactsResult.data ?? []) as ProjectReportArtifactRow[];
  const projectGrantModelingEvidenceByProjectId = buildProjectGrantModelingEvidenceByProjectId(
    linkedProjectReports,
    linkedProjectReportArtifacts
  );

  const fundingProfileByProjectId = new Map(fundingProfiles.map((profile) => [profile.project_id, profile]));
  const fundingAwardsByProjectId = new Map<string, FundingAwardRow[]>();
  const fundingOpportunitiesByProjectId = new Map<string, FundingOpportunityRow[]>();
  const fundingInvoicesByProjectId = new Map<string, BillingInvoiceRow[]>();
  for (const award of fundingAwards) {
    const current = fundingAwardsByProjectId.get(award.project_id) ?? [];
    current.push(award);
    fundingAwardsByProjectId.set(award.project_id, current);
  }
  for (const opportunity of fundingOpportunities) {
    const current = fundingOpportunitiesByProjectId.get(opportunity.project_id) ?? [];
    current.push(opportunity);
    fundingOpportunitiesByProjectId.set(opportunity.project_id, current);
  }
  for (const invoice of billingInvoices) {
    if (!invoice.funding_award_id) continue;
    const current = fundingInvoicesByProjectId.get(invoice.project_id) ?? [];
    current.push(invoice);
    fundingInvoicesByProjectId.set(invoice.project_id, current);
  }

  const linksByCycleId = new Map<string, ProjectRtpLinkRow[]>();
  for (const link of projectRtpLinks) {
    const current = linksByCycleId.get(link.rtp_cycle_id) ?? [];
    current.push(link);
    linksByCycleId.set(link.rtp_cycle_id, current);
  }

  const packetReports = looksLikePendingSchema(packetReportsResult.error?.message)
    ? []
    : ((packetReportsResult.data ?? []) as RtpPacketReportRow[]);
  const latestPacketReportByCycleId = new Map<string, RtpPacketReportRow>();
  for (const report of packetReports) {
    if (!latestPacketReportByCycleId.has(report.rtp_cycle_id)) {
      latestPacketReportByCycleId.set(report.rtp_cycle_id, report);
    }
  }

  const latestPacketReportIds = [...latestPacketReportByCycleId.values()].map((report) => report.id);
  const packetSectionsResult = latestPacketReportIds.length
    ? await supabase
        .from("report_sections")
        .select("id, report_id, section_key, enabled, sort_order")
        .in("report_id", latestPacketReportIds)
    : { data: [], error: null };

  const packetSections = looksLikePendingSchema(packetSectionsResult.error?.message)
    ? []
    : ((packetSectionsResult.data ?? []) as ReportSectionRow[]);
  const packetSectionsByReportId = new Map<string, ReportSectionRow[]>();
  for (const section of packetSections) {
    const current = packetSectionsByReportId.get(section.report_id) ?? [];
    current.push(section);
    packetSectionsByReportId.set(section.report_id, current);
  }

  const allCycles = ((rtpCyclesData ?? []) as RtpCycleRow[])
    .map((cycle) => {
      const cycleLinks = linksByCycleId.get(cycle.id) ?? [];
      const packetReport = latestPacketReportByCycleId.get(cycle.id) ?? null;
      const packetSectionsForReport = packetReport ? packetSectionsByReportId.get(packetReport.id) ?? [] : [];
      const readiness = buildRtpCycleReadiness({
        geographyLabel: cycle.geography_label,
        horizonStartYear: cycle.horizon_start_year,
        horizonEndYear: cycle.horizon_end_year,
        adoptionTargetDate: cycle.adoption_target_date,
        publicReviewOpenAt: cycle.public_review_open_at,
        publicReviewCloseAt: cycle.public_review_close_at,
      });
      const packetFreshness = packetReport
        ? getReportPacketFreshness({
            latestArtifactKind: packetReport.latest_artifact_kind,
            generatedAt: packetReport.generated_at,
            updatedAt: resolveReportPacketSourceUpdatedAt([cycle.updated_at, packetReport.updated_at]),
          })
        : {
            label: PACKET_FRESHNESS_LABELS.NO_PACKET,
            tone: "warning" as const,
            detail: PACKET_FRESHNESS_DETAIL.NO_PACKET_FOR_CYCLE,
          };
      const packetPresetAlignment = packetReport
        ? getRtpPacketPresetAlignment({
            cycleStatus: cycle.status,
            sections: packetSectionsForReport.map((section) => ({
              sectionKey: section.section_key,
              enabled: section.enabled,
              sortOrder: section.sort_order,
            })),
          })
        : null;
      const packetPresetPosture = !packetReport
        ? {
            label: PACKET_POSTURE_LABELS.NO_RECORD,
            tone: "warning" as const,
            detail: PACKET_POSTURE_DETAIL.NO_RECORD,
          }
        : packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED && packetPresetAlignment && !packetPresetAlignment.aligned
          ? {
              label: PACKET_POSTURE_LABELS.NEEDS_RESET,
              tone: "warning" as const,
              detail: `The latest packet is stale and its structure has diverged from the ${packetPresetAlignment.presetLabel.toLowerCase()} for this cycle phase.`,
            }
          : packetPresetAlignment
            ? {
                label: packetPresetAlignment.statusLabel,
                tone: packetPresetAlignment.tone,
                detail: packetPresetAlignment.detail,
              }
            : {
                label: PACKET_POSTURE_LABELS.PRESET_UNKNOWN,
                tone: "neutral" as const,
                detail: PACKET_POSTURE_DETAIL.PRESET_UNKNOWN,
              };
      const packetNavigationHref = packetReport
        ? getReportNavigationHref(packetReport.id, packetFreshness.label)
        : `/rtp/${cycle.id}`;
      const packetQueueTrace = buildPacketQueueTrace(packetReport);
      const packetQueueTraceState = buildPacketQueueTraceState({
        actedAt: packetQueueTrace.actedAt,
        sortTimestamp: packetQueueTrace.sortTimestamp,
        cycleUpdatedAt: cycle.updated_at,
      });
      const cycleFundingSummaries = cycleLinks.map((link) =>
        buildProjectFundingStackSummary(
          fundingProfileByProjectId.get(link.project_id) ?? null,
          fundingAwardsByProjectId.get(link.project_id) ?? [],
          fundingOpportunitiesByProjectId.get(link.project_id) ?? [],
          fundingInvoicesByProjectId.get(link.project_id) ?? []
        )
      );
      const packetAttention = !packetReport
        ? ("missing" as const)
        : packetPresetPosture.label === PACKET_POSTURE_LABELS.NEEDS_RESET
          ? ("reset" as const)
          : packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET
            ? ("generate" as const)
            : packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED
            ? ("refresh" as const)
            : ("current" as const);
      const packetFundingReview = buildPacketFundingReview({
        linkedProjectCount: cycleLinks.length,
        fundedProjectCount: cycleFundingSummaries.filter((summary) => summary.status === "funded").length,
        likelyCoveredProjectCount: cycleFundingSummaries.filter(
          (summary) => summary.status !== "funded" && summary.pipelineStatus === "likely_covered"
        ).length,
        unfundedProjectCount: cycleFundingSummaries.filter(
          (summary) => summary.pipelineStatus === "unfunded" || summary.pipelineStatus === "partially_covered"
        ).length,
        reimbursementInFlightCount: cycleFundingSummaries.filter(
          (summary) => summary.reimbursementStatus === "in_review"
        ).length,
        outstandingReimbursementAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.outstandingReimbursementAmount,
          0
        ),
        uninvoicedAwardAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.uninvoicedAwardAmount,
          0
        ),
      });
      const grantsFollowThrough = resolveRtpFundingFollowThrough({
        unfundedAfterLikelyAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.unfundedAfterLikelyAmount,
          0
        ),
        outstandingReimbursementAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.outstandingReimbursementAmount,
          0
        ),
        uninvoicedAwardAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.uninvoicedAwardAmount,
          0
        ),
        likelyCoveredProjectCount: cycleFundingSummaries.filter(
          (summary) => summary.status !== "funded" && summary.pipelineStatus === "likely_covered"
        ).length,
      });

      return {
        ...cycle,
        linkedProjectCount: cycleLinks.length,
        constrainedProjectCount: cycleLinks.filter((link) => link.portfolio_role === "constrained").length,
        illustrativeProjectCount: cycleLinks.filter((link) => link.portfolio_role === "illustrative").length,
        fundedProjectCount: cycleFundingSummaries.filter((summary) => summary.status === "funded").length,
        likelyCoveredProjectCount: cycleFundingSummaries.filter(
          (summary) => summary.status !== "funded" && summary.pipelineStatus === "likely_covered"
        ).length,
        unfundedProjectCount: cycleFundingSummaries.filter(
          (summary) => summary.pipelineStatus === "unfunded" || summary.pipelineStatus === "partially_covered"
        ).length,
        paidReimbursementAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.paidReimbursementAmount,
          0
        ),
        outstandingReimbursementAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.outstandingReimbursementAmount,
          0
        ),
        uninvoicedAwardAmount: cycleFundingSummaries.reduce(
          (sum, summary) => sum + summary.uninvoicedAwardAmount,
          0
        ),
        reimbursementInFlightCount: cycleFundingSummaries.filter(
          (summary) => summary.reimbursementStatus === "in_review"
        ).length,
        packetReport,
        packetFreshness,
        packetPresetPosture,
        packetAttention,
        packetOperatorStatus: buildPacketOperatorStatus({
          packetReport,
          packetFreshness,
          packetPresetPosture,
          packetQueueTraceState,
          packetFundingReview,
        }),
        packetFundingReview,
        packetQueueTrace,
        packetQueueTraceState,
        packetActivityTrace: buildPacketActivityTrace({
          packetReport,
          packetFreshness,
          packetAttention,
        }),
        packetNavigationHref,
        grantsFollowThrough,
        readiness,
        workflow: buildRtpCycleWorkflowSummary({ status: cycle.status, readiness }),
        comparisonBackedProjectCount: cycleLinks.filter(
          (link) => Boolean(projectGrantModelingEvidenceByProjectId.get(link.project_id))
        ).length,
        staleModelingProjectCount: cycleLinks.filter((link) => {
          const evidence = projectGrantModelingEvidenceByProjectId.get(link.project_id);
          return evidence?.leadComparisonReport.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED;
        }).length,
      };
    })
    .filter((cycle) => (filters.status ? cycle.status === filters.status : true));

  const packetAttentionCounts = {
    reset: allCycles.filter((cycle) => cycle.packetAttention === "reset").length,
    generate: allCycles.filter((cycle) => cycle.packetAttention === "generate").length,
    refresh: allCycles.filter((cycle) => cycle.packetAttention === "refresh").length,
    missing: allCycles.filter((cycle) => cycle.packetAttention === "missing").length,
    current: allCycles.filter((cycle) => cycle.packetAttention === "current").length,
  };

  const queueActionScopedCycles = [...allCycles]
    .filter((cycle) => matchesPacketAttentionFilter(selectedPacketFilter, cycle.packetAttention))
    .filter((cycle) => (recentOnly ? cycle.packetQueueTrace.isRecent : true));

  const queueActionCounts = {
    createRecord: queueActionScopedCycles.filter((cycle) => cycle.packetQueueTrace.action === "create_record").length,
    resetLayout: queueActionScopedCycles.filter((cycle) => cycle.packetQueueTrace.action === "reset_layout").length,
    generateFirstArtifact: queueActionScopedCycles.filter(
      (cycle) => cycle.packetQueueTrace.action === "generate_first_artifact"
    ).length,
    refreshArtifact: queueActionScopedCycles.filter((cycle) => cycle.packetQueueTrace.action === "refresh_artifact").length,
  };

  const queueTraceStateScopedCycles = queueActionScopedCycles.filter((cycle) =>
    matchesQueueActionFilter(selectedQueueActionFilter, cycle.packetQueueTrace.action)
  );

  const queueTraceStateCounts = {
    outpaced: queueTraceStateScopedCycles.filter((cycle) => cycle.packetQueueTraceState.state === "outpaced").length,
    aligned: queueTraceStateScopedCycles.filter((cycle) => cycle.packetQueueTraceState.state === "aligned").length,
    unrecorded: queueTraceStateScopedCycles.filter((cycle) => cycle.packetQueueTraceState.state === "unrecorded").length,
  };

  const typedCycles = queueTraceStateScopedCycles
    .filter((cycle) => matchesQueueTraceStateFilter(selectedQueueTraceStateFilter, cycle.packetQueueTraceState.state))
    .sort((left, right) => {
      const priorityDelta = getPacketAttentionPriority(left.packetAttention) - getPacketAttentionPriority(right.packetAttention);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const queueTraceStateDelta =
        getQueueTraceStatePriority(left.packetQueueTraceState.state) -
        getQueueTraceStatePriority(right.packetQueueTraceState.state);
      if (queueTraceStateDelta !== 0) {
        return queueTraceStateDelta;
      }

      const queueTraceDelta = right.packetQueueTrace.sortTimestamp - left.packetQueueTrace.sortTimestamp;
      if (queueTraceDelta !== 0) {
        return queueTraceDelta;
      }

      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });

  const draftCount = typedCycles.filter((cycle) => cycle.status === "draft").length;
  const publicReviewCount = typedCycles.filter((cycle) => cycle.status === "public_review").length;
  const adoptedCount = typedCycles.filter((cycle) => cycle.status === "adopted").length;
  const readyFoundationCount = typedCycles.filter((cycle) => cycle.readiness.ready).length;
  const linkedProjectCount = typedCycles.reduce((sum, cycle) => sum + cycle.linkedProjectCount, 0);
  const fundedProjectCount = typedCycles.reduce((sum, cycle) => sum + cycle.fundedProjectCount, 0);
  const likelyCoveredProjectCount = typedCycles.reduce((sum, cycle) => sum + cycle.likelyCoveredProjectCount, 0);
  const unfundedProjectCount = typedCycles.reduce((sum, cycle) => sum + cycle.unfundedProjectCount, 0);
  const paidReimbursementTotal = typedCycles.reduce((sum, cycle) => sum + cycle.paidReimbursementAmount, 0);
  const outstandingReimbursementTotal = typedCycles.reduce(
    (sum, cycle) => sum + cycle.outstandingReimbursementAmount,
    0
  );
  const uninvoicedAwardTotal = typedCycles.reduce((sum, cycle) => sum + cycle.uninvoicedAwardAmount, 0);
  const recentQueueActivityCount = typedCycles.filter((cycle) => cycle.packetQueueTrace.isRecent).length;
  const outpacedQueueTraceCount = typedCycles.filter((cycle) => cycle.packetQueueTraceState.label === "Outpaced by source").length;
  const outpacedQueueCycles = allCycles.filter((cycle) => cycle.packetQueueTraceState.state === "outpaced");
  const outpacedQueueMix = {
    reset: outpacedQueueCycles.filter((cycle) => cycle.packetAttention === "reset").length,
    refresh: outpacedQueueCycles.filter((cycle) => cycle.packetAttention === "refresh").length,
    generate: outpacedQueueCycles.filter((cycle) => cycle.packetAttention === "generate").length,
    current: outpacedQueueCycles.filter((cycle) => cycle.packetAttention === "current").length,
  };
  const unrecordedQueueCycles = allCycles.filter((cycle) => cycle.packetQueueTraceState.state === "unrecorded");
  const unrecordedQueueMix = {
    missing: unrecordedQueueCycles.filter((cycle) => cycle.packetAttention === "missing").length,
    generate: unrecordedQueueCycles.filter((cycle) => cycle.packetAttention === "generate").length,
    refresh: unrecordedQueueCycles.filter((cycle) => cycle.packetAttention === "refresh").length,
    current: unrecordedQueueCycles.filter((cycle) => cycle.packetAttention === "current").length,
  };
  const latestQueueActionAt = typedCycles
    .map((cycle) => cycle.packetQueueTrace.actedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const recentQueueActionBreakdown = {
    createRecord: typedCycles.filter(
      (cycle) => cycle.packetQueueTrace.isRecent && cycle.packetQueueTrace.action === "create_record"
    ).length,
    resetLayout: typedCycles.filter(
      (cycle) => cycle.packetQueueTrace.isRecent && cycle.packetQueueTrace.action === "reset_layout"
    ).length,
    generateFirstArtifact: typedCycles.filter(
      (cycle) => cycle.packetQueueTrace.isRecent && cycle.packetQueueTrace.action === "generate_first_artifact"
    ).length,
    refreshArtifact: typedCycles.filter(
      (cycle) => cycle.packetQueueTrace.isRecent && cycle.packetQueueTrace.action === "refresh_artifact"
    ).length,
  };
  const currentViewActionCounts = {
    createPacket: typedCycles.filter((cycle) => cycle.packetAttention === "missing").length,
    resetAndRegenerate: typedCycles.filter((cycle) => cycle.packetAttention === "reset").length,
    generateFirstArtifact: typedCycles.filter((cycle) => cycle.packetAttention === "generate").length,
    refreshArtifact: typedCycles.filter((cycle) => cycle.packetAttention === "refresh").length,
    releaseReview: typedCycles.filter(
      (cycle) => cycle.packetAttention === "current" && cycle.packetQueueTraceState.state === "aligned"
    ).length,
    traceFollowUp: typedCycles.filter(
      (cycle) => cycle.packetAttention === "current" && cycle.packetQueueTraceState.state !== "aligned"
    ).length,
  };
  const dominantCurrentViewAction = [
    { key: "createPacket", label: "Create missing packet records", count: currentViewActionCounts.createPacket },
    { key: "resetAndRegenerate", label: "Reset and regenerate packets", count: currentViewActionCounts.resetAndRegenerate },
    { key: "generateFirstArtifact", label: "Generate first packet artifacts", count: currentViewActionCounts.generateFirstArtifact },
    { key: "refreshArtifact", label: "Refresh stale packet artifacts", count: currentViewActionCounts.refreshArtifact },
    { key: "releaseReview", label: "Run release review on current packets", count: currentViewActionCounts.releaseReview },
    { key: "traceFollowUp", label: "Review trace follow-up gaps", count: currentViewActionCounts.traceFollowUp },
  ] satisfies Array<{ key: DominantActionKey; label: string; count: number }>;
  const orderedCurrentViewActions = [...dominantCurrentViewAction].sort((left, right) => right.count - left.count);
  const rankedCurrentViewActions = orderedCurrentViewActions.filter((action) => action.count > 0);
  const dominantCurrentViewActionSelection = orderedCurrentViewActions[0];
  const runnerUpCurrentViewActionSelection = orderedCurrentViewActions.find(
    (action) => action.key !== dominantCurrentViewActionSelection.key && action.count > 0
  );
  const actionHrefByKey: Record<DominantActionKey, string> = {
    createPacket: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "missing",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: selectedQueueTraceStateFilter,
    }),
    resetAndRegenerate: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "reset",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: selectedQueueTraceStateFilter,
    }),
    generateFirstArtifact: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "generate",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: selectedQueueTraceStateFilter,
    }),
    refreshArtifact: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "refresh",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: selectedQueueTraceStateFilter,
    }),
    releaseReview: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "current",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: "aligned",
    }),
    traceFollowUp: buildRtpRegistryHref({
      status: filters.status ?? null,
      packet: "current",
      recent: recentOnly,
      queueAction: selectedQueueActionFilter,
      queueTraceState: selectedQueueTraceStateFilter === "all" ? "outpaced" : selectedQueueTraceStateFilter,
    }),
  };
  const dominantActionCycles = typedCycles.filter((cycle) => {
    switch (dominantCurrentViewActionSelection.key) {
      case "createPacket":
        return cycle.packetAttention === "missing";
      case "resetAndRegenerate":
        return cycle.packetAttention === "reset";
      case "generateFirstArtifact":
        return cycle.packetAttention === "generate";
      case "refreshArtifact":
        return cycle.packetAttention === "refresh";
      case "releaseReview":
        return cycle.packetAttention === "current" && cycle.packetQueueTraceState.state === "aligned";
      case "traceFollowUp":
        return cycle.packetAttention === "current" && cycle.packetQueueTraceState.state !== "aligned";
      default:
        return false;
    }
  });
  const dominantActionHref = actionHrefByKey[dominantCurrentViewActionSelection.key];
  const dominantActionCycleIds = dominantActionCycles.map((cycle) => cycle.id);
  const dominantActionReportIds = dominantActionCycles
    .map((cycle) => cycle.packetReport?.id ?? null)
    .filter((value): value is string => Boolean(value));
  const currentFundingReviewCount = typedCycles.filter(
    (cycle) => cycle.packetAttention === "current" && cycle.packetFundingReview.needsAttention
  ).length;
  const currentFundingGapReviewCount = typedCycles.filter(
    (cycle) => cycle.packetAttention === "current" && cycle.packetFundingReview.label === "Funding gap review"
  ).length;
  const currentReimbursementFollowThroughCount = typedCycles.filter(
    (cycle) =>
      cycle.packetAttention === "current" &&
      (cycle.uninvoicedAwardAmount > 0 || cycle.outstandingReimbursementAmount > 0 || cycle.reimbursementInFlightCount > 0)
  ).length;
  const dominantTraceFollowUpCounts = {
    outpaced: dominantActionCycles.filter((cycle) => cycle.packetQueueTraceState.state === "outpaced").length,
    unrecorded: dominantActionCycles.filter((cycle) => cycle.packetQueueTraceState.state === "unrecorded").length,
    aligned: dominantActionCycles.filter((cycle) => cycle.packetQueueTraceState.state === "aligned").length,
  };
  const totalActionableCurrentViewCount = orderedCurrentViewActions.reduce((sum, action) => sum + action.count, 0);
  const dominantActionImpactPercent =
    totalActionableCurrentViewCount > 0
      ? Math.round((dominantCurrentViewActionSelection.count / totalActionableCurrentViewCount) * 100)
      : 0;
  const remainingActionableAfterDominantCount = Math.max(
    totalActionableCurrentViewCount - dominantCurrentViewActionSelection.count,
    0
  );
  const runnerUpActionHref = runnerUpCurrentViewActionSelection ? actionHrefByKey[runnerUpCurrentViewActionSelection.key] : null;

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <RouteIcon className="h-3.5 w-3.5" />
            RTP cycle foundation live
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">RTP Cycles</h1>
            <p className="module-intro-description">
              Register each RTP update as one parent control object so portfolio, chapter, engagement, and funding work can hang off a shared spine.
            </p>
          </div>

          <div className="module-summary-grid cols-6">
            <div className="module-summary-card">
              <p className="module-summary-label">Cycles</p>
              <p className="module-summary-value">{typedCycles.length}</p>
              <p className="module-summary-detail">RTP update cycles tracked in the current workspace.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Draft / review</p>
              <p className="module-summary-value">{draftCount + publicReviewCount}</p>
              <p className="module-summary-detail">{publicReviewCount} currently marked in public review posture.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Adopted</p>
              <p className="module-summary-value">{adoptedCount}</p>
              <p className="module-summary-detail">Cycles already marked as adopted.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Foundation ready</p>
              <p className="module-summary-value">{readyFoundationCount}</p>
              <p className="module-summary-detail">Cycles with core metadata in place for portfolio build-out.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked projects</p>
              <p className="module-summary-value">{linkedProjectCount}</p>
              <p className="module-summary-detail">Project-to-cycle portfolio links now visible across the registry.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Portfolio funding</p>
              <p className="module-summary-value">{fundedProjectCount}/{linkedProjectCount}</p>
              <p className="module-summary-detail">
                {likelyCoveredProjectCount} more look coverable from pursued funding, {unfundedProjectCount} still carry a gap, and linked award invoices show {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(paidReimbursementTotal)} paid, {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(outstandingReimbursementTotal)} outstanding, and {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(uninvoicedAwardTotal)} not yet invoiced.
              </p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Regional planning control room</p>
              <h2 className="module-operator-title">Make the RTP update a first-class operating object</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            This is the foundation for project portfolio, chapter narrative, public review, and financial traceability. Keep one cycle per update instead of scattering state across plans and engagement records.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">One cycle can later anchor project, chapter, and funding linkage.</div>
            <div className="module-operator-item">Public review dates stay explicit instead of buried in a memo or draft PDF.</div>
            <div className="module-operator-item">The next implementation slice will attach portfolio and chapter records to this parent.</div>
          </div>
        </article>
      </header>

      <div className="module-grid-layout mt-6 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(24rem,0.9fr)]">
        <section className="space-y-4">
          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Registry</p>
                <h2 className="module-section-title">Tracked RTP cycles</h2>
                <p className="module-section-description">
                  Keep the update cadence, public-review posture, and linked packet recommendation posture visible from the same registry.
                </p>
              </div>
              <div className="space-y-3 text-right">
                <div>
                  <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cycle status</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    {RTP_CYCLE_STATUS_OPTIONS.map((option) => {
                      const active = filters.status === option.value;
                      return (
                        <Link
                          key={option.value}
                          href={buildRtpRegistryHref({
                            status: active ? null : option.value,
                            packet: selectedPacketFilter,
                            recent: recentOnly,
                            queueAction: selectedQueueActionFilter,
                            queueTraceState: selectedQueueTraceStateFilter,
                          })}
                          className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                        >
                          {option.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Packet attention</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    {[
                      { value: "all" as const, label: "All", count: allCycles.length },
                      { value: "reset" as const, label: PACKET_POSTURE_LABELS.NEEDS_RESET, count: packetAttentionCounts.reset },
                      { value: "missing" as const, label: "Missing", count: packetAttentionCounts.missing },
                      { value: "generate" as const, label: "Generate first", count: packetAttentionCounts.generate },
                      { value: "refresh" as const, label: "Refresh", count: packetAttentionCounts.refresh },
                      { value: "current" as const, label: "Current", count: packetAttentionCounts.current },
                    ].map((option) => {
                      const active = selectedPacketFilter === option.value;
                      return (
                        <Link
                          key={option.value}
                          href={buildRtpRegistryHref({
                            status: filters.status ?? null,
                            packet: active ? "all" : option.value,
                            recent: recentOnly,
                            queueAction: selectedQueueActionFilter,
                            queueTraceState: selectedQueueTraceStateFilter,
                          })}
                          className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                        >
                          {option.label} · {option.count}
                        </Link>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recent queue work</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Link
                      href={buildRtpRegistryHref({
                        status: filters.status ?? null,
                        packet: selectedPacketFilter,
                        recent: false,
                        queueAction: selectedQueueActionFilter,
                        queueTraceState: selectedQueueTraceStateFilter,
                      })}
                      className={!recentOnly ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                    >
                      All queue history
                    </Link>
                    <Link
                      href={buildRtpRegistryHref({
                        status: filters.status ?? null,
                        packet: selectedPacketFilter,
                        recent: true,
                        queueAction: selectedQueueActionFilter,
                        queueTraceState: selectedQueueTraceStateFilter,
                      })}
                      className={recentOnly ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                    >
                      Recent only · {allCycles.filter((cycle) => cycle.packetQueueTrace.isRecent).length}
                    </Link>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Last queue action</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    {[
                      { value: "all" as const, label: "All actions", count: queueActionScopedCycles.length },
                      { value: "create_record" as const, label: "Record created", count: queueActionCounts.createRecord },
                      { value: "reset_layout" as const, label: "Preset reset", count: queueActionCounts.resetLayout },
                      {
                        value: "generate_first_artifact" as const,
                        label: "First artifact",
                        count: queueActionCounts.generateFirstArtifact,
                      },
                      { value: "refresh_artifact" as const, label: "Refresh", count: queueActionCounts.refreshArtifact },
                    ].map((option) => {
                      const active = selectedQueueActionFilter === option.value;
                      return (
                        <Link
                          key={option.value}
                          href={buildRtpRegistryHref({
                            status: filters.status ?? null,
                            packet: selectedPacketFilter,
                            recent: recentOnly,
                            queueAction: active ? "all" : option.value,
                            queueTraceState: selectedQueueTraceStateFilter,
                          })}
                          className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                        >
                          {option.label} · {option.count}
                        </Link>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Queue trace freshness</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    {[
                      { value: "all" as const, label: "All trace states", count: queueTraceStateScopedCycles.length },
                      { value: "outpaced" as const, label: "Outpaced", count: queueTraceStateCounts.outpaced },
                      { value: "aligned" as const, label: "Aligned", count: queueTraceStateCounts.aligned },
                      { value: "unrecorded" as const, label: "Unrecorded", count: queueTraceStateCounts.unrecorded },
                    ].map((option) => {
                      const active = selectedQueueTraceStateFilter === option.value;
                      return (
                        <Link
                          key={option.value}
                          href={buildRtpRegistryHref({
                            status: filters.status ?? null,
                            packet: selectedPacketFilter,
                            recent: recentOnly,
                            queueAction: selectedQueueActionFilter,
                            queueTraceState: active ? "all" : option.value,
                          })}
                          className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                        >
                          {option.label} · {option.count}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
              <div className="module-metric-card">
                <p className="module-metric-label">Needs reset</p>
                <p className="module-metric-value text-sm">{packetAttentionCounts.reset}</p>
                <p className="mt-1 text-xs text-muted-foreground">Stale packet plus phase-preset divergence.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Missing packet</p>
                <p className="module-metric-value text-sm">{packetAttentionCounts.missing}</p>
                <p className="mt-1 text-xs text-muted-foreground">Cycle still lacks a linked RTP board packet record.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Generate first</p>
                <p className="module-metric-value text-sm">{packetAttentionCounts.generate}</p>
                <p className="mt-1 text-xs text-muted-foreground">Packet record exists, but the first artifact has not been generated yet.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Refresh</p>
                <p className="module-metric-value text-sm">{packetAttentionCounts.refresh}</p>
                <p className="mt-1 text-xs text-muted-foreground">Packet artifact exists, but source cycle changed after generation.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Packet current</p>
                <p className="module-metric-value text-sm">{packetAttentionCounts.current}</p>
                <p className="mt-1 text-xs text-muted-foreground">Packet is current with the cycle, whether preset-aligned or intentionally customized.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Funding review</p>
                <p className="module-metric-value text-sm">{currentFundingReviewCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Current packets whose linked-project funding posture still needs release-review attention.
                </p>
                {currentFundingReviewCount > 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {currentFundingGapReviewCount} gap{currentFundingGapReviewCount === 1 ? "" : "s"}, {currentReimbursementFollowThroughCount} reimbursement follow-through cue{currentReimbursementFollowThroughCount === 1 ? "" : "s"}.
                  </p>
                ) : null}
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Trace outpaced</p>
                <p className="module-metric-value text-sm">{queueTraceStateCounts.outpaced}</p>
                <p className="mt-1 text-xs text-muted-foreground">Queue evidence exists, but the cycle has changed since it was recorded.</p>
                {queueTraceStateCounts.outpaced > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: selectedPacketFilter,
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: "outpaced",
                    })}
                    className="module-inline-action mt-3 w-fit"
                  >
                    Focus outpaced
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Trace gaps</p>
                <p className="module-metric-value text-sm">{queueTraceStateCounts.unrecorded}</p>
                <p className="mt-1 text-xs text-muted-foreground">Cycles still missing durable queue-action coverage.</p>
                {queueTraceStateCounts.unrecorded > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: selectedPacketFilter,
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: "unrecorded",
                    })}
                    className="module-inline-action mt-3 w-fit"
                  >
                    Focus trace gaps
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Showing {typedCycles.length} cycle{typedCycles.length === 1 ? "" : "s"}
              {filters.status ? ` in ${formatRtpCycleStatusLabel(filters.status).toLowerCase()} posture` : " across all cycle phases"}
              {selectedPacketFilter !== "all" ? ` with packet attention set to ${selectedPacketFilter.replace("_", " ")}` : ""}
              {recentOnly ? " limited to recent queue activity" : ""}
              {selectedQueueActionFilter !== "all"
                ? ` filtered to ${selectedQueueActionFilter.replaceAll("_", " ")}`
                : ""}
              {selectedQueueTraceStateFilter !== "all"
                ? ` with trace freshness ${selectedQueueTraceStateFilter}`
                : ""}
              .
            </p>

            {typedCycles.length === 0 ? (
              <EmptyState
                title={allCycles.length > 0 ? "No cycles match the current filter" : "No RTP cycles yet"}
                description={
                  allCycles.length > 0
                    ? "Try a different status, packet-attention, recent-work, queue-action, or trace-freshness filter to resume triage across the RTP registry."
                    : "Create the first RTP cycle so the regional plan update has one shared parent object instead of fragmented records."
                }
              />
            ) : (
              <div className="space-y-3">
                {typedCycles.map((cycle) => (
                  <article key={cycle.id} className="module-row-card gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/rtp/${cycle.id}`} className="text-base font-semibold tracking-tight transition hover:text-foreground/80">
                            {cycle.title}
                          </Link>
                          <StatusBadge tone={rtpCycleStatusTone(cycle.status)}>{formatRtpCycleStatusLabel(cycle.status)}</StatusBadge>
                          <StatusBadge tone={cycle.readiness.tone}>{cycle.readiness.label}</StatusBadge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {cycle.summary?.trim() || "No cycle summary yet. Add the planning scope, board/adoption posture, and intended review frame."}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>Updated {formatRtpDateTime(cycle.updated_at)}</div>
                        <div>Created {formatRtpDateTime(cycle.created_at)}</div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="module-metric-card">
                        <p className="module-metric-label">Geography</p>
                        <p className="module-metric-value text-sm">{cycle.geography_label?.trim() || "Not set"}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Horizon</p>
                        <p className="module-metric-value text-sm">
                          {typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number"
                            ? `${cycle.horizon_start_year}–${cycle.horizon_end_year}`
                            : "Not set"}
                        </p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Adoption target</p>
                        <p className="module-metric-value text-sm">{formatRtpDate(cycle.adoption_target_date)}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Public review</p>
                        <p className="module-metric-value text-sm">
                          {cycle.public_review_open_at && cycle.public_review_close_at
                            ? `${formatRtpDate(cycle.public_review_open_at)} → ${formatRtpDate(cycle.public_review_close_at)}`
                            : "Not set"}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                      <div className="module-metric-card">
                        <p className="module-metric-label">Linked projects</p>
                        <p className="module-metric-value text-sm">{cycle.linkedProjectCount}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Constrained</p>
                        <p className="module-metric-value text-sm">{cycle.constrainedProjectCount}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Illustrative</p>
                        <p className="module-metric-value text-sm">{cycle.illustrativeProjectCount}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Funded</p>
                        <p className="module-metric-value text-sm">{cycle.fundedProjectCount}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Likely</p>
                        <p className="module-metric-value text-sm">{cycle.likelyCoveredProjectCount}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Unfunded</p>
                        <p className="module-metric-value text-sm">{cycle.unfundedProjectCount}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Paid reimbursements</p>
                        <p className="module-metric-value text-sm">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cycle.paidReimbursementAmount)}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Outstanding requests</p>
                        <p className="module-metric-value text-sm">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cycle.outstandingReimbursementAmount)}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Uninvoiced awards</p>
                        <p className="module-metric-value text-sm">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cycle.uninvoicedAwardAmount)}</p>
                      </div>
                    </div>

                    {cycle.comparisonBackedProjectCount > 0 ? (
                      <div className="module-note text-sm">
                        <p className="font-medium text-foreground">Project modeling support</p>
                        <p className="mt-1">
                          {cycle.comparisonBackedProjectCount} linked project{cycle.comparisonBackedProjectCount === 1 ? "" : "s"} {cycle.comparisonBackedProjectCount === 1 ? "carries" : "carry"} comparison-backed planning support.
                          {cycle.staleModelingProjectCount > 0
                            ? ` ${cycle.staleModelingProjectCount} should refresh evidence packets before leaning on them for RTP prioritization language.`
                            : " Evidence packets appear current."}
                          {" "}Treat it as planning support only, not a substitute for board deliberation.
                        </p>
                      </div>
                    ) : null}

                    <div className="rounded-[0.5rem] border border-border/70 bg-background px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Reimbursement traceability
                          </p>
                          <p className="mt-2 text-sm font-medium">
                            {cycle.reimbursementInFlightCount > 0
                              ? `${cycle.reimbursementInFlightCount} linked project${cycle.reimbursementInFlightCount === 1 ? "" : "s"} currently have reimbursement requests in flight.`
                              : "No linked project reimbursement requests are currently in flight."}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Award-linked invoices now show how much of each RTP cycle’s committed funding has already been paid, is still awaiting payment, or has not yet been invoiced.
                          </p>
                        </div>
                        <StatusBadge tone={projectFundingReimbursementTone(cycle.reimbursementInFlightCount > 0 ? "in_review" : "not_started")}>
                          {cycle.reimbursementInFlightCount > 0 ? "Requests in flight" : "No requests in flight"}
                        </StatusBadge>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <div className="module-metric-card">
                        <p className="module-metric-label">Linked packet</p>
                        <p className="module-metric-value text-sm">{cycle.packetReport?.title ?? "Not created"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {cycle.packetReport
                            ? `${formatReportStatusLabel(cycle.packetReport.status)} record updated ${formatRtpDateTime(cycle.packetReport.updated_at)}.`
                            : "Create the first RTP board packet record to keep report posture visible from the registry."}
                        </p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Packet freshness</p>
                        <div className="mt-1">
                          <StatusBadge tone={cycle.packetFreshness.tone}>{cycle.packetFreshness.label}</StatusBadge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{cycle.packetFreshness.detail}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Packet preset</p>
                        <div className="mt-1">
                          <StatusBadge tone={cycle.packetPresetPosture.tone}>{cycle.packetPresetPosture.label}</StatusBadge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{cycle.packetPresetPosture.detail}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Packet activity</p>
                        <div className="mt-1">
                          <StatusBadge tone={cycle.packetActivityTrace.tone}>{cycle.packetActivityTrace.label}</StatusBadge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{cycle.packetActivityTrace.detail}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Funding review</p>
                        <div className="mt-1">
                          <StatusBadge tone={cycle.packetFundingReview.tone}>{cycle.packetFundingReview.label}</StatusBadge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{cycle.packetFundingReview.detail}</p>
                      </div>
                    </div>

                    <div className="rounded-[0.5rem] border border-border/70 bg-background px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Operator status
                          </p>
                          <p className="mt-2 text-sm font-medium">{cycle.packetOperatorStatus.label}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{cycle.packetOperatorStatus.detail}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2 text-right">
                          <StatusBadge tone={cycle.packetOperatorStatus.tone}>{cycle.packetOperatorStatus.label}</StatusBadge>
                          <p className="text-xs text-muted-foreground">
                            {cycle.packetReport?.generated_at
                              ? `Last generated ${formatRtpDateTime(cycle.packetReport.generated_at)}`
                              : cycle.packetReport
                                ? "No generated artifact yet"
                                : "No packet record yet"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Last queue action
                        </p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{cycle.packetQueueTrace.label}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{cycle.packetQueueTrace.detail}</p>
                            {cycle.packetQueueTrace.actedAt ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Recorded {formatRtpDateTime(cycle.packetQueueTrace.actedAt)}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <StatusBadge tone={cycle.packetQueueTrace.tone}>{cycle.packetQueueTrace.label}</StatusBadge>
                            {cycle.packetQueueTrace.isRecent ? <StatusBadge tone="info">Recent</StatusBadge> : null}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-[0.5rem] border border-border/50 bg-background px-3 py-3">
                          <div>
                            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              Queue trace freshness
                            </p>
                            <p className="mt-2 text-sm font-medium">{cycle.packetQueueTraceState.label}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{cycle.packetQueueTraceState.detail}</p>
                          </div>
                          <StatusBadge tone={cycle.packetQueueTraceState.tone}>{cycle.packetQueueTraceState.label}</StatusBadge>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="rounded-[0.5rem] border border-border/70 bg-muted/25 px-4 py-3">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Workflow posture
                        </p>
                        <p className="mt-2 text-sm font-medium">{cycle.workflow.label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{cycle.workflow.detail}</p>
                      </div>

                      <div className="rounded-[0.5rem] border border-border/70 bg-background px-4 py-3">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Next actions
                        </p>
                        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                          {cycle.workflow.actionItems.length > 0 ? (
                            cycle.workflow.actionItems.map((item) => <li key={item}>• {item}</li>)
                          ) : (
                            <li>• Keep the cycle linked to downstream portfolio and board outputs.</li>
                          )}
                        </ul>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Link href={`/rtp/${cycle.id}`} className="module-inline-action w-fit">
                        Open RTP cycle shell
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      {cycle.packetReport ? (
                        <Link href={cycle.packetNavigationHref} className="module-inline-action w-fit">
                          Open linked packet
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      ) : null}
                      {cycle.grantsFollowThrough ? (
                        <Link href={cycle.grantsFollowThrough.href} className="module-inline-action w-fit">
                          {cycle.grantsFollowThrough.actionLabel}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      ) : null}
                      <RtpRegistryPacketRowAction
                        cycleId={cycle.id}
                        reportId={cycle.packetReport?.id ?? null}
                        packetAttention={cycle.packetAttention}
                        needsFirstArtifact={cycle.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET}
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>

        <aside className="space-y-4">
          {typedCycles.length > 0 ? (
            <article className="rounded-[0.75rem] border border-border/70 bg-background/95 p-5 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Recommended next queue action
                  </p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                    {dominantCurrentViewActionSelection.count}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {dominantCurrentViewActionSelection.count > 0
                      ? `${dominantCurrentViewActionSelection.label} is the largest actionable lane in the current filtered view.`
                      : "The current filtered view has no immediate queue actions beyond passive monitoring."}
                  </p>
                </div>
                <StatusBadge tone={dominantCurrentViewActionSelection.count > 0 ? "info" : "success"}>
                  {dominantCurrentViewActionSelection.count > 0 ? dominantCurrentViewActionSelection.label : "Queue clear"}
                </StatusBadge>
              </div>

              <div className="mt-4 space-y-2">
                {rankedCurrentViewActions.length > 0 ? (
                  rankedCurrentViewActions.map((action, index) => (
                    <Link
                      key={action.key}
                      href={actionHrefByKey[action.key]}
                      className="flex items-center justify-between gap-3 rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{action.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {index === 0 ? "Primary queue lane" : index === 1 ? "Next queue lane" : `Priority ${index + 1}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={index === 0 ? "info" : "neutral"}>
                          {index === 0 ? "Now" : index === 1 ? "Next" : `#${index + 1}`}
                        </StatusBadge>
                        <span className="text-sm font-semibold tracking-tight text-foreground">{action.count}</span>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                    No queue buckets are currently actionable in this filtered view.
                  </div>
                )}
              </div>

              {dominantCurrentViewActionSelection.count > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Actionable now</p>
                    <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{totalActionableCurrentViewCount}</p>
                    <p className="mt-1 text-xs text-muted-foreground">All queueable cycles in the current filtered view.</p>
                  </div>
                  <div className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Dominant share</p>
                    <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{dominantActionImpactPercent}%</p>
                    <p className="mt-1 text-xs text-muted-foreground">Queue load removed if this first lane is cleared.</p>
                  </div>
                  <div className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Remaining after first pass</p>
                    <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{remainingActionableAfterDominantCount}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Cycles still needing follow-up after the dominant lane.</p>
                  </div>
                </div>
              ) : null}

              {runnerUpCurrentViewActionSelection ? (
                <div className="mt-4 rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Next after this lane
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{runnerUpCurrentViewActionSelection.label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {runnerUpCurrentViewActionSelection.count} cycle{runnerUpCurrentViewActionSelection.count === 1 ? "" : "s"} remain in the next-largest queue bucket.
                      </p>
                    </div>
                    <StatusBadge tone="neutral">Second priority</StatusBadge>
                  </div>
                  {runnerUpActionHref ? (
                    <div className="mt-3">
                      <Link href={runnerUpActionHref} className="module-inline-action w-fit">
                        Queue up the next lane
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {dominantCurrentViewActionSelection.count > 0 ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link href={dominantActionHref} className="module-inline-action w-fit">
                    Review {dominantCurrentViewActionSelection.count} cycle{dominantCurrentViewActionSelection.count === 1 ? "" : "s"} in this lane
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <RtpRegistryNextActionShortcut
                    actionKey={dominantCurrentViewActionSelection.key}
                    cycleIds={dominantActionCycleIds}
                    reportIds={dominantActionReportIds}
                  />
                </div>
              ) : null}

              {dominantCurrentViewActionSelection.key === "traceFollowUp" && dominantCurrentViewActionSelection.count > 0 ? (
                <div className="mt-4 rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Trace follow-up mix
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Focus the current trace lane by separating cycles whose queue trace was overtaken by source changes from cycles that still have no durable trace record.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {dominantTraceFollowUpCounts.outpaced > 0 ? (
                      <Link
                        href={buildRtpRegistryHref({
                          status: filters.status ?? null,
                          packet: "current",
                          recent: recentOnly,
                          queueAction: selectedQueueActionFilter,
                          queueTraceState: "outpaced",
                        })}
                        className="module-inline-action"
                      >
                        Review {dominantTraceFollowUpCounts.outpaced} outpaced trace{dominantTraceFollowUpCounts.outpaced === 1 ? "" : "s"}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : null}
                    {dominantTraceFollowUpCounts.unrecorded > 0 ? (
                      <Link
                        href={buildRtpRegistryHref({
                          status: filters.status ?? null,
                          packet: "current",
                          recent: recentOnly,
                          queueAction: selectedQueueActionFilter,
                          queueTraceState: "unrecorded",
                        })}
                        className="module-inline-action"
                      >
                        Review {dominantTraceFollowUpCounts.unrecorded} trace gap{dominantTraceFollowUpCounts.unrecorded === 1 ? "" : "s"}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {dominantCurrentViewActionSelection.count > 0 ? (
                <div className="mt-4 rounded-[0.5rem] border border-border/60 bg-muted/20 px-3 py-3">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Top affected cycles
                  </p>
                  <div className="mt-3 space-y-2">
                    {dominantActionCycles.slice(0, 3).map((cycle) => (
                      <div key={cycle.id} className="rounded-[0.5rem] border border-border/50 bg-background px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <Link href={`/rtp/${cycle.id}`} className="text-sm font-medium tracking-tight transition hover:text-foreground/80">
                              {cycle.title}
                            </Link>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {cycle.packetAttention === "missing"
                                ? "No packet record yet."
                                : cycle.packetAttention === "reset"
                                  ? "Packet preset drift requires reset and regeneration."
                                  : cycle.packetAttention === "generate"
                                    ? "Packet record exists but first artifact is still missing."
                                    : cycle.packetAttention === "refresh"
                                      ? "Artifact is behind current cycle state."
                                      : "Queue trace needs follow-up against current state."}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <StatusBadge tone={cycle.packetFreshness.tone}>{cycle.packetFreshness.label}</StatusBadge>
                              <StatusBadge tone={cycle.packetQueueTraceState.tone}>{cycle.packetQueueTraceState.label}</StatusBadge>
                              <StatusBadge tone={cycle.packetFundingReview.tone}>{cycle.packetFundingReview.label}</StatusBadge>
                            </div>
                          </div>
                          <StatusBadge tone={cycle.packetOperatorStatus.tone}>{cycle.packetOperatorStatus.label}</StatusBadge>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <Link href={`/rtp/${cycle.id}`} className="module-inline-action w-fit">
                            Open cycle
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                          {cycle.packetReport ? (
                            <Link href={cycle.packetNavigationHref} className="module-inline-action w-fit">
                              Open packet
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          ) : null}
                          <RtpRegistryPacketRowAction
                            cycleId={cycle.id}
                            reportId={cycle.packetReport?.id ?? null}
                            packetAttention={cycle.packetAttention}
                            needsFirstArtifact={cycle.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                {currentViewActionCounts.createPacket > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: "missing",
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: selectedQueueTraceStateFilter,
                    })}
                    className="module-inline-action"
                  >
                    Open missing lane
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
                {currentViewActionCounts.resetAndRegenerate > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: "reset",
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: selectedQueueTraceStateFilter,
                    })}
                    className="module-inline-action"
                  >
                    Open reset lane
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
                {currentViewActionCounts.generateFirstArtifact > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: "generate",
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: selectedQueueTraceStateFilter,
                    })}
                    className="module-inline-action"
                  >
                    Open first-artifact lane
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
                {currentViewActionCounts.refreshArtifact > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: "refresh",
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: selectedQueueTraceStateFilter,
                    })}
                    className="module-inline-action"
                  >
                    Open refresh lane
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
                {currentViewActionCounts.releaseReview > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: "current",
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: "aligned",
                    })}
                    className="module-inline-action"
                  >
                    Open release-review lane
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
                {currentViewActionCounts.traceFollowUp > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: "current",
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState:
                        selectedQueueTraceStateFilter === "all" ? "outpaced" : selectedQueueTraceStateFilter,
                    })}
                    className="module-inline-action"
                  >
                    Open trace follow-up
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            </article>
          ) : null}

          {unrecordedQueueCycles.length > 0 ? (
            <article className="rounded-[0.75rem] border border-slate-500/20 bg-slate-500/[0.05] p-5 shadow-[0_20px_60px_-48px_rgba(51,65,85,0.28)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Unrecorded queue traces
                  </p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{unrecordedQueueCycles.length}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    These cycles do not yet have a durable queue-action timestamp, so there is no persisted operator trace to compare against source changes.
                  </p>
                </div>
                <StatusBadge tone="neutral">Trace gap</StatusBadge>
              </div>

              <div className="mt-4 space-y-2">
                <div className="rounded-[0.5rem] border border-slate-500/20 bg-background/90 px-3 py-3">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Coverage mix
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                    <li>• Missing packet lane: {unrecordedQueueMix.missing}</li>
                    <li>• First artifact lane: {unrecordedQueueMix.generate}</li>
                    <li>• Refresh lane: {unrecordedQueueMix.refresh}</li>
                    <li>• Current-without-trace: {unrecordedQueueMix.current}</li>
                  </ul>
                </div>

                {unrecordedQueueCycles.slice(0, 5).map((cycle) => (
                  <div key={cycle.id} className="rounded-[0.5rem] border border-slate-500/20 bg-background/90 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={`/rtp/${cycle.id}`} className="text-sm font-medium tracking-tight transition hover:text-foreground/80">
                          {cycle.title}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {cycle.packetReport
                            ? "Packet record exists, but no durable queue-action trace has been recorded yet."
                            : "No packet record exists yet, so trace coverage has not started."}
                        </p>
                      </div>
                      <StatusBadge tone={cycle.packetAttention === "missing" ? "warning" : cycle.packetAttention === "generate" ? "info" : "neutral"}>
                        {cycle.packetAttention === "missing"
                          ? "Missing lane"
                          : cycle.packetAttention === "generate"
                            ? "Generate lane"
                            : "Trace gap"}
                      </StatusBadge>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href={buildRtpRegistryHref({
                    status: filters.status ?? null,
                    packet: selectedPacketFilter,
                    recent: recentOnly,
                    queueAction: selectedQueueActionFilter,
                    queueTraceState: "unrecorded",
                  })}
                  className="module-inline-action"
                >
                  Filter to unrecorded traces
                  <ArrowRight className="h-4 w-4" />
                </Link>
                {unrecordedQueueMix.missing > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: "missing",
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: "unrecorded",
                    })}
                    className="module-inline-action"
                  >
                    Review missing lane
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
                {unrecordedQueueMix.generate > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: "generate",
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: "unrecorded",
                    })}
                    className="module-inline-action"
                  >
                    Review first-artifact lane
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            </article>
          ) : null}

          {outpacedQueueCycles.length > 0 ? (
            <article className="rounded-[0.75rem] border border-amber-500/25 bg-amber-500/[0.06] p-5 shadow-[0_20px_60px_-48px_rgba(180,83,9,0.35)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Outpaced queue traces
                  </p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{outpacedQueueCycles.length}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    These cycles changed after their last recorded queue action, so the saved trace is no longer the newest truth by itself.
                  </p>
                </div>
                <StatusBadge tone="warning">Needs review</StatusBadge>
              </div>

              <div className="mt-4 space-y-2">
                <div className="rounded-[0.5rem] border border-amber-500/20 bg-background/90 px-3 py-3">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Cleanup mix
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                    <li>• Reset lane: {outpacedQueueMix.reset}</li>
                    <li>• Refresh lane: {outpacedQueueMix.refresh}</li>
                    <li>• First artifact lane: {outpacedQueueMix.generate}</li>
                    <li>• Current-but-overtaken: {outpacedQueueMix.current}</li>
                  </ul>
                </div>

                {outpacedQueueCycles.slice(0, 5).map((cycle) => (
                  <div key={cycle.id} className="rounded-[0.5rem] border border-amber-500/20 bg-background/90 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={`/rtp/${cycle.id}`} className="text-sm font-medium tracking-tight transition hover:text-foreground/80">
                          {cycle.title}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {cycle.packetQueueTrace.label} recorded {cycle.packetQueueTrace.actedAt ? formatRtpDateTime(cycle.packetQueueTrace.actedAt) : "previously"}.
                        </p>
                      </div>
                      <StatusBadge tone={cycle.packetAttention === "reset" ? "warning" : cycle.packetAttention === "refresh" ? "info" : "neutral"}>
                        {cycle.packetAttention === "reset"
                          ? "Reset lane"
                          : cycle.packetAttention === "refresh"
                            ? "Refresh lane"
                            : "Review"}
                      </StatusBadge>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href={buildRtpRegistryHref({
                    status: filters.status ?? null,
                    packet: selectedPacketFilter,
                    recent: recentOnly,
                    queueAction: selectedQueueActionFilter,
                    queueTraceState: "outpaced",
                  })}
                  className="module-inline-action"
                >
                  Filter to outpaced traces
                  <ArrowRight className="h-4 w-4" />
                </Link>
                {outpacedQueueMix.reset > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: "reset",
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: "outpaced",
                    })}
                    className="module-inline-action"
                  >
                    Review reset lane
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
                {outpacedQueueMix.refresh > 0 ? (
                  <Link
                    href={buildRtpRegistryHref({
                      status: filters.status ?? null,
                      packet: "refresh",
                      recent: recentOnly,
                      queueAction: selectedQueueActionFilter,
                      queueTraceState: "outpaced",
                    })}
                    className="module-inline-action"
                  >
                    Review refresh lane
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            </article>
          ) : null}

          {recentQueueActivityCount > 0 ? (
            <article className="rounded-[0.75rem] border border-border/70 bg-background/95 p-5 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Recent queue activity
              </p>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{recentQueueActivityCount}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                RTP cycles recorded queue work in the last 24 hours and are now sorted to the top of their current attention lane.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <li>• Record creation: {recentQueueActionBreakdown.createRecord}</li>
                <li>• Preset resets: {recentQueueActionBreakdown.resetLayout}</li>
                <li>• First artifacts: {recentQueueActionBreakdown.generateFirstArtifact}</li>
                <li>• Refreshes: {recentQueueActionBreakdown.refreshArtifact}</li>
                <li>• Outpaced by newer source edits: {outpacedQueueTraceCount}</li>
              </ul>
              {latestQueueActionAt ? (
                <p className="mt-2 text-xs text-muted-foreground">Latest action {formatRtpDateTime(latestQueueActionAt)}</p>
              ) : null}
            </article>
          ) : null}

          {packetAttentionCounts.reset > 0 || packetAttentionCounts.generate > 0 || packetAttentionCounts.refresh > 0 || packetAttentionCounts.missing > 0 ? (
            <RtpRegistryPacketQueueCommandBoard
              resetCycleIds={allCycles.filter((cycle) => cycle.packetAttention === "reset").map((cycle) => cycle.id)}
              missingCycleIds={allCycles.filter((cycle) => cycle.packetAttention === "missing").map((cycle) => cycle.id)}
              generateFirstReportIds={[
                ...new Set(
                  allCycles
                    .filter((cycle) => cycle.packetAttention === "generate")
                    .map((cycle) => cycle.packetReport?.id)
                    .filter((reportId): reportId is string => Boolean(reportId))
                ),
              ]}
              refreshReportIds={[
                ...new Set(
                  allCycles
                    .filter(
                      (cycle) =>
                        cycle.packetAttention === "reset" ||
                        cycle.packetAttention === "refresh"
                    )
                    .map((cycle) => cycle.packetReport?.id)
                    .filter((reportId): reportId is string => Boolean(reportId))
                ),
              ]}
              resetCount={packetAttentionCounts.reset}
              missingCount={packetAttentionCounts.missing}
            />
          ) : null}

          {packetAttentionCounts.reset > 0 ? (
            <RtpRegistryPacketBulkActions
              cycleIds={allCycles.filter((cycle) => cycle.packetAttention === "reset").map((cycle) => cycle.id)}
              cycleCount={packetAttentionCounts.reset}
            />
          ) : null}

          {packetAttentionCounts.generate > 0 ? (
            <RtpRegistryPacketBulkGenerateActions
              reportIds={allCycles
                .filter((cycle) => cycle.packetAttention === "generate")
                .map((cycle) => cycle.packetReport?.id)
                .filter((reportId): reportId is string => Boolean(reportId))}
              reportCount={packetAttentionCounts.generate}
            />
          ) : null}

          {packetAttentionCounts.refresh > 0 ? (
            <RtpRegistryPacketBulkRefreshActions
              reportIds={allCycles
                .filter((cycle) => cycle.packetAttention === "refresh")
                .map((cycle) => cycle.packetReport?.id)
                .filter((reportId): reportId is string => Boolean(reportId))}
              reportCount={packetAttentionCounts.refresh}
            />
          ) : null}

          <RtpCycleCreator />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Next slice</p>
                <h2 className="module-section-title">What comes next</h2>
                <p className="module-section-description">
                  The cycle now carries portfolio links and a first chapter shell. The next slice can move from structure into editable RTP content.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
                <Compass className="h-5 w-5" />
              </span>
            </div>

            <div className="module-operator-list mt-1">
              <div className="module-operator-item">Add chapter editing so policy, action, and financial sections can move from shell to working draft.</div>
              <div className="module-operator-item">Keep constrained, illustrative, and candidate project posture visible from the same cycle.</div>
              <div className="module-operator-item">Extend engagement campaigns so whole-plan, chapter, and project comments can point back to the same cycle.</div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="module-metric-card">
                <p className="module-metric-label">Next domain</p>
                <p className="module-metric-value text-sm">Editable chapter workflow</p>
                <p className="mt-1 text-xs text-muted-foreground">Section summaries, chapter status, and chapter-specific evidence posture.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Next output</p>
                <p className="module-metric-value text-sm">Comment-ready digital RTP</p>
                <p className="mt-1 text-xs text-muted-foreground">A narrative surface that can carry chapter-level comments and board packet exports.</p>
              </div>
            </div>

            <Link href="/projects" className="module-inline-action mt-4">
              Review linked project control room posture
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/plans" className="module-inline-action mt-3">
              Review existing plan records
              <FolderKanban className="h-4 w-4" />
            </Link>
          </article>
        </aside>
      </div>
    </section>
  );
}
