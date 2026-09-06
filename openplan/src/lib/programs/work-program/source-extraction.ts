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
  budgetText: string;
  revenueTotal: number | null;
  costTotal: number | null;
  warnings: string[];
};

export type WorkProgramSourceExtraction = {
  parser: "edctc-work-program-v1" | "edctc-work-program-v2" | "manual-page-review";
  pageCount: number;
  elements: WorkProgramSourceElement[];
  warnings: string[];
};

const heading = /^WORK ELEMENT ([0-9][A-Za-z0-9.-]*)\s*$/m;
const sections = /^(Objectives?|Discussion|Previous Work Activities[^\n]*|Current Work Activities[^\n]*|End Products|Completion Schedule|Work Element Budget)\s*$/gm;

function readElement(code: string, pages: ExtractedPage[]): WorkProgramSourceElement {
  const originalText = pages.map((page) => page.text).join("\n");
  const start = originalText.search(heading);
  const body = originalText.slice(start);
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
  if (!section("Current Work Activities")) warnings.push("Current activities were not identified; review the source pages.");
  return {
    key: `${code}:page-${pages[0].page}`,
    code, title: title || `Work element ${code}`,
    pageFrom: pages[0].page, pageTo: pages[pages.length - 1].page,
    originalText, objective: section("Objective"), discussion: section("Discussion"),
    priorActivities: section("Previous Work Activities"), currentActivities: section("Current Work Activities"),
    products: section("End Products"), staffingAndSchedule: section("Completion Schedule"),
    budgetText,
    revenueTotal: totals ? Number(totals[1].replaceAll(",", "")) : null,
    costTotal: totals ? Number(totals[2].replaceAll(",", "")) : null,
    warnings,
  };
}

/** Recognized public source layout only. Other documents retain a manual page-review path. */
export function extractWorkProgramSource(pages: ExtractedPage[]): WorkProgramSourceExtraction {
  const identity = pages.slice(0, 6).map((page) => page.text).join(" ").replace(/\s+/g, " ");
  if (!/El Dorado County Transportation Commission/i.test(identity) || !/Overall Work Program/i.test(identity)) {
    return { parser: "manual-page-review", pageCount: pages.length, elements: [], warnings: ["This document's work-element layout is not recognized. Retain the original and enter or correct the proposed work manually with page references."] };
  }
  const elements: WorkProgramSourceElement[] = [];
  let pending: { code: string; pages: ExtractedPage[] } | null = null;
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
    parser: "edctc-work-program-v2", pageCount: pages.length, elements,
    warnings: [
      "Extraction is a review aid. Original agency narrative, staffing schedules, financial summaries and appendices remain in the retained PDF and require separate review.",
      ...(elements.length === 0 ? ["No work-element headings were identified. Use manual page references."] : []),
    ],
  };
}
