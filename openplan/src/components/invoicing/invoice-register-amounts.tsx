import { storageMoney, type ComparableAward, type ManagedInvoice } from "@/lib/grants/award-handoff";
import { formatMoney } from "@/lib/money/format";

/** The individual record keeps its original currency and terms after amendment. */
export function InvoiceRegisterAmounts({ invoice, award }: { invoice: ManagedInvoice; award?: ComparableAward }) {
  const managed = Boolean(invoice.award_handoff_revision_id || invoice.handoff_applicable_revision_id || invoice.currency_code || award?.latest_handoff_revision_id || award?.current_handoff_revision_id);
  if (!managed && (!invoice.funding_award_id || award)) {
    return <>
      <p className="text-sm font-semibold text-foreground">{formatMoney(Number(invoice.net_amount ?? 0), { precision: "cents" })}</p>
      <p className="text-xs text-muted-foreground">Gross {formatMoney(Number(invoice.amount ?? 0), { precision: "cents" })}{Number(invoice.retention_amount ?? 0) > 0 ? ` · Retention ${formatMoney(Number(invoice.retention_amount), { precision: "cents" })}` : ""}</p>
    </>;
  }
  const currency = invoice.currency_code;
  const bound = Boolean(invoice.award_handoff_revision_id && currency && /^[A-Z]{3}$/.test(currency));
  const amount = (value: number | string | null | undefined) => {
    if (!bound || value == null) return "Unassessed";
    try { return formatMoney(storageMoney(value, "invoice"), { precision: "cents", currency, currencyDisplay: "code" }); }
    catch { return "Unassessed"; }
  };
  const current = award?.current_handoff_revision_id;
  const applicable = Boolean(current && (invoice.award_handoff_revision_id === current || invoice.handoff_applicable_revision_id === current) && currency === award?.currency_code);
  return <>
    <p className="text-sm font-semibold text-foreground">Net {amount(invoice.net_amount)}</p>
    <p className="text-xs text-muted-foreground">Gross {amount(invoice.amount)} · Retention {amount(invoice.retention_amount)}</p>
    <p className="text-xs text-muted-foreground">Original terms {invoice.award_handoff_revision_id ?? "unassessed"}. Currency {currency ?? "unassessed"}.</p>
    <p className="text-xs text-muted-foreground">{applicable ? `Applicable to current terms ${current}${invoice.handoff_applicable_revision_id === current && invoice.award_handoff_revision_id !== current ? " by explicit retained reconciliation" : ""}.` : "Current applicability unassessed. Original amounts do not establish current coverage."}</p>
    {!bound ? <p className="text-xs text-muted-foreground">Amounts unassessed: retained terms version and currency are required.</p> : null}
  </>;
}
