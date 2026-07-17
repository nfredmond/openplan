/**
 * Planner Pack — shared coercion and Python-parity formatting helpers.
 *
 * Ported from clawmodeler (Apache-2.0, same author):
 * `clawmodeler_engine/planner_pack/utilities.py` (`coerce_str`,
 * `parse_optional_float`), `clawmodeler_engine/planner_pack/atp.py`
 * (`_coerce_bool`), and `clawmodeler_engine/workspace.py` (`utc_now`).
 *
 * The number-formatting helpers exist so rendered memos and claim strings
 * are byte-comparable with the Python originals, which format via CPython
 * `round()` / `%.1f` / float `repr()`.
 */

/**
 * Mirror of Python `coerce_str(value, default)`: `None`/`""` fall back to
 * the default, everything else is stringified and trimmed (empty after
 * trimming also falls back).
 */
export function coerceStr(value: unknown, fallback = ""): string {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value).trim() || fallback;
}

/**
 * Mirror of Python `parse_optional_float`: missing or non-numeric cells
 * return null instead of throwing.
 *
 * Deliberate divergences from `float(...)`, documented rather than matched:
 * non-finite parses ("nan", "inf") return null here where Python returns
 * NaN/Infinity floats, and Python-only literal forms ("1_000") are treated
 * as non-numeric. Neither occurs in engine-produced tables.
 */
export function parseOptionalFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value).trim();
  if (text === "") {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Mirror of Python `atp._coerce_bool`: true only for the truthy CSV token
 * set {"true", "t", "1", "yes", "y"}, case-insensitively; everything else
 * (including missing values) is false.
 */
export function coerceBool(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (!text) {
    return false;
  }
  return text === "true" || text === "t" || text === "1" || text === "yes" || text === "y";
}

/**
 * Mirror of CPython `round(value, digits)`: round-half-to-even on exact
 * ties.
 *
 * Deliberate divergence: CPython rounds the exact decimal expansion of the
 * binary double (via `_Py_dg_dtoa`), while this rounds `value * 10**digits`
 * in double arithmetic. The two can differ only when that multiplication
 * crosses a rounding boundary — not observed for any value in this
 * library's magnitude range (scores, VMT, shares rounded to <= 4 digits).
 */
export function pythonRound(value: number, digits = 0): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (diff > 0.5) {
    rounded = floor + 1;
  } else if (diff < 0.5) {
    rounded = floor;
  } else {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  }
  return rounded / factor;
}

/**
 * Mirror of Python `f"{value:.<digits>f}"` for the claim strings and
 * templates: round with Python tie semantics first, then produce the fixed
 * form. (Bare `toFixed` rounds exact ties toward +Infinity where CPython
 * rounds them half-to-even, e.g. 18.25 -> "18.3" vs "18.2".)
 */
export function formatFixedPython(value: number, digits: number): string {
  return pythonRound(value, digits).toFixed(digits);
}

/**
 * Mirror of Python float `repr()` as Jinja renders bare floats: integral
 * floats keep a trailing ".0" ("22.0", "80.0"), everything else uses the
 * shortest round-trip form, which V8's String() shares with CPython for
 * this library's magnitude range. (Exponent-notation thresholds differ
 * between the runtimes at extreme magnitudes; irrelevant for planning
 * quantities.)
 */
export function formatPythonFloat(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e16) {
    return `${value}.0`;
  }
  return String(value);
}

/**
 * Mirror of Python `workspace.utc_now()`: second-precision UTC ISO-8601
 * with a "Z" suffix, e.g. "2026-07-17T19:04:05Z".
 */
export function utcNow(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}
