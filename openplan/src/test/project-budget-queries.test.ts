import { describe, expect, it, vi } from "vitest";
import { budgetDeliverable, budgetSpend, projectBudgetSnapshotFixture, type BudgetAnswer } from "./helpers/project-budget-snapshot";
import { buildProjectBudgetSnapshot } from "@/lib/projects/budget";
import {
  loadProjectBudgetInputs,
  type ProjectDeliverableBudgetRow,
} from "@/lib/projects/budget-queries";

/**
 * MONEY STATED AS FACT BECAUSE A QUERY BROKE.
 *
 * Three of this loader's four reads classified exactly one failure — a
 * deployment behind a migration — and let every other error fall through into
 * `data ?? []`, which is `[]`. `ProjectBudgetPanel` renders that as "Billed to
 * date $0", "Direct spend $0", "Actual to date $0" and "No deliverables
 * recorded yet, so there is nothing to judge burn against." A revoked grant or a
 * changed policy is not a finding about an agency's money.
 *
 * A MOCKED SUPABASE CLIENT HANDS BACK ITS FIXTURE WHATEVER IS ASKED OF IT, which
 * is why this class shipped undetected: a harness that cannot fail ONE NAMED
 * READ cannot reach the failure path at all. `fakeSupabase` below is keyed by
 * table for exactly that reason — every test here fails a single source and
 * leaves the other three answering.
 */

type Answer = BudgetAnswer;
function fakeSupabase(overrides: Partial<Record<string, Answer>> = {}) {
  return { rpc: vi.fn(async () => ({ data: projectBudgetSnapshotFixture(overrides), error: null })) };
}

const permissionDenied = (table: string): Answer => ({
  data: null,
  error: { message: `permission denied for table ${table}` },
});

