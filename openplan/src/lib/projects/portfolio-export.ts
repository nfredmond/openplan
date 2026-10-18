import * as XLSX from "xlsx";
import JSZip from "jszip";
import { formatReviewWorkbook } from "@/lib/export/review-workbook-layout";
import { PORTFOLIO_IMPORT_MAX_ROWS } from "@/lib/projects/portfolio-workbook";
import {
  PORTFOLIO_ROUND_TRIP_HEADERS,
  PORTFOLIO_ROUND_TRIP_MAPPING,
  PORTFOLIO_ROUND_TRIP_SHEET,
  PORTFOLIO_ROUND_TRIP_VERSION,
} from "@/lib/projects/portfolio-round-trip-contract";

export const PORTFOLIO_ROUND_TRIP_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export {
  PORTFOLIO_ROUND_TRIP_HEADERS,
  PORTFOLIO_ROUND_TRIP_MAPPING,
  PORTFOLIO_ROUND_TRIP_SHEET,
  PORTFOLIO_ROUND_TRIP_VERSION,
} from "@/lib/projects/portfolio-round-trip-contract";

export type PortfolioRoundTripProject = {
  id: string;
  name: string;
  summary: string | null;
  status: string;
  plan_type: string;
  delivery_phase: string;
  estimated_cost_amount: string | number | null;
  estimated_cost_currency: string | null;
  estimated_cost_basis_year: number | null;
  estimated_cost_source_document_id: string | null;
  estimated_cost_recorded_at: string | null;
  place_source: string | null;
  place_kind: string | null;
  place_ref: string | null;
  place_label: string | null;
  place_country_code: string | null;
  place_subdivision_code: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: string | number | null | undefined): string {
  return value == null ? "" : String(value);
}

const projectWidths = [32, 40, 44, 22, 16, 18, 22, 14, 18, 32, 18, 16, 24, 16, 20, 40, 30, 30, 30];

/** Reserve space for wrapped text, explicit line breaks and wide glyphs at 11 points. */
function rowHeight(row: string[], widths: number[]): { hpt: number } {
  const lines = row.map((value, index) => value.split("\n").reduce((sum, line) =>
    sum + Math.max(1, Math.ceil(Array.from(line).reduce((width, char) =>
      width + (char.codePointAt(0)! >= 0x2e80 ? 2 : 1), 0) / (widths[index] - 2))), 0));
  return { hpt: Math.min(409, Math.max(24, ...lines.map(count => count * 15 + 8))) };
}

/**
 * Build a literal-value workbook that mirrors the reviewed portfolio importer.
 * Strings beginning with spreadsheet operators remain text cells; no formulas
 * are emitted, and decimal costs stay strings so large values are not rounded.
 */
