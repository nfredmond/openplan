import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPortfolioImporter } from "@/components/projects/project-portfolio-importer";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";
const SOURCE_ID = "660e8400-e29b-41d4-a716-446655440000";
const PREVIEW_HASH = "a".repeat(64);

const cell = (display: string) => ({ type: display ? "text" : "blank", value: display || null, display, formula: false, formulaHash: null, formulaResult: "none" });
const inspection = {
  format: "xlsx", sourceHash: "b".repeat(64), byteLength: 1000,
  worksheets: [
    { index: 0, name: "North", visibility: "visible", rowCount: 3, columnCount: 3, sampleRows: [{ rowNumber: 1, cells: [cell("ID"), cell("Project"), cell("Cost")] }, { rowNumber: 2, cells: [cell("N-1"), cell("Clean project"), cell("10")] }] },
    { index: 1, name: "South", visibility: "hidden", rowCount: 3, columnCount: 3, sampleRows: [{ rowNumber: 1, cells: [cell(" id "), cell("PROJECT"), cell("Cost")] }, { rowNumber: 2, cells: [cell("S-1"), cell("Formula project"), cell("20")] }] },
    { index: 2, name: "Notes", visibility: "visible", rowCount: 2, columnCount: 2, sampleRows: [{ rowNumber: 1, cells: [cell("Topic"), cell("Text")] }] },
  ],
};

