import type { EngagementBilledSummary } from "@/lib/invoicing/receivables";
import { formatMoney } from "@/lib/money/format";

/**
 * Billed-to-date position of one engagement against its not-to-exceed
 * ceiling. Purely presentational — no hooks, renders in server components.
 *
 * An over-NTE position renders in a warning tone and names the overrun; it
 * never blocks anything. Real engagements bill over their ceiling under
 * amendments, and hiding or forbidding that would misstate the ledger.
 */
export function EngagementNteBar({ summary }: { summary: EngagementBilledSummary }) {
  if (summary.notToExceed === null) {
    return (
      <p className="text-xs text-muted-foreground">
        {formatMoney(summary.billedToDate, { precision: "cents" })} billed to date · no not-to-exceed ceiling recorded.
        {summary.draftedUnbilled > 0 ? ` ${formatMoney(summary.draftedUnbilled, { precision: "cents" })} more sits in draft.` : ""}
      </p>
    );
  }

  const ratio = summary.notToExceed > 0 ? summary.billedToDate / summary.notToExceed : summary.billedToDate > 0 ? 1 : 0;
  const widthPercent = Math.max(0, Math.min(100, Math.round(ratio * 100)));

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={summary.isOverNte ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>
          {formatMoney(summary.billedToDate, { precision: "cents" })} billed of {formatMoney(summary.notToExceed, { precision: "cents" })} not-to-exceed
        </span>
        <span className="text-muted-foreground">
          {summary.isOverNte
            ? `Over by ${formatMoney(summary.billedToDate - summary.notToExceed, { precision: "cents" })}`
            : `${formatMoney(summary.remaining ?? 0, { precision: "cents" })} remaining`}
        </span>
      </div>
      <div className="h-1.5 w-full border border-border/60 bg-background/70" role="presentation">
        <div
          className={summary.isOverNte ? "h-full bg-amber-500/80" : "h-full bg-[color:var(--pine)]/70"}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
      {summary.isOverNte ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          This engagement is billed past its not-to-exceed ceiling. Recorded as a warning — nothing is blocked;
          confirm an amendment covers the overrun.
        </p>
      ) : null}
      {summary.draftedUnbilled > 0 ? (
        <p className="text-xs text-muted-foreground">
          {formatMoney(summary.draftedUnbilled, { precision: "cents" })} more is composed in draft invoices and not yet billed.
        </p>
      ) : null}
    </div>
  );
}
