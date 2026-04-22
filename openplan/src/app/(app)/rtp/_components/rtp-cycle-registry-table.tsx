import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CartographicSelectionLink } from "@/components/cartographic/cartographic-selection-link";
import { EmptyState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { RtpRegistryPacketRowAction } from "@/components/rtp/rtp-registry-packet-row-action";
import {
  formatRtpCycleStatusLabel,
  formatRtpDate,
  formatRtpDateTime,
  rtpCycleStatusTone,
  RTP_CYCLE_STATUS_OPTIONS,
} from "@/lib/rtp/catalog";
import {
  PACKET_FRESHNESS_LABELS,
  PACKET_POSTURE_LABELS,
} from "@/lib/reports/packet-labels";
import { formatReportStatusLabel } from "@/lib/reports/catalog";
import { projectFundingReimbursementTone } from "@/lib/projects/funding";
import { buildRtpRegistryHref, formatUsdWholeAmount } from "./_helpers";
import type {
  PacketAttentionCounts,
  PacketAttentionFilter,
  QueueActionCounts,
  QueueActionFilter,
  QueueTraceStateCounts,
  QueueTraceStateFilter,
  RtpRegistryCycle,
} from "./_types";

type Props = {
  typedCycles: RtpRegistryCycle[];
  allCyclesCount: number;
  recentQueueCyclesCount: number;
  filtersStatus: string | null;
  selectedPacketFilter: PacketAttentionFilter;
  recentOnly: boolean;
  selectedQueueActionFilter: QueueActionFilter;
  selectedQueueTraceStateFilter: QueueTraceStateFilter;
  packetAttentionCounts: PacketAttentionCounts;
  queueActionScopedCyclesCount: number;
  queueActionCounts: QueueActionCounts;
  queueTraceStateScopedCyclesCount: number;
  queueTraceStateCounts: QueueTraceStateCounts;
  currentFundingReviewCount: number;
  currentFundingGapReviewCount: number;
  currentReimbursementFollowThroughCount: number;
};

export function RtpCycleRegistryTable({
  typedCycles,
  allCyclesCount,
  recentQueueCyclesCount,
  filtersStatus,
  selectedPacketFilter,
  recentOnly,
  selectedQueueActionFilter,
  selectedQueueTraceStateFilter,
  packetAttentionCounts,
  queueActionScopedCyclesCount,
  queueActionCounts,
  queueTraceStateScopedCyclesCount,
  queueTraceStateCounts,
  currentFundingReviewCount,
  currentFundingGapReviewCount,
  currentReimbursementFollowThroughCount,
}: Props) {
  return (
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
                  const active = filtersStatus === option.value;
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
                  { value: "all" as const, label: "All", count: allCyclesCount },
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
                        status: filtersStatus,
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
                    status: filtersStatus,
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
                    status: filtersStatus,
                    packet: selectedPacketFilter,
                    recent: true,
                    queueAction: selectedQueueActionFilter,
                    queueTraceState: selectedQueueTraceStateFilter,
                  })}
                  className={recentOnly ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                >
                  Recent only · {recentQueueCyclesCount}
                </Link>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Last queue action</p>
              <div className="flex flex-wrap justify-end gap-2">
                {[
                  { value: "all" as const, label: "All actions", count: queueActionScopedCyclesCount },
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
                        status: filtersStatus,
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
                  { value: "all" as const, label: "All trace states", count: queueTraceStateScopedCyclesCount },
                  { value: "outpaced" as const, label: "Outpaced", count: queueTraceStateCounts.outpaced },
                  { value: "aligned" as const, label: "Aligned", count: queueTraceStateCounts.aligned },
                  { value: "unrecorded" as const, label: "Unrecorded", count: queueTraceStateCounts.unrecorded },
                ].map((option) => {
                  const active = selectedQueueTraceStateFilter === option.value;
                  return (
                    <Link
                      key={option.value}
                      href={buildRtpRegistryHref({
                        status: filtersStatus,
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
                  status: filtersStatus,
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
                  status: filtersStatus,
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
          {filtersStatus ? ` in ${formatRtpCycleStatusLabel(filtersStatus).toLowerCase()} posture` : " across all cycle phases"}
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
            title={allCyclesCount > 0 ? "No cycles match the current filter" : "No RTP cycles yet"}
            description={
              allCyclesCount > 0
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
                      <CartographicSelectionLink
                        href={`/rtp/${cycle.id}`}
                        className="text-base font-semibold tracking-tight transition hover:text-foreground/80"
                        selection={{
                          kind: "project",
                          title: cycle.title,
                          kicker: `RTP · ${formatRtpCycleStatusLabel(cycle.status)}`,
                          avatarChar: cycle.title[0],
                          meta: [
                            { label: "readiness", value: cycle.readiness.label },
                          ],
                        }}
                      >
                        {cycle.title}
                      </CartographicSelectionLink>
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
                    <p className="module-metric-value text-sm">{formatUsdWholeAmount(cycle.paidReimbursementAmount)}</p>
                  </div>
                  <div className="module-metric-card">
                    <p className="module-metric-label">Outstanding requests</p>
                    <p className="module-metric-value text-sm">{formatUsdWholeAmount(cycle.outstandingReimbursementAmount)}</p>
                  </div>
                  <div className="module-metric-card">
                    <p className="module-metric-label">Uninvoiced awards</p>
                    <p className="module-metric-value text-sm">{formatUsdWholeAmount(cycle.uninvoicedAwardAmount)}</p>
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
                        Award-linked invoices now show how much of each RTP cycle&rsquo;s committed funding has already been paid, is still awaiting payment, or has not yet been invoiced.
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
  );
}
