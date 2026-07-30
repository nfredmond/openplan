import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUBMISSION_GEOFENCE_COLUMN } from "@/lib/engagement/geofence";

/**
 * Migration-content guard for the submission location check (20260730000002).
 *
 * What has to be true in the DATABASE rather than only in a route, because a
 * route can be bypassed by the next writer and a constraint cannot:
 *
 *   - the column is ADDITIVE and defaults to FALSE, so no campaign that existed
 *     when this ran starts refusing residents it accepted the day before;
 *   - the flag is UNSTORABLE without an extent, because a check that cannot run
 *     while an operator believes it is running is the worst of the three states;
 *   - nothing in the DDL names a place, a country or a jurisdiction vocabulary;
 *   - no destructive statement, and no new table or policy — the counts asserted
 *     by the migration inventory and the viewer-write guard stay as they were.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260730000002_engagement_campaign_submission_geofence.sql"
);

const sql = readFileSync(migrationPath, "utf8");

// Executable statements only. The header legitimately NAMES things the migration
// must not do while explaining why they are absent, and a guard that read the
// comments would either pass on prose or fail on it.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("the submission-geofence migration", () => {
  it("adds the opt-in additively, defaulting to the behaviour that already existed", () => {
    expect(sqlWithoutComments).toMatch(
      new RegExp(`ADD COLUMN IF NOT EXISTS ${SUBMISSION_GEOFENCE_COLUMN} BOOLEAN NOT NULL DEFAULT FALSE`, "i")
    );
    expect(sqlWithoutComments).toMatch(/ALTER TABLE engagement_campaigns/);

    // DEFAULT TRUE would silently start refusing residents on every campaign
    // that had ever set an area — including ones that set it only to frame a map.
    expect(sqlWithoutComments).not.toMatch(/DEFAULT TRUE/i);
  });

  it("makes a check with nothing to test against unstorable", () => {
    expect(sqlWithoutComments).toMatch(/engagement_campaigns_geofence_needs_area/);
    expect(sqlWithoutComments).toMatch(
      /num_nulls\(place_min_lon, place_min_lat, place_max_lon, place_max_lat\) = 0/
    );
    // The constraint is added conditionally, so the migration is re-runnable.
    expect(sqlWithoutComments).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = 'engagement_campaigns_geofence_needs_area'/);
  });

  it("does not require a boundary polygon, only an extent", () => {
    // A bbox-only geofence is coarse and honest; requiring the polygon would
    // make the check unavailable to every area recorded without one, and the
    // verdict already carries which test produced it.
    expect(sqlWithoutComments).not.toMatch(/place_geometry_geojson IS NOT NULL/);
  });

  it("names no place, country or jurisdiction vocabulary", () => {
    for (const forbidden of [/\bfips\b/i, /\bcalifornia\b/i, /\bcounty\b/i, /\bcensus\b/i, /\btigerweb\b/i]) {
      expect(sqlWithoutComments).not.toMatch(forbidden);
    }
  });

  it("destroys nothing and adds no table or policy", () => {
    for (const destructive of [
      /DROP TABLE/i,
      /DROP COLUMN/i,
      /DELETE FROM/i,
      /TRUNCATE/i,
      /DROP POLICY/i,
      /CREATE POLICY/i,
      /CREATE TABLE/i,
    ]) {
      expect(sqlWithoutComments).not.toMatch(destructive);
    }
  });

  it("documents the column, including the case it deliberately does not refuse", () => {
    expect(sql).toMatch(/COMMENT ON COLUMN engagement_campaigns\.submission_geofence_enabled/);
    // A submission with no coordinate is accepted whatever the flag says, and
    // that has to be discoverable from the database itself — it is the single
    // most surprising thing about this column.
    expect(sql).toMatch(/NO coordinate is always accepted/);
  });
});