function reviewed(rows: Array<Record<string, unknown>>) {
  const rowByKey = new Map(rows.map((row) => [`${row.worksheetIndex}:${row.rowNumber}`, row]));
  const cleanInput = rowByKey.get("0:2");
  const formulaInput = rowByKey.get("1:2");
  const cleanDecision = cleanInput?.decision === "create" ? "create" : "skip";
  const formulaDecision = formulaInput?.decision === "create" ? "create" : "skip";
  const formulaConfirmed = Boolean(formulaInput?.confirmFormula);
  return {
    version: 2, format: "xlsx", sourceHash: "b".repeat(64), previewHash: PREVIEW_HASH, byteLength: 1000,
    worksheets: inspection.worksheets,
    configurations: [],
    sheets: [
      { worksheetIndex: 0, worksheetName: "North", headerRow: 1, headers: ["ID", "Project", "Cost"], duplicateHeaders: [] },
      { worksheetIndex: 1, worksheetName: "South", headerRow: 1, headers: [" id ", "PROJECT", "Cost"], duplicateHeaders: [] },
      { worksheetIndex: 2, worksheetName: "Notes", headerRow: 1, headers: ["Topic", "Text"], duplicateHeaders: [] },
    ],
    rows: [
      {
        worksheetIndex: 0, worksheetName: "North", headerRow: 1, rowNumber: 2, fingerprint: "c".repeat(64),
        name: "Clean project", sourceId: "N-1", description: null, sourceLocationText: "North district", estimatedCost: null,
        planType: "capital_program", status: "draft", deliveryPhase: "programming", decision: cleanDecision,
        confirmNameMatch: false, confirmFormula: false, formulaFields: [], state: "clean", canCreate: true,
        errors: [], warnings: [], matchingProjectIds: [], matchingBatchRows: [], previouslyCreatedProjectId: null,
      },
      {
        worksheetIndex: 1, worksheetName: "South", headerRow: 1, rowNumber: 2, fingerprint: "d".repeat(64),
        name: "Formula project", sourceId: "S-1", description: null, sourceLocationText: null,
        estimatedCost: { amount: "20", currency: "USD", priceYear: 2026 }, planType: "capital_program",
        status: "draft", deliveryPhase: "programming", decision: formulaDecision, confirmNameMatch: false,
        confirmFormula: formulaConfirmed, formulaFields: ["estimatedCost"], state: "warning",
        canCreate: formulaDecision === "skip" || formulaConfirmed, errors: [],
        warnings: [{ code: "formula_value", message: "Mapped formula fields use cached workbook values: estimatedCost." }],
        matchingProjectIds: [], matchingBatchRows: [], previouslyCreatedProjectId: null,
      },
    ],
    formulaWarnings: [{ worksheetIndex: 1, rowNumber: 2, fields: ["estimatedCost"] }],
    counts: { rows: 2, selectedForCreate: (cleanDecision === "create" ? 1 : 0) + (formulaDecision === "create" && formulaConfirmed ? 1 : 0), skipped: (cleanDecision === "skip" ? 1 : 0) + (formulaDecision === "skip" ? 1 : 0), conflicted: 0, invalid: 0, previouslyCreated: 0 },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("ProjectPortfolioImporter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a workbook, selects several sheets, copies exact-header setup, confirms a formula row, and commits", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/knowledge-base/documents")) {
        requests.push({ url, body: null });
        return jsonResponse({ document: { id: SOURCE_ID, title: "portfolio.xlsx" } }, 201);
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if (body.mode === "inspect") return jsonResponse({ source: { id: SOURCE_ID, format: "xlsx" }, inspection });
      const rows = (body.rowReviews ?? []) as Array<Record<string, unknown>>;
      if (body.mode === "commit") return jsonResponse({ review: reviewed(rows), committed: { batchId: "batch", created: 2, skipped: 0, conflicted: 0, invalid: 0, previouslyCreated: 0, projectIds: ["one", "two"] } }, 201);
      return jsonResponse({ review: reviewed(rows) });
    }));

    render(<ProjectPortfolioImporter workspaceId={WORKSPACE_ID} recentImports={[]} historyReadFailed={false} />);
    const file = new File(["workbook bytes"], "portfolio.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(screen.getByLabelText(/Project list, up to/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /Store source and inspect worksheets/i }));

    expect(await screen.findByText(/No worksheet is selected automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/Location text is provenance, not verified geography/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select worksheet North"));
    fireEvent.click(screen.getByLabelText("Select worksheet South"));
    fireEvent.click(screen.getByLabelText("Select worksheet Notes"));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Copy setup to exact-header matches/i })).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Project name for North"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Source ID for North"), { target: { value: "0" } });
    await waitFor(() => expect(screen.getByLabelText("Source ID for North")).toHaveValue("0"));
    fireEvent.click(screen.getAllByRole("button", { name: /Copy setup to exact-header matches/i })[0]);
    expect(await screen.findByRole("status")).toHaveTextContent("Headers did not match: Notes");
    expect(screen.getByLabelText("Project name for South")).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: "Preview selected worksheets" }));
    expect(await screen.findByText("Clean project")).toBeInTheDocument();
    expect(screen.getAllByText("Formula project").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Create all clean rows" }));
    fireEvent.change(screen.getByLabelText("Decision for South row 2"), { target: { value: "create" } });
    fireEvent.click(screen.getByLabelText(/Use cached formula values for estimatedCost/i));
    expect(screen.getByRole("button", { name: /Confirm and create/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review selections" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm and create 2" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Confirm and create 2" }));
    expect(await screen.findByText(/Created 2, skipped 0/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open created project 1" })).toHaveAttribute("href", "/projects/one");
    expect(refreshMock).toHaveBeenCalled();

    const commit = requests.find((entry) => entry.body?.mode === "commit")?.body;
    const configurations = commit?.configurations as Array<Record<string, unknown>>;
    expect(configurations.map((config) => config.worksheetIndex)).toEqual([0, 1, 2]);
    expect(configurations[1]).toMatchObject({ mapping: { name: 1, sourceId: 0 } });
    expect((commit?.rowReviews as Array<Record<string, unknown>>)).toEqual(expect.arrayContaining([
      expect.objectContaining({ worksheetIndex: 0, rowNumber: 2, decision: "create" }),
      expect.objectContaining({ worksheetIndex: 1, rowNumber: 2, decision: "create", confirmFormula: true }),
    ]));
  });

  it("shows a source-review failure and an honest history-read failure", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/knowledge-base/documents")) return jsonResponse({ document: { id: SOURCE_ID, title: "bad.xlsx" } }, 201);
      return jsonResponse({ error: "The workbook archive is malformed." }, 400);
    }));
    render(<ProjectPortfolioImporter workspaceId={WORKSPACE_ID} recentImports={[]} historyReadFailed />);
    fireEvent.change(screen.getByLabelText(/Project list, up to/i), { target: { files: [new File(["bad"], "bad.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })] } });
    fireEvent.click(screen.getByRole("button", { name: /Store source and inspect worksheets/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("archive is malformed");
    const history = screen.getByRole("heading", { name: "Recent imports" }).parentElement;
    expect(within(history as HTMLElement).getByText(/Import history could not be read/i)).toBeInTheDocument();
    expect(within(history as HTMLElement).queryByText(/No reviewed portfolio imports/i)).toBeNull();
  });
});
