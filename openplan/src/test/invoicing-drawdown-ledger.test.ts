import { describe, expect, it } from "vitest";

import { evaluateFundingAwardCloseoutCoverage } from "@/app/api/funding-awards/[awardId]/award-closure";
import {
  buildAwardDrawdownLedger,
  toDrawdownInvoiceRead,
  type DrawdownInvoiceLike,
} from "@/lib/invoicing/drawdown-ledger";
import {
  computeInvoiceRetentionWithheld,
  computeNetInvoiceAmount,
  roundCurrencyAmount,
} from "@/lib/invoicing/invoice-records";

/**
 * THE DRAWDOWN LEDGER'S WORKED EXAMPLE.
 *
 * Every expected value below was derived by hand from the fixture and written
 * down BEFORE the module was run — not pasted out of its output. That
 * distinction is the whole point: a fixture whose expectations came from the
 * code under test asserts only that the code is deterministic.
 *
 * The award: $250,000 authorized, $32,362.50 local match, match secured.
 * Seven invoices claimed against it:
 *
 *   #  status                gross      pct  ret.amt   → retention      net
 *   1  paid                  80,000.00    5     0.00      4,000.00  76,000.00
 *   2  paid                  42,500.50    0 1,000.00      1,000.00  41,500.50
 *   3  approved_for_payment  33,333.33   10     0.00      3,333.33  30,000.00
 *   4  submitted             12,000.00    0     0.00          0.00  12,000.00
 *   5  draft                  9,000.00    0     0.00          0.00   9,000.00
 *   6  rejected              55,000.00    0     0.00          0.00  55,000.00
 *   7  paid (no paid_date)   10,000.00    5     0.00        500.00   9,500.00
 *
 *   claimedGrossToDate  = 80,000.00 + 42,500.50 + 33,333.33 + 12,000.00 + 10,000.00
 *                       = 177,833.83          (5 and 6 are excluded)
 *   paidToDate          = 76,000.00 + 41,500.50 + 9,500.00 = 127,000.50
 *   outstandingClaimed  = 30,000.00 + 12,000.00            =  42,000.00
 *   retentionHeld       =  4,000.00 +  1,000.00 +   500.00 =   5,500.00  (paid only)
 *   retentionPending    =  3,333.33 +      0.00            =   3,333.33
 *   remainingAuthorized = 250,000.00 - 177,833.83          =  72,166.17
 *
 * Invoice 1 ships with a POISONED stored `net_amount` of 0. The schema's
 * `net_amount` is a plain `NUMERIC DEFAULT 0` that any writer can leave at
 * zero, and trusting it once already produced two different amounts for one
 * planner's money. Leaving the poison in the fixture permanently means a future
 * edit that starts reading the column drops $76,000 from `paidToDate` and this
 * file says so, rather than a one-off mutation catching it once.
 */
const AWARD = {
  awarded_amount: "250000.00",
  match_amount: "32362.50",
  match_posture: "secured",
};

const INVOICES: DrawdownInvoiceLike[] = [
  {
    id: "inv-1",
    invoice_number: "RB-2026-001",
    status: "paid",
    amount: "80000.00",
    retention_percent: "5.00",
    retention_amount: "0.00",
    net_amount: "0.00",
    invoice_date: "2026-04-01",
    due_date: "2026-05-01",
    paid_date: "2026-05-02",
  },
  {
    id: "inv-2",
    invoice_number: "RB-2026-002",
    status: "paid",
    amount: "42500.50",
    retention_percent: "0.00",
    retention_amount: "1000.00",
    net_amount: "41500.50",
    invoice_date: "2026-04-15",
    due_date: "2026-05-15",
    paid_date: "2026-05-20",
  },
  {
    id: "inv-3",
    invoice_number: "RB-2026-003",
    status: "approved_for_payment",
    amount: "33333.33",
    retention_percent: "10.00",
    retention_amount: "0.00",
    net_amount: "30000.00",
    invoice_date: "2026-05-01",
    due_date: "2026-06-01",
    paid_date: null,
  },
  {
    id: "inv-4",
    invoice_number: "RB-2026-004",
    status: "submitted",
    amount: "12000.00",
    retention_percent: "0.00",
    retention_amount: "0.00",
    net_amount: "12000.00",
    invoice_date: "2026-05-15",
    due_date: "2026-06-15",
    paid_date: null,
  },
  {
    id: "inv-5",
    invoice_number: "RB-2026-005",
    status: "draft",
    amount: "9000.00",
    retention_percent: "0.00",
    retention_amount: "0.00",
    net_amount: "9000.00",
    invoice_date: null,
    due_date: null,
    paid_date: null,
  },
  {
    id: "inv-6",
    invoice_number: "RB-2026-006",
    status: "rejected",
    amount: "55000.00",
    retention_percent: "0.00",
    retention_amount: "0.00",
    net_amount: "55000.00",
    invoice_date: "2026-03-01",
    due_date: "2026-04-01",
    paid_date: null,
  },
  {
    id: "inv-7",
    invoice_number: "RB-2026-007",
    status: "paid",
    amount: "10000.00",
    retention_percent: "5.00",
    retention_amount: "0.00",
    net_amount: "9500.00",
    invoice_date: "2026-06-01",
    due_date: "2026-07-01",
    paid_date: null,
  },
];

