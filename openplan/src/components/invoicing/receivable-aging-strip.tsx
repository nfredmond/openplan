import {
  RECEIVABLE_AGING_BUCKETS,
  type ReceivableAgingBucket,
  type ReceivableAgingSummary,
} from "@/lib/invoicing/receivables";
import { formatMoney } from "@/lib/money/format";

const BUCKET_LABELS: Record<ReceivableAgingBucket, string> = {
  current: "Current",
  days_1_30: "1-30 days",
  days_31_60: "31-60 days",
  days_61_90: "61-90 days",
  days_over_90: "Over 90 days",
};

/**
 * Aging strip for outstanding (sent) client invoices. Purely presentational —
 * no hooks, so it renders inside server and client components alike.
 *
 * Undated invoices are the honesty case this component exists for: a sent
 * invoice without a due date cannot be aged without guessing, so it is called
 * out explicitly instead of being folded into a bucket or dropped.
 */
export function ReceivableAgingStrip({ aging }: { aging: ReceivableAgingSummary }) {
  const bucketTotal = RECEIVABLE_AGING_BUCKETS.reduce(
    (sum, bucket) => sum + aging.buckets[bucket].count,
    0
  );

  if (bucketTotal === 0 && aging.undatedCount === 0) {
    return (
      <p className="text-xs text-muted-foreground">No outstanding invoices to age.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-px border border-border/60 bg-border/80 sm:grid-cols-5">
        {RECEIVABLE_AGING_BUCKETS.map((bucket) => {
          const cell = aging.buckets[bucket];
          const empty = cell.count === 0;
          return (
            <div key={bucket} className="bg-background/70 px-3 py-2">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {BUCKET_LABELS[bucket]}
              </p>
              <p className={`mt-1 text-sm font-semibold ${empty ? "text-muted-foreground" : "text-foreground"}`}>
                {formatMoney(cell.amount, { precision: "cents" })}
              </p>
              <p className="text-xs text-muted-foreground">
                {cell.count} invoice{cell.count === 1 ? "" : "s"}
              </p>
            </div>
          );
        })}
      </div>

      {aging.undatedCount > 0 ? (
        <p className="border-l-2 border-amber-300/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100">
          {aging.undatedCount} outstanding without a due date ({formatMoney(aging.undatedAmount, { precision: "cents" })}) — these
          cannot be aged without guessing, so they sit outside the buckets until a due date is set.
        </p>
      ) : null}
    </div>
  );
}