describe("loadProjectBudgetInputs", () => {
  it("returns a failed client-invoice read as unreadable rather than as an empty billed list", async () => {
    const inputs = await loadProjectBudgetInputs(
      fakeSupabase({ client_invoices: permissionDenied("client_invoices") }),
      "project-1"
    );

    // THE LIE FIRST: the loader used to answer this with `billedLines: []` and
    // nothing else, and the panel turned that into "Billed to date $0".
    expect(inputs.pending.clientInvoices).toBe(false);
    expect(inputs.unreadable.clientInvoices).toBe(true);
    expect(inputs.readFailures).toContainEqual({
      label: "client invoices billed to this project",
      message: "permission denied for table client_invoices",
    });
    // Rows still resolve to empty — which is exactly why a caller must branch on
    // the flag. Emptiness is the same value here as in the honest case.
    expect(inputs.billedLines).toEqual([]);
    // And only the lane that failed is disowned.
    expect(inputs.unreadable.deliverables).toBe(false);
    expect(inputs.unreadable.spendEntries).toBe(false);
  });

  it("keeps a pending migration classified as pending and does NOT report it as a read failure", async () => {
    const inputs = await loadProjectBudgetInputs(
      fakeSupabase({
        client_invoices: {
          data: null,
          error: { message: 'relation "public.client_invoices" does not exist' },
        },
      }),
      "project-1"
    );

    // The pending case has a truer thing to say — "apply the migration" — and
    // must keep saying it. Without this the fix would trade one wrong answer for
    // another and the panel's setup copy would disappear.
    expect(inputs.pending.clientInvoices).toBe(true);
    expect(inputs.unreadable.clientInvoices).toBe(false);
    expect(inputs.readFailures).toEqual([]);
  });

  /**
   * THE SUB-DEFECT. `statedBudgetPending` was
   * `looksLikePendingSchema(msg) || Boolean(error)`, so a permission failure on
   * `projects` was filed as a pending migration — the one classification whose
   * operator move is "apply a migration". Nobody would ever apply one, because
   * the column was already there and the policy was the problem.
   */
  it("does not file a permission failure on the stated budget as a pending migration", async () => {
    const inputs = await loadProjectBudgetInputs(
      fakeSupabase({ projects: permissionDenied("projects") }),
      "project-1"
    );

    expect(inputs.pending.statedBudget).toBe(false);
    expect(inputs.unreadable.statedBudget).toBe(true);
    expect(inputs.readFailures).toContainEqual({
      label: "this project's stated budget",
      message: "permission denied for table projects",
    });
    // Null either way: "Not entered" is what the panel prints for null, and a
    // budget nobody could read must not become a number.
    expect(inputs.statedBudgetAmount).toBeNull();
  });

  it("still calls a genuinely pending budget column pending", async () => {
    const inputs = await loadProjectBudgetInputs(
      fakeSupabase({
        projects: { data: null, error: { message: "column projects.budget_amount does not exist" } },
      }),
      "project-1"
    );

    expect(inputs.pending.statedBudget).toBe(true);
    expect(inputs.unreadable.statedBudget).toBe(false);
    expect(inputs.readFailures).toEqual([]);
  });

  it("names the deliverable and spend-ledger lanes separately when each fails", async () => {
    const inputs = await loadProjectBudgetInputs(
      fakeSupabase({
        project_deliverables: permissionDenied("project_deliverables"),
        project_spend_entries: permissionDenied("project_spend_entries"),
      }),
      "project-1"
    );

    expect(inputs.unreadable.deliverables).toBe(true);
    expect(inputs.unreadable.spendEntries).toBe(true);
    expect(inputs.readFailures.map((failure) => failure.label)).toEqual([
      "this project's deliverables",
      "this project's direct spend ledger",
    ]);
    // "No deliverables recorded yet, so there is nothing to judge burn against."
    // is the panel's sentence for this array. It is now disowned by a flag.
    expect(inputs.deliverables).toEqual([]);
  });

  /**
   * THE DELIVERABLE PROJECTION IS A LADDER, NOT A SWITCH.
   *
   * Two migrations have added columns to project_deliverables — budgets
   * (20260727000012) and the assignee (20260811000006) — and a deployment can
   * be behind either or both. A two-step full→legacy fallback would have
   * answered "behind the assignee migration" by dropping all the way back to
   * the 2026-03 column set, and the panel would then have reported "no budget
   * basis" over budgets the database actually holds: a schema gap rendered as a
   * finding about an agency's money.
   *
   * These transport fixtures name the returned rung. The migration source
   * tests separately assert each projection; native fallback remains untested.
   */
  function laddered(pendingColumns: string[]) {
    const row: Partial<ProjectDeliverableBudgetRow> = budgetDeliverable("deliverable-1");
    row.assignee_user_id = "member-1";
    row.title = "Existing Conditions Memo";
    row.budget_amount = 1000;
    const budget = pendingColumns.includes("budget_amount");
    const assignee = pendingColumns.includes("assignee_user_id");
    if (budget) { delete row.budget_amount; delete row.percent_complete; }
    if (assignee) delete row.assignee_user_id;
    const client = { rpc: vi.fn(async () => ({ data: projectBudgetSnapshotFixture({
      project_deliverables: { data: [row], error: null },
    }, { assignee, budget }), error: null })) };
    return { client };
  }

  it("drops only the assignee column when only that migration is pending", async () => {
    const { client } = laddered(["assignee_user_id"]);
    const inputs = await loadProjectBudgetInputs(client, "project-1");

    expect(inputs.pending.deliverableAssigneeColumn).toBe(true);
    // The rung that matters: the budget columns were NOT collateral damage.
    expect(inputs.pending.deliverableBudgetColumns).toBe(false);
    expect(inputs.deliverables[0]).toMatchObject({ budget_amount: 1000, percent_complete: 50 });
    expect(inputs.deliverables[0]).not.toHaveProperty("assignee_user_id");
  });

  it("retains an existing nonnull assignee when only the budget columns are missing", async () => {
    const { client } = laddered(["budget_amount"]);
    const inputs = await loadProjectBudgetInputs(client, "project-1");
    expect(inputs.pending.deliverableBudgetColumns).toBe(true);
    expect(inputs.pending.deliverableAssigneeColumn).toBe(false);
    expect(inputs.deliverables[0].assignee_user_id).toBe("member-1");
    expect(inputs.deliverables[0]).not.toHaveProperty("budget_amount");
  });

  it("falls all the way back when both migrations are pending, and says so about both", async () => {
    const { client } = laddered(["assignee_user_id", "budget_amount"]);
    const inputs = await loadProjectBudgetInputs(client, "project-1");

    expect(inputs.pending.deliverableAssigneeColumn).toBe(true);
    expect(inputs.pending.deliverableBudgetColumns).toBe(true);
    expect(inputs.deliverables[0]).not.toHaveProperty("budget_amount");
    // The deliverables themselves still load — the list is not the casualty.
    expect(inputs.deliverables).toHaveLength(1);
  });

  it("reports nothing unreadable when every read answers", async () => {
    // Without this the assertions above would pass on a loader that always
    // claims failure, and the honest empty case is the common one.
    const inputs = await loadProjectBudgetInputs(fakeSupabase(), "project-1");

    expect(inputs.readFailures).toEqual([]);
    expect(inputs.unreadable).toEqual({
      deliverables: false,
      statedBudget: false,
      spendEntries: false,
      clientInvoices: false,
    });
    expect(inputs.pending).toEqual({
      snapshot: false,
      deliverables: false,
      deliverableBudgetColumns: false,
      deliverableAssigneeColumn: false,
      statedBudget: false,
      spendEntries: false,
      clientInvoices: false,
    });
  });
});


