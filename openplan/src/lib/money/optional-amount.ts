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

export type ExactDecimal = { units: bigint; scale: bigint; negative: boolean };

/** Parse decimal digits without converting the amount through binary floating point. */
export function parseExactDecimal(value: number | string | null | undefined): ExactDecimal | null {
  if (value == null || (typeof value === "number" && !Number.isFinite(value))) return null;
  const text = String(value).trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const exponent = BigInt(match[5] ?? 0);
  // Exponent notation keeps the finite-input contract. Plain decimal strings
  // can carry aggregate amounts beyond Number's range without losing digits.
  if (match[5] && !Number.isFinite(Number(text))) return null;
  const fraction = match[3] ?? match[4] ?? "";
  const negative = match[1] === "-" || (typeof value === "number" && Object.is(value, -0));
  let units = BigInt((match[2] ?? "0") + fraction);
  let scale = BigInt(fraction.length) - exponent;
  if (units === BigInt(0)) scale = BigInt(0);
  // A nonzero positive exponent has already passed the finite-input check.
  // Its expansion is bounded by the supplied coefficient and finite magnitude.
  if (scale < BigInt(0)) { units *= BigInt(10) ** -scale; scale = BigInt(0); }
  return { units: negative ? -units : units, scale, negative };
}

/** Rescale using supplied digits. Null means fractional units in exact mode.
 * Rounded mode uses the first discarded digit for half-away-from-zero rounding. */
export function decimalUnitsAtScale(decimal: ExactDecimal, digits: number, round: boolean): bigint | null {
  if (decimal.units === BigInt(0)) return BigInt(0);
  const shift = decimal.scale - BigInt(digits);
  if (shift <= BigInt(0)) return decimal.units * BigInt(10) ** -shift;
  const magnitude = decimal.units < BigInt(0) ? -decimal.units : decimal.units;
  const text = String(magnitude);
  if (shift > BigInt(text.length)) return round ? BigInt(0) : null;
  const cut = text.length - Number(shift);
  const discarded = text.slice(cut);
  if (!round && /[1-9]/.test(discarded)) return null;
  const units = BigInt(text.slice(0, cut) || "0") + (round && discarded[0] >= "5" ? BigInt(1) : BigInt(0));
  return decimal.units < BigInt(0) ? -units : units;
}

/** Compare sign, decimal order and aligned supplied digits without cross-powers. */
export function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): number {
  if (left.units === BigInt(0) || right.units === BigInt(0) || (left.units < BigInt(0)) !== (right.units < BigInt(0))) {
    return left.units < right.units ? -1 : left.units > right.units ? 1 : 0;
  }
  const negative = left.units < BigInt(0);
  const leftText = String(negative ? -left.units : left.units);
  const rightText = String(negative ? -right.units : right.units);
  const leftOrder = BigInt(leftText.length) - left.scale;
  const rightOrder = BigInt(rightText.length) - right.scale;
  const width = Math.max(leftText.length, rightText.length);
  const first = leftText.padEnd(width, "0");
  const second = rightText.padEnd(width, "0");
  const order = leftOrder !== rightOrder
    ? (leftOrder < rightOrder ? -1 : 1)
    : (first < second ? -1 : first > second ? 1 : 0);
  return negative && order !== 0 ? -order : order;
}

/** Require an exact cent value. Missing, malformed or sub-cent records cannot become zero. */
export function moneyCents(value: number | string | null | undefined): bigint {
  const decimal = parseExactDecimal(value);
  if (!decimal) throw new Error("Invalid money amount");
  const cents = decimalUnitsAtScale(decimal, 2, false);
  if (cents === null) throw new Error("Money amount contains fractional cents");
  return cents;
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
