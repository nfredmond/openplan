import { render } from "@testing-library/react";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONE INVOICE RECORD, TWO SCREENS, AND THE TWO NUMBERS A PLANNER RECONCILES.
 *
 * The defect this file guards: the RTP cycle and registry surfaces summarise
 * paid / outstanding / uninvoiced reimbursement rounded to whole dollars,
 * while the invoicing register renders THE SAME `billing_invoice_records` to
 * the cent. A planner reconciling a draw against a plan got two different
 * numbers for one fact, with nothing on either screen saying which one had
 * been rounded.
 *
 * So the rule, and what is asserted below:
 *
 *   Two surfaces may print the same underlying record differently ONLY if the
 *   rounding surface says, on the screen, that it rounds.
 *
 * Both figures below come from the SAME fixture records through the SAME
 * `summarizeBillingInvoiceRecords`. Nothing here hand-writes a total: a
 * described fixture would let the two screens agree in the test and disagree
 * in the product.
 *
 * ============================================================================
 * THE BROWSER'S LOCALE IS STUBBED FOR THIS WHOLE FILE, ON PURPOSE
 * ============================================================================
 *
 * Four surfaces used to build `Intl.NumberFormat` with an undefined locale,
 * which resolves to the BROWSER's. The same stored measure then rendered one
 * way on a planner's laptop and another on an auditor's. `beforeAll` below
 * replaces `Intl.NumberFormat` so that an undefined locale resolves to de-DE —
 * where the grouping and decimal separators are swapped and the symbol trails
 * the number. Every assertion in this file is therefore also an assertion that
 * the code under test passed an explicit locale.
 *
 * `stubLocaleIsLive` is the negative control. Without it, a stub that had
 * quietly stopped working would let every locale assertion pass for the wrong
 * reason.
 */

/** ICU uses non-breaking spaces around a currency code; assertions normalise. */
const spaces = (value: string) => value.replace(/\s/g, " ");

const BROWSER_LOCALE = "de-DE";
const OriginalNumberFormat = Intl.NumberFormat;

beforeAll(() => {
  const Stub = function (
    this: unknown,
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions
  ) {
    return new OriginalNumberFormat(locales ?? BROWSER_LOCALE, options);
  } as unknown as typeof Intl.NumberFormat;
  Stub.supportedLocalesOf = OriginalNumberFormat.supportedLocalesOf;
  Intl.NumberFormat = Stub;
});

afterAll(() => {
  Intl.NumberFormat = OriginalNumberFormat;
});

const createClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

/**
 * One register, three records. The amounts are deliberately NOT whole dollars:
 * a fixture of round numbers cannot tell a rounding surface from an exact one.
 */
const INVOICE_RECORDS = [
  { status: "submitted", amount: 12000.34, retention_percent: 0, retention_amount: 0, due_date: null },
  { status: "approved_for_payment", amount: 345.33, retention_percent: 0, retention_amount: 0, due_date: null },
  { status: "paid", amount: 9000.5, retention_percent: 0, retention_amount: 0, due_date: null },
];

