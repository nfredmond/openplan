import { describe, expect, it } from "vitest";

import { blankComments, readMigration } from "./migrations/read-migrations";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * aerial_imagery — one row per stored mission photo, bytes in the private
 * `aerial-imagery` bucket.
 *
 * Structural assertions against the parsed migrations (the
 * aerial-flight-plans-migration arrangement), so they hold with no live
 * database. What matters here: the EXIF columns are honest evidence (nullable,
 * range-checked, half-coordinates unstorable), duplicates per mission are
 * unstorable, cross-workspace rows are unstorable, and the write posture is
 * the CUSTODY one — member SELECT only, no client write policies, because the
 * bytes must transit an authed route and a row written any other way would
 * claim bytes that never did.
 */

// Comments are BLANKED before any regex runs: this test asserts on SQL that
// executes, never on prose (the prose-is-not-the-artifact lesson).
const migrationSql = blankComments(readMigration("20260811000002_aerial_imagery.sql"));

const schema = loadSchemaInventory();
const policies = loadPolicyInventory();

describe("aerial_imagery migration", () => {
  it("creates the table with every column the imagery routes project", () => {
    expect(schema.tables()).toContain("aerial_imagery");

    for (const column of [
      "id",
      "workspace_id",
      "mission_id",
      "storage_bucket",
      "storage_path",
      "original_filename",
      "byte_size",
      "checksum_sha256",
      "content_type",
      "captured_at",
      "gps_lat",
      "gps_lon",
      "gps_altitude_m",
      "camera_make",
      "camera_model",
      "uploaded_by",
      "created_at",
      "updated_at",
    ]) {
      expect(schema.hasColumn("aerial_imagery", column), `missing ${column}`).toBe(true);
    }
  });

  it("cascades with its mission and workspace", () => {
    expect(schema.childrenOf("aerial_missions")).toContain("aerial_imagery");
    expect(schema.childrenOf("workspaces")).toContain("aerial_imagery");
    expect(migrationSql).toMatch(
      /mission_id\s+UUID\s+NOT NULL REFERENCES public\.aerial_missions\(id\) ON DELETE CASCADE/i
    );
  });

  it("makes the same bytes twice per mission unstorable — the dedupe constraint", () => {
    expect(migrationSql).toMatch(
      /aerial_imagery_mission_checksum_key UNIQUE \(mission_id, checksum_sha256\)/i
    );
  });

  it("requires a provable checksum and a countable size", () => {
    expect(migrationSql).toMatch(/checksum_sha256\s+TEXT\s+NOT NULL CHECK \(checksum_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(migrationSql).toMatch(/byte_size\s+BIGINT\s+NOT NULL CHECK \(byte_size >= 0\)/i);
  });

  it("keeps the EXIF evidence honest: nullable, range-checked, half-coordinates unstorable", () => {
    // Range bounds are geometry, not jurisdiction: a latitude beyond ±90 is
    // not a place anywhere on Earth.
    expect(migrationSql).toMatch(/gps_lat IS NULL OR \(gps_lat >= -90 AND gps_lat <= 90\)/i);
    expect(migrationSql).toMatch(/gps_lon IS NULL OR \(gps_lon >= -180 AND gps_lon <= 180\)/i);
    expect(migrationSql).toMatch(
      /aerial_imagery_gps_pair CHECK \(\(gps_lat IS NULL\) = \(gps_lon IS NULL\)\)/i
    );
    // No NOT NULL on any EXIF column: absence is a storable, honest state.
    expect(migrationSql).not.toMatch(/captured_at\s+TIMESTAMPTZ\s+NOT NULL/i);
    expect(migrationSql).not.toMatch(/camera_make\s+TEXT\s+NOT NULL/i);
  });

  it("hardcodes no vendor and no default location", () => {
    // camera_make/model are what the FILE says — free text, no vendor enum.
    expect(migrationSql).not.toMatch(/\b(dji|mavic|phantom|autel|sony|wingtra|parrot|skydio)\b/i);
    expect(migrationSql).not.toMatch(/DEFAULT\s+[-0-9.]+\s*(,)?\s*$/m);
  });

  it("makes a cross-workspace photo unstorable via the scope trigger", () => {
    expect(migrationSql).toMatch(/CREATE OR REPLACE FUNCTION public\.validate_aerial_imagery_scope\(\)/i);
    expect(migrationSql).toMatch(/mission_workspace_id <> NEW\.workspace_id/i);
    expect(migrationSql).toMatch(
      /CREATE TRIGGER trg_aerial_imagery_scope\s+BEFORE INSERT OR UPDATE ON public\.aerial_imagery/i
    );
  });

  it("creates the private aerial-imagery bucket and forces it private", () => {
    expect(migrationSql).toMatch(
      /INSERT INTO storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s*VALUES \('aerial-imagery', 'aerial-imagery', false, NULL, NULL\)/i
    );
    expect(migrationSql).toMatch(
      /UPDATE storage\.buckets SET public = false WHERE id = 'aerial-imagery' AND public/i
    );
  });

  it("gives members read-only rows: a SELECT policy and NO client write policies", () => {
    expect(schema.rlsEnabled("aerial_imagery")).toBe(true);

    expect(policies.permissiveGrants("aerial_imagery", "SELECT").map((policy) => policy.policy)).toEqual([
      "aerial_imagery_read",
    ]);

    // The custody posture: every write goes through an authed route with the
    // service role, so a client-side write policy would be a hole, not a grant.
    for (const command of ["INSERT", "UPDATE", "DELETE"] as const) {
      expect(policies.permissiveGrants("aerial_imagery", command)).toEqual([]);
    }
  });

  it("grants explicitly under the deny-by-default posture: authenticated reads, service role writes", () => {
    expect(migrationSql).toMatch(/REVOKE ALL ON TABLE public\.aerial_imagery FROM PUBLIC, anon/i);
    // SELECT and nothing more for authenticated — the grant must not outrun
    // the policy surface.
    expect(migrationSql).toMatch(/GRANT SELECT ON TABLE public\.aerial_imagery TO authenticated/i);
    expect(migrationSql).not.toMatch(
      /GRANT [^;]*\b(INSERT|UPDATE|DELETE)\b[^;]* ON TABLE public\.aerial_imagery TO authenticated/i
    );
    expect(migrationSql).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.aerial_imagery TO service_role/i
    );
  });

  it("indexes the mission and workspace sweep paths", () => {
    expect(migrationSql).toMatch(/aerial_imagery_mission_idx\s+ON public\.aerial_imagery\(mission_id\)/i);
    expect(migrationSql).toMatch(/aerial_imagery_workspace_idx\s+ON public\.aerial_imagery\(workspace_id\)/i);
  });
});
