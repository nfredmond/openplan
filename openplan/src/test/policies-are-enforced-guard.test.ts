import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer, queryCatalog } from "./helpers/live-catalog";
import { loadGrantInventory } from "./migrations/grant-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";

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

  it("the grant-fidelity half exists and is ungated (guard-the-guard)", () => {
    // The live grant assertions below are nightly-only. The half that fails EVERY
    // build is `inventory.test.ts`'s replay of the migration corpus: a privilege a
    // migration revoked may be held only if a later statement granted it by name.
    // Deleting that assertion would leave the class unguarded on PRs, so deleting
    // it fails here instead — everywhere, including qa:gate.
    const inventorySource = readFileSync(
      path.join(process.cwd(), "src", "test", "migrations", "inventory.test.ts"),
      "utf8"
    );
    expect(inventorySource).toContain("client grants compose back to the audited posture");
    expect(inventorySource).toContain("inventory.violations()");
    expect(inventorySource).toContain("describeViolations(violations)");
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

  /**
   * The live counterpart of `inventory.test.ts`'s grant replay.
   *
   * The static half proves the MIGRATIONS compose to the audited posture. This
   * proves the DATABASE actually arrived there — which is a different claim, and
   * the one an agency's data safety rests on. It is also the only form of the
   * assertion that is identically true on a fresh and a grandfathered database,
   * because it asserts exactly what the corpus states and nothing about the
   * bootstrap privilege residue that predates it.
   *
   * `has_table_privilege` is deliberately the right function here: it ignores
   * column-level grants, so `document_narrative_drafts`' four-column UPDATE
   * survives while its table-level UPDATE is correctly reported as absent.
   */
  it("matches the posture the migrations replay to, in both directions", () => {
    const denials = loadGrantInventory().denials();

    // A denied triple that a LATER by-name GRANT restored is meant to be held —
    // `document_narrative_drafts` revokes ALL from `authenticated` and then grants
    // SELECT and INSERT back deliberately. Asserting on the denial alone would
    // have called those three tables defects. The question is not "was it ever
    // revoked" but "what does replaying the corpus to HEAD say it should be", and
    // both answers are checked, because an over-broad REVOKE that silently breaks
    // a working feature is as much a defect as a grant that widens the posture.
    const rowsFor = (subset: typeof denials) =>
      subset
        .map(
          (denial) =>
            `('${denial.table}','${denial.role}','${denial.privilege}','${denial.revokedBy.file}:${denial.revokedBy.line}')`
        )
        .join(",");

    const shouldNotHold = denials.filter((denial) => denial.heldBy === null);
    const shouldHold = denials.filter((denial) => denial.heldBy !== null);
    expect(shouldNotHold.length).toBeGreaterThanOrEqual(150);

    const missing = catalog(
      `SELECT v.tbl FROM (VALUES ${rowsFor(denials)}) AS v(tbl, role, priv, src) ` +
        "WHERE to_regclass('public.' || quote_ident(v.tbl)) IS NULL GROUP BY v.tbl ORDER BY v.tbl"
    );
    expect(
      missing,
      "tables the migration parser named that do not exist — the parser is reading something wrong, " +
        "and every assertion below would have skipped them silently"
    ).toEqual([]);

    const heldAnyway = catalog(
      `SELECT v.tbl || ': ' || v.role || ' holds ' || v.priv || ', revoked by ' || v.src ` +
        `FROM (VALUES ${rowsFor(shouldNotHold)}) AS v(tbl, role, priv, src) ` +
        "WHERE has_table_privilege(v.role, 'public.' || quote_ident(v.tbl), v.priv) ORDER BY 1"
    );
    expect(
      heldAnyway,
      "privileges a migration revoked that the live database still holds — a blanket GRANT has widened " +
        "the audited posture again. Fix it in a migration, not here."
    ).toEqual([]);

    const missingDeliberateGrant = catalog(
      `SELECT v.tbl || ': ' || v.role || ' has lost ' || v.priv ` +
        `FROM (VALUES ${rowsFor(shouldHold)}) AS v(tbl, role, priv, src) ` +
        "WHERE NOT has_table_privilege(v.role, 'public.' || quote_ident(v.tbl), v.priv) ORDER BY 1"
    );
    expect(
      missingDeliberateGrant,
      "privileges a migration granted BY NAME after revoking them, which the database no longer holds — " +
        "a revoke has gone further than the corpus says it should and a client feature is broken"
    ).toEqual([]);
  });

  /**
   * Column-scoped grants — the control `has_table_privilege` cannot see.
   *
   * `document_narrative_drafts` gives members UPDATE on exactly four columns, and
   * its own migration says why: "the draft body, its grounding record, and its
   * facts hash are immutable to members." That column list is the thing standing
   * between a member and a forged `grounding_json` on a draft they then accept
   * as-is into a funder-facing packet. It is also fragile in a way that is easy
   * to miss: revoking UPDATE at table level silently drops every column grant
   * with it, so a well-meant lockdown can erase the control it meant to tighten.
   *
   * Both halves are asserted, and the second is the security-relevant one: every
   * column the corpus grants must be writable, and every OTHER column of that
   * table must not be.
   */
  it("holds column privileges exactly where the migrations put them", () => {
    const inventory = loadGrantInventory();
    const schema = loadSchemaInventory();
    const granted = inventory.columnGrants();

    expect(granted.length).toBeGreaterThanOrEqual(4);

    const rows = granted
      .map((grant) => `('${grant.table}','${grant.role}','${grant.privilege}','${grant.column}')`)
      .join(",");
    const lost = catalog(
      `SELECT v.tbl || '.' || v.col || ': ' || v.role || ' cannot ' || v.priv ` +
        `FROM (VALUES ${rows}) AS v(tbl, role, priv, col) ` +
        "WHERE NOT has_column_privilege(v.role, 'public.' || quote_ident(v.tbl), v.col, v.priv) ORDER BY 1"
    );
    expect(
      lost,
      "column privileges the migrations grant that the database does not hold — most likely a table-level " +
        "REVOKE dropped them, which Postgres does silently"
    ).toEqual([]);

    // The other side: on a table whose table-level privilege is denied, no column
    // beyond the granted ones may carry it.
    const forbidden: string[] = [];
    const deniedTableLevel = new Set(
      inventory
        .denials()
        .filter((denial) => denial.heldBy === null)
        .map((denial) => `${denial.table}|${denial.role}|${denial.privilege}`)
    );

    for (const grant of granted) {
      const key = `${grant.table}|${grant.role}|${grant.privilege}`;
      if (!deniedTableLevel.has(key)) continue;

      const allowed = new Set(
        granted
          .filter((other) => `${other.table}|${other.role}|${other.privilege}` === key)
          .map((other) => other.column)
      );
      for (const column of schema.columns(grant.table) ?? []) {
        if (allowed.has(column)) continue;
        forbidden.push(`('${grant.table}','${grant.role}','${grant.privilege}','${column}')`);
      }
    }

    expect(forbidden.length).toBeGreaterThanOrEqual(10);
    const writable = catalog(
      `SELECT v.tbl || '.' || v.col || ': ' || v.role || ' can ' || v.priv || ' a column no migration granted' ` +
        `FROM (VALUES ${[...new Set(forbidden)].join(",")}) AS v(tbl, role, priv, col) ` +
        "WHERE has_column_privilege(v.role, 'public.' || quote_ident(v.tbl), v.col, v.priv) ORDER BY 1"
    );
    expect(writable).toEqual([]);
  });

  /**
   * The strictly-worst subset of the client-grant surface, adopted as an absolute
   * rule because it has no exceptions and therefore cannot rot.
   *
   * RLS on with zero policies denies every command already, so a client grant on
   * such a table buys nothing and costs the whole second lock: one careless
   * `USING (true)` and the grant is live. Twelve tables are in this shape today
   * and all twelve comply. The stronger per-command variant — no client grant for
   * a command with no permissive policy for it — is 258 triples across 59 tables
   * and would need an allowlist, so it is recorded in 20260805000005's header as
   * a measured, named follow-up rather than half-built here.
   */
  it("gives no client grant to a table whose policies deny everything", () => {
    const offenders = catalog(
      "SELECT c.relname || ': ' || g.grantee || ' holds ' || g.privilege_type || ' on a table with RLS on and no policies' " +
        "FROM pg_class c " +
        "JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' " +
        "JOIN information_schema.role_table_grants g ON g.table_schema = 'public' AND g.table_name = c.relname " +
        "WHERE c.relkind = 'r' AND c.relrowsecurity " +
        "AND g.grantee IN ('anon','authenticated') " +
        "AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) " +
        "ORDER BY 1"
    );

    expect(offenders).toEqual([]);
  });

  it("is asserting on a real denial set, not an empty one", () => {
    // The two assertions above pass trivially if the migration parser returns
    // nothing. These floors are what make that a failure instead of a green run —
    // the same reason the policy count above has one.
    const inventory = loadGrantInventory();
    expect(inventory.denials().length).toBeGreaterThanOrEqual(150);
    expect(inventory.revokedTables().length).toBeGreaterThanOrEqual(25);

    const [zeroPolicy] = catalog(
      "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' " +
        "WHERE c.relkind = 'r' AND c.relrowsecurity " +
        "AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)"
    );
    expect(Number(zeroPolicy)).toBeGreaterThanOrEqual(9);
  });
});
