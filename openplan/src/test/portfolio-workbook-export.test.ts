import * as XLSX from "xlsx";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { reviewPortfolioWorkbook } from "@/lib/projects/portfolio-import";
import {
  buildPortfolioRoundTripWorkbook,
  PORTFOLIO_ROUND_TRIP_CONTENT_TYPE,
  PORTFOLIO_ROUND_TRIP_HEADERS,
  PORTFOLIO_ROUND_TRIP_MAPPING,
  portfolioRoundTripFilename,
} from "@/lib/projects/portfolio-export";
import { mappingForOpenPlanRoundTripHeaders } from "@/lib/projects/portfolio-round-trip-contract";

const generatedAt = new Date("2026-08-26T18:30:00.000Z");
const projects = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "=Literal project name",
    summary: "+Literal description",
    status: "active",
    plan_type: "corridor_plan",
    delivery_phase: "analysis",
    estimated_cost_amount: "12500000.25",
    estimated_cost_currency: "CAD",
    estimated_cost_basis_year: 2025,
    estimated_cost_source_document_id: "33333333-3333-4333-8333-333333333333",
    estimated_cost_recorded_at: "2026-08-20T00:00:00.000Z",
    place_source: "tigerweb",
    place_kind: "county",
    place_ref: "06057",
    place_label: "Nevada County, California",
    place_country_code: "US",
    place_subdivision_code: "CA",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "-Project without cost or place",
    summary: "@Literal note",
    status: "draft",
    plan_type: "capital_program",
    delivery_phase: "programming",
    estimated_cost_amount: null,
    estimated_cost_currency: null,
    estimated_cost_basis_year: null,
    estimated_cost_source_document_id: null,
    estimated_cost_recorded_at: null,
    place_source: null,
    place_kind: null,
    place_ref: null,
    place_label: null,
    place_country_code: null,
    place_subdivision_code: null,
    created_at: "2026-08-02T00:00:00.000Z",
    updated_at: "2026-08-24T00:00:00.000Z",
  },
];

