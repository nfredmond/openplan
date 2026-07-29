import { describe, expect, it } from "vitest";
import { readMigration } from "./migrations/read-migrations";
import {
  WRITE_COMMANDS,
  classifyRoleAwareness,
  classifyWorkspaceScope,
  isWriteCommand,
  loadPolicyInventory,
  type PolicyStatement,
  type WriteCommand,
} from "./migrations/policy-inventory";

/**
 * REGRESSION GUARD — a role-blind write policy may not exist without a
 * restrictive writer gate over the same table.
 *
 * `workspace-write-role-gate-guard.test.ts` states the problem from the API
 * side, and its own header admits the database half: OpenPlan's workspace
 * content write policies ask `workspace_id IN (SELECT … FROM workspace_members
 * WHERE user_id = auth.uid())`, which is MEMBERSHIP, not PERMISSION. That guard
 * can only police route files. It cannot police PostgREST.
 *
 * It had to, because Supabase's ALTER DEFAULT PRIVILEGES grants ALL on every new
 * public-schema table straight to `authenticated`. With table grants wide open
 * and RLS role-blind, a viewer holding the public anon key and their own session
 * JWT could write directly to PostgREST, past every route gate in the product.
 *
 * 20260728000006 / 20260728000007 close that with RESTRICTIVE policies over the
 * 80 workspace-scoped tables. This guard exists so the NEXT table does not
 * reopen it.
 *
 * WHAT CHANGED, AND WHY IT MATTERED
 *
 * This guard used to carry its own regex parser, and that parser could not see
 * policies built at migration time by `EXECUTE format(…)`. Twelve such policies
 * exist over the three scenario_* spine tables, NINE of them role-blind
 * workspace writes — and the guard passed anyway, because those three tables
 * happen to appear in 20260728000007's VALUES list. Delete three lines from that
 * migration and this suite stayed green while viewers regained write access.
 *
 * The parser now lives in `src/test/migrations/`, is shared with the class-1
 * write-coverage guard, and throws rather than shrinking when it meets SQL it
 * cannot render. Three consequences show up below:
 *
 *   1. `gatedTables()` is derived from PARSED restrictive policies rather than
 *      scraped out of a VALUES list. The old version proved a table was NAMED;
 *      this one proves three restrictive policies exist over it, so a typo in a
 *      workspace expression or a dropped command is caught too.
 *   2. Coverage is asserted per table AND per command — 240 facts, not one.
 *   3. Floors became equalities. `>= 70` against an actual 80 tolerated seven
 *      tables silently vanishing, which is exactly the failure being guarded.
 *
 * Note what is deliberately NOT asserted: that a policy is role-AWARE. Almost
 * every permissive policy in the schema is role-blind and that is fine — the
 * restrictive layer is what supplies the role. What must never happen is a
 * workspace-scoped write path with neither.
 */

/** The two migrations that INSTALL the restrictive gate; they are the answer, not the question. */
const WRITER_GATE_MIGRATIONS = [
  "20260728000006_workspace_write_role_gate.sql",
  "20260728000007_workspace_write_role_gate_children.sql",
];

const EXPECTED_GATED_TABLES = 80;
const EXPECTED_RESTRICTIVE_POLICIES = 240;
// 198 rather than 197 since 20260728000012 added `vmt_significance_screenings`.
// Its INSERT policy is role-AWARE (it calls `workspace_member_can_write`), which
// is why the gated-table and restrictive-policy counts above did NOT move: a
// policy that consults the role needs no restrictive partner to supply one. That
// is the intended shape for a new table — the 240 restrictive policies exist to
// retrofit 80 tables whose policies were written role-blind.
//
// 201 rather than 198 since 20260729000002 added `engagement_context_layers`
// with role-aware INSERT, UPDATE and DELETE policies. Same reasoning, and the
// same reason the two counts above are untouched. The stake is higher on this
// table than most: one of its columns publishes geometry to the open internet,
// so "viewer cannot write" has to hold at the database and not only at the route.
//
// 20260729000003 (engagement_campaigns.place_*) deliberately moves none of the
// three numbers: it adds nullable columns to an existing table, creating no
// policy and no table. Written down so the migration is not left unaccounted
// for by someone checking this list against the migration directory.
const EXPECTED_PERMISSIVE_WRITE_POLICIES = 201;

