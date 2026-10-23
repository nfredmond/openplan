import { moneyCents, parseOptionalMoney } from "@/lib/money/optional-amount";
import { formatMoney } from "@/lib/money/format";

/** Project estimates retain the existing positive, at-most-10^15 write range.
 * Strings are whole decimal inputs, never currency, grouping or exponent text.
 * Numeric clients retain their supplied decimal spelling; prior rounding cannot
 * be detected or recovered here. Null clearing belongs to the estimate object.
 */
export function projectEstimateDecimal(value: number | string): string {
  const text = String(value).trim();
  if (text.length > 64 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)
    || (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))) {
    throw new Error("Use a positive decimal amount without currency marks, grouping or exponent notation.");
  }
  const amount = parseOptionalMoney(value);
  const cents = moneyCents(amount);
  if (cents <= BigInt(0) || cents > BigInt("100000000000000000")) {
    throw new Error("Estimate must be greater than zero and no more than 1000000000000000.");
  }
  return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}

/** Retain a legacy JSON number's source digits before schema validation.
 * The bounded HTTP reader has already parsed/validated JSON. A second parse
 * quotes number tokens, skipping entire JSON strings (including escaped keys).
 * Only estimatedCost.amount is replaced; all other fields keep their original
 * types and semantics. No client-runtime JSON.parse source extension is needed.
 */
export function projectEstimateRequestData(text: string, data: unknown): unknown {
  if (!data || typeof data !== "object" || !("estimatedCost" in data)) return data;
  const estimate = data.estimatedCost;
  if (!estimate || typeof estimate !== "object" || !("amount" in estimate) || typeof estimate.amount !== "number") return data;
  const quotedNumbers = text.replace(/"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    token => token.startsWith('"') ? token : JSON.stringify(token));
  const exact: unknown = JSON.parse(quotedNumbers);
  if (!exact || typeof exact !== "object" || !("estimatedCost" in exact)
    || !exact.estimatedCost || typeof exact.estimatedCost !== "object" || !("amount" in exact.estimatedCost)
    || typeof exact.estimatedCost.amount !== "string") throw new Error("Could not read exact estimate amount.");
  return { ...data, estimatedCost: { ...estimate, amount: exact.estimatedCost.amount } };
}

/** Historical values are read without rewriting them. Invalid recorded cents
 * remain visible as an error instead of being rounded into an apparent estimate.
 */
export function formatProjectEstimate(value: number | string, currency: string): string {
  try {
    const amount = parseOptionalMoney(value);
    if (moneyCents(amount) <= BigInt(0)) throw new Error("Invalid recorded estimate");
    return formatMoney(amount, { precision: "hundredths", currency, currencyDisplay: "code" });
  } catch {
    return "Invalid recorded estimate";
  }
}