export async function buildPortfolioRoundTripWorkbook(input: {
  workspaceId: string;
  workspaceName: string;
  projects: PortfolioRoundTripProject[];
  generatedAt: Date;
}): Promise<Uint8Array> {
  if (input.projects.length > PORTFOLIO_IMPORT_MAX_ROWS) {
    throw new Error("portfolio_round_trip_row_limit");
  }

  const projectRows = input.projects.map((project) => [
    text(project.name),
    text(project.id),
    text(project.summary),
    text(project.estimated_cost_amount),
    text(project.estimated_cost_currency),
    text(project.estimated_cost_basis_year),
    text(project.plan_type),
    text(project.status),
    text(project.delivery_phase),
    text(project.place_label),
    text(project.place_source),
    text(project.place_kind),
    text(project.place_ref),
    text(project.place_country_code),
    text(project.place_subdivision_code),
    text(project.estimated_cost_source_document_id),
    text(project.estimated_cost_recorded_at),
    text(project.created_at),
    text(project.updated_at),
  ]);
  const projectsSheet = XLSX.utils.aoa_to_sheet([
    [...PORTFOLIO_ROUND_TRIP_HEADERS],
    ...projectRows,
  ]);
  projectsSheet["!autofilter"] = {
    ref: `A1:${XLSX.utils.encode_col(PORTFOLIO_ROUND_TRIP_HEADERS.length - 1)}${Math.max(1, projectRows.length + 1)}`,
  };
  projectsSheet["!cols"] = projectWidths.map(wch => ({ wch }));
  projectsSheet["!rows"] = [{ hpt: 40 }, ...projectRows.map(row => rowHeight(row, projectWidths))];

  const instructions = [
    ["OpenPlan portfolio round-trip workbook", `version ${PORTFOLIO_ROUND_TRIP_VERSION}`],
    ["Generated at", input.generatedAt.toISOString()],
    ["Workspace", input.workspaceName],
    ["Workspace ID", input.workspaceId],
    ["Project rows", String(input.projects.length)],
    ["Import worksheet", PORTFOLIO_ROUND_TRIP_SHEET],
    ["Header row", "1"],
    ["Cost scale", "Units"],
    ["Import behavior", "Create only. Every row starts as Skip and must be explicitly reviewed."],
    ["Geography limit", "Source-location text is retained for review but does not create a project boundary or map point."],
    ["Reference columns", "Place identity, cost provenance, and timestamps are exported for inspection but are not imported as project fields."],
    ["Formula policy", "This workbook contains literal values only. OpenPlan does not emit or recalculate formulas."],
    [],
    ["Map this OpenPlan field", "To this Projects column"],
    ["Project name", PORTFOLIO_ROUND_TRIP_HEADERS[PORTFOLIO_ROUND_TRIP_MAPPING.name]],
    ["Source ID", PORTFOLIO_ROUND_TRIP_HEADERS[PORTFOLIO_ROUND_TRIP_MAPPING.sourceId]],
    ["Description", PORTFOLIO_ROUND_TRIP_HEADERS[PORTFOLIO_ROUND_TRIP_MAPPING.description]],
    ["Estimated cost", PORTFOLIO_ROUND_TRIP_HEADERS[PORTFOLIO_ROUND_TRIP_MAPPING.estimatedCost]],
    ["Cost currency", PORTFOLIO_ROUND_TRIP_HEADERS[PORTFOLIO_ROUND_TRIP_MAPPING.costCurrency]],
    ["Cost price year", PORTFOLIO_ROUND_TRIP_HEADERS[PORTFOLIO_ROUND_TRIP_MAPPING.costPriceYear]],
    ["Project type", PORTFOLIO_ROUND_TRIP_HEADERS[PORTFOLIO_ROUND_TRIP_MAPPING.planType]],
    ["Status", PORTFOLIO_ROUND_TRIP_HEADERS[PORTFOLIO_ROUND_TRIP_MAPPING.status]],
    ["Delivery phase", PORTFOLIO_ROUND_TRIP_HEADERS[PORTFOLIO_ROUND_TRIP_MAPPING.deliveryPhase]],
    ["Source-location text", PORTFOLIO_ROUND_TRIP_HEADERS[PORTFOLIO_ROUND_TRIP_MAPPING.sourceLocation]],
  ];
  const readmeSheet = XLSX.utils.aoa_to_sheet(instructions);
  const readmeWidths = [28, 48];
  readmeSheet["!cols"] = readmeWidths.map(wch => ({ wch }));
  readmeSheet["!rows"] = instructions.map(row => rowHeight(row, readmeWidths));

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: `OpenPlan project portfolio: ${input.workspaceName}`,
    Subject: "Reviewed create-only portfolio round-trip",
    Author: "OpenPlan",
    CreatedDate: input.generatedAt,
  };
  XLSX.utils.book_append_sheet(workbook, projectsSheet, PORTFOLIO_ROUND_TRIP_SHEET);
  XLSX.utils.book_append_sheet(workbook, readmeSheet, "Read me");

  workbook.Workbook = { Names: [
    { Name: "_xlnm.Print_Titles", Sheet: 0, Ref: "'Projects'!$1:$1" },
    { Name: "_xlnm.Print_Area", Sheet: 0, Ref: `'Projects'!$A$1:$S$${projectRows.length + 1}` },
    { Name: "_xlnm.Print_Area", Sheet: 1, Ref: `'Read me'!$A$1:$B$${instructions.length}` },
  ] };
  const zip = await JSZip.loadAsync(XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true }) as Buffer);
  await formatReviewWorkbook(zip, { worksheets: [
    { page: { orientation: "landscape", scale: 100 } },
    { headerRows: [1, 14], freezeHeader: false, page: { orientation: "portrait", scale: 100 } },
  ] });
  return new Uint8Array(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

export function portfolioRoundTripFilename(workspaceName: string, generatedAt: Date): string {
  const slug = workspaceName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "workspace";
  return `openplan-${slug}-projects-${generatedAt.toISOString().slice(0, 10)}.xlsx`;
}
