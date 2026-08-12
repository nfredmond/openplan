import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type ClientRole, loadGrantInventory } from "./migrations/grant-inventory";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * A row policy and a GRANT are two separate locks, and both have to open.
 *
 * WHAT THIS EXISTS BECAUSE OF. `work_notifications` shipped in v0.14.0 with RLS
 * enabled, a `work_notifications_read` SELECT policy, a `work_notifications_update`
 * mark-read policy, three restrictive writer gates — and no GRANT statement at
 * all. `20260804000001` had flipped default privileges to deny, so the table was
 * born with nothing for `authenticated`. Every signed-in planner who opened the
 * /my-work inbox got `permission denied for table work_notifications`. The
 * feature was complete, tested, wired into the navigation, and unusable.
 *
 * WHY NOTHING CAUGHT IT. The inbox, mark-read and sweep suites all run against
 * fakes, which model row filtering and know nothing about privileges. The live
 * RLS suite would have seen it, but it is env-gated and runs nightly. And the
 * grant-composition guard in `migrations/inventory.test.ts` only ever examines
 * triples some migration REVOKED — a table that revoked nothing has no denial,
 * so there was no denial to check. The whole class was invisible to `qa:gate`.
 *
 * THE INVARIANT. If a PERMISSIVE policy promises a client role access to a
 * table for a command, that role must actually hold the privilege for that
 * command at HEAD. Otherwise the policy is a door with no handle: PostgREST
 * answers `permission denied` before RLS is ever consulted, so the careful
 * `USING` clause someone wrote is never evaluated by anything.
 *
 * WHICH ROLE IS ASKED. Every policy in this repo is written without a `TO`
 * clause, which in Postgres means `TO PUBLIC` — every role. This guard reads
 * that as a promise to the SIGNED-IN PLANNER and checks `authenticated`, for a
 * reason that is not symmetric: a workspace table that `anon` cannot reach is
 * the normal, deliberate posture (twenty-six migrations exist to make it so),
 * while a workspace table a signed-in member cannot reach is always a defect.
 * A policy that names its roles explicitly is checked against exactly those.
 *
 * A COLUMN GRANT COUNTS. `document_narrative_drafts` has a permissive UPDATE
 * policy and no table-level UPDATE for `authenticated` — deliberately: members
 * may write four named columns and not the draft's own grounding record. The
 * door opens, just onto fewer columns, so it is not a locked door.
 *
 * NO EXCEPTION LIST. Every table in the corpus satisfies this today, which was
 * confirmed against the live database as well as the migrations before the rule
 * was written, so there is nothing to ratchet down from. Do not add a mechanism
 * for exceptions speculatively; if a real one appears, the honest form is a
 * named entry carrying the argument for why that policy is meant to be
 * unreachable to a signed-in user.
 */

/** The commands a GRANT and a policy can both be about. */
const COMMANDS = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
type Command = (typeof COMMANDS)[number];

type LockedDoor = {
  table: string;
  command: Command;
  role: ClientRole;
  policy: string;
  file: string;
};

/**
 * Which client role a policy's audience must be checked against, or null when
 * the policy is not about a client at all.
 *
 * `service_role` bypasses RLS entirely, so a policy addressed to it is not a
 * promise this guard can hold anyone to.
 */
function clientRoleFor(policyRole: string): ClientRole | null {
  if (policyRole === "public") return "authenticated";
  if (policyRole === "authenticated" || policyRole === "anon") return policyRole;
  return null;
}

type Sweep = { doors: LockedDoor[]; checked: number };