function buildFixtureLedger(overrides?: {
  award?: Partial<typeof AWARD>;
  invoices?: DrawdownInvoiceLike[];
}) {
  const result = buildAwardDrawdownLedger({
    award: { ...AWARD, ...(overrides?.award ?? {}) },
    invoiceRead: { ok: true, invoices: overrides?.invoices ?? INVOICES },
  });

  if (!result.ok) {
    throw new Error(`expected a ledger, got read failure: ${result.message}`);
  }

  return result.ledger;
}

describe("award drawdown ledger — the worked example", () => {
  it("reports every drawdown figure to the exact cent", () => {
    const { lines, ...totals } = buildFixtureLedger();

    expect(totals).toEqual({
      authorizedAmount: 250000.0,
      matchAmount: 32362.5,
      matchPosture: "secured",
      claimedGrossToDate: 177833.83,
      claimedCount: 5,
      paidToDate: 127000.5,
      paidCount: 3,
      paidWithNoDateCount: 1,
      outstandingClaimed: 42000.0,
      outstandingCount: 2,
      retentionHeld: 5500.0,
      retentionPendingOnUnpaid: 3333.33,
      draftedNotClaimed: 9000.0,
      draftedCount: 1,
      rejectedGross: 55000.0,
      rejectedCount: 1,
      remainingAuthorized: 72166.17,
    });

    expect(lines).toHaveLength(7);
  });

  it("states each invoice's gross, retention and net independently of the stored net_amount column", () => {
    const { lines } = buildFixtureLedger();

    expect(
      lines.map((line) => [line.invoiceNumber, line.grossAmount, line.retentionWithheld, line.netAmount])
    ).toEqual([
      ["RB-2026-001", 80000.0, 4000.0, 76000.0],
      ["RB-2026-002", 42500.5, 1000.0, 41500.5],
      ["RB-2026-003", 33333.33, 3333.33, 30000.0],
      ["RB-2026-004", 12000.0, 0, 12000.0],
      ["RB-2026-005", 9000.0, 0, 9000.0],
      ["RB-2026-006", 55000.0, 0, 55000.0],
      ["RB-2026-007", 10000.0, 500.0, 9500.0],
    ]);

    // Invoice 1's stored net_amount is 0 in the fixture. If the ledger ever
    // reads that column instead of recomputing, this line and paidToDate both
    // collapse.
    expect(lines[0]?.netAmount).toBe(76000.0);
  });

  it("marks which rows the claimed and paid totals were built from", () => {
    const { lines } = buildFixtureLedger();

    expect(lines.map((line) => [line.invoiceNumber, line.isClaimed, line.isPaid])).toEqual([
      ["RB-2026-001", true, true],
      ["RB-2026-002", true, true],
      ["RB-2026-003", true, false],
      ["RB-2026-004", true, false],
      ["RB-2026-005", false, false],
      ["RB-2026-006", false, false],
      ["RB-2026-007", true, true],
    ]);
  });

  it("keeps a rejected claim out of every total and still reports it", () => {
    const withoutRejected = buildFixtureLedger({
      invoices: INVOICES.filter((invoice) => invoice.status !== "rejected"),
    });
    const withRejected = buildFixtureLedger();

    // Removing the rejected invoice changes nothing that was folded in...
    expect(withoutRejected.claimedGrossToDate).toBe(withRejected.claimedGrossToDate);
    expect(withoutRejected.paidToDate).toBe(withRejected.paidToDate);
    expect(withoutRejected.remainingAuthorized).toBe(withRejected.remainingAuthorized);
    // ...but the $55,000 the funder refused is still on the ledger where a
    // planner can see it, rather than vanishing into a zero.
    expect(withRejected.rejectedGross).toBe(55000.0);
    expect(withRejected.rejectedCount).toBe(1);
    expect(withoutRejected.rejectedGross).toBe(0);
    expect(withoutRejected.rejectedCount).toBe(0);
  });

  it("keeps a draft out of the claimed total and still reports it", () => {
    const withoutDraft = buildFixtureLedger({
      invoices: INVOICES.filter((invoice) => invoice.status !== "draft"),
    });

    expect(withoutDraft.claimedGrossToDate).toBe(177833.83);
    expect(withoutDraft.draftedNotClaimed).toBe(0);
    expect(buildFixtureLedger().draftedNotClaimed).toBe(9000.0);
  });

  it("counts retention as held only where a payment actually happened", () => {
    const ledger = buildFixtureLedger();

    // 4,000.00 + 1,000.00 + 500.00 on the three paid invoices. The 3,333.33 on
    // the approved-for-payment invoice has not been withheld from anything yet.
    expect(ledger.retentionHeld).toBe(5500.0);
    expect(ledger.retentionPendingOnUnpaid).toBe(3333.33);
    expect(roundCurrencyAmount(ledger.retentionHeld + ledger.retentionPendingOnUnpaid)).toBe(8833.33);
  });

  it("counts a paid invoice with no recorded payment date, and says how many", () => {
    const ledger = buildFixtureLedger();

    // Invoice 7 is paid with a null paid_date: the money arrived, the date is
    // unrecorded. It is in paidToDate and it is disclosed.
    expect(ledger.paidCount).toBe(3);
    expect(ledger.paidWithNoDateCount).toBe(1);
    expect(ledger.lines.find((line) => line.invoiceNumber === "RB-2026-007")?.paidDate).toBeNull();
    expect(ledger.paidToDate).toBe(127000.5);
  });

  it("treats an empty payment date as unrecorded rather than as a date", () => {
    // A blank text input round-trips as "" through more than one write path.
    // Rendering "Paid on " with nothing after it is a worse lie than saying the
    // date was never recorded.
    const ledger = buildFixtureLedger({
      invoices: INVOICES.map((invoice) =>
        invoice.id === "inv-1" ? { ...invoice, paid_date: "" } : invoice
      ),
    });

    expect(ledger.lines[0]?.paidDate).toBeNull();
    expect(ledger.paidWithNoDateCount).toBe(2);
    expect(ledger.paidToDate).toBe(127000.5);
  });

  it("agrees with the close-out evaluator about what has been paid", async () => {
    // Two modules deriving "paid to date" from the same rows must not be able
    // to disagree. The close-out evaluator is what decides whether an award may
    // be closed; the ledger is what a planner reads. Different numbers there is
    // the defect this assertion exists to prevent.
    const evaluation = await evaluateFundingAwardCloseoutCoverage({
      supabase: fakeInvoiceClient({ data: INVOICES }),
      award: {
        id: "award-1",
        workspace_id: "workspace-1",
        project_id: "project-1",
        title: "Corridor safety improvements",
        awarded_amount: AWARD.awarded_amount,
        spending_status: "active",
      },
    });

    expect(evaluation.outcome).toBe("evaluated");
    if (evaluation.outcome !== "evaluated") return;

    expect(evaluation.coverage.paidAmount).toBe(buildFixtureLedger().paidToDate);
    expect(evaluation.coverage.paidAmount).toBe(127000.5);
  });
});

