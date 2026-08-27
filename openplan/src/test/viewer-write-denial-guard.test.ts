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

// 81 since 20260805000009 added `title_vi_policies`, a workspace-scoped table a
// planner writes through the client, so it carries the full permissive set plus
// the three restrictive `_writer_only_*` gates. `gtfs_tract_service` in the same
// migration does NOT count: it is derived by a spatial join at ingest and is
// service-role-authored, so it has no permissive write for a gate to narrow.
// 82 since 20260811000007 added `work_notifications`, the daily deadline
// reminder. Its permissive mark-read UPDATE is deliberately ROLE-BLIND
// (recipient AND membership, no role test), following engagement_notifications
// — so it enters `tablesNeedingGate()` and carries the three restrictive
// `_writer_only_*` companions, +3 below. Deliberate rather than copied: the
// alternative was `workspace_member_can_write` at the permissive layer, which
// would have moved neither number and would have made this the one table where
// a viewer writes.
const EXPECTED_GATED_TABLES = 82;
const EXPECTED_RESTRICTIVE_POLICIES = 246;
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
//
// 204 rather than 201 since 20260729000004 added
// `engagement_content_translations` with role-aware INSERT, UPDATE and DELETE
// policies — same reasoning again, and the same reason the two counts above are
// untouched. What is at stake on this table is the operator/machine distinction
// itself: `source = 'operator'` is the agency's own words and renders with no
// caveat, so a viewer who could write a row could publish their own wording as
// the agency's official Spanish on a page that has no sign-in. "Viewer cannot
// write" has to hold at the database, not only at whatever route ships next.
// 213 rather than 204 since 20260805000003 added the RTP financial element —
// `rtp_horizon_bands`, `rtp_financial_assumptions`, `rtp_performance_measures`,
// each with role-aware INSERT, UPDATE and DELETE (3 x 3 = +9). The gated-table
// counts above are untouched for the same reason as the translations table:
// these three carry `workspace_member_can_write` at the PERMISSIVE layer, so
// they never enter `tablesNeedingGate()` and need no RESTRICTIVE companion.
//
// That distinction is load-bearing here rather than stylistic. The natural
// move when adding an RTP table is to copy the policies off `rtp_cycles`,
// which are bare membership (`workspace_id IN (SELECT ...)`) and depend on the
// 20260728000006 VALUES loop for their role check. A table added that way is
// role-blind until someone remembers to extend that loop — and what is at
// stake on these three is what a plan says it can afford, so a viewer able to
// write one could alter the revenue assumption a fiscal-constraint finding is
// computed from. Verified by mutation: swapping the INSERT policy to the
// membership-only shape puts all three into `tablesNeedingGate()` and fails
// three assertions in this file.
// 213 -> 215 (20260805000006): the UPDATE and DELETE permissive partners
// gtfs_feeds' restrictive writer gates had been missing since 20260728000006.
// EXPECTED_GATED_TABLES and EXPECTED_RESTRICTIVE_POLICIES do NOT move —
// gtfs_feeds was already gated, and both new policies are role-blind at the
// permissive layer on purpose, so the existing gate is what narrows them.
//
// 218 -> 220 (20260810000003): `engagement_campaign_projects` adds role-aware
// INSERT and DELETE permissive policies via `workspace_member_can_write`, so
// the gated-table and restrictive counts do not move. There is deliberately
// NO UPDATE policy and no UPDATE grant on that table — a coverage row is an
// immutable (campaign, project) pair, corrected by delete-and-insert — which
// is why only two policies arrive instead of the usual three.
//
// 220 -> 223 (20260811000001): `aerial_flight_plans` adds role-aware INSERT,
// UPDATE and DELETE permissive policies via `workspace_member_can_write`, so
// the gated-table and restrictive counts do not move. Deliberately NOT the
// `FOR ALL` role-blind shape its older aerial siblings carry: a flight plan's
// altitude and overlap are safety-relevant authored numbers, and "viewer
// cannot write" holds at the database, not only at the route.
//
// 223 -> 224 (20260811000007): `work_notifications` adds ONE permissive write —
// the recipient's mark-read UPDATE. There is no permissive INSERT and no
// permissive DELETE, on purpose: the rows are EVIDENCE that a person was told
// something was due, authored by the service-role sweep, so the person they are
// about must not be able to mint or destroy one. The three restrictive gates
// still cover all three commands, because the command a table does not use
// today is the one a future route reaches for.
//
// 224 -> 239 (20260812000011): the self-help local measure fund adds six tables
// and fifteen permissive write policies, EVERY one of them role-aware through
// `workspace_member_can_write`. The two counts above are untouched for the same
// reason as the RTP financial tables: a policy that consults the role needs no
// restrictive partner to supply one, so these six never enter
// `tablesNeedingGate()`.
//
// The distinction is load-bearing here rather than stylistic, and more so than
// usual. What a viewer could otherwise write is what an ordinance says the
// money splits into, what the fund received, and the population figure a
// jurisdiction's share is divided by — three inputs that flow straight onto a
// public oversight page a citizens' committee reads. Verified by mutation:
// swapping any of the fifteen to the bare-membership shape puts its table into
// `tablesNeedingGate()` and fails the first assertion in this file.
//
// Fifteen rather than eighteen because three of the six tables are deliberately
// narrower — no DELETE on `measure_recipients`, no UPDATE on
// `measure_allocation_rules` or `measure_recipient_basis_values`. The arguments
// are in that migration's header; each is a record that must not be edited away
// rather than an omission.
//
// 239 -> 247 (20260812000012): claims against the measure fund add three tables
// and eight permissive write policies, every one role-aware through
// `workspace_member_can_write`, so none of them enters `tablesNeedingGate()`
// either.
//
// What a viewer could otherwise write here is the sharper end of the same
// argument: a claim's amount, and — through `measure_claims.status` — whether
// public money is recorded as having been approved and paid. The DELETE policy
// on `measure_claims` narrows further still, to `status = 'draft'`, so even a
// writer cannot erase a submitted claim.
//
// 247 -> 249 (20260812000014): `measure_period_off_the_top` adds two permissive
// write policies, both role-aware through `workspace_member_can_write`, so it
// never enters `tablesNeedingGate()` either. What a viewer could otherwise
// write here is what the agency took for administration before a cent reached
// the ordinance's own purposes — and, through the fiscal-year cap that is
// evaluated against these rows, how much more it may take. Two rather than
// three: the table has no UPDATE policy at all.
//
// 249 -> 259 (20260812000015-18): the workspace GIS lane adds four tables and
// ten permissive write policies — four on the layer, four on its versions, and
// three each on the features and references tables minus the UPDATEs neither of
// those has. Every one is role-aware through `workspace_member_can_write`, so
// none enters `tablesNeedingGate()` and EXPECTED_GATED_TABLES does not move.
//
// What a viewer could otherwise write here is geometry: which shapes every map
// in the workspace draws, and — through `workspace_gis_layers.current_version_id`
// — which upload of them. A layer in the wrong place looks exactly like a layer
// in the right place, so "read everything, change nothing" has to hold at the
// database for this lane in particular.
//
// 259 -> 261 (20260812000019): `measure_period_reserve` — an INSERT and a
// DELETE, both role-aware through `workspace_member_can_write`, so the table
// never enters `tablesNeedingGate()` either. Two rather than three: no UPDATE
// policy, matching `measure_period_off_the_top`. What a viewer could otherwise
// write here is how much of a voter-approved fund the agency kept back instead
// of dividing — a figure the public oversight page subtracts from what came in,
// so a fabricated row moves the amount the ordinance's own purposes appear to
// have been given.
// 272 -> 274 (20260823000007): descriptor-keyed plan process records and
// immutable review releases each add one role-aware FOR ALL policy. Neither
// table enters tablesNeedingGate(), because workspace_member_can_write is
// already present at the permissive layer.
// 20260824000006 adds owner/admin INSERT and UPDATE policies for reminder
// preferences. They are role-aware at the permissive layer. The v0.36 evidence
// bundle table adds role-aware INSERT and UPDATE policies. The exact guided-run
// link table and the two governed-package tables add three more role-aware
// INSERT policies, so no restrictive gate is needed.
const EXPECTED_PERMISSIVE_WRITE_POLICIES = 281;

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
