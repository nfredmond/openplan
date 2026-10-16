/**
 * Parsing a money column that may simply not have been filled in.
 *
 * Extracted rather than copied. It lived privately inside
 * `src/lib/projects/budget.ts`, and the fiscal-constraint check needs exactly
 * the same semantics — so under the rule that a shared capability living
 * inside one of its callers gets reimplemented wrongly by the next one, it
 * moves here and both import it.
 *
 * THE SEMANTICS ARE THE WHOLE POINT: absent is NOT zero. `funding.ts`'s
 * `toNumber` returns 0 for an absent or unparseable value, which is survivable
 * for an award (no award really is $0 committed) and is why `hasTargetNeed`
 * guards it. It is not survivable for a cost total: a plan with twelve of
 * forty projects unpriced would sum to a figure that looks complete and report
 * itself fiscally constrained — on the one number a funder verifies. Null
 * propagates so the caller has to decide what to say about it.
 *
 * Negative is also null rather than a negative number: a negative cost or
 * revenue is not a smaller amount, it is a data-entry error, and treating it
 * as arithmetic silently offsets a real figure elsewhere in the same total.
 */
export function parseOptionalAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/** A JSON-safe amount. Numbers are retained only when their decimal spelling is exact. */
export type ExactMoneyAmount = number | string;

export type ExactDecimal = { units: bigint; scale: number; negative: boolean };

/** Parse decimal digits without converting the amount through binary floating point. */
export function parseExactDecimal(value: number | string | null | undefined): ExactDecimal | null {
  if (value == null || (typeof value === "number" && !Number.isFinite(value))) return null;
  const text = String(value).trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const exponent = Number(match[5] ?? 0);
  // Exponent notation keeps the finite-input contract. Plain decimal strings
  // can carry aggregate amounts beyond Number's range without losing digits.
  if (!Number.isSafeInteger(exponent) || (match[5] && !Number.isFinite(Number(text)))) return null;
  const fraction = match[3] ?? match[4] ?? "";
  const negative = match[1] === "-" || (typeof value === "number" && Object.is(value, -0));
  let units = BigInt((match[2] ?? "0") + fraction);
  let scale = fraction.length - exponent;
  if (scale < 0) { units *= BigInt(10) ** BigInt(-scale); scale = 0; }
  return { units: negative ? -units : units, scale, negative };
}

/** Require an exact cent value. Missing, malformed or sub-cent records cannot become zero. */
export function moneyCents(value: number | string | null | undefined): bigint {
  const decimal = parseExactDecimal(value);
  if (!decimal) throw new Error("Invalid money amount");
  if (decimal.scale <= 2) return decimal.units * BigInt(10) ** BigInt(2 - decimal.scale);
  const divisor = BigInt(10) ** BigInt(decimal.scale - 2);
  if (decimal.units % divisor !== BigInt(0)) throw new Error("Money amount contains fractional cents");
  return decimal.units / divisor;
}

/** Preserve ordinary numeric APIs only when decimal and JSON roundtrips retain every cent. */
export function moneyFromCents(cents: bigint): ExactMoneyAmount {
  const magnitude = cents < BigInt(0) ? -cents : cents;
  const text = `${cents < BigInt(0) ? "-" : ""}${magnitude / BigInt(100)}.${String(magnitude % BigInt(100)).padStart(2, "0")}`;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric.toFixed(2) === text && moneyCents(String(numeric)) === cents) return numeric;
  return text;
}

/** Absent budgets remain unknown. Invalid recorded amounts fail instead of becoming zero. */
export function parseOptionalMoney(value: number | string | null | undefined): ExactMoneyAmount | null {
  if (value == null) return null;
  const decimal = parseExactDecimal(value);
  if (!decimal || decimal.units < BigInt(0)) throw new Error("Invalid optional money amount");
  // Invalid precision is a data error, not an absent budget.
  return moneyFromCents(moneyCents(value));
}

export function sumMoney(values: Array<number | string | null | undefined>): ExactMoneyAmount {
  return moneyFromCents(values.reduce<bigint>((total, value) => {
    const cents = moneyCents(value);
    if (cents < BigInt(0)) throw new Error("Negative budget input amount");
    return total + cents;
  }, BigInt(0)));
}

export function subtractMoney(left: ExactMoneyAmount, right: ExactMoneyAmount): ExactMoneyAmount {
  return moneyFromCents(moneyCents(left) - moneyCents(right));
}

export function compareMoney(left: ExactMoneyAmount, right: ExactMoneyAmount): number {
  const difference = moneyCents(left) - moneyCents(right);
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}

/** Display percentages round to two places. Verdicts must use the exact ratio instead. */
export function moneyPercent(actual: ExactMoneyAmount, budget: ExactMoneyAmount): number {
  const numerator = moneyCents(actual) * BigInt(10000);
  const denominator = moneyCents(budget);
  if (denominator <= BigInt(0)) throw new Error("Percentage requires a positive budget");
  const rounded = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
  return Number(rounded) / 100;
}

/** Compare exact burn percentage with a decimal progress boundary, before display rounding. */
export function compareMoneyPercent(actual: ExactMoneyAmount, budget: ExactMoneyAmount, percent: number, offset = 0): number {
  const decimal = parseExactDecimal(percent);
  if (!decimal) throw new Error("Invalid percentage");
  const difference = moneyCents(actual) * BigInt(100) * BigInt(10) ** BigInt(decimal.scale) - moneyCents(budget) * (decimal.units + BigInt(offset) * BigInt(10) ** BigInt(decimal.scale));
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}
