import type { EngagementBilledSummary } from "@/lib/invoicing/receivables";
import { formatMoney } from "@/lib/money/format";
/** Legacy scalar ceilings carry no retained agreement interpretation. Assess them in contract management. */
export function EngagementNteBar({summary}:{summary:EngagementBilledSummary}) {
 return <p className="text-xs text-muted-foreground">{formatMoney(summary.billedToDate,{precision:"cents"})} gross billed before retention. {summary.notToExceed===null?"No legacy ceiling recorded.":`Legacy ceiling ${formatMoney(summary.notToExceed,{precision:"cents"})}; agreement terms unassessed. Confirm the approved gross-fee basis in contract management.`}{summary.draftedUnbilled>0?` ${formatMoney(summary.draftedUnbilled,{precision:"cents"})} gross remains in draft.`:""}</p>;
}
