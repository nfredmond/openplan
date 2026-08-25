import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.join(process.cwd(), "supabase/migrations/20260825000002_direct_workbook_portfolio_import.sql"), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").trim();

describe("direct workbook portfolio import migration", () => {
  it("backfills CSV identity and replaces created-row uniqueness with sheet identity", () => {
    expect(migration).toContain("DISABLE TRIGGER project_portfolio_import_batches_immutable");
    expect(migration).toContain("ENABLE TRIGGER project_portfolio_import_batches_immutable");
    expect(migration).toContain("ADD COLUMN worksheet_index integer NOT NULL DEFAULT 0");
    expect(migration).toContain("ADD COLUMN header_row integer NOT NULL DEFAULT 1");
    const unique = migration.match(/CREATE UNIQUE INDEX project_portfolio_import_rows_created_identity_uidx[\s\S]*?WHERE outcome = 'created';/)?.[0] ?? "";
    expect(compact(unique)).toContain("workspace_id, source_sha256, worksheet_index, source_row_number, row_fingerprint");
  });

  it("records format, ordered sheet setup, sheet names, headers, formula fields, and location provenance", () => {
    for (const field of ["source_format", "sheet_configurations_json", "worksheet_index", "worksheet_name", "header_row", "formula_warning_fields", "source_location_text"]) {
      expect(migration).toContain(field);
    }
  });

  it("retains v0.33 and adds a separately versioned service-role-only atomic RPC", () => {
    expect(migration).not.toContain("DROP FUNCTION public.commit_project_portfolio_import(");
    expect(migration).toContain("project_portfolio_import_batches_csv_compatibility");
    expect(migration).toContain("'mapping', NEW.mapping_json");
    expect(migration).toContain("'defaults', NEW.defaults_json");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.commit_project_portfolio_import_v2");
    expect(compact(migration)).toContain("REVOKE ALL ON FUNCTION public.commit_project_portfolio_import_v2( uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb ) FROM PUBLIC, anon, authenticated");
    expect(compact(migration)).toContain("GRANT EXECUTE ON FUNCTION public.commit_project_portfolio_import_v2( uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb ) TO service_role");
  });

  it("rechecks actor role, source scope/hash/status/format, ordered sheets, rows, formulas, and cross-sheet IDs", () => {
    for (const evidence of [
      "v_role IS NULL OR v_role = 'viewer'",
      "d.workspace_id = p_workspace_id",
      "d.project_id IS NULL",
      "v_source_checksum <> p_source_hash",
      "v_source_status <> 'stored'",
      "v_source_content_type",
      "worksheetIndex",
      "v_previous_sheet",
      "does not match its worksheet setup",
      "confirmFormula",
      "Duplicate source IDs cannot create projects",
    ]) expect(migration).toContain(evidence);
  });

  it("inserts projects and immutable provenance in the same transaction without geography columns", () => {
    const body = migration.match(/CREATE OR REPLACE FUNCTION public\.commit_project_portfolio_import_v2[\s\S]*?\n\$\$;/)?.[0] ?? "";
    expect(body).toContain("INSERT INTO public.project_portfolio_import_batches");
    expect(body).toContain("INSERT INTO public.projects");
    expect(body).toContain("INSERT INTO public.project_portfolio_import_rows");
    const projectColumns = body.match(/INSERT INTO public\.projects \(([\s\S]*?)\) VALUES/)?.[1] ?? "";
    expect(projectColumns).not.toMatch(/source_location|geograph|geometry|coordinate|latitude|longitude|\bbbox\b|place_id/);
    expect(projectColumns).toContain("estimated_cost_source_document_id");
  });
});
