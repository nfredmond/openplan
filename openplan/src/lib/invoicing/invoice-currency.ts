import { formatMoney, isSupportedCurrency } from "@/lib/money/format";
import { moneyCents } from "@/lib/money/optional-amount";

export const ENGAGEMENT_CURRENCY_DISCLOSURE = "Aggregate currency, legacy ceiling currency and currency agreement across invoices are unassessed. This is a numerical comparison only; agreement terms are unassessed.";

/** Legacy engagement context has no assessed currency, regardless of the current invoice. */
export function formatEngagementMoney(amount: number | string | null | undefined): string {
  return formatInvoiceMoney(amount, null);
}

/** Invoice previews and retained documents keep the stated currency and exact cents. */
export function formatInvoiceMoney(amount: number | string | null | undefined, currencyCode: string | null | undefined): string {
  if (amount == null) return "Not recorded";
  let cents: bigint;
  try {
    cents = moneyCents(amount);
  } catch {
    return "Amount unavailable";
  }
  const code = currencyCode?.trim();
  if (code && isSupportedCurrency(code)) {
    return formatMoney(amount, { precision: "cents", currency: code });
  }
  // Unassessed currency keeps its literal label. No number conversion may
  // discard aggregate cents on this fallback path.
  const magnitude = cents < BigInt(0) ? -cents : cents;
  const text = `${cents < BigInt(0) ? "-" : ""}${magnitude / BigInt(100)}.${String(magnitude % BigInt(100)).padStart(2, "0")}`;
  return `${text} ${code || "(currency unassessed)"}`;
}
