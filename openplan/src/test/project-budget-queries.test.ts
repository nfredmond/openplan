import { describe, expect, it, vi } from "vitest";
import {
  loadProjectBudgetInputs,
  type ProjectBudgetQuerySupabaseLike,
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

type Answer = { data: unknown; error: { message?: string } | null };

/**
 * A chainable stand-in for the PostgREST builder. Every link returns the same
 * node, and the node is thenable, so any order of `.select().eq().order()
 * .limit()` / `.in()` resolves to the table's answer — and `.maybeSingle()`
 * resolves to it too, which is how the stated-budget read is served.
 */
function chain(answer: Answer) {
  const node: Record<string, unknown> = {
    maybeSingle: vi.fn(async () => answer),
    then: (resolve: (value: Answer) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(answer).then(resolve, reject),
  };
  for (const link of ["select", "eq", "order", "limit", "in"]) {
    node[link] = vi.fn(() => node);
  }
  return node;
}

const OK_ROWS: Answer = { data: [], error: null };
const OK_STATED_BUDGET: Answer = { data: { budget_amount: null }, error: null };

function fakeSupabase(overrides: Partial<Record<string, Answer>> = {}) {
  const answers: Record<string, Answer> = {
    project_deliverables: OK_ROWS,
    projects: OK_STATED_BUDGET,
    project_spend_entries: OK_ROWS,
    client_invoices: OK_ROWS,
    ...overrides,
  };

  return {
    from: (table: string) => chain(answers[table] ?? OK_ROWS),
  } as unknown as ProjectBudgetQuerySupabaseLike;
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
   * This fake answers by PROJECTION, which is the only way to see the rung.
   */
  function laddered(pendingColumns: string[]) {
    const row = {
      id: "deliverable-1",
      title: "Existing Conditions Memo",
      budget_amount: 1000,
      percent_complete: 50,
      assignee_user_id: "user-2",
    };
    const asked: string[] = [];
    const client = {
      from: (table: string) => {
        if (table !== "project_deliverables") return chain(table === "projects" ? OK_STATED_BUDGET : OK_ROWS);
        return {
          select: (columns: string) => {
            asked.push(columns);
            const missing = pendingColumns.find((column) => columns.includes(column));
            return chain(
              missing
                ? { data: null, error: { message: `column project_deliverables.${missing} does not exist` } }
                : { data: [row], error: null }
            );
          },
        };
      },
    } as unknown as ProjectBudgetQuerySupabaseLike;
    return { client, asked };
  }

  it("drops only the assignee column when only that migration is pending", async () => {
    const { client, asked } = laddered(["assignee_user_id"]);
    const inputs = await loadProjectBudgetInputs(client, "project-1");

    expect(inputs.pending.deliverableAssigneeColumn).toBe(true);
    // The rung that matters: the budget columns were NOT collateral damage.
    expect(inputs.pending.deliverableBudgetColumns).toBe(false);
    expect(inputs.deliverables[0]).toMatchObject({ budget_amount: 1000, percent_complete: 50 });
    expect(asked[0]).toContain("assignee_user_id");
    expect(asked[1]).toContain("budget_amount");
    expect(asked[1]).not.toContain("assignee_user_id");
  });

  it("falls all the way back when both migrations are pending, and says so about both", async () => {
    const { client, asked } = laddered(["assignee_user_id", "budget_amount"]);
    const inputs = await loadProjectBudgetInputs(client, "project-1");

    expect(inputs.pending.deliverableAssigneeColumn).toBe(true);
    expect(inputs.pending.deliverableBudgetColumns).toBe(true);
    expect(asked).toHaveLength(3);
    expect(asked[2]).not.toContain("budget_amount");
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
      deliverables: false,
      deliverableBudgetColumns: false,
      deliverableAssigneeColumn: false,
      statedBudget: false,
      spendEntries: false,
      clientInvoices: false,
    });
  });
});
