import { compareExactDecimals, decimalUnitsAtScale, parseExactDecimal, type ExactDecimal } from "./optional-amount";

/**
 * One way to write a dollar figure, everywhere in OpenPlan.
 *
 * Before this file there were more than twenty independent currency
 * formatters, and they had split into three camps: whole dollars, dollars and
 * cents, and — worst — number formatters constructed with an undefined locale,
 * which format in the BROWSER's locale. That last one meant a measure recorded in one agency could
 * render one way on the planner's laptop and another way on the auditor's,
 * from the same stored number, with nothing on screen to explain it.
 *
 * The defect that forced the consolidation was quieter and worse: the RTP
 * cycle page summarised paid, outstanding, and uninvoiced reimbursement to
 * whole dollars while the invoicing register rendered THE SAME
 * `billing_invoice_records` to the cent. A planner reconciling a draw against
 * a plan got two different numbers for one fact and no way to tell which was
 * the rounding.
 *
 * So the rules encoded here:
 *
 * 1. **`precision` is required.** There is no default. A ledger figure that
 *    silently lost its cents because a call site omitted an option is exactly
 *    the failure this module exists to prevent, so the type system asks every
 *    time. Ledger and worksheet surfaces (invoicing, measure claims,
 *    maintenance-of-effort, drawdown) pass `"cents"`; plan, program, report
 *    and RTP summary surfaces may pass `"whole"`.
 * 2. **A surface that rounds says so, once, near the figures.** Round with
 *    `"whole"` and put `ROUNDED_MONEY_NOTE` — or, where the rounded figures
 *    restate records the invoicing register also shows,
 *    `ROUNDED_MONEY_NOTE_RECONCILES_TO_LEDGER` — beside them. Rounding is
 *    fine. Rounding invisibly is what produced two numbers for one fact.
 * 3. **Never the browser's locale.** Formatting is pinned to
 *    `MONEY_DISPLAY_LOCALE`; what varies is the amount's own currency, which
 *    the data carries (measures declare a currency per profile, invoices per
 *    record). The same stored figure reads the same on every machine.
 *
 * The resident-facing engagement portal is deliberately NOT a caller:
 * `src/lib/engagement/portal-i18n/format.ts` formats in the resident's chosen
 * language on purpose, and that is a different job from stating an agency's
 * money.
 */

/**
 * Money is formatted in one fixed locale so a stored figure reads identically
 * on every machine that opens the workspace. This is a grouping-and-decimal
 * convention, not a claim about who is reading: the currency comes from the
 * data, so a euro-denominated profile still renders "€1,234.56".
 */
export const MONEY_DISPLAY_LOCALE = "en-US";

/** Fallback when a record carries no currency of its own. */
export const DEFAULT_MONEY_CURRENCY = "USD";

/**
 * - `whole` — nearest dollar. Summary surfaces only, and only with a note.
 * - `cents` — the currency's own minor unit, always shown. Ledgers,
 *   worksheets, anything a funder or a client reconciles against. For USD that
 *   is two decimal places; for a zero-decimal currency it is none, because
 *   there are no cents to show.
 * - `auto` — whole when the figure is a whole number of dollars, to the cent
 *   otherwise. For entered ledger lines in plan documents, where "$1,200,000"
 *   is the spelling a reader expects but "$0.30" must not be written "$0".
 */
export type MoneyPrecision = "whole" | "cents" | "auto";

export type FormatMoneyOptions = {
  precision: MoneyPrecision;
  /** ISO 4217 code from the record itself. Absent or blank defaults to USD. */
  currency?: string | null;
  /** Rendered when the amount is missing or unparseable. Defaults to "Not recorded". */
  absent?: string;
  /**
   * `"symbol"` (the default) writes "$1,234.56"; `"code"` writes
   * "USD 1,234.56". Public oversight pages use `"code"` deliberately — a
   * resident reading a fund report should not have to infer which country's
   * dollar a "$" means.
   */
  currencyDisplay?: "symbol" | "code";
};

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * `exact` means the currency's OWN minor unit, not "two decimal places". A yen
 * figure has no cents, and forcing "¥1,234.50" onto an invoice denominated in
 * a zero-decimal currency invents a precision the money does not have.
 */
