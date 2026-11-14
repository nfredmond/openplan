/**
 * A SAFETY ACTION PLAN REPORT OPENS WITH ITS SAFETY CONTENT (KI-2026-11-14-340).
 *
 * Each plan from the first proven job opened with about eight pages of
 * OpenPlan's own records before the crash summary: the evidence chain, the
 * jurisdiction readiness registry (repository file paths with hashes,
 * California Government Code general-plan articles, "Model validation
 * evidence"), the stage-gate snapshot and the project-record snapshot.
 *
 * A report that carries a saved safety action plan now prints the plan first,
 * then the project's own sections, then those records in an appendix at the
 * back under a heading that says what they are. Nothing is dropped: every
 * sentence the report printed without the plan still prints with it. Every
 * other report keeps its order.
 *
 * Blind category: report blocks this fixture does not carry (modeling
 * evidence, dual-model agreement, aerial previews, guided comparison), which
 * the code places after the plan with the project's sections; campaign
 * reports, which never carry a plan; the hosted Chrome bundle's page breaks.
 * The PDF block is skipped where Chrome or poppler is missing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildReportHtml, type ReportGenerationData } from "@/lib/reports/html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { findPdfPhrase } from "../../scripts/lib/pdf-text-match.mjs";
import { safetyReportData } from "./fixtures/grants/safety-exports";

const APPENDIX = "Appendix: OpenPlan records behind this report";

/** The report with the project's own sections switched on, as a generated packet has them. */
function data(withPlan = true): ReportGenerationData {
  const base = safetyReportData();
  return {
    ...base,
    sections: [
      { id: "s1", section_key: "project_overview", title: "Project overview", enabled: true, sort_order: 0, config_json: {} },
      { id: "s2", section_key: "status_snapshot", title: "Current status", enabled: true, sort_order: 1, config_json: {} },
    ],
    ...(withPlan ? {} : { safetyActionPlan: null, safetyActionPlanSupport: null }),
  } as ReportGenerationData;
}

/** Each top-level heading, in reading order. */
function headings(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((match) => match[1].trim());
}

/** Visible sentences, for the "nothing dropped" comparison. */
function sentences(html: string): Set<string> {
  const text = html.replace(/<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, "\n").replace(/&#39;/g, "'");
  return new Set(text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line.length > 0));
}

describe("a report with a saved safety action plan", () => {
  it("opens with the plan and ends with the records appendix", () => {
    const order = headings(buildReportHtml(data()));
    expect(order[0]).toBe("Safety action plan (draft)");
    const appendix = order.indexOf(APPENDIX);
    expect(appendix).toBeGreaterThan(order.indexOf("Project overview"));
    expect(appendix).toBeGreaterThan(order.indexOf("Current status"));
    for (const record of ["Evidence chain summary", "Project jurisdiction context", "Jurisdiction readiness", "Governance and stage-gate provenance", "Project records provenance"]) {
      expect(order.indexOf(record), record).toBeGreaterThan(appendix);
    }
  });

  it("drops nothing the same report printed without the plan", () => {
    const withPlan = sentences(buildReportHtml(data()));
    const missing = [...sentences(buildReportHtml(data(false)))].filter((line) => !withPlan.has(line));
    expect(missing).toEqual([]);
  });
});

describe("every other report", () => {
  it("keeps its order: the records come before the project's sections", () => {
    const order = headings(buildReportHtml(data(false)));
    expect(order).not.toContain(APPENDIX);
    expect(order.indexOf("Evidence chain summary")).toBeLessThan(order.indexOf("Project overview"));
    expect(order.indexOf("Governance and stage-gate provenance")).toBeLessThan(order.indexOf("Project overview"));
  });
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
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-safety-first-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe.runIf(PDF_TOOLS)("the report as a PDF, read back with pdftotext", () => {
  it("puts the crash summary on the first pages and the records after every safety page", async () => {
    process.env.CHROME_EXECUTABLE_PATH = CHROME;
    const file = path.join(workDir, "safety-first.pdf");
    writeFileSync(file, await renderHtmlToPdf(buildReportHtml(data()), { footerLabel: "safety-first" }));
    const exe = process.platform === "win32" ? ".exe" : "";
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync(path.join(POPPLER!, `pdfinfo${exe}`), [file]).toString())![1]);
    const pageText = Array.from({ length: pages }, (_, index) =>
      execFileSync(path.join(POPPLER!, `pdftotext${exe}`), ["-f", String(index + 1), "-l", String(index + 1), file, "-"]).toString());
    const firstPage = (phrase: string) => {
      const found: number[] = findPdfPhrase(pageText, phrase);
      expect(found, phrase).not.toEqual([]);
      return Math.min(...found);
    };
    expect(firstPage("Crash summary")).toBeLessThanOrEqual(2);
    const appendix = firstPage(APPENDIX);
    for (const safety of ["High-injury network", "Countermeasures", "Benefit-cost summary", "Action plan components not yet covered"]) {
      expect(firstPage(safety), safety).toBeLessThan(appendix);
    }
    for (const record of ["Evidence chain summary", "Jurisdiction readiness", "Governance and stage-gate provenance"]) {
      expect(firstPage(record), record).toBeGreaterThanOrEqual(appendix);
    }
  }, 120_000);
});
