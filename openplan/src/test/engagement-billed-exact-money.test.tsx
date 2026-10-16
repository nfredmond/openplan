import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildEngagementBilledSummary } from "@/lib/invoicing/receivables";
import { EngagementNteBar } from "@/components/invoicing/engagement-nte-bar";
import { formatInvoiceMoney } from "@/lib/invoicing/invoice-currency";

const engagement = { id: "eng-1", not_to_exceed_amount: "999999999999.99" };
// Independent literal-cent expectations. This does not call production parsing,
// arithmetic or formatting to decide the expected answer.
function literalCents(value: number | string | null): bigint {
  const text = String(value);
  expect(text).toMatch(/^-?\d+(?:\.\d{1,2})?$/);
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  return BigInt(whole + fraction.padEnd(2, "0")) * (text.startsWith("-") ? BigInt(-1) : BigInt(1));
}
function rows(count: number, draft = false, numeric = false) {
  return Array.from({ length: count }, (_, i) => ({
    engagement_id: "eng-1", status: draft ? "draft" : i % 2 ? "paid" : "sent",
    subtotal_amount: numeric ? 999999999999.99 : "999999999999.99",
    retention_amount: "0.00", total_amount: "999999999999.99",
  }));
}

describe("engagement exact money", () => {
  for (const numeric of [false, true]) {
    for (const [count, billed, remaining] of [
      [45, "4499999999999955", "-4399999999999956"],
      [91, "9099999999999909", "-8999999999999910"],
      [100, "9999999999999900", "-9899999999999901"],
    ] as const) {
      it(`retains literal cents for ${count} billed rows, numeric=${numeric}`, () => {
        const result = buildEngagementBilledSummary(engagement, rows(count, false, numeric));
        const transported = JSON.parse(JSON.stringify(result));
        expect(literalCents(transported.billedToDate)).toBe(BigInt(billed));
        expect(literalCents(transported.remaining)).toBe(BigInt(remaining));
        expect(result.isOverNte).toBe(true);
        expect(result.draftedUnbilled).toBe(0);
      });
      it(`retains literal cents for ${count} draft rows, numeric=${numeric}`, () => {
        const result = buildEngagementBilledSummary(engagement, rows(count, true, numeric));
        expect(literalCents(result.draftedUnbilled)).toBe(BigInt(billed));
        expect(result.billedToDate).toBe(0);
        expect(result.notToExceed).toBe(999999999999.99);
        expect(result.remaining).toBe(999999999999.99);
        expect(result.isOverNte).toBe(false);
      });
    }
  }
  it("keeps ordinary numeric output and legitimate ceiling equality and one-cent overrun", () => {
    const base = [{ engagement_id: "eng-1", status: "sent", subtotal_amount: "999999999999.98" }];
    const equal = buildEngagementBilledSummary(engagement, [...base, { engagement_id: "eng-1", status: "paid", subtotal_amount: "0.01" }]);
    expect(equal.billedToDate).toBe(999999999999.99);
    expect(equal.remaining).toBe(0);
    expect(equal.isOverNte).toBe(false);
    const over = buildEngagementBilledSummary(engagement, [...base, { engagement_id: "eng-1", status: "paid", subtotal_amount: "0.02" }]);
    expect(over.remaining).toBe(-0.01);
    expect(over.isOverNte).toBe(true);
  });
  it("keeps gross retention, status and strict attribution independent", () => {
    const result = buildEngagementBilledSummary({ id: "eng-1", not_to_exceed_amount: 10 }, [
      { engagement_id: "eng-1", status: "sent", subtotal_amount: 11, total_amount: 8.8, retention_amount: 2.2 },
      { engagement_id: "eng-1", status: "draft", subtotal_amount: 2.5 },
      { engagement_id: "eng-1", status: "void", subtotal_amount: null },
      { engagement_id: "foreign", status: "paid", subtotal_amount: "broken" },
      { engagement_id: null, status: "sent", subtotal_amount: 100 },
    ]);
    expect(result).toEqual({ billedToDate: 11, draftedUnbilled: 2.5, notToExceed: 10, remaining: -1, isOverNte: true });
  });
  it("preserves empty supplied sets, absent identity and recorded zero", () => {
    for (const invoices of [null, undefined, []]) {
      expect(buildEngagementBilledSummary({ id: "eng-1", not_to_exceed_amount: 0 }, invoices))
        .toEqual({ billedToDate: 0, draftedUnbilled: 0, notToExceed: 0, remaining: 0, isOverNte: false });
    }
    expect(buildEngagementBilledSummary({}, rows(45))).toEqual({ billedToDate: 0, draftedUnbilled: 0, notToExceed: null, remaining: null, isOverNte: false });
  });
  it("preserves buckets when the ceiling is absent or invalid", () => {
    const invoices = [{ engagement_id: "eng-1", status: "sent", subtotal_amount: 7 }, { engagement_id: "eng-1", status: "draft", subtotal_amount: 2 }];
    expect(buildEngagementBilledSummary({ id: "eng-1" }, invoices)).toEqual({ billedToDate: 7, draftedUnbilled: 2, notToExceed: null, remaining: null, isOverNte: false });
    for (const invalid of ["bad", "", "1.001", -1, NaN, Infinity]) {
      expect(buildEngagementBilledSummary({ id: "eng-1", not_to_exceed_amount: invalid }, invoices))
        .toEqual({ billedToDate: 7, draftedUnbilled: 2, notToExceed: null, remaining: null, isOverNte: null, unavailable: { notToExceed: "invalid" } });
    }
  });
  it("isolates missing and invalid billed or draft buckets", () => {
    for (const value of [null, undefined, "bad", "2junk", "1.001", -1, NaN, Infinity]) {
      for (const badDraft of [false, true]) {
        const result = buildEngagementBilledSummary({ id: "eng-1", not_to_exceed_amount: 10 }, [
          { engagement_id: "eng-1", status: "sent", subtotal_amount: badDraft ? 7 : value },
          { engagement_id: "eng-1", status: "draft", subtotal_amount: badDraft ? value : 2 },
        ]);
        expect(result.billedToDate).toBe(badDraft ? 7 : null);
        expect(result.draftedUnbilled).toBe(badDraft ? null : 2);
        expect(result.remaining).toBe(badDraft ? 3 : null);
        expect(result.isOverNte).toBe(badDraft ? false : null);
        expect(result.unavailable).toEqual({ [badDraft ? "draftedUnbilled" : "billedToDate"]: value == null ? "missing" : "invalid" });
      }
    }
  });
  it("renders exact summary markup with stated or unassessed currency", () => {
    const summary = buildEngagementBilledSummary(engagement, [...rows(45), ...rows(45, true)]);
    const html = renderToStaticMarkup(<EngagementNteBar summary={summary} currencyCode="EUR" />);
    expect(html).toContain("€44,999,999,999,999.55 gross billed before retention");
    expect(html).toContain("€44,999,999,999,999.55 gross remains in draft");
    expect(html).toContain("agreement terms unassessed");
    expect(renderToStaticMarkup(<EngagementNteBar summary={summary} />)).toContain("44999999999999.55 (currency unassessed)");
    expect(formatInvoiceMoney("90999999999999.09", "local-unit")).toBe("90999999999999.09 local-unit");
    expect(formatInvoiceMoney("90999999999999.09", "EUR")).toBe("€90,999,999,999,999.09");
    expect(formatInvoiceMoney("bad", null)).toBe("Amount unavailable");
    expect(formatInvoiceMoney(null, null)).toBe("Not recorded");
  });
  it("renders unavailable fields independently without inventing zero", () => {
    const summary = buildEngagementBilledSummary({ id: "eng-1", not_to_exceed_amount: "bad" }, [{ engagement_id: "eng-1", status: "sent" }, { engagement_id: "eng-1", status: "draft", subtotal_amount: 2 }]);
    const html = renderToStaticMarkup(<EngagementNteBar summary={summary} />);
    expect(html).toContain("Gross billed calculation unavailable (missing amount)");
    expect(html).toContain("Legacy ceiling calculation unavailable (invalid amount)");
    expect(html).toContain("2.00 (currency unassessed) gross remains in draft");
    expect(html).not.toContain("0.00");
  });
});