describe("portfolio XLSX round-trip", () => {
  it("round-trips an estimated cost whose price year is unknown without inventing a default", async () => {
    const bytes = await buildPortfolioRoundTripWorkbook({
      workspaceId: "44444444-4444-4444-8444-444444444444", workspaceName: "OpenPlan QA",
      projects: [{ ...projects[0], estimated_cost_basis_year: null }], generatedAt,
    });
    const review = await reviewPortfolioWorkbook({
      bytes, filename: "portfolio.xlsx", contentType: PORTFOLIO_ROUND_TRIP_CONTENT_TYPE,
      configurations: [{
        worksheetIndex: 0, headerRow: 1, mapping: PORTFOLIO_ROUND_TRIP_MAPPING,
        defaults: { planType: "capital_program", status: "draft", deliveryPhase: "programming", cost: { currency: "USD", scale: "ones", priceYear: 2026 } },
      }],
    });
    expect(review.rows[0]).toMatchObject({
      estimatedCost: { amount: "12500000.25", currency: "CAD", priceYear: null },
      canCreate: true, errors: [], warnings: [{ code: "unknown_price_year" }],
    });
  });

  it("re-enters the reviewed importer with exact row-level project fields and no formulas", async () => {
    const bytes = await buildPortfolioRoundTripWorkbook({
      workspaceId: "44444444-4444-4444-8444-444444444444",
      workspaceName: "OpenPlan QA",
      projects,
      generatedAt,
    });
    const workbook = XLSX.read(bytes, { type: "array", cellFormula: true });
    expect(workbook.SheetNames).toEqual(["Projects", "Read me"]);
    const sheet = workbook.Sheets.Projects;
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })[0]).toEqual([...PORTFOLIO_ROUND_TRIP_HEADERS]);
    expect(sheet.A2).toMatchObject({ t: "s", v: "=Literal project name" });
    expect(sheet.A2.f).toBeUndefined();
    expect(sheet.C2).toMatchObject({ t: "s", v: "+Literal description" });
    expect(sheet.C2.f).toBeUndefined();
    expect(sheet.A3).toMatchObject({ t: "s", v: "-Project without cost or place" });
    expect(sheet.A3.f).toBeUndefined();
    expect(sheet.C3).toMatchObject({ t: "s", v: "@Literal note" });
    expect(sheet.C3.f).toBeUndefined();

    const review = await reviewPortfolioWorkbook({
      bytes,
      filename: "portfolio.xlsx",
      contentType: PORTFOLIO_ROUND_TRIP_CONTENT_TYPE,
      configurations: [{
        worksheetIndex: 0,
        headerRow: 1,
        mapping: PORTFOLIO_ROUND_TRIP_MAPPING,
        defaults: {
          planType: "capital_program",
          status: "draft",
          deliveryPhase: "programming",
          cost: { currency: "USD", scale: "ones", priceYear: 2026 },
        },
      }],
    });

    expect(review.rows).toHaveLength(2);
    expect(review.rows[0]).toMatchObject({
      name: "=Literal project name",
      sourceId: projects[0].id,
      description: "+Literal description",
      estimatedCost: { amount: "12500000.25", currency: "CAD", priceYear: 2025 },
      planType: "corridor_plan",
      status: "active",
      deliveryPhase: "analysis",
      sourceLocationText: "Nevada County, California",
      formulaFields: [],
      errors: [],
    });
    expect(review.rows[1]).toMatchObject({
      estimatedCost: null,
      planType: "capital_program",
      status: "draft",
      deliveryPhase: "programming",
      sourceLocationText: null,
      errors: [],
    });
    expect(review.rows[0]).not.toHaveProperty("geometry");
  });

  it("refuses to build a workbook that the importer would have to truncate", async () => {
    await expect(buildPortfolioRoundTripWorkbook({
      workspaceId: "44444444-4444-4444-8444-444444444444",
      workspaceName: "OpenPlan QA",
      projects: Array.from({ length: 2_001 }, () => projects[1]),
      generatedAt,
    })).rejects.toThrow("portfolio_round_trip_row_limit");
  });

  it("emits wrapped cells, bounded readme printing and readable repeated project headers", async () => {
    const bytes = await buildPortfolioRoundTripWorkbook({
      workspaceId: "44444444-4444-4444-8444-444444444444", workspaceName: "A & B <review> \"quoted\"",
      projects, generatedAt,
    });
    const zip = await JSZip.loadAsync(bytes);
    const xml = async (path: string) => new DOMParser().parseFromString(await zip.file(path)!.async("string"), "application/xml");
    const styles = await xml("xl/styles.xml");
    expect(styles.querySelector("parsererror"), "valid style XML").toBeNull();
    const cellStyles = [...styles.querySelectorAll("cellXfs > xf")];
    expect(cellStyles[1].querySelector("alignment")?.getAttribute("wrapText"), "header wrap serialized").toBe("1");
    expect(cellStyles[2].querySelector("alignment")?.getAttribute("wrapText"), "body wrap serialized").toBe("1");
    const project = await xml("xl/worksheets/sheet1.xml"), readme = await xml("xl/worksheets/sheet2.xml");
    expect(project.querySelector('c[r="A1"]')?.getAttribute("s"), "styled project header").toBe("1");
    expect(project.querySelector('c[r="B2"]')?.getAttribute("s"), "styled project body").toBe("2");
    expect(project.querySelector("pane")?.getAttribute("state"), "frozen project header").toBe("frozen");
    expect(project.querySelector("pane")?.getAttribute("topLeftCell")).toBe("A2");
    for (const sheet of [project, readme]) {
      expect(sheet.querySelector("parsererror"), "valid worksheet XML").toBeNull();
      expect(sheet.querySelector("pageSetup")?.getAttribute("scale"), "readable native print scale").toBe("100");
      expect(sheet.querySelector("pageSetup")?.hasAttribute("fitToWidth"), "no microscopic one-page fit").toBe(false);
      expect(sheet.querySelector("sheetProtection"), "no work-program protection").toBeNull();
    }
    expect(project.querySelector("pageSetup")?.getAttribute("orientation")).toBe("landscape");
    expect(readme.querySelector("pageSetup")?.getAttribute("orientation")).toBe("portrait");
    expect(Number(project.querySelector('col[min="2"]')?.getAttribute("width")), "ID width").toBeGreaterThanOrEqual(40);
    expect(Number(project.querySelector('row[r="1"]')?.getAttribute("ht")), "wrapped project headers have height").toBeGreaterThanOrEqual(38);
    expect(Number(readme.querySelector('col[min="2"]')?.getAttribute("width")), "bounded readme value width").toBeLessThan(50);
    expect(Number(readme.querySelector('row[r="11"]')?.getAttribute("ht")), "long readme guidance has height").toBeGreaterThanOrEqual(38);
    expect(readme.querySelector('c[r="A14"]')?.getAttribute("s"), "mapping header style").toBe("1");
    const book = await xml("xl/workbook.xml");
    const names = [...book.querySelectorAll("definedName")].map(node => [node.getAttribute("name"), node.getAttribute("localSheetId"), node.textContent]);
    expect(names, "repeat project headers vertically").toContainEqual(["_xlnm.Print_Titles", "0", "'Projects'!$1:$1"]);
    expect(names, "bounded complete readme print area").toContainEqual(["_xlnm.Print_Area", "1", "'Read me'!$A$1:$B$24"]);
    const workbook = XLSX.read(bytes, { type: "array" });
    expect(workbook.Sheets["Read me"].B3.v, "XML-sensitive workspace text retained").toBe('A & B <review> "quoted"');
  });

  it("keeps identical serialization inputs byte-stable across formatting times", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const input = { workspaceId: "44444444-4444-4444-8444-444444444444", workspaceName: "OpenPlan QA", projects, generatedAt };
      vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
      const first = await buildPortfolioRoundTripWorkbook(input);
      vi.setSystemTime(new Date("2026-10-15T01:00:00Z"));
      expect(Buffer.from(await buildPortfolioRoundTripWorkbook(input)).equals(Buffer.from(first)), "formatting retains deterministic ZIP dates").toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a bounded filesystem-safe filename", () => {
    expect(portfolioRoundTripFilename("Région / North & South", generatedAt)).toBe(
      "openplan-region-north-south-projects-2026-08-26.xlsx"
    );
  });

  it("auto-maps only the exact OpenPlan header contract", () => {
    expect(mappingForOpenPlanRoundTripHeaders([...PORTFOLIO_ROUND_TRIP_HEADERS])).toEqual(
      PORTFOLIO_ROUND_TRIP_MAPPING
    );
    const staleHeaders: string[] = [...PORTFOLIO_ROUND_TRIP_HEADERS];
    staleHeaders[7] = "Project status";
    expect(mappingForOpenPlanRoundTripHeaders(staleHeaders)).toBeNull();
    expect(mappingForOpenPlanRoundTripHeaders([...PORTFOLIO_ROUND_TRIP_HEADERS, "Extra column"])).toBeNull();
  });
});
