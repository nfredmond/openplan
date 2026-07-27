import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260727000006_models_network_package_link.sql"),
  "utf8"
);

describe("models network package link migration", () => {
  it("adds the column additively with SET NULL cleanup when a version is deleted", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.models\s+ADD COLUMN IF NOT EXISTS network_package_version_id UUID REFERENCES public\.network_package_versions\(id\) ON DELETE SET NULL/
    );
  });

  it("never drops anything", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
  });

  it("indexes only linked rows via a partial index", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS models_network_package_version_idx/);
    expect(sql).toMatch(/WHERE network_package_version_id IS NOT NULL/);
  });

  it("backs the workspace match with a plain STABLE SQL function, not SECURITY DEFINER", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.model_network_package_version_matches_workspace/);
    expect(sql).toMatch(/\bSTABLE\b/);
    expect(sql).toMatch(/LANGUAGE sql/);
    expect(sql).not.toMatch(/SECURITY DEFINER/i);
  });

  it("pins search_path on the helper function", () => {
    expect(sql).toMatch(/SET search_path = public, pg_catalog/);
  });

  it("resolves the workspace through the version -> package join and allows NULL to unlink", () => {
    expect(sql).toMatch(/p_version_id IS NULL/);
    expect(sql).toMatch(/JOIN public\.network_packages np ON np\.id = npv\.package_id/);
    expect(sql).toMatch(/np\.workspace_id = p_workspace_id/);
  });

  it("adds the CHECK constraint guarded by a pg_constraint lookup", () => {
    expect(sql).toMatch(/FROM pg_constraint/);
    expect(sql).toMatch(/conname = 'models_network_package_version_workspace_match'/);
    expect(sql).toMatch(
      /ADD CONSTRAINT models_network_package_version_workspace_match\s+CHECK \(public\.model_network_package_version_matches_workspace\(workspace_id, network_package_version_id\)\)/
    );
  });

  it("does not use the helper in RLS — the workspace match is a data-integrity constraint only", () => {
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("locks the helper down to authenticated and service_role callers", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.model_network_package_version_matches_workspace\(UUID, UUID\) FROM PUBLIC/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.model_network_package_version_matches_workspace\(UUID, UUID\) TO authenticated, service_role/
    );
  });
});
