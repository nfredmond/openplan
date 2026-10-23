import { describe, expect, it } from "vitest";
import { formatProjectEstimate, projectEstimateDecimal, projectEstimateRequestData } from "@/lib/projects/estimated-cost";
import { moneyCents, moneyFromCents } from "@/lib/money/optional-amount";
import { formatMoney } from "@/lib/money/format";

describe("project estimate decimal boundary", () => {
  it.each([
    '{"name":"Number 123 and escaped \\"quote\\"","estimatedCost":{"amount":999999999999999.99,"currency":"USD","basisYear":2026}}',
    '{"estimatedCost":{"amount":1,"amount":999999999999999.99},"place":{"mode":"drawn","coordinates":[1.5,-3]}}',
    '{"estimatedCost":{"amou\\u006et":999999999999999.99},"summary":"123.45"}',
  ])("preserves numeric source tokens without changing other parsed fields", text => {
    const parsed = JSON.parse(text);
    expect(projectEstimateRequestData(text, parsed)).toEqual({ ...parsed, estimatedCost: { ...parsed.estimatedCost, amount: "999999999999999.99" } });
  });

  it.each([null, { name: "Unchanged" }, { estimatedCost: null }, { estimatedCost: { amount: "1.01", basisYear: 2026 } }])("keeps nonnumeric and absent estimate input unchanged", data => {
    expect(projectEstimateRequestData(JSON.stringify(data), data)).toBe(data);
  });
  it.each([
    ["999999999999999.99", "999999999999999.99"], ["90071992547409.93", "90071992547409.93"],
    ["1000000000000000", "1000000000000000.00"], [" 12.30 ", "12.30"], ["1.2300", "1.23"],
    [0.01, "0.01"], [12.3, "12.30"], [1_000_000, "1000000.00"],
  ] as const)("retains all cents for %s", (input, expected) => {
    const actual = projectEstimateDecimal(input);
    expect(actual).toBe(expected);
    expect(moneyCents(actual)).toBe(moneyCents(expected));
    expect(moneyCents(moneyFromCents(moneyCents(actual)))).toBe(moneyCents(expected));
  });

  it.each(["", " ", "1e3", "1E-2", "12junk", "$12", "1,000", "12,34", "1 2", "+1", "-1", "-0", "0", 0, -0, "1.001", 1.001, "1000000000000000.01", Infinity, NaN])("refuses %s", input => {
    expect(() => projectEstimateDecimal(input)).toThrow();
  });

  it.each(["USD", "JPY", "KWD"])("preserves two estimate decimals for %s", currency => {
    expect(formatProjectEstimate("999999999999999.99", currency)).toContain("999,999,999,999,999.99");
    expect(formatProjectEstimate("0.01", currency)).toContain("0.01");
    expect(formatProjectEstimate("12.001", currency)).toBe("Invalid recorded estimate");
    expect(formatProjectEstimate("0", currency)).toBe("Invalid recorded estimate");
    expect(formatProjectEstimate("garbage", currency)).toBe("Invalid recorded estimate");
  });

  it("keeps existing currency-minor-unit formatting while explicitly supporting estimate hundredths", () => {
    expect(formatMoney("12.34", { precision: "cents", currency: "JPY" })).toBe("¥12");
    expect(formatMoney("12.34", { precision: "hundredths", currency: "JPY" })).toBe("¥12.34");
    expect(formatMoney("12.34", { precision: "cents", currency: "KWD" })).toContain("12.340");
  });
});
