import Link from "next/link";
import { ActivitySquare, ArrowRight, GitBranch } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  PROJECT_SPINE_CROSSLINK_ROW_COUNT,
  type ProjectSpineCrosslinkSummary,
} from "@/lib/projects/project-spine-crosslinks";
import {
  formatProjectSpineReadinessStatus,
  type ProjectSpineReadinessRollup,
} from "@/lib/projects/spine-readiness";
import { fmtDateTime } from "./_helpers";

/**
 * ONE SPINE SECTION, MERGED FROM TWO.
 *
 * The project page used to render `ProjectSpineCrosslinkBoard` and
 * `ProjectSpineReadinessRollup` back to back, and a planner read the same
 * subject twice in a row: both enumerated this project's linked lanes (RTP,
 * reports, funding, engagement, analysis, aerial), both scored each lane
 * ready / needs-review / not-linked, both totalled those three into a stat
 * trio, and both closed with a single "first operator" callout. Two headers,
 * two vocabularies ("Review" vs "Needs review"), one subject.
 *
 * They are merged rather than deduplicated because the two summaries are not
 * redundant underneath: the crosslink summary carries eight lanes with a next
 * action and a caveat per row, and the readiness rollup carries the freshness
 * axis the crosslink rows have no notion of — when each lane's source last
 * changed, and whether a generated packet has been reviewed against it since.
 * So the section keeps every fact both computed and drops only the second
 * frame around them.
 *
 * BOTH ANCHORS SURVIVE. `#project-spine-crosslinks` addresses the section and
 * `#project-spine-readiness` the freshness block inside it, because links to
 * each already exist and a merge is not a licence to break them.
 */

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

export function ProjectSpineBoard({
  summary,
  rollup,
  isLoading = false,
}: {
  summary: ProjectSpineCrosslinkSummary;
  rollup: ProjectSpineReadinessRollup;
  isLoading?: boolean;
}) {
  // Written out as literal class names, never assembled from a number: Tailwind
  // scans source text for the classes it emits, so `grid-cols-${n}` compiles to
  // no CSS at all and the tiles silently stack.
  const optionalTileCount = (summary.schemaPendingCount > 0 ? 1 : 0) + (summary.unreadableCount > 0 ? 1 : 0);
  const statGridClass =
    optionalTileCount === 2 ? "grid-cols-5" : optionalTileCount === 1 ? "grid-cols-4" : "grid-cols-3";

  const firstOperatorCheck =
    rollup.lanes.find((lane) => lane.status === "stale_needs_review") ??
    rollup.lanes.find((lane) => lane.status === "missing_not_linked") ??
    rollup.lanes[0] ??
    null;

  return (
    <article id="project-spine-crosslinks" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <GitBranch className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Shared project spine</p>
            <h2 className="module-section-title">Linked outputs across this project, and whether they are current</h2>
            <p className="module-section-description">
              One scanable rail for the downstream outputs that reuse this project record: RTP links, project reports, scenario sets, grants, engagement, analysis, and aerial evidence. Below it, whether each of those lanes is current, out of date, or not linked yet. It says what looks stale; a person decides whether it matters.
            </p>
          </div>
        </div>
        <StatusBadge tone={rollup.tone}>{rollup.label}</StatusBadge>
      </div>

      <div className="mt-5 rounded-[0.5rem] border border-border/70 bg-background/70 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(13rem,18rem)] md:items-start">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {isLoading
                ? "Loading state"
                : summary.boardState === "unreadable"
                  ? "Read failure"
                  : summary.boardState === "schema_pending"
                    ? "Setup fallback"
                    : summary.boardState === "empty"
                      ? "Empty state"
                      : "Operator queue"}
            </p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">
              {isLoading ? "Loading crosslink queue" : summary.stateHeadline}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {isLoading
                ? "Checking this project's links to plans, programs, and funding. Each row will resolve into ready evidence, a setup gap, or a next step."
                : summary.stateDetail}
            </p>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Next:</span>{" "}
            {isLoading ? "Keep the board open while it finishes loading." : summary.stateNextAction}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)]">
        <div className="module-record-list">
          {isLoading
            ? Array.from({ length: PROJECT_SPINE_CROSSLINK_ROW_COUNT }).map((_, index) => (
                <div
                  key={`crosslink-loading-${index}`}
                  className="module-record-row overflow-hidden border-border/80 bg-background/80"
                  aria-label="Loading crosslink row"
                >
                  <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-muted-foreground/25" />
                  <div className="module-record-head pl-2">
                    <div className="module-record-main space-y-2">
                      <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-56 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                    </div>
                    <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                  </div>
                  <div className="grid gap-3 pl-2 md:grid-cols-[0.74fr_1.26fr]">
                    <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                    <div className="space-y-2">
                      <div className="h-3 w-full animate-pulse rounded bg-muted" />
                      <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                </div>
              ))
            : summary.rows.map((row) => (
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
                      {row.sourceState === "unreadable"
                        ? "Unavailable"
                        : row.sourceState === "schema_pending"
                          ? "Setup needed"
                          : row.readiness === "ready"
                            ? "Ready"
                            : row.readiness === "attention"
                              ? "Needs review"
                              : "Not linked"}
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
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {row.detail}
                  </p>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-foreground/70">
                    {row.sourceLabel}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{row.sourceDetail}</p>
                </div>
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
          <div className={`mt-4 grid ${statGridClass} gap-3 text-center`}>
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
            {summary.schemaPendingCount > 0 ? (
              <div>
                <p className="text-xl font-semibold text-foreground">{summary.schemaPendingCount}</p>
                <p className="text-[0.67rem] uppercase tracking-[0.14em] text-muted-foreground">setup</p>
              </div>
            ) : null}
            {summary.unreadableCount > 0 ? (
              <div>
                <p className="text-xl font-semibold text-foreground">{summary.unreadableCount}</p>
                <p className="text-[0.67rem] uppercase tracking-[0.14em] text-muted-foreground">failed</p>
              </div>
            ) : null}
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

      <div id="project-spine-readiness" className="mt-6 scroll-mt-24 border-t border-border/70 pt-6">
        <div className="grid gap-4 lg:grid-cols-[0.86fr_1.14fr]">
          <div className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.45rem] border border-border/70 bg-card text-muted-foreground">
                <ActivitySquare className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Are these lanes up to date?</p>
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
            {firstOperatorCheck ? (
              <div className="mt-4 rounded-[0.55rem] border border-border/70 bg-card/70 p-3 text-sm leading-relaxed">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  First operator check
                </p>
                <p className="mt-1 font-semibold text-foreground">{firstOperatorCheck.label}</p>
                <p className="mt-1 text-muted-foreground">{firstOperatorCheck.detail}</p>
              </div>
            ) : null}
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
      </div>
    </article>
  );
}
