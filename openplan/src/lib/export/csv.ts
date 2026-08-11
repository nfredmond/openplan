/**
 * The ONE CSV escaping layer for every CSV OpenPlan writes.
 *
 * Three copies of this logic used to exist — the engagement items export, the
 * survey export, and the client-side download helpers — and none of them
 * neutralized spreadsheet formulas. A shared capability that lives inside one
 * of its callers gets reimplemented wrongly by the next one, so the copies are
 * unified here and every export inherits both protections:
 *
 * 1. QUOTING (RFC 4180): a field containing a quote, comma, or line break is
 *    wrapped in double quotes with inner quotes doubled.
 *
 * 2. FORMULA NEUTRALIZATION (CSV injection): a cell whose first character is
 *    `=`, `+`, `-`, `@`, tab, or CR is executed as a formula when the file is
 *    opened in Excel, LibreOffice, or Sheets. Resident-authored free text
 *    flows into these files — a public comment reading `=HYPERLINK(...)` or
 *    `@SUM(...)` would run on the planner's machine when they open their own
 *    export. The standard mitigation is applied at this layer: prefix a single
 *    quote (`'`), which spreadsheets read as "treat this cell as text". The
 *    prefix is visible in the raw CSV; that is the accepted cost of the file
 *    being safe to open.
 *
 * THE NUMERIC-COLUMN DECISION, made deliberately: only STRING values are
 * neutralized. A machine-written number (a score delta of -6, a longitude of
 * -121.06) must stay a number a spreadsheet can compute with, so callers that
 * hold a real `number` write it via `csvCellForValue` (or `String(n)` before
 * quoting-only paths), which passes numbers through untouched — a number
 * cannot carry a formula. A resident-typed "-5" arrives as a string and IS
 * prefixed: it is untrusted text in a text column, and "'-5" displayed as
 * text is the honest, safe rendering of it.
 */

const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Prefix a single quote when the text would be executed as a formula. */
export function neutralizeSpreadsheetFormula(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

/**
 * Escape one UNTRUSTED (or simply textual) CSV field: formula neutralization
 * first, then RFC 4180 quoting. Null/undefined become the empty field.
 */
export function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = neutralizeSpreadsheetFormula(String(value));
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Escape a value whose TYPE is still known. Numbers and booleans are machine
 * values — they pass through bare so numeric columns stay computable (see the
 * numeric-column decision above). Everything else is treated as text, JSON
 * included, and gets the full escaping.
 */
export function csvCellForValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return escapeCsvField(typeof value === "string" ? value : JSON.stringify(value));
}
