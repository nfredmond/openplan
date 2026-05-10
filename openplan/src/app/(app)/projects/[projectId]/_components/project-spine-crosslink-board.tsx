import Link from "next/link";
import { ArrowRight, GitBranch } from "lucide-react";
import type { ProjectSpineCrosslinkSummary } from "@/lib/projects/project-spine-crosslinks";

function readinessClass(readiness: string) {
  switch (readiness) {
    case "ready":
      return "border-emerald-500/35 bg-emerald-50/45 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/20 dark:text-emerald-50";
    case "attention":
      return "border-amber-500/40 bg-amber-50/60 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-50";
    default:
      return "border-border/80 bg-background/80 text-foreground";
  }
}

function readinessRailClass(readiness: string) {
  switch (readiness) {
    case "ready":
      return "bg-emerald-500/75";
    case "attention":
      return "bg-amber-500/85";
    default:
      return "bg-muted-foreground/35";
  }
}

export function ProjectSpineCrosslinkBoard({
  summary,
}: {
  summary: ProjectSpineCrosslinkSummary;
}) {
  return (
    <article id="project-spine-crosslinks" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <GitBranch className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Shared project spine</p>
            <h2 className="module-section-title">Linked outputs across this project</h2>
            <p className="module-section-description">
              One scanable rail for the downstream outputs that reuse this project record: RTP links, project reports, scenario sets, grants, engagement, analysis, and aerial evidence.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)]">
        <div className="module-record-list">
          {summary.rows.map((row) => (
            <Link
              key={row.id}
              href={row.href}
              className={`module-record-row is-interactive overflow-hidden ${readinessClass(row.readiness)}`}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 w-1 ${readinessRailClass(row.readiness)}`}
              />
              <div className="module-record-head pl-2">
                <div className="module-record-main">
                  <p className="module-record-stamp">{row.lane}</p>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="module-record-title">{row.statusLabel}</h3>
                    <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {row.readiness === "ready" ? "Ready" : row.readiness === "attention" ? "Needs review" : "Not linked"}
                    </span>
                  </div>
                  <p className="module-record-summary">{row.headline}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground/80">
                  {row.actionLabel}
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="grid gap-3 pl-2 md:grid-cols-[0.74fr_1.26fr]">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {row.detail}
                </p>
                <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                  <p>{row.evidence}</p>
                  <p>
                    <span className="font-semibold text-foreground/80">Next:</span> {row.nextAction}
                  </p>
                  <p>
                    <span className="font-semibold text-foreground/80">Caveat:</span> {row.caveat}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <aside className="rounded-[0.5rem] border border-border/70 bg-background/75 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Crosslink inspector
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-semibold text-foreground">{summary.readyCount}</p>
              <p className="text-[0.67rem] uppercase tracking-[0.14em] text-muted-foreground">ready</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-foreground">{summary.attentionCount}</p>
              <p className="text-[0.67rem] uppercase tracking-[0.14em] text-muted-foreground">review</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-foreground">{summary.missingCount}</p>
              <p className="text-[0.67rem] uppercase tracking-[0.14em] text-muted-foreground">missing</p>
            </div>
          </div>
          <div className="mt-5 border-t border-border/70 pt-4">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              First operator move
            </p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{summary.leadAction.lane}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {summary.leadAction.headline}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Next:</span> {summary.leadAction.nextAction}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground/80">Caveat:</span> {summary.leadAction.caveat}
            </p>
            <Link
              href={summary.leadAction.href}
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary transition hover:text-primary/80"
            >
              {summary.leadAction.actionLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </aside>
      </div>
    </article>
  );
}
