import { readFileSync } from "node:fs";
import path from "node:path";
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
  it("the build-time half of this invariant exists and is ungated (guard-the-guard)", () => {
    // The live half below runs only under OPENPLAN_RLS_LIVE_TEST=1 (the
    // nightly cron and test:rls-live) — it does NOT fail push/PR builds. The
    // half that DOES fail every build is migration-text-derived and lives in
    // migrations/inventory.test.ts (every declared table must have RLS
    // enabled in the migration text). This assertion pins that enforcement:
    // if the inventory check is deleted, inverted, or gated behind a skip,
    // this file fails everywhere. An earlier version here asserted
    // `typeof LIVE_RLS === "boolean"` — a tautology that could not fail,
    // sitting directly under a header claiming "never vacuous"
    // (2026-08-03 review).
    const inventorySource = readFileSync(
      path.join(process.cwd(), "src", "test", "migrations", "inventory.test.ts"),
      "utf8"
    );
    expect(inventorySource).toContain("filter((t) => !schema.rlsEnabled(t))).toEqual([])");
    expect(inventorySource.includes("describe.skip")).toBe(false);
    expect(LIVE_RLS === true || LIVE_RLS === false).toBe(true);
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
    // Per-command, because qual and with_check govern different halves of a
    // policy: INSERT policies have qual IS NULL by definition (only
    // with_check applies), and a FOR ALL/UPDATE policy with a scoped USING
    // but an explicit `WITH CHECK (true)` passes reads correctly while
    // accepting writes into any feed. The first version of this check read
    // only qual, so it would have flagged a correct INSERT policy and stayed
    // green on exactly that write hole (2026-08-03 review).
    const scopedQual = "(qual LIKE '%gtfs_feeds%' AND qual LIKE '%workspace_members%')";
    const scopedCheck = "(with_check LIKE '%gtfs_feeds%' AND with_check LIKE '%workspace_members%')";
    const unscoped = catalog(
      "SELECT tablename || '.' || policyname || ' [' || cmd || ']' FROM pg_policies " +
        "WHERE schemaname = 'public' " +
        "AND tablename IN ('agencies','calendar','calendar_dates','routes','shapes','stop_times','stops','trips') " +
        "AND NOT (" +
        "  CASE cmd " +
        `    WHEN 'INSERT' THEN with_check IS NOT NULL AND ${scopedCheck} ` +
        `    WHEN 'SELECT' THEN qual IS NOT NULL AND ${scopedQual} ` +
        `    WHEN 'DELETE' THEN qual IS NOT NULL AND ${scopedQual} ` +
        // UPDATE and ALL: the read side must be scoped, and the write side
        // must either inherit it (with_check IS NULL) or be scoped itself.
        `    ELSE qual IS NOT NULL AND ${scopedQual} AND (with_check IS NULL OR ${scopedCheck}) ` +
        "  END" +
        ")"
    );

    expect(unscoped, "GTFS child policies whose read or write half does not inherit from gtfs_feeds").toEqual([]);
  });

  /**
   * The default-privileges lock (20260804000001): a table created from now on
   * must NOT be born with grants to anon/authenticated — that regrowth was
   * "one careless CREATE POLICY away from total exposure" per 20260730000008's
   * own header, and per-table revokes cannot reach tables that do not exist
   * yet. This reads pg_default_acl for the role migrations run as.
   */
  it("new tables and sequences are not born with anon/authenticated grants", () => {
    const regrown = catalog(
      "SELECT pg_get_userbyid(defaclrole) || ':' || defaclobjtype::text FROM pg_default_acl d " +
        "JOIN pg_namespace n ON n.oid = d.defaclnamespace " +
        "WHERE n.nspname = 'public' AND defaclobjtype IN ('r','S') " +
        "AND pg_get_userbyid(defaclrole) = 'postgres' " +
        "AND (defaclacl::text LIKE '%anon=%' OR defaclacl::text LIKE '%authenticated=%')"
    );

    expect(
      regrown,
      "default ACLs that would grant anon/authenticated on future tables — 20260804000001 has been undone"
    ).toEqual([]);
  });
});
