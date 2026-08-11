import { describe, expect, it } from "vitest";

import { blankComments, readMigration } from "./migrations/read-migrations";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";
import {
  AERIAL_ARTIFACT_CUSTODY_COLUMNS,
  AERIAL_ARTIFACT_CUSTODY_COLUMNS_WITHOUT_GEOREF,
  AERIAL_CUSTODY_GEOREF_COLUMN_NAMES,
} from "@/lib/aerial/artifact-custody";

/**
 * 20260811000003 — georeferencing on the custody ledger.
 *
 * What matters structurally: a PARTIAL rectangle is unstorable (all four bounds
 * or none), bounds that are present are coordinates that exist and open the
 * right way, the ortho_preview kind the v1.1 contract introduces is admitted
 * (without it the callback's custody upsert would violate the kind CHECK and
 * the preview would be the one artifact custody silently cannot hold), and the
 * table's no-client-write posture is unchanged.
 */

// Comments are BLANKED before any regex runs: assertions hold against SQL that
// executes, never against prose (the prose-is-not-the-artifact lesson).
const migrationSql = blankComments(readMigration("20260811000003_aerial_custody_georef.sql"));

const schema = loadSchemaInventory();
const policies = loadPolicyInventory();

describe("aerial custody georef migration", () => {
  it("adds every column the custody projection reads, and the projection names them", () => {
    for (const column of AERIAL_CUSTODY_GEOREF_COLUMN_NAMES) {
      expect(schema.hasColumn("aerial_artifact_custody", column), `missing ${column}`).toBe(true);
      // The shared projection constant is what every read goes through; a
      // column added to the table but not the projection is undefined at
      // runtime with nothing failing at build (untyped clients).
      expect(AERIAL_ARTIFACT_CUSTODY_COLUMNS).toContain(column);
      // ...and the deploy-window fallback projection must NOT name it, or the
      // fallback fails on exactly the database it exists for.
      expect(AERIAL_ARTIFACT_CUSTODY_COLUMNS_WITHOUT_GEOREF).not.toContain(column);
    }
    // The fallback is the old projection, not an empty one.
    expect(AERIAL_ARTIFACT_CUSTODY_COLUMNS_WITHOUT_GEOREF).toContain("state");
    expect(AERIAL_ARTIFACT_CUSTODY_COLUMNS_WITHOUT_GEOREF).toContain("storage_path");
  });

  it("makes a partial bounds rectangle unstorable (all four or none)", () => {
    const allOrNone = migrationSql.match(
      /ADD CONSTRAINT aerial_artifact_custody_bounds_all_or_none CHECK \(([\s\S]*?)\);/
    );
    expect(allOrNone, "all-or-none CHECK missing").not.toBeNull();
    const body = allOrNone![1];
    for (const column of ["bounds_west", "bounds_south", "bounds_east", "bounds_north"]) {
      expect(body).toMatch(new RegExp(`${column} IS NULL`));
      expect(body).toMatch(new RegExp(`${column} IS NOT NULL`));
    }
  });

  it("refuses bounds that are not WGS84 coordinates or do not open the right way", () => {
    const wgs84 = migrationSql.match(
      /ADD CONSTRAINT aerial_artifact_custody_bounds_are_wgs84 CHECK \(([\s\S]*?)\);/
    );
    expect(wgs84, "WGS84 sanity CHECK missing").not.toBeNull();
    const body = wgs84![1];
    expect(body).toMatch(/bounds_west\s+>= -180/);
    expect(body).toMatch(/bounds_north\s+<= 90/);
    expect(body).toMatch(/bounds_west < bounds_east/);
    expect(body).toMatch(/bounds_south < bounds_north/);
  });

  it("refuses a non-positive pixel size", () => {
    expect(migrationSql).toMatch(
      /ADD CONSTRAINT aerial_artifact_custody_pixel_size_positive CHECK \(\s*pixel_size_m IS NULL OR pixel_size_m > 0\s*\)/
    );
  });

  it("admits the ortho_preview kind while keeping every original kind", () => {
    // The original inline CHECK gets Postgres's auto-name; it must be dropped
    // and re-added, not duplicated.
    expect(migrationSql).toMatch(
      /DROP CONSTRAINT IF EXISTS aerial_artifact_custody_kind_check/
    );
    const kindCheck = migrationSql.match(
      /ADD CONSTRAINT aerial_artifact_custody_kind_check CHECK \(([\s\S]*?)\);/
    );
    expect(kindCheck, "re-added kind CHECK missing").not.toBeNull();
    for (const kind of ["orthomosaic", "dsm", "dtm", "point_cloud", "mesh", "ortho_preview"]) {
      expect(kindCheck![1]).toContain(`'${kind}'`);
    }
  });

  it("does not change the table's no-client-write posture", () => {
    // Same posture as 20260730000004: members read, every write is a
    // service-role route. A write policy appearing in ANY migration for this
    // table would be a posture change, not a georef change.
    for (const command of ["INSERT", "UPDATE", "DELETE"] as const) {
      expect(policies.permissiveGrants("aerial_artifact_custody", command)).toEqual([]);
    }
    expect(
      policies.permissiveGrants("aerial_artifact_custody", "SELECT").length
    ).toBeGreaterThan(0);
  });
});
