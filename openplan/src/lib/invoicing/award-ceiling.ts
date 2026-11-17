import {
  isClaimedInvoiceStatus,
  parseCurrencyAmount,
  roundCurrencyAmount,
} from "@/lib/invoicing/invoice-records";

/**
 * Whether counting one more request as claimed would take an award's claims
 * above its recorded ceiling (KI-2026-11-16-131).
 *
 * Claimed means the drawdown ledger's own statuses (`CLAIMED_INVOICE_STATUSES`)
 * and gross amounts, so the refusal and the worksheet's "Claimed to date
 * (gross)" use one definition. `otherInvoices` is the award's complete
 * invoice set; the request being moved is passed separately and left out of
 * that set by id, so a request already counted is never counted twice.
 *
 * An award with no ceiling entered (0 or empty, which the column cannot tell
 * apart) has nothing to exceed, and answers null.
 */
export type AwardCeilingCheck = {
  ceiling: number;
  claimedBefore: number;
  claimedAfter: number;
  excess: number;
};

function grossAmount(value: number | string | null | undefined): number {
  return roundCurrencyAmount(Math.max(0, parseCurrencyAmount(value)));
}

export function checkClaimAgainstAwardCeiling({
  awardedAmount,
  invoiceId,
  invoiceAmount,
  otherInvoices,
}: {
  awardedAmount: number | string | null | undefined;
  invoiceId: string;
  invoiceAmount: number | string | null | undefined;
  otherInvoices: Array<{ id: string; status: string | null; amount: number | string | null }>;
}): AwardCeilingCheck | null {
  const ceiling = roundCurrencyAmount(parseCurrencyAmount(awardedAmount));
  if (!(ceiling > 0)) return null;
  const claimedBefore = otherInvoices
    .filter((invoice) => invoice.id !== invoiceId && isClaimedInvoiceStatus(invoice.status ?? ""))
    .reduce((sum, invoice) => roundCurrencyAmount(sum + grossAmount(invoice.amount)), 0);
  const claimedAfter = roundCurrencyAmount(claimedBefore + grossAmount(invoiceAmount));
  if (claimedAfter <= ceiling) return null;
  return { ceiling, claimedBefore, claimedAfter, excess: roundCurrencyAmount(claimedAfter - ceiling) };
}
