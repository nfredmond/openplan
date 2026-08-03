import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WHAT THIS FILE USED TO BE, AND WHY THAT MATTERED.
 *
 * Until 2026-08-03 this file asserted that the TEXT of two migration files
 * contained `WHERE feed.id = stops.feed_id`, and it was green from the day it
 * was written. It was also completely vacuous as a security guard: the policies
 * whose source it was reading had never been ENFORCED, because no migration ever
 * ran `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on any of the eight GTFS child
 * tables. Live, an anonymous caller with no account could read, deface and
 * delete any workspace's entire transit network for four months while this test
 * reported the boundary intact.
 *
 * It failed in the specific way CLAUDE.md warns about: it guarded a COPY of the
 * artifact (the migration source) instead of the artifact (the database), so it
 * could not see the difference between a policy that exists and a policy that
 * runs. Worse than useless — it converted an unchecked area into one everybody
 * believed was checked.
 *
 * THE ENFORCEMENT CHECK NOW LIVES IN `policies-are-enforced-guard.test.ts`,
 * which asks Postgres directly: no table in `public` may carry a policy while
 * RLS is off, RLS is on for all eight of these tables, and each policy still
 * consults `gtfs_feeds` and `workspace_members`.
 *
 * WHAT IS LEFT HERE, AND WHY IT IS STILL WORTH KEEPING. This is now a
 * migration-history check, not a security guard, and it is labelled as one. It
 * asserts that the forward-repair migration 20260420000064 remains in the tree
 * and still drops-and-recreates the scoped policies. That matters for a reason
 * the live guard cannot cover: the live guard only sees THIS database. A
 * deployment that applied the original broad `USING (true)` policies before the
 * repair existed depends on 20260420000064 being present to converge, and
 * deleting it would silently strand those installations while every live check
 * here stayed green.
 */

const policyMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260420000062_public_data_select_policies.sql"),
  "utf8",
);

const correctiveMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260420000064_scope_gtfs_child_feed_visibility.sql"),
  "utf8",
);

const enablingMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260730000010_enable_rls_on_gtfs_child_tables.sql"),
  "utf8",
);

const gtfsChildTables = [
  "agencies",
  "routes",
  "stops",
  "trips",
  "stop_times",
  "calendar",
  "calendar_dates",
  "shapes",
] as const;

describe("GTFS child table migration history", () => {
  it("never declared the broad all-rows policies in the original migration", () => {
    for (const table of gtfsChildTables) {
      expect(policyMigration).not.toContain(
        `CREATE POLICY "public_read_${table}" ON public.${table} FOR SELECT USING (true)`,
      );
      expect(policyMigration).toContain(`CREATE POLICY "public_read_${table}"`);
    }
  });

  it("keeps the forward repair for deployments that applied the broad policies", () => {
    for (const table of gtfsChildTables) {
      expect(correctiveMigration).toContain(
        `DROP POLICY IF EXISTS "public_read_${table}" ON public.${table};`,
      );
      expect(correctiveMigration).toContain(`WHERE feed.id = ${table}.feed_id`);
    }
  });

  /**
   * The one assertion here that would have caught the original defect. It is
   * deliberately a check that the ENABLING statement exists in the migration
   * set — because a migration is what carries the fix to every other
   * deployment, and the live guard can only speak for the database it is
   * pointed at.
   */
  it("carries a migration that actually enables row-level security on all eight", () => {
    for (const table of gtfsChildTables) {
      expect(
        enablingMigration,
        `20260730000010 must enable RLS on ${table}, or its policy is decoration`,
      ).toContain(`alter table public.${table} enable row level security;`);
    }
  });
});
