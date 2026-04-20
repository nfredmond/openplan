import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const policyMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260420000062_public_data_select_policies.sql"),
  "utf8",
);

const correctiveMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260420000064_scope_gtfs_child_feed_visibility.sql"),
  "utf8",
);

const gtfsChildPolicies = [
  ["agencies", "agencies"],
  ["routes", "routes"],
  ["stops", "stops"],
  ["trips", "trips"],
  ["stop_times", "stop_times"],
  ["calendar", "calendar"],
  ["calendar_dates", "calendar_dates"],
  ["shapes", "shapes"],
] as const;

describe("GTFS child table RLS policies", () => {
  it("inherits visibility from gtfs_feeds instead of granting all rows", () => {
    for (const [table, policySuffix] of gtfsChildPolicies) {
      expect(policyMigration).not.toContain(
        `CREATE POLICY "public_read_${policySuffix}" ON public.${table} FOR SELECT USING (true)`,
      );
      expect(policyMigration).toContain(`CREATE POLICY "public_read_${policySuffix}"`);
      expect(policyMigration).toContain(`WHERE feed.id = ${table}.feed_id`);
    }
  });

  it("includes a forward repair migration for environments that applied the broad policies", () => {
    for (const [table, policySuffix] of gtfsChildPolicies) {
      expect(correctiveMigration).toContain(
        `DROP POLICY IF EXISTS "public_read_${policySuffix}" ON public.${table};`,
      );
      expect(correctiveMigration).toContain(`WHERE feed.id = ${table}.feed_id`);
    }
  });
});
