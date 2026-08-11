import Link from "next/link";
import { AlertTriangle, TableProperties } from "lucide-react";
import {
  PORTFOLIO_BURN_BASIS_LABELS,
  type ProjectPortfolioSummary,
} from "@/lib/projects/portfolio";
import { formatWorkDeadlineDate } from "@/lib/work/deadlines";

/**
 * The portfolio table on /projects — every project on one screen, with the two
 * facts a card list cannot make comparable: what is due next, and how much of
 * the budget is gone.
 *
 * IT SITS ABOVE THE CARDS AND REPLACES NOTHING. The cards answer "what is this
 * project"; this answers "which of them needs me first".
 *
 * "—" IS A REAL ANSWER HERE, AND IT ALWAYS CARRIES ITS REASON. Every cell that
 * cannot be computed renders an em dash with the reason both as visible text
 * (for the burn column, where the reason is usually actionable — enter a budget)
 * and as a `title` for the deadline column. No cell ever falls back to zero: a
 * summary table is the easiest place in a product to state a falsehood, because
 * one short value has no room for a caveat.
 *
 * SORTED BY WHAT IS WRONG, NOT BY NAME. Overdue work first, then the soonest
 * deadline, then everything whose deadlines could not be read, then the rest.
 * A table sorted alphabetically makes a reader do the triage the table exists to
 * do for them.
 */

function OverdueChip({ count }: { count: number }) {
  // The word "overdue" is in the LABEL, not only in the colour — a table that
  // signals lateness by tone alone is unreadable to anyone who cannot see the
  // difference, and lateness is the one thing this table turns on.
  return (
    <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 text-[0.7rem] font-semibold text-red-700 dark:text-red-300">
      <AlertTriangle className="h-3 w-3" />
      {count} overdue
    </span>
  );
}

function sortKey(row: ProjectPortfolioSummary["rows"][number]): [number, number] {
  const { deadlines } = row;
  if (!deadlines.available) return [2, 0];
  if (deadlines.overdueCount > 0) return [0, -deadlines.overdueCount];
  if (deadlines.next) return [1, new Date(deadlines.next.dueOn).getTime()];
  return [3, 0];
}

export function ProjectPortfolioTable({ summary }: { summary: ProjectPortfolioSummary }) {
  const rows = [...summary.rows].sort((left, right) => {
    const [leftGroup, leftValue] = sortKey(left);
    const [rightGroup, rightValue] = sortKey(right);
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    return leftValue - rightValue;
  });

  return (
    <article className="module-section-surface" id="portfolio-table">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Portfolio</p>
          <h2 className="module-section-title">What each project needs next</h2>
        </div>
        <span className="module-record-chip">
          <TableProperties className="h-3.5 w-3.5" />
          <span>Summarized</span>
          <strong>{rows.length}</strong>
        </span>
      </div>

      {summary.disclosures.length > 0 ? (
        <div className="mt-3 space-y-1 rounded-[0.5rem] border border-border/70 bg-background/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {summary.disclosures.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="module-empty-state mt-4 text-sm">
          No projects to summarize yet. The table fills in as soon as this workspace has one.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-semibold">Project</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Phase</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Next due</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Open dated work</th>
                <th scope="col" className="py-2 font-semibold">Budget used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/40 align-top">
                  <td className="py-2.5 pr-3">
                    <Link
                      href={`/projects/${row.id}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{row.status.replace(/_/g, " ")}</p>
                  </td>
                  <td className="py-2.5 pr-3 text-muted-foreground">
                    {row.deliveryPhase.replace(/_/g, " ")}
                  </td>
                  <td className="py-2.5 pr-3">
                    {!row.deadlines.available ? (
                      <span
                        className="text-muted-foreground"
                        title={row.deadlines.unavailableReason ?? undefined}
                      >
                        —
                      </span>
                    ) : row.deadlines.next ? (
                      <div className="space-y-0.5">
                        <p className="text-foreground">{row.deadlines.next.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.deadlines.next.kind} · {formatWorkDeadlineDate(row.deadlines.next.dueOn)}
                        </p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Nothing dated and open</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {!row.deadlines.available ? (
                      <span
                        className="text-muted-foreground"
                        title={row.deadlines.unavailableReason ?? undefined}
                      >
                        —
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-foreground">{row.deadlines.openDatedCount}</span>
                        {row.deadlines.overdueCount > 0 ? (
                          <OverdueChip count={row.deadlines.overdueCount} />
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5">
                    {row.burn.available && row.burn.burnPercent !== null ? (
                      <div className="space-y-0.5">
                        <p className="text-foreground">{row.burn.burnPercent}%</p>
                        <p className="text-xs text-muted-foreground">
                          {row.burn.basis ? PORTFOLIO_BURN_BASIS_LABELS[row.burn.basis] : ""}
                          {row.burn.coverage === "partial"
                            ? " · some deliverables carry no budget"
                            : ""}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        <p className="text-muted-foreground">—</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {row.burn.unavailableReason}
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