describe("complete project snapshot transport", () => {
  it("requests one scoped snapshot and retains inputs above every old cap and the backend cap", async () => {
    const deliverables = Array.from({ length: 1201 }, (_, i) => budgetDeliverable(`d${i}`));
    const spends = Array.from({ length: 1201 }, (_, i) => budgetSpend(`s${i}`, `d${i}`));
    const invoices = Array.from({ length: 1201 }, (_, i) => ({
      id: `i${i}`, status: i % 2 ? "paid" : "sent",
      client_invoice_line_items: [{ id: `l${i}`, deliverable_id: `d${i}`, amount: 2 }],
    }));
    // One parent has more lines than the backend cap, independently of parent count.
    invoices[0].client_invoice_line_items.push(...Array.from({ length: 1201 }, (_, i) => ({
      id: `nested${i}`, deliverable_id: "d1200", amount: 3,
    })));
    const client = fakeSupabase({
      project_deliverables: { data: deliverables, error: null },
      project_spend_entries: { data: spends, error: null },
      client_invoices: { data: invoices, error: null },
      projects: { data: { budget_amount: 9999 }, error: null },
    });
    const inputs = await loadProjectBudgetInputs(client, "project-1");
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("project_budget_inputs_v1", { p_project_id: "project-1" });
    expect(inputs.readFailures).toEqual([]);
    expect(inputs.deliverables).toHaveLength(1201);
    expect(inputs.spendEntries).toHaveLength(1201);
    expect(inputs.billedLines).toHaveLength(2402);
    expect(inputs.billedLines.at(-1)).toMatchObject({ id: "l1200", invoice_id: "i1200" });
    const snapshot = buildProjectBudgetSnapshot({
      project: { budget_amount: inputs.statedBudgetAmount }, ...inputs,
    });
    expect(snapshot.deliverableBudgetTotal).toBe(1201000);
    expect(snapshot.spendToDate).toBe(1201);
    expect(snapshot.billedToDate).toBe(6005);
    expect(snapshot.actualToDate).toBe(1201);
    expect(snapshot.remainingAgainstStatedBudget).toBe(8798);
    expect(snapshot.deliverables.at(-1)).toMatchObject({ billedToDate: 3605, actualToDate: 1 });
  });

  it("keeps equal-valued distinct cost and billing identities without combining or deducting them", async () => {
    const inputs = await loadProjectBudgetInputs(fakeSupabase({
      project_deliverables: { data: [budgetDeliverable("d")], error: null },
      project_spend_entries: { data: [budgetSpend("s1", "d"), budgetSpend("s2", "d")], error: null },
      client_invoices: { data: [{ id: "i", status: "paid", client_invoice_line_items: [
        { id: "l1", deliverable_id: "d", amount: 1 }, { id: "l2", deliverable_id: "d", amount: 1 },
      ] }], error: null },
    }), "project-1");
    const snapshot = buildProjectBudgetSnapshot({ project: null, ...inputs });
    expect(snapshot.spendToDate).toBe(2);
    expect(snapshot.billedToDate).toBe(2);
    expect(snapshot.actualToDate).toBe(2);
    expect(inputs.billedLines.map((line) => line.id)).toEqual(["l1", "l2"]);
  });

  it.each(["deliverables", "spendEntries", "clientInvoices", "invoice lines"])("refuses repeated %s primary keys", async (kind) => {
    const data = projectBudgetSnapshotFixture({
      project_deliverables: { data: [budgetDeliverable("d")], error: null },
      project_spend_entries: { data: [budgetSpend("s")], error: null },
      client_invoices: { data: [{ id: "i", status: "sent", client_invoice_line_items: [
        { id: "l", deliverable_id: "d", amount: 1 },
      ] }], error: null },
    });
    if (kind === "invoice lines") {
      const rows = data.clientInvoices.data as Array<{ client_invoice_line_items: unknown[] }>;
      rows[0].client_invoice_line_items.push(rows[0].client_invoice_line_items[0]);
    } else {
      const rows = data[kind as "deliverables" | "spendEntries" | "clientInvoices"].data as unknown[];
      rows.push(rows[0]);
    }
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ data, error: null }) }, "project-1");
    expect(inputs.unreadable.spendEntries).toBe(true);
    expect(inputs.readFailures[0].message).toMatch(/repeated source identities/);
    expect(inputs.billedLines).toEqual([]);
  });

  it.each([null, {}, { ...projectBudgetSnapshotFixture(), project_id: "another-project" },
  ])("refuses absent, malformed or wrong-project envelopes (%#)", async (data) => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ data, error: null }) }, "project-1");
    expect(Object.values(inputs.unreadable).every(Boolean)).toBe(true);
    expect(inputs.readFailures[0].message).toMatch(/invalid or belongs/);
  });

  it("refuses omitted financial projection columns instead of inventing a budget basis", async () => {
    const row: Partial<ReturnType<typeof budgetDeliverable>> = budgetDeliverable("d");
    delete row.budget_amount;
    const inputs = await loadProjectBudgetInputs(fakeSupabase({ project_deliverables: { data: [row], error: null } }), "project-1");
    expect(inputs.unreadable.deliverables).toBe(true);
    expect(inputs.readFailures[0].message).toMatch(/omitted required deliverable columns/);
  });

  it("returns thrown transport failures as unreadable without any table-read fallback", async () => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => { throw new Error("connection closed"); } }, "project-1");
    expect(Object.values(inputs.unreadable).every(Boolean)).toBe(true);
    expect(inputs.readFailures[0].message).toBe("connection closed");
  });

  it("keeps whole-snapshot permission failures distinct from a missing snapshot migration", async () => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ data: null, error: { code: "42501", message: "permission denied for function project_budget_inputs_v1" } }) }, "project-1");
    expect(inputs.pending.snapshot).toBe(false);
    expect(Object.values(inputs.unreadable).every(Boolean)).toBe(true);
    expect(inputs.readFailures[0].message).toMatch(/permission denied/);
  });

  it("marks a missing snapshot RPC pending and leaves every financial source unavailable", async () => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.project_budget_inputs_v1 in the schema cache" } }) }, "project-1");
    expect(inputs.pending.snapshot).toBe(true);
    expect(inputs.pending.spendEntries).toBe(false);
    expect(inputs.pending.deliverableAssigneeColumn).toBe(false);
    expect(inputs.pending.deliverableBudgetColumns).toBe(false);
    expect(Object.values(inputs.unreadable).some(Boolean)).toBe(false);
    expect(inputs.readFailures).toEqual([]);
  });
});
