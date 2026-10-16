import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyRange, type MoneyPrecision } from "@/lib/money/format";
import {
  compareExactDecimals,
  compareMoneyPercent,
  moneyCents,
  moneyFromCents,
  parseExactDecimal,
  parseOptionalMoney,
  sumMoney,
} from "@/lib/money/optional-amount";

const tiny = "1e-9007199254740991";
const precisions: MoneyPrecision[] = ["cents", "auto", "whole"];

function decimal(text: string) {
  const parsed = parseExactDecimal(text);
  expect(parsed).not.toBeNull();
  return parsed!;
}

describe("bounded money decimal scales", () => {
  it("rounds tiny finite exponents to signed zero at every precision", () => {
    for (const value of [tiny, "0.01e-9007199254740991", "1e-100"]) {
      for (const precision of precisions) {
        const magnitude = precision === "whole" ? "$0" : "$0.00";
        expect(formatMoney(value, { precision })).toBe(magnitude);
        expect(formatMoney(`-${value}`, { precision })).toBe(`-${magnitude}`);
      }
    }
  });

  it("handles zero coefficients before positive or negative exponent expansion", () => {
    for (const exponent of ["9007199254740991", "-9007199254740991", "9007199254740993", "-9007199254740993"]) {
      for (const sign of ["", "-"]) {
        const value = `${sign}0.000e${exponent}`;
        expect(moneyCents(value)).toBe(BigInt(0));
        expect(decimal(value).scale).toBe(BigInt(0));
        for (const precision of precisions) {
          expect(formatMoney(value, { precision })).toBe(`${sign}$0${precision === "cents" ? ".00" : ""}`);
        }
      }
    }
    expect(formatMoney(-0, { precision: "cents" })).toBe("-$0.00");
    expect(parseOptionalMoney("-0e9007199254740991")).toBe(0);
  });

  it("keeps exponent plus fraction scale exact above safe integer arithmetic", () => {
    expect(decimal("0.01e-9007199254740991").scale).toBe(BigInt("9007199254740993"));
    expect(decimal("1e-9007199254740993").scale).toBe(BigInt("9007199254740993"));
    expect(compareExactDecimals(decimal("0.01e-9007199254740991"), decimal("1e-9007199254740993"))).toBe(0);
    expect(compareExactDecimals(decimal("0.01e-9007199254740991"), decimal("1e-9007199254740992"))).toBe(-1);
  });

  it("rejects nonzero fractional cents without allocating their denominator", () => {
    for (const value of [tiny, `-${tiny}`, "0.01e-9007199254740991", "0.001", "1.23001"]) {
      expect(() => moneyCents(value)).toThrow(/^Money amount contains fractional cents$/);
    }
    for (const [value, cents] of [["0.0100", "1"], ["1.2300e1", "1230"], ["-1.2300", "-123"], ["1e2", "10000"]]) {
      expect(moneyCents(value)).toBe(BigInt(cents));
    }
  });

  it("distinguishes integral trailing zeros in auto mode", () => {
    expect(formatMoney("12.0000", { precision: "auto" })).toBe("$12");
    expect(formatMoney("12.0010", { precision: "auto" })).toBe("$12.00");
    expect(formatMoney(tiny, { precision: "auto" })).toBe("$0.00");
    expect(formatMoney("1200e-2", { precision: "auto" })).toBe("$12");
  });

  it("rounds ordinary digits half away from zero in recorded currency units", () => {
    for (const sign of ["", "-"]) {
      expect(formatMoney(`${sign}1.0050`, { precision: "cents" })).toBe(`${sign}$1.01`);
      expect(formatMoney(`${sign}0.005`, { precision: "cents" })).toBe(`${sign}$0.01`);
      expect(formatMoney(`${sign}0.0049`, { precision: "cents" })).toBe(`${sign}$0.00`);
      expect(formatMoney(`${sign}9.5`, { precision: "whole" })).toBe(`${sign}$10`);
      expect(formatMoney(`${sign}1.2345`, { precision: "cents", currency: "KWD" })).toBe(`${sign}KWD\u00a01.235`);
      expect(formatMoney(`${sign}1.5`, { precision: "cents", currency: "JPY" })).toBe(`${sign}¥2`);
    }
    expect(formatMoney(tiny, { precision: "cents", currency: "EUR", currencyDisplay: "code" })).toBe("EUR\u00a00.00");
    expect(formatMoney(tiny, { precision: "cents", currency: "US D" })).toBe("US D 0.00");
  });

  it("orders ranges by sign magnitude and aligned digits without cross powers", () => {
    expect(formatMoneyRange("-0.01", tiny, { precision: "cents" })).toBe("-$0.01–$0.00");
    expect(formatMoneyRange(tiny, "-0.01", { precision: "cents" })).toBe("-$0.01–$0.00");
    expect(formatMoneyRange(`-${tiny}`, "0.01", { precision: "cents" })).toBe("-$0.00–$0.01");
    expect(formatMoneyRange("0.01", `-${tiny}`, { precision: "cents" })).toBe("-$0.00–$0.01");
    expect(formatMoneyRange("12.30", "12.3000", { precision: "cents" })).toBe("$12.30");
    const pairs = [["12.30", "12.3000", 0], ["-12.3", "-12.3000", 0], ["1.29", "1.3", -1], ["-1.29", "-1.3", 1], ["1e-100", "9e-101", 1], ["0", tiny, -1], ["-0", `-${tiny}`, 1]] as const;
    for (const [left, right, order] of pairs) {
      expect(compareExactDecimals(decimal(left), decimal(right))).toBe(order);
      expect(compareExactDecimals(decimal(right), decimal(left))).toBe(order === 0 ? 0 : -order);
    }
  });

  it("refuses genuinely nonfinite exponents and retains missing amount meaning", () => {
    for (const value of ["1e309", "-1e9007199254740991", "1e9007199254740993", "garbage", Infinity]) {
      expect(parseExactDecimal(value)).toBeNull();
      for (const precision of precisions) expect(formatMoney(value, { precision })).toBe("Not recorded");
      expect(() => moneyCents(value)).toThrow(/^Invalid money amount$/);
    }
    expect(parseOptionalMoney(null)).toBeNull();
    expect(parseOptionalMoney(0)).toBe(0);
    expect(formatMoneyRange(null, tiny, { precision: "cents", absent: "Unknown" })).toBe("Unknown");
  });

  it("retains root cent references and JSON representation across safe cent limits", () => {
    const cases = [
      [10000, "0.01", "100.00"], [10000, "19999.99", "199999900.00"],
      [2, "999999999999.99", "1999999999999.98"], [19, "999999999999.99", "18999999999999.81"],
      [33, "999999999999.99", "32999999999999.67"], [49, "999999999999.99", "48999999999999.51"],
      [79, "999999999999.99", "78999999999999.21"], [89, "999999999999.99", "88999999999999.11"],
      [90, "999999999999.99", "89999999999999.10"], [101, "999999999999.99", "100999999999998.99"],
      [1001, "999999999999.99", "1000999999999989.99"],
    ] as const;
    for (const [count, value, expected] of cases) {
      const reference = BigInt(expected.replace(".", ""));
      const result = sumMoney(Array.from({ length: count }, () => value));
      expect(moneyCents(JSON.parse(JSON.stringify(result)))).toBe(reference);
      expect(moneyFromCents(reference)).toBe(result);
      const [whole, fraction] = expected.split(".");
      expect(formatMoney(result, { precision: "cents" })).toBe(`$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`);
    }
    expect(typeof sumMoney(Array.from({ length: 79 }, () => "999999999999.99"))).toBe("string");
    expect(typeof sumMoney([0.01, 0.02])).toBe("number");
    const largeWhole = `1${"0".repeat(320)}`;
    const largeAmount = `${largeWhole}.01`;
    expect(moneyCents(largeAmount)).toBe(BigInt(`${largeWhole}01`));
    expect(formatMoney(largeAmount, { precision: "cents" })).toBe(`$${largeWhole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.01`);
    expect(compareMoneyPercent("1.00", "2.00", 50)).toBe(0);
    expect(compareMoneyPercent("1.01", "2.00", 50)).toBe(1);
    expect(compareMoneyPercent("1.00", "2.00", 40, 10)).toBe(0);
  });
});
