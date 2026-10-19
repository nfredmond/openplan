import type { AwardDrawdownLedger } from "@/lib/invoicing/drawdown-ledger";
import { formatMoney } from "@/lib/money/format";
import { subtractMoney, type ExactMoneyAmount } from "@/lib/money/optional-amount";
export function ManagedAwardLedgerFacts({ ledger }: { ledger: NonNullable<AwardDrawdownLedger['managed']> }) {
  const { funding, invoices } = ledger;
  const amount = (v: ExactMoneyAmount | null) => v === null ? 'Unassessed' : formatMoney(v,{ precision:'cents',currency:funding.currency,currencyDisplay:'code' });
  return <div className="text-sm space-y-1"><p>Recorded award ceiling {amount(funding.ceiling)}. Claimed gross {amount(invoices.grossClaimed)}. Paid net {amount(invoices.paid)}.</p><p>Remaining against recorded award ceiling {amount(funding.ceiling !== null && invoices.grossClaimed !== null ? subtractMoney(funding.ceiling,invoices.grossClaimed) : null)}.</p>{[...funding.reasons,...invoices.reasons].map((r) => <p key={r}>{r}</p>)}<p>Authorization amount is separate. Review the retained terms for its actual state, scope, period and evidence.</p></div>;
}
