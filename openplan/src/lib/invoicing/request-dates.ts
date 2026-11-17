/**
 * Dates on a reimbursement request that a funder will question.
 *
 * Costs incurred before an award was obligated, authorized or allocated are
 * generally not reimbursable; the program sources are cited on
 * KI-2026-11-16-139 and in migration 20261117000200. OpenPlan does not know
 * which exception an agreement grants, so this warns and never refuses.
 *
 * Dates are compared as calendar days (YYYY-MM-DD text), never as instants, so
 * the answer does not depend on the server's time zone.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type RequestDateWarning = {
  code: "costs_before_obligation";
  message: string;
};

export function requestCostsBeforeObligation({
  obligatedOn,
  periodStart,
  invoiceDate,
}: {
  obligatedOn: string | null | undefined;
  periodStart: string | null | undefined;
  invoiceDate: string | null | undefined;
}): RequestDateWarning[] {
  if (!obligatedOn || !DATE_ONLY.test(obligatedOn)) return [];
  const start = periodStart && DATE_ONLY.test(periodStart) ? periodStart : null;
  const dated = invoiceDate && DATE_ONLY.test(invoiceDate) ? invoiceDate : null;
  const earliest = start ?? dated;
  if (!earliest || earliest >= obligatedOn) return [];
  const which = start ? "'s period starts" : " is dated";
  return [
    {
      code: "costs_before_obligation",
      message: `This request${which} ${earliest}, before the award was obligated on ${obligatedOn}. Costs before that date are generally not reimbursable unless the agreement allows them.`,
    },
  ];
}
