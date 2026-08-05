import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer, queryCatalog } from "./helpers/live-catalog";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * LIVE TEST — the migration parsers still agree with a real database.
 *
 * Four guards now answer questions about the schema by PARSING the migrations
 * rather than by querying Postgres, because `npm run qa:gate` has no database
 * and a check that only runs nightly cannot block a merge. That is the right
 * trade, and it has one exposure: a parser can be confidently wrong. In
 * particular `plpgsql-expansion.ts` RENDERS the 264 policies that migrations
 * build at runtime with `EXECUTE format(…)`, and a subtle error there would
 * make every guard above it ask a subtly wrong question, quietly.
 *
 * So this is the reconciliation. It compares the parsed inventories against
 * `information_schema` and `pg_policies` in both directions and reports the
 * differences by name. If the offline parser meets a shape it cannot render it
 * throws in qa:gate; if instead it renders one WRONGLY, this catches it that
 * night.
 *
 * Run with: npm run test:rls-live
 *
 * The offline half below runs everywhere, so this file is never vacuous.
 */

const liveDescribe = LIVE_RLS ? describe : describe.skip;

const policies = loadPolicyInventory();
const schema = loadSchemaInventory();

/** Relations Postgres creates that no migration declares. */
const EXTENSION_OWNED = new Set(["spatial_ref_sys", "geography_columns", "geometry_columns"]);

describe("migration inventory (offline)", () => {
  it("parses a schema large enough to be worth reconciling", () => {
    // Without this the live half could pass against an empty inventory.
    expect(schema.tables().length).toBeGreaterThan(110);
    expect(policies.all().length).toBeGreaterThan(500);
    expect(policies.all().filter((policy) => policy.origin === "expanded").length).toBe(264);
  });
});

liveDescribe("migration inventory vs the live database", () => {
  let container = "";

  /**
   * The catalog is read through `psql` inside the database container the local
   * stack is already running — see `helpers/live-catalog.ts` for why there is
   * no driver and no arbitrary-SQL RPC to use instead.
   */
  beforeAll(() => {
    container = resolveLocalDbContainer();
  });

  const catalog = (query: string) => queryCatalog(container, query);

  it("declares every policy the database has, and no policy it does not", () => {
    const live = catalog(
      "SELECT tablename || '.' || policyname || ' ' || cmd || ' ' || permissive " +
        "FROM pg_policies WHERE schemaname = 'public'"
    ).sort();

    const parsed = policies
      .all()
      .map((policy) => `${policy.table}.${policy.policy} ${policy.command} ${policy.kind}`)
      .sort();

    expect(
      parsed.filter((entry) => !live.includes(entry)),
      "The migrations declare policies the database does not have. Either a migration is not " +
        "applied, or the expander rendered something that does not exist."
    ).toEqual([]);

    expect(
      live.filter((entry) => !parsed.includes(entry)),
      "The database has policies the parsers cannot see. This is the failure that hid twelve " +
        "scenario_* policies from viewer-write-denial-guard.test.ts — every guard built on this " +
        "inventory is asking a smaller question than it appears to."
    ).toEqual([]);
  });

  it("declares every column the database has, and no column it does not", () => {
    const live = catalog(
      "SELECT c.table_name || '.' || c.column_name FROM information_schema.columns c " +
        "JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name " +
        "WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'"
    )
      .filter((entry) => !EXTENSION_OWNED.has(entry.split(".")[0]))
      .sort();

    const parsed = schema
      .tables()
      .flatMap((table) => [...(schema.columns(table) ?? [])].map((column) => `${table}.${column}`))
      .sort();

    expect(
      parsed.filter((entry) => !live.includes(entry)),
      "The column inventory claims columns the database does not have — the projection guard is " +
        "approving queries that will answer 42703."
    ).toEqual([]);

    expect(
      live.filter((entry) => !parsed.includes(entry)),
      "The database has columns the inventory cannot see, so the projection guard is skipping " +
        "queries it should be checking."
    ).toEqual([]);
  });

  it("agrees about which tables enable row level security", () => {
    const live = catalog(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity"
    )
      .filter((table) => !EXTENSION_OWNED.has(table))
      .sort();
    const parsed = schema.tables().filter((table) => schema.rlsEnabled(table)).sort();

    // A table the inventory thinks is protected but is not would make
    // write-policy-coverage-guard skip it as "RLS off, nothing to check".
    expect(parsed.filter((table) => !live.includes(table))).toEqual([]);
    expect(live.filter((table) => !parsed.includes(table))).toEqual([]);
  });
});
