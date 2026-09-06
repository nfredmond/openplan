import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(path.join(process.cwd(), "supabase/migrations", name), "utf8");
const migration = read("20260905000001_portfolio_unknown_price_year.sql");
const originalGuard = "OR COALESCE((v_row#>>'{estimatedCost,priceYear}')::integer, 0) NOT BETWEEN 1800 AND 3000";
const nullableGuard = "OR ((v_row#>>'{estimatedCost,priceYear}') IS NOT NULL\n               AND (v_row#>>'{estimatedCost,priceYear}')::integer NOT BETWEEN 1800 AND 3000)";

function definition(sql: string, name: string) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + 3);
}

describe("unknown import price-year migration", () => {
  it.each([
    ["20260825000001_reviewed_portfolio_import.sql", "commit_project_portfolio_import"],
    ["20260825000002_direct_workbook_portfolio_import.sql", "commit_project_portfolio_import_v2"],
  ])("changes only the missing-year refusal in %s", (source, name) => {
    const previous = definition(read(source), name);
    expect(previous.split(originalGuard)).toHaveLength(2);
    expect(definition(migration, name)).toBe(previous.replace(originalGuard, nullableGuard));
  });
});
