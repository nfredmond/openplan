/**
 * THE REVIEW PDF STATES ITS COUNTS AS SENTENCES A READER AND A TEXT SEARCH
 * BOTH FIND (KI-2026-11-14-310, -311).
 *
 * The campaign review PDF printed its counts as a two-column table. Read back
 * with Poppler's `pdftotext -layout`, "Approved" and its number sat about 56
 * spaces apart, and the shared matcher (scripts/lib/pdf-text-match.mjs)
 * refuses a column gap, so "Approved 3" could not be found. The PDF also had
 * no count of contributions answered by a published response. Now each count
 * is a sentence led by the state's word and its number, and a public copy says
 * what it leaves out instead of printing a zero for it.
 *
 * The first block reads the HTML the PDF is printed from. The second renders
 * the real PDF through the product's own path (`renderCampaignReviewFiles`,
 * Chrome) and reads it back with Poppler, with and without -layout, through
 * the shared matcher. It is skipped where Chrome or Poppler is missing.
 *
 * WHAT THIS FILE CANNOT PROVE. Whether the numbers are right for a real
 * campaign (the four-output agreement test checks one fixture), how a reader
 * at 390 px meets the page, or how the hosted serverless Chrome lays it out.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildCampaignReviewHtml, parseReviewSnapshot, renderCampaignReviewFiles } from "@/lib/engagement/review-export";
import { findPdfPhrase } from "../../scripts/lib/pdf-text-match.mjs";
import { internalReviewCountSnapshot, publicReviewCountSnapshot, savedSnapshot } from "./fixtures/engagement/review-counts";

const INTERNAL_SENTENCES = [
  "Received 7 contributions.",
  "Approved 4 contributions.",
  "Withheld 1 contribution.",
  "Pending 1 contribution.",
  "Flagged for review 1 contribution.",
  "Published 2 staff responses.",
  "Answered 3 contributions with a published staff response. A contribution that two responses answer counts once.",
];
const PUBLIC_LEFT_OUT = "This public copy holds approved contributions only. Withheld, pending and flagged contributions are left out, so it does not count them.";

async function html(snapshot: ReturnType<typeof internalReviewCountSnapshot>) {
  const saved = savedSnapshot(snapshot);
  return buildCampaignReviewHtml(await parseReviewSnapshot(saved.text, saved.checksum), saved.checksum);
}

function countLines(markup: string): string[] {
  const document = new DOMParser().parseFromString(markup, "text/html");
  return [...document.querySelectorAll("ul.review-counts li")].map((li) => li.textContent ?? "");
}

describe("the review PDF's counts, in the HTML it is printed from", () => {
  it("states each internal count as a sentence led by the state's word and its number", async () => {
    expect(countLines(await html(internalReviewCountSnapshot()))).toEqual(INTERNAL_SENTENCES);
  });

  it("says what a public copy leaves out instead of printing a zero for it", async () => {
    const lines = countLines(await html(publicReviewCountSnapshot()));
    expect(lines).toEqual([
      PUBLIC_LEFT_OUT,
      "Approved 4 contributions.",
      "Published 2 staff responses.",
      "Answered 3 contributions with a published staff response. A contribution that two responses answer counts once.",
    ]);
    expect(lines.join(" ")).not.toMatch(/Withheld \d|Pending \d|Flagged for review \d|Received \d/);
  });

  it("says what a selection filtered to one review state leaves out", async () => {
    const lines = countLines(await html({ ...internalReviewCountSnapshot(), filters: { status: "rejected" } }));
    expect(lines[0]).toBe("This selection holds withheld contributions only. Contributions in other review states are left out, so it does not count them.");
    expect(lines.join(" ")).not.toMatch(/Approved \d|Pending \d|Received \d/);
  });
});

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
/** Poppler's folder: another pdftotext (xpdf) can come first on PATH on Windows. */
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext", "pdfinfo"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const tool = (name: "pdftotext" | "pdfinfo") => path.join(POPPLER!, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-review-counts-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/** The real review PDF for a snapshot, read back one page at a time, plain and with -layout. */
async function reviewPdfPages(snapshot: ReturnType<typeof internalReviewCountSnapshot>) {
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  const saved = savedSnapshot(snapshot);
  const files = await renderCampaignReviewFiles(saved.text, saved.checksum);
  const file = path.join(workDir, `${snapshot.scope}.pdf`);
  writeFileSync(file, files.find((entry) => entry.format === "pdf")!.bytes);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync(tool("pdfinfo"), [file]).toString())![1]);
  const read = (layout: boolean) => Array.from({ length: pages }, (_, index) =>
    execFileSync(tool("pdftotext"), [...(layout ? ["-layout"] : []), "-f", String(index + 1), "-l", String(index + 1), file, "-"]).toString());
  return { plain: read(false), layout: read(true) };
}

describe.skipIf(!PDF_TOOLS)("the real review PDF, read back with Poppler", () => {
  it("carries each count as a phrase the shared matcher finds, with and without -layout", async () => {
    const pages = await reviewPdfPages(internalReviewCountSnapshot());
    const phrases = ["Approved 4", "Withheld 1", "Answered 3", "Received 7", "Pending 1", "Flagged for review 1", "Published 2 staff responses"];
    // Every phrase at once, so a failure names each one the PDF lacks and in which reading.
    const found = Object.fromEntries(phrases.map((phrase) => [phrase, {
      plain: findPdfPhrase(pages.plain, phrase).length > 0,
      layout: findPdfPhrase(pages.layout, phrase).length > 0,
    }]));
    expect(found).toEqual(Object.fromEntries(phrases.map((phrase) => [phrase, { plain: true, layout: true }])));
  }, 120_000);

  it("prints no withheld count in the public copy and says it leaves them out", async () => {
    const pages = await reviewPdfPages(publicReviewCountSnapshot());
    expect(findPdfPhrase(pages.layout, "Approved 4").length).toBeGreaterThan(0);
    expect(findPdfPhrase(pages.layout, "Answered 3").length).toBeGreaterThan(0);
    expect(findPdfPhrase(pages.layout, "Withheld 0")).toEqual([]);
    expect(findPdfPhrase(pages.plain, "Withheld, pending and flagged contributions are left out").length).toBeGreaterThan(0);
  }, 120_000);
});
