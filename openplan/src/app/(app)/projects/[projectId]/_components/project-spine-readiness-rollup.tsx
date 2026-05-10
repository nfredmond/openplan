import { ActivitySquare, GitBranch } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatProjectSpineReadinessStatus,
  type ProjectSpineReadinessRollup,
} from "@/lib/projects/spine-readiness";
import { fmtDateTime } from "./_helpers";

export function ProjectSpineReadinessRollup({
  rollup,
}: {
  rollup: ProjectSpineReadinessRollup;
}) {
  return (
    <article id="project-spine-readiness" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <GitBranch className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Shared planning spine</p>
            <h2 className="module-section-title">Connected-output readiness rollup</h2>
            <p className="module-section-description">
              A supervised-workbench check of whether this project’s RTP, report, funding, engagement, analysis, and aerial evidence lanes look current, stale, or not linked.
            </p>
          </div>
        </div>
        <StatusBadge tone={rollup.tone}>{rollup.label}</StatusBadge>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.86fr_1.14fr]">
        <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.45rem] border border-border/70 bg-card text-muted-foreground">
              <ActivitySquare className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Operator posture</p>
              <h3 className="mt-1 text-base font-semibold text-foreground">{rollup.headline}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{rollup.detail}</p>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
            <div className="border-l border-emerald-500/35 pl-3">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Current</dt>
              <dd className="mt-1 text-xl font-semibold text-foreground">{rollup.readyCount}</dd>
            </div>
            <div className="border-l border-amber-500/45 pl-3">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Review</dt>
              <dd className="mt-1 text-xl font-semibold text-foreground">{rollup.staleCount}</dd>
            </div>
            <div className="border-l border-slate-300 pl-3 dark:border-slate-700">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Missing</dt>
              <dd className="mt-1 text-xl font-semibold text-foreground">{rollup.missingCount}</dd>
            </div>
          </dl>

          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            Latest source change: {rollup.latestSourceUpdatedAt ? fmtDateTime(rollup.latestSourceUpdatedAt) : "Not available"}
            {rollup.reviewedAgainstAt ? ` · Reviewed against packet ${fmtDateTime(rollup.reviewedAgainstAt)}` : " · No generated packet baseline yet"}
          </p>
        </div>

        <div className="overflow-hidden rounded-[0.75rem] border border-border/70 bg-card/70">
          <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-border/70 px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground md:grid-cols-[0.62fr_0.4fr_1.1fr]">
            <span>Lane</span>
            <span>Status</span>
            <span className="hidden md:block">Operator note</span>
          </div>
          <div className="divide-y divide-border/70">
            {rollup.lanes.map((lane) => (
              <div key={lane.key} className="grid gap-3 px-4 py-3 md:grid-cols-[0.62fr_0.4fr_1.1fr]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{lane.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{lane.countLabel}</p>
                </div>
                <div>
                  <StatusBadge tone={lane.tone} className="min-h-7 tracking-[0.12em]">
                    {formatProjectSpineReadinessStatus(lane.status)}
                  </StatusBadge>
                </div>
                <div className="text-sm leading-relaxed">
                  <p className="font-medium text-foreground/90">{lane.headline}</p>
                  <p className="mt-1 text-muted-foreground">{lane.detail}</p>
                  <p className="mt-1 text-[0.72rem] text-muted-foreground/85">
                    Source {lane.latestSourceUpdatedAt ? fmtDateTime(lane.latestSourceUpdatedAt) : "not recorded"}
                    {lane.reviewedAgainstAt ? ` · Baseline ${fmtDateTime(lane.reviewedAgainstAt)}` : " · No packet baseline"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
