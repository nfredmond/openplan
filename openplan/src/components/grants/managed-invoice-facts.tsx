import type { ManagedInvoiceTotals } from "@/lib/grants/award-handoff";
import { formatMoney } from "@/lib/money/format";
export function ManagedInvoiceFacts({ facts }: { facts: ManagedInvoiceTotals }) {
  const fmt=(v:number|string|null)=>v===null?'Unassessed':formatMoney(v,{precision:'cents',currency:facts.currency,currencyDisplay:'code'});
  return <div className="space-y-1 text-sm"><p>Version-bound register: claimed gross {fmt(facts.grossClaimed)}, paid net {fmt(facts.paid)}, outstanding net {fmt(facts.outstanding)}, draft net {fmt(facts.draft)}.</p>{facts.reasons.map((r)=><p key={r}>{r}</p>)}</div>;
}