describe("award drawdown ledger — authorization edges", () => {
  it("reports an over-claim as a negative remainder rather than clamping it to zero", () => {
    const ledger = buildAwardDrawdownLedger({
      award: { awarded_amount: "10000.00", match_amount: "0.00", match_posture: "not_required" },
      invoiceRead: {
        ok: true,
        invoices: [
          {
            id: "inv-over",
            invoice_number: "RB-OVER",
            status: "paid",
            amount: "12000.00",
            retention_percent: "0.00",
            retention_amount: "0.00",
            paid_date: "2026-06-01",
          },
        ],
      },
    });

    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;

    expect(ledger.ledger.authorizedAmount).toBe(10000.0);
    expect(ledger.ledger.claimedGrossToDate).toBe(12000.0);
    // Clamping this at 0 would print "fully drawn down" over a $2,000 overage.
    expect(ledger.ledger.remainingAuthorized).toBe(-2000.0);
  });

  it("refuses to treat an unrecorded award amount as a zero-dollar award", () => {
    const ledger = buildFixtureLedger({ award: { awarded_amount: "0.00", match_amount: "0.00" } });

    expect(ledger.authorizedAmount).toBeNull();
    expect(ledger.remainingAuthorized).toBeNull();
    expect(ledger.matchAmount).toBeNull();
    // The claims themselves are still real and still reported.
    expect(ledger.claimedGrossToDate).toBe(177833.83);
  });

  it("carries the match posture so a zero match can be told apart from an unrecorded one", () => {
    const notRequired = buildFixtureLedger({
      award: { awarded_amount: "250000.00", match_amount: "0.00", match_posture: "not_required" },
    });
    const notEnteredYet = buildFixtureLedger({
      award: { awarded_amount: "250000.00", match_amount: "0.00", match_posture: "partial" },
    });

    expect(notRequired.matchAmount).toBeNull();
    expect(notRequired.matchPosture).toBe("not_required");
    expect(notEnteredYet.matchAmount).toBeNull();
    expect(notEnteredYet.matchPosture).toBe("partial");
  });

  it("computes no ledger at all when there is no award row", () => {
    const ledger = buildAwardDrawdownLedger({ award: null, invoiceRead: { ok: true, invoices: [] } });

    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    expect(ledger.ledger.authorizedAmount).toBeNull();
    expect(ledger.ledger.matchPosture).toBeNull();
    expect(ledger.ledger.remainingAuthorized).toBeNull();
  });
});