function supabaseReturning(records: unknown[]) {
  const limit = vi.fn(async () => ({ data: records, error: null }));
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  return {
    from: vi.fn((table: string) => {
      if (table === "billing_invoice_records") return { select };
      // The strip reads the receivable side too; an empty read renders its
      // own honest empty state and does not touch the reimbursement figure.
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(async () => ({ data: [], error: null })) })) })),
        })),
      };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("one invoice figure, two surfaces", () => {
  it("stubLocaleIsLive: a formatter built without a locale really does format in de-DE", () => {
    // The negative control. If this fails, every locale assertion below is
    // green for the wrong reason and proves nothing.
    const naive = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(1234.5);
    expect(naive).not.toContain("$1,234.50");
  });

  it("renders the ledger to the cent and the plan summary rounded, and the plan summary says it rounds", async () => {
    const { summarizeBillingInvoiceRecords } = await import("@/lib/invoicing/invoice-records");
    const { InvoicingCashStrip } = await import("@/app/(app)/invoicing/_components/invoicing-cash-strip");
    const { RtpRegistryOverview } = await import("@/app/(app)/rtp/_components/rtp-registry-overview");
    const { ROUNDED_MONEY_NOTE_RECONCILES_TO_LEDGER } = await import("@/lib/money/format");

    // ONE derivation, feeding both screens — the same call the RTP cycle page
    // reaches through `summarizeProjectFundingStack`.
    const summary = summarizeBillingInvoiceRecords(INVOICE_RECORDS);
    expect(summary.outstandingNetAmount).toBeCloseTo(12345.67, 2);

    createClientMock.mockResolvedValue(supabaseReturning(INVOICE_RECORDS));
    const { container: ledger } = render(await InvoicingCashStrip({ workspaceId: "w1" }));
    const ledgerText = ledger.textContent ?? "";

    const { container: plan } = render(
      <RtpRegistryOverview
        cycleCount={1}
        draftCount={1}
        publicReviewCount={0}
        adoptedCount={0}
        readyFoundationCount={1}
        linkedProjectCount={1}
        fundedProjectCount={0}
        likelyCoveredProjectCount={0}
        unfundedProjectCount={1}
        paidReimbursementTotal={summary.paidNetAmount}
        outstandingReimbursementTotal={summary.outstandingNetAmount}
        uninvoicedAwardTotal={0}
      />
    );
    const planText = plan.textContent ?? "";

    // The ledger is exact.
    expect(ledgerText).toContain("$12,345.67");
    // The plan summary rounds…
    expect(planText).toContain("$12,346");
    expect(planText).not.toContain("$12,345.67");
    // …and therefore must say so, on the screen, beside the figures.
    expect(planText).toContain(ROUNDED_MONEY_NOTE_RECONCILES_TO_LEDGER);

    // Stated as the rule rather than as two literals, so a future surface that
    // switches to exact cents also passes — reconcile OR disclose.
    const reconciles = ledgerText.includes("$12,345.67") && planText.includes("$12,345.67");
    expect(reconciles || planText.includes(ROUNDED_MONEY_NOTE_RECONCILES_TO_LEDGER)).toBe(true);
  });

  it("writes both figures in the pinned locale even though the browser's is de-DE", async () => {
    const { summarizeBillingInvoiceRecords } = await import("@/lib/invoicing/invoice-records");
    const { InvoicingCashStrip } = await import("@/app/(app)/invoicing/_components/invoicing-cash-strip");
    const { RtpRegistryOverview } = await import("@/app/(app)/rtp/_components/rtp-registry-overview");

    const summary = summarizeBillingInvoiceRecords(INVOICE_RECORDS);
    createClientMock.mockResolvedValue(supabaseReturning(INVOICE_RECORDS));

    const { container: ledger } = render(await InvoicingCashStrip({ workspaceId: "w1" }));
    const { container: plan } = render(
      <RtpRegistryOverview
        cycleCount={1}
        draftCount={1}
        publicReviewCount={0}
        adoptedCount={0}
        readyFoundationCount={1}
        linkedProjectCount={1}
        fundedProjectCount={0}
        likelyCoveredProjectCount={0}
        unfundedProjectCount={1}
        paidReimbursementTotal={summary.paidNetAmount}
        outstandingReimbursementTotal={summary.outstandingNetAmount}
        uninvoicedAwardTotal={0}
      />
    );

    // de-DE would render "12.345,67 $" — a different string entirely.
    expect(ledger.textContent).toContain("$12,345.67");
    expect(ledger.textContent).not.toContain("12.345,67");
    expect(plan.textContent).toContain("$12,346");
    expect(plan.textContent).not.toContain("12.346");
  });
});

