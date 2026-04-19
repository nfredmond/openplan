import Link from "next/link";
import { Link2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildGrantDecisionModelingSupport,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import { describeComparisonSnapshotAggregate, titleize } from "@/lib/reports/catalog";
import type { PacketFreshness, ReportRow } from "./_types";

type GrantModelingReadiness = ReturnType<typeof describeProjectGrantModelingReadiness>;
type GrantModelingSupport = ReturnType<typeof buildGrantDecisionModelingSupport>;
type ComparisonDigest = ReturnType<typeof describeComparisonSnapshotAggregate>;

export type GrantModelingEvidence = {
  leadComparisonReport: {
    comparisonAggregate: { indicatorDeltaCount: number };
  };
} | null;

type Props = {
  report: Pick<
    ReportRow,
    "rtp_basis_stale" | "rtp_basis_stale_reason" | "rtp_basis_stale_marked_at"
  >;
  projectId: string | null;
  packetFreshness: PacketFreshness;
  grantModelingReadiness: GrantModelingReadiness;
  grantModelingSupport: GrantModelingSupport;
  grantModelingEvidence: GrantModelingEvidence;
  comparisonDigest: ComparisonDigest;
};

export function ReportPacketReview({
  report,
  projectId,
  packetFreshness,
  grantModelingReadiness,
  grantModelingSupport,
  grantModelingEvidence,
  comparisonDigest,
}: Props) {
  return (
    <article id="packet-release-review" className="module-section-surface">
      {report.rtp_basis_stale ? (
        <div className="mb-4 rounded-[18px] border border-amber-400/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em]">
            Basis stale
          </p>
          <p className="mt-1 font-semibold">
            {report.rtp_basis_stale_reason ??
              "An upstream model run succeeded after this packet was last generated."}
          </p>
          <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/90">
            {report.rtp_basis_stale_marked_at
              ? `Marked stale on ${new Date(report.rtp_basis_stale_marked_at).toLocaleString()}. Regenerate the packet to re-ground it on the new run.`
              : "Regenerate the packet to re-ground it on the new run."}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Release review
          </p>
          <h2 className="text-xl font-semibold tracking-tight">Packet release review</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Use this operator checkpoint to decide whether the current packet is safe to cite in grant triage language. Recommendations remain advisory until someone explicitly saves a decision in the grants lane.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {report.rtp_basis_stale ? (
            <StatusBadge tone="warning">Basis stale</StatusBadge>
          ) : null}
          <StatusBadge tone={packetFreshness.tone}>
            {packetFreshness.label}
          </StatusBadge>
          {grantModelingReadiness ? (
            <StatusBadge tone={grantModelingReadiness.tone}>
              {grantModelingReadiness.label}
            </StatusBadge>
          ) : null}
          {comparisonDigest ? (
            <StatusBadge tone="info">{comparisonDigest.headline}</StatusBadge>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Packet freshness
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {packetFreshness.label}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {packetFreshness.detail}
          </p>
        </div>
        <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Grant planning posture
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {grantModelingReadiness?.label ?? "No visible support"}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {grantModelingReadiness?.detail ?? grantModelingSupport.summary}
          </p>
        </div>
        <div className="rounded-[18px] border border-border/80 bg-background/80 px-4 py-3">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Modeling digest
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {comparisonDigest?.headline ?? "No saved comparisons in this packet"}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {comparisonDigest?.detail ??
              "Saved comparison snapshots have not been captured here yet, so this packet should not drive pursue language on its own."}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-[20px] border border-border/80 bg-background/80 px-4 py-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Recommended next action
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {grantModelingSupport.recommendedNextActionTitle}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {grantModelingSupport.recommendedNextActionSummary}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone="neutral">
            Suggested decision: {titleize(grantModelingSupport.recommendedDecisionState)}
          </StatusBadge>
          {grantModelingEvidence ? (
            <StatusBadge tone="neutral">
              {grantModelingEvidence.leadComparisonReport.comparisonAggregate.indicatorDeltaCount} indicator delta
              {grantModelingEvidence.leadComparisonReport.comparisonAggregate.indicatorDeltaCount === 1 ? "" : "s"}
            </StatusBadge>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
        <Link
          href="#report-controls"
          className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
        >
          Review packet controls
          <Link2 className="h-4 w-4" />
        </Link>
        {projectId ? (
          <Link
            href={`/grants?focusProjectId=${projectId}`}
            className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
          >
            Open grant decisions
            <Link2 className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
    </article>
  );
}
