import { Compass, Plane } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  aerialVerificationReadinessTone,
  describeAerialProjectPosture,
  formatAerialVerificationReadinessLabel,
  type AerialProjectPosture,
} from "@/lib/aerial/catalog";
import type { ProjectRtpPosture } from "@/lib/projects/rtp-posture-writeback";
import { fmtCurrency, fmtDateTime, type Tone } from "./_helpers";

type ProjectPostureUnifiedProps = {
  rtpPosture: ProjectRtpPosture | null;
  rtpPostureUpdatedAt: string | null;
  aerialPosture: AerialProjectPosture | null;
  aerialPostureUpdatedAt: string | null;
};

function toneForReimbursementStatus(status: string): Tone {
  if (status === "paid") return "success";
  if (status === "partial") return "info";
  if (status === "outstanding") return "warning";
  if (status === "none") return "neutral";
  return "neutral";
}

function toneForFundingStackStatus(status: string): Tone {
  if (status === "fully_funded") return "success";
  if (status === "partially_funded") return "info";
  if (status === "gap") return "warning";
  if (status === "unfunded") return "danger";
  return "neutral";
}

export function ProjectPostureUnified({
  rtpPosture,
  rtpPostureUpdatedAt,
  aerialPosture,
  aerialPostureUpdatedAt,
}: ProjectPostureUnifiedProps) {
  const hasRtp = rtpPosture !== null;
  const hasAerial = aerialPosture !== null;

  if (!hasRtp && !hasAerial) {
    return null;
  }

  const rtpGap = rtpPosture?.remainingFundingGap ?? 0;
  const rtpWarm = rtpGap > 0;
  const rtpRowClass = rtpWarm
    ? "rounded-[0.75rem] border border-amber-300/50 bg-gradient-to-br from-amber-50/90 to-amber-100/40 px-5 py-4 dark:border-amber-900/70 dark:from-amber-950/30 dark:to-amber-950/10"
    : "rounded-[0.75rem] border border-border/70 bg-background/80 px-5 py-4";

  const aerialDetail = aerialPosture ? describeAerialProjectPosture(aerialPosture) : null;

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <Compass className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Project posture</p>
            <h2 className="module-section-title">RTP and aerial posture, read from the write-back</h2>
            <p className="module-section-description">
              Funding stack and aerial evidence posture are cached on the project record. These rows read the cached posture
              directly instead of recomputing — so what you see here matches what closeouts, invoice updates, and evidence-package
              mutations actually wrote.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {hasRtp && rtpPosture ? (
          <div className={rtpRowClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">RTP posture</p>
                <StatusBadge tone={toneForFundingStackStatus(rtpPosture.status)}>{rtpPosture.label}</StatusBadge>
                <StatusBadge tone={toneForReimbursementStatus(rtpPosture.reimbursementStatus)}>
                  {rtpPosture.reimbursementLabel}
                </StatusBadge>
              </div>
              <p className="text-[0.7rem] text-muted-foreground">
                Posture cached {fmtDateTime(rtpPostureUpdatedAt)}
              </p>
            </div>
            <p className="mt-2 text-sm font-medium leading-relaxed text-foreground">
              Committed {fmtCurrency(rtpPosture.committedFundingAmount)} · remaining gap{" "}
              <span className={rtpWarm ? "text-amber-900 dark:text-amber-100" : undefined}>
                {fmtCurrency(rtpPosture.remainingFundingGap)}
              </span>{" "}
              · {rtpPosture.awardCount} award{rtpPosture.awardCount === 1 ? "" : "s"} on record
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{rtpPosture.reason}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rtpPosture.reimbursementReason}</p>
          </div>
        ) : (
          <div className="rounded-[0.75rem] border border-dashed border-border/60 bg-background/60 px-5 py-4 text-sm text-muted-foreground">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em]">RTP posture</p>
            <p className="mt-1">No cached posture yet. Will populate after the first funding-award creation, invoice update, closeout, or report generation.</p>
          </div>
        )}

        {hasAerial && aerialPosture ? (
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-[0.4rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
                  <Plane className="h-3.5 w-3.5" />
                </span>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Aerial posture</p>
                <StatusBadge tone={aerialVerificationReadinessTone(aerialPosture.verificationReadiness)}>
                  {aerialPosture.verificationReadiness === "none"
                    ? "No missions"
                    : formatAerialVerificationReadinessLabel(aerialPosture.verificationReadiness)}
                </StatusBadge>
              </div>
              <p className="text-[0.7rem] text-muted-foreground">
                Posture cached {fmtDateTime(aerialPostureUpdatedAt)}
              </p>
            </div>
            <p className="mt-2 text-sm font-medium leading-relaxed text-foreground">
              {aerialPosture.missionCount} mission{aerialPosture.missionCount === 1 ? "" : "s"} · {aerialPosture.activeMissionCount}{" "}
              active · {aerialPosture.completeMissionCount} complete · {aerialPosture.readyPackageCount} evidence package
              {aerialPosture.readyPackageCount === 1 ? "" : "s"} ready
            </p>
            {aerialDetail ? (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{aerialDetail}</p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[0.75rem] border border-dashed border-border/60 bg-background/60 px-5 py-4 text-sm text-muted-foreground">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em]">Aerial posture</p>
            <p className="mt-1">No cached posture yet. Will populate after the first aerial mission or evidence-package mutation.</p>
          </div>
        )}
      </div>
    </article>
  );
}