describe("award drawdown ledger — a failed read is never a ledger of zeros", () => {
  it("returns the failure instead of a complete-looking $0 position", () => {
    const result = buildAwardDrawdownLedger({
      award: AWARD,
      invoiceRead: toDrawdownInvoiceRead({ error: { message: "connection terminated unexpectedly" } }),
    });

    expect(result).toEqual({
      ok: false,
      pending: false,
      message: "connection terminated unexpectedly",
    });
    expect(result).not.toHaveProperty("ledger");
  });

  it("marks an unapplied migration as a setup gap rather than a fault", () => {
    const result = toDrawdownInvoiceRead({
      error: { message: "column billing_invoice_records.paid_date does not exist" },
    });

    expect(result).toEqual({
      ok: false,
      pending: true,
      message: "column billing_invoice_records.paid_date does not exist",
    });
  });

  it("does not let rows that arrived alongside an error pass as a complete read", () => {
    // PostgREST can hand back a partial body with an error on it. Rows plus an
    // error is not a read that succeeded — a ledger built from the rows that
    // happened to arrive is a total presented as complete when it is not.
    const result = toDrawdownInvoiceRead({
      data: [{ id: "inv-1", status: "paid", amount: "80000.00" }],
      error: { message: "canceling statement due to statement timeout" },
    });

    expect(result).toEqual({
      ok: false,
      pending: false,
      message: "canceling statement due to statement timeout",
    });
    expect(buildAwardDrawdownLedger({ award: AWARD, invoiceRead: result }).ok).toBe(false);
  });

  it("treats a genuinely empty invoice list as an empty ledger, not a failure", () => {
    const result = toDrawdownInvoiceRead({ data: [] });
    expect(result).toEqual({ ok: true, invoices: [] });

    const ledger = buildAwardDrawdownLedger({ award: AWARD, invoiceRead: result });
    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    expect(ledger.ledger.claimedGrossToDate).toBe(0);
    expect(ledger.ledger.remainingAuthorized).toBe(250000.0);
    expect(ledger.ledger.lines).toEqual([]);
  });
});

