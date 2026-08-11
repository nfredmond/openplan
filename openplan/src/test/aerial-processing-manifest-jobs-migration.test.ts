import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_IMAGERY_TYPES } from "@/lib/aerial/processing-contract";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * 20260811000004 — aerial_processing_jobs learns the second imagery shape
 * (contract v1.1 photo manifests).
 *
 * WHAT IS AT STAKE. A manifest job has no single imagery URL, so the migration
 * makes `imagery_url` nullable — and the moment a NOT NULL becomes nullable,
 * the honest states have to be pinned by CHECKs instead: a zip job without its
 * URL must be unstorable (before this, NOT NULL guaranteed that), and
 * `imagery_type` must not admit a third value the contract does not have.
 * These live checks were verified against the local Postgres on 2026-08-11
 * (manifest row with NULL url stored; zip row with NULL url refused).
 */

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260811000004_aerial_processing_manifest_jobs.sql"
);

describe("aerial_processing_jobs manifest support (20260811000004)", () => {
  it("adds the imagery_type column to the schema the inventory sees", () => {
    const schema = loadSchemaInventory();
    expect(schema.hasColumn("aerial_processing_jobs", "imagery_type")).toBe(true);
  });

  it("keeps the imagery_type vocabulary identical to the contract's imagery types", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const match = sql.match(/CHECK \(\s*imagery_type IN \(([^)]*)\)\s*\)/);
    expect(match, "the imagery_type CHECK is no longer where this guard looks").not.toBeNull();

    const inSql = (match?.[1] ?? "")
      .split(",")
      .map((token) => token.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();

    expect(inSql).toEqual([...CONTRACT_IMAGERY_TYPES].sort());
  });

  it("makes a zip job without its URL unstorable", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    // The constraint that replaces the old NOT NULL for the zip lane.
    expect(sql).toMatch(
      /CHECK \(\s*imagery_type = 'photo_manifest' OR imagery_url IS NOT NULL\s*\)/
    );
    expect(sql).toMatch(/ALTER COLUMN imagery_url DROP NOT NULL/);
  });
});
