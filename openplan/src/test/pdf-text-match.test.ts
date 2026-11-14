// @vitest-environment node
/**
 * ONE PDF TEXT MATCHER FOR THE EXPORT TEST, THE PROOF CHECKER AND THE JOURNEY
 * (KI-2026-11-14-117).
 *
 * The safety exports read back differently on Linux, where the hosted site
 * renders them, than on Windows: labels set with letter spacing came out as
 * single letters, and a URL wrapped in a narrow column came out one piece per
 * line. The fixtures below are pdftotext output from Chrome 157 and Poppler
 * 24.02 on Ubuntu 24.04, taken from the exports before the export styling was
 * fixed, so the Linux case is tested on every platform without Chrome.
 *
 * The matcher is a guard for the proof: it must find what is there and must
 * not turn a miss into a hit.
 *
 * Blind category: inside a letter-spaced run it cannot see word breaks, so a
 * phrase that stops partway through a spaced word is found; two cells side by
 * side on one line, or one after another across a single line break, read as
 * one passage.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findPdfPhrase,
  joinLetterSpacing,
  letterSpacedRuns,
  normalizePdfText,
  pdfTextHasPhrase,
} from "../../scripts/lib/pdf-text-match.mjs";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/pdf-text/linux-chrome-157-poppler-24.02/${name}`, import.meta.url)), "utf8");

const reportPage1 = fixture("report-page-1.txt");
const reportPage6 = fixture("report-page-6.txt");
const ss4aPage7 = fixture("ss4a-application-page-7.txt");
const ss4aPage7Layout = fixture("ss4a-application-page-7-layout.txt");
const countermeasurePages = fixture("ss4a-countermeasures-pages-2-3.txt").split("\f");

describe("the Linux fixtures hold the failure a plain search misses", () => {
  it("prints the labels as separated letters", () => {
    expect(reportPage1).toContain("R E P O RT T Y P E");
    expect(ss4aPage7).toContain("C O M M E N T S A P P R OV E D");
    const plain = ss4aPage7.replace(/\s+/g, " ").toLowerCase();
    expect(plain).not.toContain("comments approved");
  });
});

describe("pdfTextHasPhrase finds what the page says", () => {
  it.each([
    ["Report type", "reportPage1", reportPage1],
    ["Created", "reportPage1", reportPage1],
    // Kerning keeps "ATA" together inside the spaced letters.
    ["Scenario data packages", "reportPage1", reportPage1],
    ["Handoff-ready input", "reportPage1", reportPage1],
    ["Comments approved", "reportPage6", reportPage6],
    ["Comments approved", "ss4aPage7", ss4aPage7],
    ["Community-input finding source", "ss4aPage7", ss4aPage7],
    ["Campaigns on record", "ss4aPage7", ss4aPage7],
    ["Lead campaign", "ss4aPage7", ss4aPage7],
    ["Comments approved", "ss4aPage7Layout", ss4aPage7Layout],
    ["Community-input finding source", "ss4aPage7Layout", ss4aPage7Layout],
  ])("finds the letter-spaced label %s in %s", (phrase, _name, page) => {
    expect(pdfTextHasPhrase(page, phrase)).toBe(true);
  });

  it("finds ordinary text across one line break, with any case", () => {
    expect(pdfTextHasPhrase(ss4aPage7, "sorts 3 comment(s) and survey answer(s)")).toBe(true);
    expect(pdfTextHasPhrase(ss4aPage7, "APPROVED STAFF REVIEW (REVISION 1, APPROVED JAN 2, 2026)")).toBe(true);
    expect(pdfTextHasPhrase(ss4aPage7, "revision 1")).toBe(true);
  });

  it("finds a URL wrapped in a narrow column, where Poppler dropped a hyphen at a line end", () => {
    // Page 2 reads "ven-safetycountermea": the hyphen after "safety" was lost.
    expect(countermeasurePages[0]).toContain("ven-safetycountermea");
    expect(pdfTextHasPhrase(countermeasurePages[0],
      "https://highways.dot.gov/safety/proven-safety-countermeasures/enhanced-delineation-horizontal-curves")).toBe(true);
  });

  it("ignores soft hyphens, zero-width characters, ligatures, no-break spaces and curly quotes", () => {
    expect(pdfTextHasPhrase("Bene­fit​-cost", "benefit-cost")).toBe(true);
    expect(pdfTextHasPhrase("ﬁnding source", "finding source")).toBe(true);
    expect(pdfTextHasPhrase("Comments approved", "comments approved")).toBe(true);
    expect(pdfTextHasPhrase("the plan’s “finding”", "the plan's \"finding\"")).toBe(true);
    expect(normalizePdfText("A‑B")).toBe("a-b");
  });
});

describe("pdfTextHasPhrase does not turn a miss into a hit", () => {
  it("refuses a phrase that is not there", () => {
    expect(pdfTextHasPhrase(ss4aPage7, "Comments rejected")).toBe(false);
    expect(pdfTextHasPhrase(ss4aPage7, "Benefit-cost summary")).toBe(false);
    expect(pdfTextHasPhrase(ss4aPage7, "")).toBe(false);
  });

  it("refuses a phrase split across two unrelated places", () => {
    // Two blocks: "COMMENTS RECEIVED", a blank line, then "Map comments".
    expect(pdfTextHasPhrase(ss4aPage7, "Comments received map comments")).toBe(false);
    // Two cells in -layout output, side by side behind a column gap.
    expect(ss4aPage7Layout).toMatch(/METHOD {2,}COMMENTS RECEIVED/);
    expect(pdfTextHasPhrase(ss4aPage7Layout, "Method comments received")).toBe(false);
    expect(pdfTextHasPhrase(ss4aPage7Layout, "Comments approved community-input finding source")).toBe(false);
  });

  it("refuses a phrase that only exists by joining two pages", () => {
    const url = "https://highways.dot.gov/safety/proven-safety-countermeasures/medians-and-pedestrian-refuge-islands-urban-and-suburban-areas";
    expect(findPdfPhrase(countermeasurePages, url)).toEqual([]);
    expect(pdfTextHasPhrase(countermeasurePages.join("\f"), url)).toBe(false);
    expect(findPdfPhrase(countermeasurePages, "https://highways.dot.gov/safety/proven-safety-countermeasures/lighting")).toEqual([2]);
  });

  it("refuses a near phrase", () => {
    expect(pdfTextHasPhrase(ss4aPage7, "Corridor listening sessions")).toBe(false);
    expect(pdfTextHasPhrase(ss4aPage7, "Corridor listening session (close")).toBe(false);
    expect(pdfTextHasPhrase(ss4aPage7, "Comments receive")).toBe(false);
    expect(pdfTextHasPhrase(ss4aPage7, "Comment approved")).toBe(false);
    expect(pdfTextHasPhrase("start the review", "art")).toBe(false);
  });

  it("does not run two words together or split one word at a plain space", () => {
    expect(pdfTextHasPhrase("the rapist", "therapist")).toBe(false);
    expect(pdfTextHasPhrase("therapist", "the rapist")).toBe(false);
    expect(pdfTextHasPhrase("thera\npist", "therapist")).toBe(true);
  });
});

describe("letter-spaced runs", () => {
  it("lists them in the Linux fixtures and finds none in ordinary text", () => {
    expect(letterSpacedRuns(reportPage1)).toEqual(expect.arrayContaining(["r e p o rt t y p e", "c r e at e d", "s c e n a r i o d ata"]));
    expect(letterSpacedRuns(ss4aPage7)).toContain("c o m m e n t s a p p r ov e d");
    expect(letterSpacedRuns("Page 2 of 4\nAppendix C. Countermeasures\nIs it on record?")).toEqual([]);
    // The stated limit: real one-letter words in a row read as letter spacing.
    expect(letterSpacedRuns("I am a cat, A to Z")).toEqual(["i am a", "a to z"]);
  });

  it("joins a spaced stamp so a case-sensitive whole-word test sees it", () => {
    expect(/\bDRAFT\b/.test("D R A F T: 2 required attachment(s)")).toBe(false);
    expect(/\bDRAFT\b/.test(joinLetterSpacing("D R A F T: 2 required attachment(s)"))).toBe(true);
    expect(joinLetterSpacing("A draft section\nPage 2 of 4")).toBe("A draft section\nPage 2 of 4");
  });
});

describe("loading the matcher", () => {
  it("works from a CommonJS script, as qa-harness scripts are", () => {
    const helper = fileURLToPath(new URL("../../scripts/lib/pdf-text-match.mjs", import.meta.url));
    const out = execFileSync(process.execPath, ["-e",
      `const { findPdfPhrase } = require(${JSON.stringify(helper)}); process.stdout.write(JSON.stringify(findPdfPhrase(["x", "C O M M E N T S A P P R OV E D"], "Comments approved")));`,
    ]).toString();
    expect(out).toBe("[2]");
  });
});
