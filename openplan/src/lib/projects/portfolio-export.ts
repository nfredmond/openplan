import * as XLSX from "xlsx";
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

function addColumnWidths(sheet: XLSX.WorkSheet): void {
  sheet["!cols"] = PORTFOLIO_ROUND_TRIP_HEADERS.map((header) => ({
    wch: Math.min(44, Math.max(14, header.length + 2)),
  }));
}

/**
 * Build a literal-value workbook that mirrors the reviewed portfolio importer.
 * Strings beginning with spreadsheet operators remain text cells; no formulas
 * are emitted, and decimal costs stay strings so large values are not rounded.
 */
export function buildPortfolioRoundTripWorkbook(input: {
  workspaceId: string;
  workspaceName: string;
  projects: PortfolioRoundTripProject[];
  generatedAt: Date;
}): Uint8Array {
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
  addColumnWidths(projectsSheet);

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
  readmeSheet["!cols"] = [{ wch: 26 }, { wch: 100 }];

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: `OpenPlan project portfolio — ${input.workspaceName}`,
    Subject: "Reviewed create-only portfolio round-trip",
    Author: "OpenPlan",
    CreatedDate: input.generatedAt,
  };
  XLSX.utils.book_append_sheet(workbook, projectsSheet, PORTFOLIO_ROUND_TRIP_SHEET);
  XLSX.utils.book_append_sheet(workbook, readmeSheet, "Read me");

  return new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true }));
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