/** The three tables whose policies exist only as runtime-built SQL. */
const DYNAMIC_POLICY_TABLES = [
  "scenario_assumption_sets",
  "scenario_data_packages",
  "scenario_indicator_snapshots",
];

const inventory = loadPolicyInventory();

function permissiveWritePolicies(): PolicyStatement[] {
  return inventory.all().filter((policy) => policy.kind === "PERMISSIVE" && isWriteCommand(policy));
}

/**
 * Tables that carry at least one role-blind, workspace-scoped write policy —
 * i.e. a policy that lets any MEMBER of the workspace write, without asking
 * what that member is allowed to do.
 */
function tablesNeedingGate(): Map<string, PolicyStatement[]> {
  const needing = new Map<string, PolicyStatement[]>();

  for (const policy of permissiveWritePolicies()) {
    if (classifyWorkspaceScope(policy).kind !== "matched") continue;
    if (classifyRoleAwareness(policy).kind !== "absent") continue;

    const existing = needing.get(policy.table) ?? [];
    existing.push(policy);
    needing.set(policy.table, existing);
  }

  return needing;
}

/** For each table, the write commands a restrictive writer gate actually covers. */
function gatedCommands(): Map<string, Set<WriteCommand>> {
  const gated = new Map<string, Set<WriteCommand>>();

  for (const table of inventory.tables()) {
    const commands = new Set<WriteCommand>();
    for (const command of WRITE_COMMANDS) {
      const gatedHere = inventory
        .restrictiveGates(table, command)
        .some((policy) => /workspace_member_can_write/i.test(policy.body));
      if (gatedHere) commands.add(command);
    }
    if (commands.size) gated.set(table, commands);
  }

  return gated;
}