/** Every permissive policy in a migration set, checked against the privilege it needs. */
function sweep(options: { dir?: string } = {}): Sweep {
  const policies = loadPolicyInventory(options);
  const schema = loadSchemaInventory(options);
  const grants = loadGrantInventory(options);

  const doors: LockedDoor[] = [];
  let checked = 0;

  for (const table of policies.tables()) {
    if (schema.createdIn(table) === undefined) {
      throw new Error(
        `a policy names public.${table}, which the schema inventory does not know as a table. ` +
          "One of the two parsers is reading something wrong, and this guard would have skipped " +
          "the table in silence."
      );
    }

    // RLS off is a different defect with its own guard (policies-are-enforced).
    // With no RLS the policies are inert and the GRANT alone decides, so an
    // absent grant here would be a denial rather than a broken promise.
    if (!schema.rlsEnabled(table)) continue;

    for (const command of COMMANDS) {
      for (const policy of policies.permissiveGrants(table, command)) {
        for (const audience of policy.roles) {
          const role = clientRoleFor(audience);
          if (!role) continue;

          checked += 1;
          if (grants.holds(table, role, command) !== "none") continue;

          doors.push({ table, command, role, policy: policy.policy, file: policy.file });
        }
      }
    }
  }

  return { doors, checked };
}

function describe_(doors: readonly LockedDoor[]): string {
  return doors
    .map(
      (door) =>
        `public.${door.table}: policy "${door.policy}" (${door.file}) promises ${door.role} ` +
        `${door.command}, but no migration ever GRANTs ${door.command} on that table to ${door.role}.\n` +
        `  The policy is unreachable. Postgres refuses the statement with "permission denied for ` +
        `table ${door.table}" before any row policy is consulted, so the USING clause never runs.\n` +
        `  Fix it in a migration: GRANT ${door.command} ON TABLE public.${door.table} TO ${door.role};`
    )
    .join("\n\n");
}

