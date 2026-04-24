import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { RtpRegistryNextActionShortcut } from "@/components/rtp/rtp-registry-next-action-shortcut";
import { RtpRegistryPacketRowAction } from "@/components/rtp/rtp-registry-packet-row-action";
import { formatRtpDateTime } from "@/lib/rtp/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { buildRtpRegistryHref } from "./_helpers";
import type {
  DominantAction,
  DominantActionKey,
  PacketAttentionFilter,
  QueueActionFilter,
  QueueTraceStateFilter,
  RtpRegistryCycle,
} from "./_types";

type DominantTraceFollowUpCounts = {
  outpaced: number;
  unrecorded: number;
  aligned: number;
};

type CurrentViewActionCounts = {
  createPacket: number;
  resetAndRegenerate: number;
  generateFirstArtifact: number;
  refreshArtifact: number;
  releaseReview: number;
  traceFollowUp: number;
};

type UnrecordedQueueMix = {
  missing: number;
  generate: number;
  refresh: number;
  current: number;
};

type OutpacedQueueMix = {
  reset: number;
  refresh: number;
  generate: number;
  current: number;
};

type RecentQueueActionBreakdown = {
  createRecord: number;
  resetLayout: number;
  generateFirstArtifact: number;
  refreshArtifact: number;
};

type Props = {
  typedCyclesLength: number;
  dominantCurrentViewActionSelection: DominantAction;
  rankedCurrentViewActions: DominantAction[];
  actionHrefByKey: Record<DominantActionKey, string>;
  totalActionableCurrentViewCount: number;
  dominantActionImpactPercent: number;
  remainingActionableAfterDominantCount: number;
  runnerUpCurrentViewActionSelection: DominantAction | undefined;
  runnerUpActionHref: string | null;
  dominantActionHref: string;
  dominantActionCycleIds: string[];
  dominantActionReportIds: string[];
  dominantActionCycles: RtpRegistryCycle[];
  dominantTraceFollowUpCounts: DominantTraceFollowUpCounts;
  currentViewActionCounts: CurrentViewActionCounts;
  unrecordedQueueCycles: RtpRegistryCycle[];
  unrecordedQueueMix: UnrecordedQueueMix;
  outpacedQueueCycles: RtpRegistryCycle[];
  outpacedQueueMix: OutpacedQueueMix;
  recentQueueActivityCount: number;
  recentQueueActionBreakdown: RecentQueueActionBreakdown;
  outpacedQueueTraceCount: number;
  latestQueueActionAt: string | null;
  filtersStatus: string | null;
  selectedPacketFilter: PacketAttentionFilter;
  recentOnly: boolean;
  selectedQueueActionFilter: QueueActionFilter;
  selectedQueueTraceStateFilter: QueueTraceStateFilter;
  modelingCountyRunId: string | null;
};

export function RtpRegistryAdvisoryPanel({
  typedCyclesLength,
  dominantCurrentViewActionSelection,
  rankedCurrentViewActions,
  actionHrefByKey,
  totalActionableCurrentViewCount,
  dominantActionImpactPercent,
  remainingActionableAfterDominantCount,
  runnerUpCurrentViewActionSelection,
  runnerUpActionHref,
  dominantActionHref,
  dominantActionCycleIds,
  dominantActionReportIds,
  dominantActionCycles,
  dominantTraceFollowUpCounts,
  currentViewActionCounts,
  unrecordedQueueCycles,
  unrecordedQueueMix,
  outpacedQueueCycles,
  outpacedQueueMix,
  recentQueueActivityCount,
  recentQueueActionBreakdown,
  outpacedQueueTraceCount,
  latestQueueActionAt,
  filtersStatus,
  selectedPacketFilter,
  recentOnly,
  selectedQueueActionFilter,
  selectedQueueTraceStateFilter,
  modelingCountyRunId,
}: Props) {
  return (
    <>
      {typedCyclesLength > 0 ? (
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
                modelingCountyRunId={modelingCountyRunId}
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
                      status: filtersStatus,
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
                      status: filtersStatus,
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
                        modelingCountyRunId={cycle.modelingCountyRunId}
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
                  status: filtersStatus,
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
                  status: filtersStatus,
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
                  status: filtersStatus,
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
                  status: filtersStatus,
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
                  status: filtersStatus,
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
                  status: filtersStatus,
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
                status: filtersStatus,
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
                  status: filtersStatus,
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
                  status: filtersStatus,
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
                status: filtersStatus,
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
                  status: filtersStatus,
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
                  status: filtersStatus,
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
    </>
  );
}
