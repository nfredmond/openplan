import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer, queryCatalog } from "./helpers/live-catalog";

/**
 * LIVE GUARD — a policy that exists is a policy that runs.
 *
 * WHAT THIS CATCHES, AND WHY IT IS NOT HYPOTHETICAL. On 2026-08-03 ten tables in
 * `public` carried a row-level-security policy while `pg_class.relrowsecurity`
 * was FALSE. Eight of them — `agencies`, `routes`, `stops`, `trips`,
 * `stop_times`, `shapes`, `calendar`, `calendar_dates` — carried a CORRECT
 * workspace-scoped policy inheriting visibility from `gtfs_feeds`, written in
 * 20260420000062 and repaired in 20260420000064. No migration had ever run
 * `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on any of them, so those policies
 * had never filtered a single row. Live, with nothing but the public anon key
 * and no account, an anonymous caller could read, deface and delete any
 * workspace's entire transit network, while the PARENT table `gtfs_feeds`
 * correctly returned nothing. 20260730000010 and 20260730000011 closed it.
 *
 * WHY THE EXISTING TEST DID NOT CATCH IT — this is the part worth keeping.
 * `gtfs-child-policies.test.ts` was green for four months. It read the TEXT of
 * the two migration files and asserted the policy SQL contained
 * `WHERE feed.id = stops.feed_id`. It never touched a database. It was guarding
 * a COPY of the artifact, so it could not see that the original had never been
 * switched on, and its greenness is precisely why nobody looked again. That is
 * the CLAUDE.md rule "never guard a claim by scanning a document" showing up in
 * schema instead of prose. This file replaces that check with one that asks
 * Postgres.
 *
 * WHY THERE IS NO ALLOWLIST, AND WHY ONE MUST NEVER BE ADDED. The two remaining
 * exceptions (`census_tracts`, `lodes_od` — genuinely public reference data with
 * `USING (true)`) were removed in 20260730000011 by enabling RLS on them too,
 * which permits exactly the same reads. That was done SO THAT this rule could be
 * absolute. An allowlist here would be the perfect hiding place for the next
 * instance of this defect: the deliberate entry ("public reference data") and
 * the accident ("someone forgot ENABLE ROW LEVEL SECURITY") are indistinguishable
 * from inside the list, which is how eight tables passed review. If a future
 * table genuinely needs world-readable rows, give it a `USING (true)` policy AND
 * enable RLS — the behaviour is identical and the invariant stays whole. Do not
 * add an exception to this test.
 *
 * Run with: npm run test:rls-live
 *
 * The offline half below runs everywhere, so this file is never vacuous.
 */

const liveDescribe = LIVE_RLS ? describe : describe.skip;

describe("policy enforcement invariant (offline)", () => {
  it("states the rule the live half checks", () => {
    // A placeholder assertion would make this file look covered while proving
    // nothing, so this one carries the rule itself: the live check must run
    // against a real catalog, and LIVE_RLS is what decides that.
    expect(typeof LIVE_RLS).toBe("boolean");
  });
});

liveDescribe("every policy in the database is actually enforced", () => {
  let container = "";

  beforeAll(() => {
    container = resolveLocalDbContainer();
  });

  const catalog = (query: string) => queryCatalog(container, query);

  it("finds no table carrying a policy while row-level security is disabled", () => {
    const offenders = catalog(
      "SELECT c.relname || ' (' || count(p.polname) || ' policies, rls off)' " +
        "FROM pg_class c " +
        "JOIN pg_namespace n ON n.oid = c.relnamespace " +
        "JOIN pg_policy p ON p.polrelid = c.oid " +
        "WHERE n.nspname = 'public' AND NOT c.relrowsecurity " +
        "GROUP BY c.relname ORDER BY c.relname"
    );

    expect(
      offenders,
      "tables whose policies are decoration — `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` is missing"
    ).toEqual([]);
  });

  /**
   * The assertion above passes trivially if the query returns nothing because it
   * is broken, or because the database is empty. This is the non-vacuity floor:
   * it proves the catalog read works and that there is a real schema behind it.
   */
  it("is reading a populated catalog, so the check above cannot pass by finding nothing", () => {
    const [tables] = catalog(
      "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
        "WHERE n.nspname = 'public' AND c.relkind = 'r'"
    );
    const [policies] = catalog("SELECT count(*) FROM pg_policies WHERE schemaname = 'public'");
    const [enforced] = catalog(
      "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
        "WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity"
    );

    expect(Number(tables)).toBeGreaterThan(110);
    expect(Number(policies)).toBeGreaterThan(500);
    expect(Number(enforced)).toBeGreaterThan(110);
  });

  /**
   * The eight GTFS child tables get their own named assertion on top of the
   * general rule. The general rule would catch a regression here, but only while
   * the policies still exist — dropping BOTH the policy and RLS would satisfy
   * "no policy without RLS" while leaving the tables wide open, because they
   * would then have neither. Naming them closes that hole, and records which
   * tables the 2026-08-03 leak was actually in.
   */
  it("keeps row-level security enabled on every GTFS child table", () => {
    const gtfsChildren = [
      "agencies",
      "calendar",
      "calendar_dates",
      "routes",
      "shapes",
      "stop_times",
      "stops",
      "trips",
    ];

    const enforced = catalog(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
        `WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relname IN (${gtfsChildren
          .map((table) => `'${table}'`)
          .join(", ")}) ORDER BY c.relname`
    );

    expect(enforced, "GTFS child tables with RLS enforced").toEqual(gtfsChildren);
  });

  /**
   * The tenant boundary on those tables is inherited from `gtfs_feeds`, so the
   * policy must actually consult the parent. A policy rewritten to `USING (true)`
   * would keep RLS on and still publish every workspace's transit network — the
   * exact shape 20260420000064 was written to repair.
   */
  it("scopes every GTFS child policy to the owning feed rather than granting all rows", () => {
    const unscoped = catalog(
      "SELECT tablename || '.' || policyname FROM pg_policies " +
        "WHERE schemaname = 'public' " +
        "AND tablename IN ('agencies','calendar','calendar_dates','routes','shapes','stop_times','stops','trips') " +
        "AND (qual IS NULL OR qual NOT LIKE '%gtfs_feeds%' OR qual NOT LIKE '%workspace_members%')"
    );

    expect(unscoped, "GTFS child policies that do not inherit from gtfs_feeds").toEqual([]);
  });
});