describe("a policy without a grant is a locked door", () => {
  it("grants every command its permissive policies promise a signed-in user", () => {
    const { doors } = sweep();

    expect(
      doors.length === 0
        ? ""
        : `${doors.length} policy promise(s) the privilege system refuses:\n\n${describe_(doors)}\n`
    ).toBe("");
  });

  it("asks the question of a world big enough to be worth asking", () => {
    // A floor, not an equality: the set grows with every table. What must never
    // happen is this SHRINKING to nothing while the assertion above stays green,
    // which is what a broken parser looks like from the outside.
    const { checked } = sweep();
    expect(checked).toBeGreaterThanOrEqual(250);
  });

  /**
   * The defect this guard was written for, asserted by name.
   *
   * The general rule above would go green again if someone deleted the two
   * policies instead of adding the grants, so the specific fix is pinned here:
   * `authenticated` reads and marks read, and cannot author or destroy a
   * reminder about itself.
   */
  it("lets a planner read and mark read their own reminders, and nothing more", () => {
    const grants = loadGrantInventory();

    expect(grants.holds("work_notifications", "authenticated", "SELECT")).toBe("table");
    expect(grants.holds("work_notifications", "authenticated", "UPDATE")).toBe("table");
    expect(grants.holds("work_notifications", "authenticated", "INSERT")).toBe("none");
    expect(grants.holds("work_notifications", "authenticated", "DELETE")).toBe("none");
    expect(grants.holds("work_notifications", "anon", "SELECT")).toBe("none");

    // By NAME, not by a blanket grant that happened to sweep it up.
    expect(grants.heldBy("work_notifications", "authenticated", "SELECT")?.reach).toBe("named");
  });

  /**
   * GUARD THE GUARD.
   *
   * Everything above is only worth its runtime if the sweep can actually fail.
   * These synthetic corpora prove the three answers it has to get right, and the
   * middle one is the subtle one: `20260804000002` grants over a `pg_tables`
   * loop, and the expander renders that against every table in the corpus —
   * including tables created long afterwards. If a grant issued before a table
   * existed were credited to it, this whole guard would be vacuous on exactly
   * the post-2026-08-04 tables it exists to protect, and `work_notifications`
   * would have passed.
   */
  it("reports a forgotten grant, and only a forgotten grant (synthetic controls)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openplan-locked-door-"));
    const write = (name: string, sql: string) => writeFileSync(path.join(dir, name), sql, "utf8");
    const names = () => sweep({ dir }).doors.map((door) => `${door.table}/${door.command}/${door.role}`).sort();

    // 1. Born under the OLD default privileges: full DML at creation, so a
    //    policy needs no explicit grant and must NOT be reported.
    write(
      "0001_early.sql",
      "CREATE TABLE public.widgets (id uuid primary key);\n" +
        "ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;\n" +
        "CREATE POLICY widgets_read ON widgets FOR SELECT USING (true);\n"
    );
    expect(names()).toEqual([]);

    // 2. The default flips to deny, and a blanket loop grants everything that
    //    exists AT THAT MOMENT.
    write(
      "0002_deny_by_default.sql",
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;\n"
    );
    write(
      "0003_blanket.sql",
      "DO $$\nDECLARE t record;\nBEGIN\n  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP\n" +
        "    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t.tablename);\n" +
        "  END LOOP;\nEND $$;\n"
    );
    expect(names()).toEqual([]);

    // 3. THE DEFECT. A table born after the flip, with policies and no grant.
    //    The blanket loop in 0003 ran before it existed and cannot save it.
    write(
      "0004_gadgets.sql",
      "CREATE TABLE public.gadgets (id uuid primary key);\n" +
        "ALTER TABLE gadgets ENABLE ROW LEVEL SECURITY;\n" +
        "CREATE POLICY gadgets_read ON gadgets FOR SELECT USING (true);\n" +
        "CREATE POLICY gadgets_write ON gadgets FOR UPDATE USING (true) WITH CHECK (true);\n"
    );
    expect(names()).toEqual(["gadgets/SELECT/authenticated", "gadgets/UPDATE/authenticated"]);

    // 4. The fix: a by-name grant of exactly the two commands.
    write("0005_grants.sql", "GRANT SELECT, UPDATE ON TABLE public.gadgets TO authenticated;\n");
    expect(names()).toEqual([]);

    // 5. A RESTRICTIVE policy promises nothing, so it needs no grant — and an
    //    unmatched command must not be invented out of one.
    write(
      "0006_restrictive.sql",
      "CREATE POLICY gadgets_no_delete ON gadgets AS RESTRICTIVE FOR DELETE USING (false);\n"
    );
    expect(names()).toEqual([]);

    // 6. A policy addressed to a role that holds nothing is still reported, and
    //    reported against the role it names rather than against `authenticated`.
    write("0007_anon.sql", "CREATE POLICY gadgets_public_read ON gadgets FOR SELECT TO anon USING (true);\n");
    expect(names()).toEqual(["gadgets/SELECT/anon"]);

    // 7. A later REVOKE re-locks a door the corpus had opened. The grant existing
    //    "somewhere in the migration set" is not the question; holding it at HEAD is.
    write("0008_revoke.sql", "REVOKE UPDATE ON TABLE public.gadgets FROM authenticated;\n");
    expect(names()).toEqual(["gadgets/SELECT/anon", "gadgets/UPDATE/authenticated"]);

    rmSync(dir, { recursive: true, force: true });
  });

  /** A column-scoped grant opens the door onto fewer columns; it is still open. */
  it("accepts a column-scoped grant as reachability", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openplan-locked-door-columns-"));
    const write = (name: string, sql: string) => writeFileSync(path.join(dir, name), sql, "utf8");

    write(
      "0001_deny.sql",
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;\n"
    );
    write(
      "0002_drafts.sql",
      "CREATE TABLE public.drafts (id uuid primary key, status text, body text);\n" +
        "ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;\n" +
        "CREATE POLICY drafts_update ON drafts FOR UPDATE USING (true) WITH CHECK (true);\n" +
        "GRANT SELECT ON TABLE public.drafts TO authenticated;\n"
    );
    expect(sweep({ dir }).doors.map((door) => door.command)).toEqual(["UPDATE"]);

    write("0003_column.sql", "GRANT UPDATE (status) ON TABLE public.drafts TO authenticated;\n");
    expect(sweep({ dir }).doors).toEqual([]);

    rmSync(dir, { recursive: true, force: true });
  });
});
