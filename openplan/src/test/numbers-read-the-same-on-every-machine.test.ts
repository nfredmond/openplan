import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/source-text";

/**
 * A NUMBER OR DATE IN THE PLANNER'S APP READS THE SAME ON EVERY MACHINE.
 *
 * A formatter given no locale (`n.toLocaleString()`, `Intl.NumberFormat()`, or
 * `undefined` in the locale slot) formats in whatever locale the machine
 * running it has. The server renders in its own; the browser re-renders client
 * components in the reader's. The same count could read "12,345" on the server
 * and "12.345" in a German browser, in one page, and a figure in a report
 * could change with the machine that generated it. The 2026-10-01 review found
 * 241 such calls (286 by the time they were fixed); they are pinned to "en-US", the locale the money module
 * (`lib/money/format.ts`) already uses.
 *
 * The resident portal formats in the resident's language on purpose
 * (`lib/engagement/portal-i18n/format.ts`), and it passes that language
 * explicitly, so it never needs a locale-less call either.
 *
 * WHAT THIS CANNOT SEE: a locale passed through a variable that happens to be
 * undefined at run time, and a timezone. Pinning the locale fixes the digits
 * and separators, not which clock a date is read on.
 */

const SRC = path.join(process.cwd(), "src");

const LOCALE_LESS = [
  /\.toLocale(?:String|DateString|TimeString)\(\s*(?:\)|undefined\b)/g,
  /\bIntl\.[A-Za-z]+\(\s*(?:\)|undefined\b)/g,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full === path.join(SRC, "test")) continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function locateLocaleLessCalls(text: string): string[] {
  const code = stripSourceComments(text);
  return LOCALE_LESS.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[0]));
}

describe("numbers and dates read the same on every machine", () => {
  it("finds the shapes it is looking for, and not a pinned call", () => {
    expect(locateLocaleLessCalls("n.toLocaleString()")).toHaveLength(1);
    expect(locateLocaleLessCalls("d.toLocaleDateString(undefined, { month: 'long' })")).toHaveLength(1);
    expect(locateLocaleLessCalls("new Intl.NumberFormat(undefined, {})")).toHaveLength(1);
    expect(locateLocaleLessCalls("new Intl.DateTimeFormat()")).toHaveLength(1);
    expect(locateLocaleLessCalls('n.toLocaleString("en-US")')).toEqual([]);
    expect(locateLocaleLessCalls("new Intl.NumberFormat(locale, {})")).toEqual([]);
    expect(locateLocaleLessCalls("// the page used a bare `toLocaleString()` once")).toEqual([]);
  });

  it("has no formatter in the app that falls back to the machine's locale", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      locateLocaleLessCalls(readFileSync(file, "utf8")).map((call) => `${path.relative(SRC, file)}: ${call}`),
    );
    expect(sourceFiles(SRC).length).toBeGreaterThan(500);
    expect(offenders).toEqual([]);
  });
});
