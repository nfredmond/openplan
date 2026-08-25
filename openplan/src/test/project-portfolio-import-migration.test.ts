import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260825000001_reviewed_portfolio_import.sql"
  ),
  "utf8"
);

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

describe("reviewed portfolio import migration", () => {
  it("records immutable batches and rows with source deletion restricted", () => {
    expect(migration).toContain("CREATE TABLE public.project_portfolio_import_batches");
    expect(migration).toContain("CREATE TABLE public.project_portfolio_import_rows");
    expect(migration).toMatch(/source_document_id uuid NOT NULL REFERENCES public\.kb_documents\(id\) ON DELETE RESTRICT/);
    expect(migration).toMatch(/original_workbook_document_id uuid REFERENCES public\.kb_documents\(id\) ON DELETE RESTRICT/);
    expect(migration).toContain("project_portfolio_import_batches_immutable");
    expect(migration).toContain("project_portfolio_import_rows_immutable");
    expect(migration).toContain("RAISE EXCEPTION 'Project portfolio import provenance is immutable'");
  });

  it("locks only rows that actually created a project", () => {
    const unique = migration.match(
      /CREATE UNIQUE INDEX project_portfolio_import_rows_created_identity_uidx[\s\S]*?WHERE outcome = 'created';/
    )?.[0];
    expect(compact(unique ?? "")).toContain(
      "workspace_id, source_sha256, source_row_number, row_fingerprint"
    );
    expect(unique).toContain("WHERE outcome = 'created'");
  });

  it("keeps the atomic RPC service-role-only", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.commit_project_portfolio_import");
    expect(migration).toContain("SECURITY DEFINER");
    expect(compact(migration)).toContain(
      "REVOKE ALL ON FUNCTION public.commit_project_portfolio_import( uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb ) FROM PUBLIC, anon, authenticated"
    );
    expect(compact(migration)).toContain(
      "GRANT EXECUTE ON FUNCTION public.commit_project_portfolio_import( uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb ) TO service_role"
    );
  });

  it("rechecks the actor's current write role and workspace-level source inside the transaction", () => {
    expect(compact(migration)).toContain(
      "WHERE wm.workspace_id = p_workspace_id AND wm.user_id = p_actor_id"
    );
    expect(migration).toContain("IF v_role IS NULL OR v_role = 'viewer' THEN");
    expect(compact(migration)).toContain(
      "WHERE d.id = p_source_document_id AND d.workspace_id = p_workspace_id AND d.project_id IS NULL AND d.source_kind = 'uploaded_spreadsheet'"
    );
    expect(migration).toContain("v_source_checksum <> p_source_hash");
    expect(migration).toContain("v_source_extraction <> 'spreadsheet_parse'");
  });

  it("writes the batch, every audit row, and selected projects inside that one function", () => {
    const functionBody = migration.match(
      /CREATE OR REPLACE FUNCTION public\.commit_project_portfolio_import[\s\S]*?\n\$\$;/
    )?.[0];
    expect(functionBody).toContain("INSERT INTO public.project_portfolio_import_batches");
    expect(functionBody).toContain("INSERT INTO public.project_portfolio_import_rows");
    expect(functionBody).toContain("INSERT INTO public.projects");
  });

  it("carries exact imported cost provenance from the workspace-level CSV", () => {
    const projectInsert = migration.match(
      /INSERT INTO public\.projects \([\s\S]*?\)\s*VALUES \([\s\S]*?\)\s*RETURNING id INTO v_project_id;/
    )?.[0];
    expect(projectInsert).toContain("estimated_cost_amount");
    expect(projectInsert).toContain("estimated_cost_currency");
    expect(projectInsert).toContain("estimated_cost_basis_year");
    expect(projectInsert).toContain("estimated_cost_source_document_id");
    expect(projectInsert).toContain("p_source_document_id");
    expect(projectInsert).toContain("p_actor_id");
  });

  it("does not turn source-location text into project geography", () => {
    const projectInsertColumns = migration.match(
      /INSERT INTO public\.projects \(([\s\S]*?)\)\s*VALUES/
    )?.[1];
    expect(projectInsertColumns).toBeTruthy();
    expect(projectInsertColumns).not.toMatch(
      /source_location|geograph|geometry|coordinate|latitude|longitude|\bbbox\b|place_id/
    );
    expect(migration).toContain("source_location_text text");
  });
});