describe("the amount's own currency drives the formatting", () => {
  it("writes a measure's claim ledger in the profile's currency, not the browser's", async () => {
    const { formatMoney } = await import("@/lib/money/format");

    // A measure profile that declares euros. The figure is the agency's; the
    // machine reading it is irrelevant.
    expect(formatMoney(1234.5, { precision: "cents", currency: "EUR" })).toBe("€1,234.50");
    // …and the same figure in the default currency, from the same machine.
    expect(formatMoney(1234.5, { precision: "cents" })).toBe("$1,234.50");
  });

  it("does not invent cents for a currency that has none", async () => {
    const { formatMoney } = await import("@/lib/money/format");
    // "¥1,234.50" would state a precision the money does not have.
    expect(formatMoney(1234.5, { precision: "cents", currency: "JPY" })).toBe("¥1,235");
  });

  it("prints the code beside the number rather than 500ing on a typo'd currency", async () => {
    const { formatMoney, isSupportedCurrency } = await import("@/lib/money/format");

    // A well-formed but unassigned code is NOT a RangeError — ICU accepts any
    // three-letter code and prints it in place of a symbol. Every
    // `currency_code` column carries a `^[A-Z]{3}$` CHECK, so the catch
    // branches the old per-file formatters carried for this case could never
    // fire from the database. The behaviour they wanted was already the
    // platform's, and it is asserted here so nobody "fixes" it back.
    expect(isSupportedCurrency("USF")).toBe(true);
    // ICU separates the code from the number with a NARROW NO-BREAK SPACE, so
    // the assertion normalises whitespace rather than pretending it is a space.
    expect(spaces(formatMoney(1234.5, { precision: "cents", currency: "USF" }))).toBe("USF 1,234.50");

    // A MALFORMED code is the one Intl refuses — reachable from an import or a
    // request body, which no CHECK constraint sees. Never a silent
    // substitution to USD: that would MISLABEL the unit on every figure.
    expect(isSupportedCurrency("US")).toBe(false);
    expect(spaces(formatMoney(1234.5, { precision: "cents", currency: "US" }))).toBe("US 1,234.50");
  });
});

describe("formatMoney precision", () => {
  it("requires the caller to choose, and rounds only when asked", async () => {
    const { formatMoney } = await import("@/lib/money/format");
    expect(formatMoney(1234.5, { precision: "whole" })).toBe("$1,235");
    expect(formatMoney(1234.5, { precision: "cents" })).toBe("$1,234.50");
    // `auto` is the RTP financial-element spelling: whole dollars written
    // whole, but a floating-point 0.30000000000000004 written to the cent
    // rather than as "$0.3".
    expect(formatMoney(1200000, { precision: "auto" })).toBe("$1,200,000");
    expect(formatMoney(0.1 + 0.2, { precision: "auto" })).toBe("$0.30");
  });

  it("keeps an absent amount absent instead of turning it into zero", async () => {
    const { formatMoney } = await import("@/lib/money/format");
    expect(formatMoney(null, { precision: "cents" })).toBe("Not recorded");
    expect(formatMoney(undefined, { precision: "whole" })).toBe("Not recorded");
    // The empty string is the dangerous one: `Number("")` is a confident zero.
    expect(formatMoney("", { precision: "cents" })).toBe("Not recorded");
    expect(formatMoney("not a number", { precision: "cents", absent: "N/A" })).toBe("N/A");
    // A real zero is a recorded fact and still reads as one.
    expect(formatMoney(0, { precision: "cents" })).toBe("$0.00");
  });
});

describe("formatMoneyRange", () => {
  it("writes a band, collapses a certain one, and refuses a half-known one", async () => {
    const { formatMoneyRange } = await import("@/lib/money/format");
    expect(formatMoneyRange(-4000, 12000, { precision: "whole" })).toBe("-$4,000–$12,000");
    // Reversed input is still a band, not a negative-width one.
    expect(formatMoneyRange(12000, -4000, { precision: "whole" })).toBe("-$4,000–$12,000");
    // "$4,000–$4,000" reads as a data error, not as a certain estimate.
    expect(formatMoneyRange(4000, 4000, { precision: "whole" })).toBe("$4,000");
    // Half a range is not a range.
    expect(formatMoneyRange(4000, null, { precision: "whole" })).toBe("Not recorded");
  });
});
