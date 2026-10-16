import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.join(process.cwd(),
  "supabase/migrations/20261017000017_portfolio_skip_invalid_classifications.sql"), "utf8");
const sql = migration.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();

// Source checks cannot execute PL/pgSQL or establish live RLS and rollback behavior.
// The adjacent rollback-only native probe covers those separate boundaries.
describe("portfolio skipped invalid classification migration", () => {
  it("requires valid classifications only for create while retaining structural and creation guards", () => {
    const rowValidation = sql.slice(sql.indexOf("FOR v_row IN"), sql.indexOf("IF EXISTS ("));
    const structural = rowValidation.slice(0, rowValidation.indexOf("END IF;"));
    expect(structural).toContain("COALESCE(v_row->>'decision', '') NOT IN ('create','skip')");
    expect(structural).toContain("COALESCE(v_row->>'fingerprint', '') !~ '^[0-9a-f]{64}$'");
    expect(structural).toContain("does not match its worksheet setup");
    expect(structural).not.toMatch(/v_row->>'(?:planType|status|deliveryPhase)'/);
    expect(rowValidation).toContain("IF v_row->>'decision' = 'create' AND ( COALESCE(v_row->>'planType', '') = '' OR char_length(v_row->>'planType') > 80 OR COALESCE(v_row->>'status', '') NOT IN ('draft','active','on_hold','complete') OR COALESCE(v_row->>'deliveryPhase', '') NOT IN ('scoping','analysis','engagement','programming','delivery','complete') ) THEN RAISE EXCEPTION 'Created project classification is invalid' USING ERRCODE = '22023'; END IF;");
    expect(rowValidation).toContain("A blocked or unconfirmed row was selected for creation");
    expect(rowValidation).toContain("A cached formula row lacks individual confirmation");
    expect(sql).toContain("Created project cost is invalid");
    expect(sql).toContain("v_source_checksum <> p_source_hash");
    expect(sql).toContain("IF v_role IS NULL OR v_role = 'viewer' THEN");
    expect(sql).toContain("Duplicate source IDs cannot create projects");
    expect(sql).toContain("A current project name match lacks individual confirmation");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("TO service_role");
  });

  it("permits raw invalid skipped audit values while retaining create constraints and existing rows", () => {
    expect(sql).toContain("ADD CONSTRAINT project_portfolio_import_rows_resolved_status_check CHECK ( decision <> 'create' OR resolved_status IN ('draft','active','on_hold','complete') )");
    expect(sql).toContain("ADD CONSTRAINT project_portfolio_import_rows_resolved_delivery_phase_check CHECK ( decision <> 'create' OR resolved_delivery_phase IN ('scoping','analysis','engagement','programming','delivery','complete') )");
    expect(sql).toContain("CASE WHEN v_row->>'decision' = 'create' THEN btrim(v_row->>'planType') ELSE v_row->>'planType' END, v_row->>'status', v_row->>'deliveryPhase'");
    expect(sql).not.toMatch(/DROP NOT NULL|DISABLE TRIGGER|DISABLE ROW LEVEL SECURITY|UPDATE public\.|DELETE FROM|TRUNCATE|NOT VALID/);
    expect(sql).not.toContain("commit_project_portfolio_import(");
  });
});
