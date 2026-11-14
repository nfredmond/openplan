/**
 * EVERY TIME IN BOTH SAFETY EXPORTS NAMES ITS ZONE (KI-2026-11-14-340).
 *
 * Each plan from the first proven job printed "CREATED 11/14/2026, 5:33:55 PM"
 * on its cover. That was UTC (the hosted functions run in UTC) with no zone
 * named; in Sierra County it was 9:33 AM, and the same journey's screens
 * showed local time. The SS4A packet already labeled UTC.
 *
 * The report now prints every date and time through the formatter the SS4A
 * appendices use ("Nov 14, 2026, 17:33 UTC"). This test renders both whole
 * exports and fails on a time of day with no zone after it, on a 12-hour
 * clock time, and on a raw ISO stamp.
 *
 * Blind category: text a planner typed into a section (printed as written),
 * section text seeded before the November 14 seed change (stored, kept), and
 * report blocks this fixture does not reach (county runs, scenario spines and
 * aerial previews print through the same formatter, but no fixture here has
 * them). The PDF block is skipped where Chrome or poppler is missing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildReportHtml } from "@/lib/reports/html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { findPdfPhrase } from "../../scripts/lib/pdf-text-match.mjs";
import { safetyReportData, safetyReportHtml, ss4aPacketHtml } from "./fixtures/grants/safety-exports";

/** A time of day: "17:33", "5:33:55 PM". */
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?/g;
/** What must follow a time: a zone, bare or in parentheses ("17:57 (UTC, no workspace time zone set)"). */
const ZONE_AFTER = /^\s*\(?(?:UTC|GMT|[A-Z]{2,4}T)\b/;
const ISO_STAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const TWELVE_HOUR = /\b\d{1,2}:\d{2}(?::\d{2})?\s?[AP]M\b/;

function readerText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ");
}

/** Every time of day a reader would see without a zone after it, with its context. */
function unzonedTimes(text: string): string[] {
  return [...text.matchAll(TIME)].flatMap((match) => {
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 8);
    return ZONE_AFTER.test(after) && !TWELVE_HOUR.test(match[0]) ? [] : [text.slice(Math.max(0, match.index! - 20), match.index! + match[0].length + 8)];
  });
}

describe("the check can fail", () => {
  it("finds the proof job's cover time and passes the SS4A packet's", () => {
    expect(unzonedTimes("CREATED 11/14/2026, 5:33:55 PM LINKED RUNS")).not.toEqual([]);
    expect(unzonedTimes("Generated on 11/14/2026, 5:46:55 PM. Project last updated")).not.toEqual([]);
    expect(unzonedTimes("Recorded at 17:33. Next")).not.toEqual([]);
    expect(unzonedTimes("November 14, 2026 at 17:57 (UTC, no workspace time zone set)")).toEqual([]);
    expect(unzonedTimes("Generated: Nov 14, 2026, 17:46 UTC.")).toEqual([]);
    expect("Retrieved: 2026-11-14T05:52:05.469213+00:00.").toMatch(ISO_STAMP);
  });
});

describe("both exports", () => {
  it("the report's cover prints its creation time with the zone named", () => {
    const html = safetyReportHtml();
    expect(html).toContain("<div><dt>Created</dt><dd>Nov 14, 2026, 17:33 UTC</dd></div>");
  });

  for (const [name, build] of [["safety action plan report", safetyReportHtml], ["SS4A packet", ss4aPacketHtml]] as const) {
    it(`the ${name} prints no time without its zone and no raw stamp`, () => {
      const text = readerText(build());
      expect(text).toMatch(TIME);
      expect(unzonedTimes(text)).toEqual([]);
      expect(text).not.toMatch(ISO_STAMP);
    });
  }
});

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftotext", "pdfinfo"].every((tool) => existsSync(path.join(dir, `${tool}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-zoned-times-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe.runIf(PDF_TOOLS)("the report as a PDF, read back with pdftotext", () => {
  it("prints the cover time with its zone on page 1", async () => {
    process.env.CHROME_EXECUTABLE_PATH = CHROME;
    const file = path.join(workDir, "zoned-cover.pdf");
    writeFileSync(file, await renderHtmlToPdf(buildReportHtml(safetyReportData()), { footerLabel: "zoned-cover" }));
    const exe = process.platform === "win32" ? ".exe" : "";
    const page1 = execFileSync(path.join(POPPLER!, `pdftotext${exe}`), ["-f", "1", "-l", "1", file, "-"]).toString();
    expect(findPdfPhrase([page1], "Nov 14, 2026, 17:33 UTC")).not.toEqual([]);
    expect(page1).not.toMatch(TWELVE_HOUR);
  }, 120_000);
});
