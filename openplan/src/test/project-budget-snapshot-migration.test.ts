import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261017000019_project_budget_complete_inputs.sql", "utf8")
  .replace(/--[^\n]*/g, "");

// Mechanical source checks only. They do not parse/execute SQL or establish RLS,
// native schema fallback, API caps, performance or concurrent snapshot behavior.
describe("project budget complete-inputs SQL contract", () => {
  it("returns a scalar aggregate from one stable snapshot without row windows", () => {
    expect(sql).toMatch(/RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER/);
    expect(sql).not.toMatch(/\b(?:LIMIT|OFFSET|SETOF|VOLATILE)\b/i);
    expect(sql.match(/jsonb_agg\(/g) ?? []).toHaveLength(4);
    expect(sql).toContain("'complete', true, 'data', rows, 'error', NULL");
    expect(sql.match(/'complete', false, 'data', NULL/g) ?? []).toHaveLength(4);
  });

  it("retains caller RLS, scoped project refusal and restricted function grants", () => {
    expect(sql).not.toMatch(/SECURITY DEFINER|ALTER TABLE|CREATE POLICY|\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(sql).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(sql).toMatch(/p_project_id IS NULL OR NOT EXISTS\s*\(\s*SELECT 1 FROM public.projects p WHERE p.id = p_project_id/);
    expect(sql).toContain("USING ERRCODE = '42501'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.project_budget_inputs_v1(uuid) FROM PUBLIC, anon");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.project_budget_inputs_v1(uuid) TO authenticated");
  });

  it("scopes every source and aggregates every nested invoice line by its parent identity", () => {
    expect(sql.match(/WHERE d.project_id = (?:\$1|p_project_id)/g) ?? []).toHaveLength(1);
    expect(sql).toContain("FROM public.projects p WHERE p.id = p_project_id");
    expect(sql).toContain("FROM public.project_spend_entries s WHERE s.project_id = p_project_id");
    expect(sql).toContain("WHERE i.project_id = p_project_id AND i.status IN ('sent', 'paid')");
    expect(sql).toContain("p.id = i.project_id");
    expect(sql).toContain("AND i.workspace_id <> p.workspace_id");
    expect(sql).toContain("RAISE EXCEPTION 'Invoice workspace does not match its project'");
    expect(sql).toContain("FROM public.client_invoice_line_items l WHERE l.invoice_id = i.id");
    expect(sql).toMatch(/jsonb_agg\(jsonb_build_object\(\s*'id', l.id, 'deliverable_id', l.deliverable_id, 'amount', l.amount\s*\) ORDER BY l.id\)/);
  });

  it("selects optional fields independently from this table catalog and preserves unknown read errors", () => {
    expect(sql).toContain("IF to_regclass('public.project_deliverables') IS NULL THEN");
    expect(sql).toContain("WHERE a.attrelid = to_regclass('public.project_deliverables')");
    expect(sql).toContain("AND a.attnum > 0 AND NOT a.attisdropped");
    expect(sql).toContain("INTO assignee_pending, budget_amount_pending, percent_complete_pending");
    for (const [flag, column] of [["assignee_pending", "assignee_user_id"],
      ["budget_amount_pending", "budget_amount"], ["percent_complete_pending", "percent_complete"]]) {
      expect(sql).toContain(`NOT coalesce(bool_or(a.attname = '${column}'), false)`);
      expect(sql).toContain(`IF NOT ${flag} THEN\n      projection := projection || ', d.${column}';`);
    }
    expect(sql).toContain("budget_pending := budget_amount_pending OR percent_complete_pending;");
    expect(sql).toContain("projection := 'd.id, d.title, d.summary, d.owner_label, d.due_date, d.status, d.created_at';");
    expect(sql).not.toMatch(/EXCEPTION WHEN undefined_column|assignee_pending := true|budget_pending := true/);
    expect(sql).toContain("'deliverableAssigneeColumnPending', assignee_pending");
    expect(sql).toContain("'deliverableBudgetColumnsPending', budget_pending");
    expect(sql).toContain("SELECT s.id, s.deliverable_id, s.entry_date, s.amount, s.description, s.vendor_label, s.created_at");
    expect(sql).toContain("jsonb_build_object('budget_amount', p.budget_amount)");
  });

  it("orders display rows with primary-key tie-breakers while reading each identity once", () => {
    expect(sql.match(/ORDER BY r.updated_at DESC, r.id/g) ?? []).toHaveLength(1);
    expect(sql).toContain("ORDER BY r.entry_date DESC, r.id");
    expect(sql).toContain("to_jsonb(r) ORDER BY r.id");
    expect(sql).not.toMatch(/\bDISTINCT\b/i);
  });
});