describe("retention withheld and net amount are one rule, not two", () => {
  const rows: Array<{
    label: string;
    amount: number | string | null;
    retentionAmount?: number | string | null;
    retentionPercent?: number | string | null;
    expectedRetention: number;
    expectedNet: number;
  }> = [
    { label: "percentage retention", amount: "33333.33", retentionPercent: "10", expectedRetention: 3333.33, expectedNet: 30000.0 },
    { label: "explicit amount wins over a zero percentage", amount: "42500.50", retentionAmount: "1000.00", retentionPercent: "0", expectedRetention: 1000.0, expectedNet: 41500.5 },
    { label: "explicit amount wins over a non-zero percentage", amount: "8000", retentionAmount: "250", retentionPercent: "5", expectedRetention: 250.0, expectedNet: 7750.0 },
    { label: "no retention at all", amount: "12000.00", expectedRetention: 0, expectedNet: 12000.0 },
    { label: "retention larger than the invoice is clamped to the invoice", amount: "100.00", retentionAmount: "250.00", expectedRetention: 100.0, expectedNet: 0 },
    { label: "full retention at 100 percent", amount: "500.00", retentionPercent: "100", expectedRetention: 500.0, expectedNet: 0 },
    { label: "an unparseable amount is zero, not NaN", amount: "not a number", retentionPercent: "5", expectedRetention: 0, expectedNet: 0 },
    { label: "a missing amount is zero", amount: null, retentionPercent: "5", expectedRetention: 0, expectedNet: 0 },
    { label: "half-cent rounding", amount: "100.005", retentionPercent: "5", expectedRetention: 5.0, expectedNet: 95.01 },
  ];

  it.each(rows)("$label", ({ amount, retentionAmount, retentionPercent, expectedRetention, expectedNet }) => {
    const retention = computeInvoiceRetentionWithheld(amount, retentionAmount, retentionPercent);
    const net = computeNetInvoiceAmount(amount, retentionAmount, retentionPercent);

    expect(retention).toBe(expectedRetention);
    expect(net).toBe(expectedNet);
  });

  it("keeps gross minus retention equal to net on every row a worksheet can print", () => {
    // A worksheet prints all three columns. If they stop adding up, the
    // document is arithmetically wrong on its face.
    for (const row of rows) {
      const gross = Math.max(0, Number.parseFloat(String(row.amount ?? "0")) || 0);
      const retention = computeInvoiceRetentionWithheld(row.amount, row.retentionAmount, row.retentionPercent);
      const net = computeNetInvoiceAmount(row.amount, row.retentionAmount, row.retentionPercent);

      expect(roundCurrencyAmount(gross - retention)).toBe(net);
    }
  });

  it("holds the same identity across every fixture invoice in the ledger", () => {
    for (const line of buildFixtureLedger().lines) {
      expect(roundCurrencyAmount(line.grossAmount - line.retentionWithheld)).toBe(line.netAmount);
    }
  });
});

/**
 * The narrowest client `evaluateFundingAwardCloseoutCoverage` can be handed: it
 * records the filters so the cross-check cannot pass by reading some other
 * workspace's rows.
 */
function fakeInvoiceClient({ data }: { data: DrawdownInvoiceLike[] }) {
  const filters: Array<[string, unknown]> = [];
  const query = {
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return query;
    },
    then<T>(resolve: (value: { data: DrawdownInvoiceLike[]; error: null }) => T) {
      expect(filters).toEqual([
        ["workspace_id", "workspace-1"],
        ["funding_award_id", "award-1"],
      ]);
      return Promise.resolve(resolve({ data, error: null }));
    },
  };

  return {
    from(table: string) {
      expect(table).toBe("billing_invoice_records");
      return {
        select(columns: string) {
          expect(columns).toContain("amount");
          expect(columns).toContain("retention_percent");
          expect(columns).toContain("retention_amount");
          return query;
        },
      };
    },
  } as unknown as Parameters<typeof evaluateFundingAwardCloseoutCoverage>[0]["supabase"];
}
