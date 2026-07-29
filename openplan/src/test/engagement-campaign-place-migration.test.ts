import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_PLACE_SCOPE_COLUMNS } from "@/lib/engagement/public-portal-data";

/**
 * Migration-content guard for the engagement campaign's place of record
 * (20260729000003).
 *
 * THE DEFECT IT CLOSES. A campaign had no geography, so its public map was
 * framed from the pins already on it — and a brand-new campaign has none. The
 * first resident to open one, on a phone, from a QR code on a flyer, got the
 * whole United States.
 *
 * What this pins is the part that has to be true in the DATABASE rather than
 * only in a route: additive nullable columns, a bbox that is whole or absent, a
 * coordinate range that does not assume a hemisphere, jurisdiction codes that
 * stay ISO, a coherence rule that keeps "set" distinguishable from "unset", a
 * drawn area with no borrowed identity, and no destructive statement anywhere.
 *
 * It also checks the thing that would make all of the above useless: that the
 * column names the reader SELECTS are the names this migration creates.
 */

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260729000003_engagement_campaign_place_of_record.sql"
);

const sql = readFileSync(migrationPath, "utf8");
// Executable statements only. The header legitimately NAMES things the migration
// must not do while explaining why they are absent, and a guard that read the
// comments would either pass on prose or fail on it.
const sqlWithoutComments = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const PLACE_COLUMNS = [
  "place_source",
  "place_kind",
  "place_ref",
  "place_label",
  "place_country_code",
  "place_subdivision_code",
  "place_min_lon",
  "place_min_lat",
  "place_max_lon",
  "place_max_lat",
  "place_geometry_geojson",
  "place_set_at",
] as const;

describe("engagement campaign place-of-record migration", () => {
  it("adds every place column additively and nullable", () => {
    for (const column of PLACE_COLUMNS) {
      expect(
        sqlWithoutComments,
        `${column} must be added with ADD COLUMN IF NOT EXISTS so the migration is re-runnable`
      ).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
    }

    // NOT NULL on a new column would need a default, and a default here would
    // invent a geography for every campaign that has never stated one.
    expect(sqlWithoutComments).not.toMatch(/ADD COLUMN IF NOT EXISTS \w+ [A-Z ]+NOT NULL/);
    expect(sqlWithoutComments).toMatch(/ALTER TABLE engagement_campaigns/);
  });

  it("refuses a partial bounding box, which would frame a plausible wrong map", () => {
    expect(sqlWithoutComments).toMatch(/engagement_campaigns_place_bbox_complete/);
    expect(sqlWithoutComments).toMatch(
      /num_nulls\(place_min_lon, place_min_lat, place_max_lon, place_max_lat\) IN \(0, 4\)/
    );
  });

  it("bounds coordinates to the globe without assuming a hemisphere", () => {
    expect(sqlWithoutComments).toMatch(/engagement_campaigns_place_bbox_on_globe/);
    expect(sqlWithoutComments).toMatch(/place_min_lat <= place_max_lat/);
    // Longitude ordering must NOT be constrained: a bbox crossing the
    // antimeridian legitimately has min_lon > max_lon, and forbidding it would
    // bake a hemisphere into the schema of a product meant to reach worldwide.
    expect(sqlWithoutComments).not.toMatch(/place_min_lon <= place_max_lon/);
  });

  it("keeps the jurisdiction seam ISO and country-neutral", () => {
    expect(sqlWithoutComments).toMatch(/place_country_code ~ '\^\[A-Z\]\{2\}\$'/);
    expect(sqlWithoutComments).toMatch(/engagement_campaigns_place_subdivision_code_iso/);
    // A subdivision is meaningless without its country.
    expect(sqlWithoutComments).toMatch(/place_country_code IS NOT NULL AND place_subdivision_code/);
    // No country-specific vocabulary may appear in the DDL. The COMMENT bodies
    // are excluded deliberately: they explain what a `tigerweb` ref IS (a Census
    // GEOID), which is a fact about one resolver adapter, not a rule the schema
    // enforces — the same split 20260728000009 makes.
    const ddl = sqlWithoutComments.split("COMMENT ON")[0].toLowerCase();
    expect(ddl).not.toMatch(/\bfips\b|\bcensus\b|\bstate_code\b|\bcounty\b/);
  });

  it("keeps 'set' distinguishable from 'never set'", () => {
    expect(sqlWithoutComments).toMatch(/engagement_campaigns_place_coherent/);
    // A ref without a source is unresolvable, and a source without a timestamp
    // cannot be told apart from a half-written row.
    expect(sqlWithoutComments).toMatch(/place_ref IS NULL OR place_source IS NOT NULL/);
    expect(sqlWithoutComments).toMatch(/place_source IS NULL OR place_set_at IS NOT NULL/);
  });

  it("refuses to give a drawn area somebody else's identity", () => {
    expect(sqlWithoutComments).toMatch(/engagement_campaigns_place_drawn_has_no_ref/);
    expect(sqlWithoutComments).toMatch(/place_source IS DISTINCT FROM 'drawn' OR place_ref IS NULL/);
  });

  it("creates no policy and no table, so the RLS inventory counts are unchanged", () => {
    // Columns added to a table inherit its policies. This migration deliberately
    // creates, alters and drops none — which is why the exact counts in
    // src/test/migrations/inventory.test.ts and
    // src/test/viewer-write-denial-guard.test.ts do not move for it.
    expect(sqlWithoutComments).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/i);
    expect(sqlWithoutComments).not.toMatch(/CREATE TABLE|CREATE VIEW/i);
    expect(sqlWithoutComments).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
  });

  it("creates exactly the columns the portal's reader selects", () => {
    // The recurring defect in this repo is a select naming a column the table
    // lacks — silent at build, `undefined` at runtime. This ties the two ends
    // together.
    for (const column of CAMPAIGN_PLACE_SCOPE_COLUMNS.split(", ")) {
      expect(
        sqlWithoutComments,
        `the portal selects ${column} from engagement_campaigns, so this migration must create it`
      ).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
    }
  });
});
