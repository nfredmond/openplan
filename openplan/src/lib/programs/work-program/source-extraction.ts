import type { ExtractedPage } from "@/lib/knowledge-base/types";

export type WorkProgramSourceElement = {
  key: string;
  code: string;
  title: string;
  pageFrom: number;
  pageTo: number;
  originalText: string;
  objective: string;
  discussion: string;
  priorActivities: string;
  currentActivities: string;
  products: string;
  staffingAndSchedule: string;
  responsible?: string;
  schedule?: string;
  budgetText: string;
  revenueTotal: number | null;
  costTotal: number | null;
  warnings: string[];
};

export type WorkProgramSourceExtraction = {
  parser: "edctc-work-program-v1" | "edctc-work-program-v2" | "edctc-work-program-v3" | "edctc-work-program-v4" | "edctc-work-program-v5" | "manual-page-review";
  pageCount: number;
  elements: WorkProgramSourceElement[];
  warnings: string[];
};

const heading = /^WORK ELEMENT ([0-9][A-Za-z0-9.-]*)\s*$/m;
const sections = /^(Objectives?|Discussion|Previous Work Activities[^\n]*|Current Work Activities[^\n]*|Work Activities to be completed[^\n]*|End Products|Completion Schedule[^\n]*|Work Element Budget)\s*$/gm;

function readElement(code: string, pages: (ExtractedPage & { layoutText?: string })[]): WorkProgramSourceElement {
  const originalText = pages.map((page) => page.text).join("\n");
  const content = pages.map((page) => {
    const lines = page.text.split("\n");
    const last = lines.findLastIndex((line) => Boolean(line.trim()));
    return lines.filter((line, index) => !/^FY \d{4}\/\d{2} Overall Work Program and Budget/.test(line) && !(index === last && /^\d+$/.test(line.trim()))).join("\n");
  }).join("\n");
  const start = content.search(heading);
  const body = content.slice(start);
  const matches = [...body.matchAll(sections)];
  const values = new Map<string, string>();
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    values.set(match[1], body.slice(match.index! + match[0].length, matches[index + 1]?.index ?? body.length).trim());
  }
  const section = (prefix: string) => [...values].find(([key]) => key.startsWith(prefix))?.[1] ?? "";
  const budgetSection = section("Work Element Budget");
  // Some PDFs place the table's text before its heading in extraction order.
  // Retain that whole source page instead of reconstructing its column layout.
  const budgetPage = pages.findLast((page) => page.text.includes("Work Element Budget"));
  const budgetText = /^TOTALS?\s+\$/m.test(budgetSection) ? budgetSection : budgetPage?.text ?? budgetSection;
  const totals = /Revenues\s+Expenditures/.test(budgetText) ? budgetText.match(/^TOTALS?\s+\$([\d,]+(?:\.\d{1,2})?)\s+\$([\d,]+(?:\.\d{1,2})?)\s*$/m) : null;
  const titleEnd = matches[0]?.index ?? body.indexOf("\n", body.indexOf("\n") + 1);
  const title = body.slice(body.indexOf("\n") + 1, titleEnd > 0 ? titleEnd : undefined).trim().replace(/\s+/g, " ");
  const warnings = ["Only printed work-element totals are extracted as figures. Review the original funding and expenditure breakdown before proposing allocations."];
  if (!totals) warnings.push("The two printed budget totals could not be read unambiguously; enter figures from the original table.");
  if (!(section("Current Work Activities") || section("Work Activities to be completed"))) warnings.push("Current activities were not identified; review the source pages.");
  const layout = pages.map((page) => page.layoutText ?? page.text).join("\n").split("\n");
  const header = layout.findIndex((line) => line.includes("Staff Responsible"));
  const scheduleHeader = layout.findIndex((line) => line.includes("Completion Schedule"));
  let responsible = "", schedule = "";
  if (header >= 0 && scheduleHeader >= 0) {
    const staffColumn = layout[header].indexOf("Staff Responsible"), monthsColumn = layout[header].indexOf("Total Person Months");
    const following = layout.slice(Math.min(header, scheduleHeader));
    const stop = following.findIndex((line) => line.includes("Work Element Budget"));
    const rows = stop >= 0 ? following.slice(0, stop) : following;
    schedule = rows.map((line) => line.slice(0, Math.max(0, staffColumn - 4)).trim()).filter((line) => line && line !== "Completion Schedule").join(" ");
    responsible = rows.map((line) => line.slice(Math.max(0, staffColumn - 4), monthsColumn > staffColumn ? monthsColumn - 2 : undefined).trim()).filter((line) => line && !line.startsWith("Staff Responsible")).map((line) => line.replace(/^(?:Work\s+)?Element:?\s*/i, "")).filter(Boolean).join(" ");
  }
  if (!responsible) responsible = body.match(/^Work Activities to be completed by (.+)$/m)?.[1]?.trim() ?? "";
  return {
    key: `${code}:page-${pages[0].page}`,
    code, title: title || `Work element ${code}`,
    pageFrom: pages[0].page, pageTo: pages[pages.length - 1].page,
    originalText, objective: section("Objective"), discussion: section("Discussion"),
    priorActivities: section("Previous Work Activities"), currentActivities: section("Current Work Activities") || section("Work Activities to be completed"),
    products: section("End Products"), staffingAndSchedule: section("Completion Schedule"), responsible, schedule,
    budgetText,
    revenueTotal: totals ? Number(totals[1].replaceAll(",", "")) : null,
    costTotal: totals ? Number(totals[2].replaceAll(",", "")) : null,
    warnings,
  };
}

/** Recognized public source layout only. Other documents retain a manual page-review path. */
export function extractWorkProgramSource(input: ExtractedPage[]): WorkProgramSourceExtraction {
  const pages = input.map((page) => ({ ...page, layoutText: page.text, text: page.text.split("\n").map((line) => line.trim().replace(/[ \t]+/g, " ")).join("\n") }));
  const identity = pages.slice(0, 6).map((page) => page.text).join(" ").replace(/\s+/g, " ");
  if (!/El Dorado County Transportation Commission/i.test(identity) || !/Overall Work Program/i.test(identity)) {
    return { parser: "manual-page-review", pageCount: pages.length, elements: [], warnings: ["This document's work-element layout is not recognized. Retain the original and enter or correct the proposed work manually with page references."] };
  }
  const elements: WorkProgramSourceElement[] = [];
  let pending: { code: string; pages: (ExtractedPage & { layoutText?: string })[] } | null = null;
  for (const page of pages) {
    const match = page.text.match(heading);
    if (match) {
      if (pending) elements.push(readElement(pending.code, pending.pages));
      pending = { code: match[1], pages: [page] };
    } else if (pending) pending.pages.push(page);
    if (pending && /^TOTALS?\s+\$/m.test(page.text)) {
      elements.push(readElement(pending.code, pending.pages));
      pending = null;
    }
  }
  if (pending) elements.push(readElement(pending.code, pending.pages));
  return {
    parser: "edctc-work-program-v5", pageCount: pages.length, elements,
    warnings: [
      "Extraction is a review aid. Original agency narrative, staffing schedules, financial summaries and appendices remain in the retained PDF and require separate review.",
      ...(elements.length === 0 ? ["No work-element headings were identified. Use manual page references."] : []),
    ],
  };
}
