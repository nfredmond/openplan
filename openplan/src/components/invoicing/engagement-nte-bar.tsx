import type { EngagementBilledSummary } from "@/lib/invoicing/receivables";
import { formatInvoiceMoney } from "@/lib/invoicing/invoice-currency";
import { compareMoney } from "@/lib/money/optional-amount";

/** Legacy scalar ceilings carry no retained agreement interpretation. Assess them in contract management. */
export function EngagementNteBar({ summary, currencyCode }: { summary: EngagementBilledSummary; currencyCode?: string | null }) {
  const sourceUnavailable = summary.source && summary.source.state !== "complete";
  const billed = summary.billedToDate === null
    ? sourceUnavailable
      ? `Engagement invoice summary ${summary.source?.state === "pending" ? "pending schema upgrade" : "source unavailable"}. Gross billed and draft positions are unknown.`
      : `Gross billed calculation unavailable (${summary.unavailable?.billedToDate ?? "unavailable"} amount).`
    : `${formatInvoiceMoney(summary.billedToDate, currencyCode)} gross billed before retention.`;
  const ceiling = summary.unavailable?.notToExceed
    ? "Legacy ceiling calculation unavailable (invalid amount); agreement terms unassessed."
    : summary.notToExceed === null
      ? "No legacy ceiling recorded."
      : `Legacy ceiling ${formatInvoiceMoney(summary.notToExceed, currencyCode)}; agreement terms unassessed. Confirm the approved gross-fee basis in contract management.`;
  const draft = sourceUnavailable ? "" : summary.draftedUnbilled === null
    ? ` Draft calculation unavailable (${summary.unavailable?.draftedUnbilled ?? "unavailable"} amount).`
    : compareMoney(summary.draftedUnbilled, 0) > 0
      ? ` ${formatInvoiceMoney(summary.draftedUnbilled, currencyCode)} gross remains in draft.`
      : "";
  return <p className="text-xs text-muted-foreground">{billed} {ceiling}{draft}</p>;
}