describe("viewer write denial", () => {
  it("gates every table that has a role-blind workspace write policy", () => {
    const gated = gatedCommands();
    const ungated = [...tablesNeedingGate().entries()]
      .filter(([table]) => !gated.has(table))
      .map(([table, policies]) => `${table} (${policies.map((p) => `${p.command} in ${p.file}`).join(", ")})`)
      .sort();

    expect(
      ungated,
      "These tables accept workspace-scoped writes through a role-blind policy and have no " +
        "RESTRICTIVE writer gate, so a viewer can write to them directly through PostgREST. " +
        "Add the table to a writer-gate migration's VALUES list with the expression that " +
        "resolves its workspace."
    ).toEqual([]);
  });

  it("gates each one for all three write commands, not just the one in use today", () => {
    // 240 facts rather than one. A gate installed for INSERT only would have
    // satisfied the old aggregate assertion while leaving UPDATE and DELETE
    // open — and the command a table does not use today is exactly the one a
    // future route will reach for.
    const partial: string[] = [];

    for (const table of tablesNeedingGate().keys()) {
      for (const command of WRITE_COMMANDS) {
        const covered = inventory
          .restrictiveGates(table, command)
          .some((policy) => /workspace_member_can_write/i.test(policy.body));
        if (!covered) partial.push(`${table} ${command}`);
      }
    }

    expect(partial).toEqual([]);
  });

  it("classifies every write policy — nothing exempts itself by being unreadable", () => {
    // The two silent-shrink holes this guard used to have. `isWorkspaceScoped`
    // was `body.includes("workspace_members")` and `isRoleBlind` a bare
    // /\brole\b/; both answered "no" for anything unfamiliar, and a "no" here
    // drops the policy from the inventory without failing anything. The
    // asymmetry is what made them dangerous: a false positive is loud, a false
    // negative is invisible.
    const writes = permissiveWritePolicies();

    expect(
      writes.filter((p) => classifyWorkspaceScope(p).kind === "unclassifiable").map((p) => `${p.table}.${p.policy}`),
      "This policy reaches a workspace by an idiom the inventory does not recognise. Add the " +
        "idiom to WORKSPACE_SCOPE_IDIOMS rather than leaving it unclassified — an unclassified " +
        "policy is one this guard cannot require a gate for."
    ).toEqual([]);

    expect(
      writes.filter((p) => classifyRoleAwareness(p).kind === "unclassifiable").map((p) => `${p.table}.${p.policy}`),
      "This policy mentions a role but by no pattern the inventory recognises. Add it to " +
        "ROLE_AWARE_IDIOMS, or rewrite the policy — a policy that merely CONTAINS the word " +
        "'role' must not be able to exempt itself from the writer gate."
    ).toEqual([]);
  });

  it("keeps the gate list honest — nothing is gated for a reason that no longer exists", () => {
    const needing = tablesNeedingGate();
    const orphaned = [...gatedCommands().keys()].filter((table) => !needing.has(table)).sort();

    expect(
      orphaned,
      "These tables carry a restrictive writer gate but no role-blind workspace write policy " +
        "this guard can see. Two possibilities, and the second is the dangerous one: either the " +
        "permissive policies were removed and the gate is now dead weight, OR the inventory " +
        "cannot read them. Until 20260728000006's dynamic policies were expanded, the three " +
        "scenario_* tables sat in exactly this state and nothing said so."
    ).toEqual([]);
  });

  it("installs the writer predicate as one shared, fail-closed helper", () => {
    const sql = readMigration(WRITER_GATE_MIGRATIONS[0]);

    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.workspace_member_can_write\(/i);
    // Rank comparison rather than a role-name allowlist, so a new tier ranks in
    // one place instead of in 240 policies.
    expect(sql).toMatch(/workspace_role_rank\(wm\.role\)\s*>=\s*public\.workspace_role_rank\('member'\)/i);
    // An RLS policy evaluates as the caller, so the caller needs the rank helper.
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.workspace_role_rank\(text\)\s+TO\s+authenticated/i);
  });

  it("never puts SELECT behind the writer predicate", () => {
    // A RESTRICTIVE `FOR ALL` policy would constrain reading too, and take
    // reading away from the very role this exists to keep reading. Asked of the
    // parsed policies rather than of the migration text, so a gate installed
    // from anywhere is covered.
    const readingGates = inventory
      .all()
      .filter((policy) => policy.kind === "RESTRICTIVE" && (policy.command === "ALL" || policy.command === "SELECT"))
      .map((policy) => `${policy.table}.${policy.policy} (${policy.command})`);

    expect(readingGates).toEqual([]);
  });

  it("guards the guard", () => {
    const gated = gatedCommands();
    const needing = tablesNeedingGate();

    // Equalities, not floors. `>= 70` against an actual 80 tolerated seven
    // tables disappearing from the inventory unnoticed — which is the precise
    // shape of the defect this file exists to prevent. When a legitimately new
    // workspace table lands, these numbers move in the same commit as its
    // migration, and the diff is the record of it.
    expect(needing.size).toBe(EXPECTED_GATED_TABLES);
    expect(gated.size).toBe(EXPECTED_GATED_TABLES);
    expect(inventory.all().filter((p) => p.kind === "RESTRICTIVE")).toHaveLength(EXPECTED_RESTRICTIVE_POLICIES);
    expect(permissiveWritePolicies()).toHaveLength(EXPECTED_PERMISSIVE_WRITE_POLICIES);

    // Every gated table must be gated for all three commands.
    for (const [table, commands] of gated) {
      expect([...commands].sort(), `${table} must be gated for every write command`).toEqual([
        "DELETE",
        "INSERT",
        "UPDATE",
      ]);
    }

    // The tables whose policies are BUILT AT RUNTIME must be visible as
    // needing a gate on their own merits — not merely present in the gate list.
    // Their absence from `needing` is what made this suite green while it could
    // not see twelve policies.
    for (const table of DYNAMIC_POLICY_TABLES) {
      expect(needing.has(table), `${table}'s dynamic write policies must be visible to this guard`).toBe(true);
      expect(inventory.permissiveGrants(table, "UPDATE").map((p) => p.policy)).toEqual([`${table}_update`]);
      expect(inventory.permissiveGrants(table, "DELETE")).toHaveLength(1);
    }

    // Spot-check both families: a table owning workspace_id, and one that
    // reaches a workspace only through a parent.
    expect(gated.has("projects")).toBe(true);
    expect(gated.has("report_sections")).toBe(true);

    // The detector must actually discriminate — billing_invoice_records was made
    // role-aware in 20260717000082, so it must not register as needing a gate.
    expect(needing.has("billing_invoice_records")).toBe(false);
  });
});