function formatter(
  currency: string,
  mode: "whole" | "exact",
  currencyDisplay: "symbol" | "code"
): Intl.NumberFormat | null {
  const key = `${currency}|${mode}|${currencyDisplay}`;
  if (formatterCache.has(key)) return formatterCache.get(key) ?? null;
  let created: Intl.NumberFormat | null = null;
  try {
    created = new Intl.NumberFormat(MONEY_DISPLAY_LOCALE, {
      style: "currency",
      currency,
      currencyDisplay,
      ...(mode === "whole" ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    });
  } catch {
    // An unknown ISO code. See `formatMoney`.
    created = null;
  }
  if (created) formatterCache.set(key, created);
  return created;
}

/** Round decimal digits half away from zero, then format the exact whole units.
 * Intl receives BigInt, never an unvalidated decimal-string overload. */
function exactAmountText(amount: ExactDecimal, intl: Intl.NumberFormat): string {
  const digits = intl.resolvedOptions().maximumFractionDigits ?? 0;
  const scaled = decimalUnitsAtScale(amount, digits, true)!;
  const rounded = scaled < BigInt(0) ? -scaled : scaled;
  const minorBase = BigInt(10) ** BigInt(digits);
  const whole = rounded / minorBase;
  const signedWhole = amount.negative ? (whole === BigInt(0) ? -0 : -whole) : whole;
  const fraction = String(rounded % minorBase).padStart(digits, "0");
  return intl.formatToParts(signedWhole).map((part) => part.type === "fraction" ? fraction : part.value).join("");
}

/**
 * Format one amount. `precision` is required — see the module note.
 *
 * ```ts
 * formatMoney(1234.5, { precision: "cents" })            // "$1,234.50"
 * formatMoney(1234.5, { precision: "cents", currency: "JPY" }) // "¥1,235" — yen has no cents
 * formatMoney(1234.5, { precision: "whole" })            // "$1,235"
 * formatMoney(1234, { precision: "auto" })               // "$1,234"
 * formatMoney(null, { precision: "cents" })              // "Not recorded"
 * formatMoney(90, { precision: "cents", currency: "EUR" }) // "€90.00"
 * ```
 */
export function formatMoney(
  value: number | string | null | undefined,
  options: FormatMoneyOptions
): string {
  const amount = parseExactDecimal(value);
  if (amount === null) return options.absent ?? "Not recorded";

  const currency = options.currency?.trim() ? options.currency.trim().toUpperCase() : DEFAULT_MONEY_CURRENCY;

  const mode: "whole" | "exact" =
    options.precision === "whole" || (options.precision === "auto" && decimalUnitsAtScale(amount, 0, false) !== null)
      ? "whole"
      : "exact";
  const intl = formatter(currency, mode, options.currencyDisplay ?? "symbol");
  if (intl) return exactAmountText(amount, intl);
  // Malformed codes keep their own label rather than silently becoming USD.
  // Intl itself renders well-formed but unassigned three-letter codes.
  const digits = mode === "whole" ? 0 : 2;
  const fallback = new Intl.NumberFormat(MONEY_DISPLAY_LOCALE, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  return `${currency} ${exactAmountText(amount, fallback)}`;
}

/**
 * Format a low-to-high pair as one range. Collapses to a single figure when
 * the ends are equal, because "$4,000–$4,000" reads as a data error rather
 * than as a certain estimate. If either end is missing the range is not a
 * range, so the absent string stands for the whole thing rather than half of
 * it being quietly dropped.
 */
export function formatMoneyRange(
  low: number | string | null | undefined,
  high: number | string | null | undefined,
  options: FormatMoneyOptions
): string {
  const lowAmount = parseExactDecimal(low);
  const highAmount = parseExactDecimal(high);
  if (lowAmount === null || highAmount === null) return options.absent ?? "Not recorded";

  const lowFirst = compareExactDecimals(lowAmount, highAmount) <= 0;
  const [first, second] = lowFirst ? [low, high] : [high, low];
  const firstText = formatMoney(first, options);
  const secondText = formatMoney(second, options);
  if (firstText === secondText) return firstText;
  return `${firstText}–${secondText}`;
}

/**
 * Whether `Intl` will accept this code as a currency.
 *
 * For the two callers that render money into HTML they build themselves
 * (`invoice-pdf.ts`, `reimbursement-worksheet.ts`): an unrecognized code has
 * to fall back to a string those callers ESCAPE, because the column is free
 * text and the fallback would otherwise put user input into a document
 * unescaped. They ask this first and format the happy path through
 * `formatMoney` like everything else.
 */
export function isSupportedCurrency(code: string | null | undefined): boolean {
  const trimmed = code?.trim().toUpperCase();
  if (!trimmed) return false;
  return formatter(trimmed, "exact", "symbol") !== null;
}

/**
 * The sentence a rounding surface puts beside its figures. One wording, so a
 * planner learns it once.
 */
export const ROUNDED_MONEY_NOTE = "Dollar figures here are rounded to the nearest dollar.";

/**
 * The stronger wording for a summary that restates records the invoicing
 * register also shows to the cent — the reconciliation case. It names where
 * the exact figure lives, because "these two screens disagree by 40 cents" is
 * a question a planner should never have to ask a funder.
 */
export const ROUNDED_MONEY_NOTE_RECONCILES_TO_LEDGER =
  "Dollar figures here are rounded to the nearest dollar. The invoicing register shows the same invoice records to the cent.";
