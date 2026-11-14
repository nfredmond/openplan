import { describe, expect, it } from "vitest";
import { loadProjectBudgetInputs, projectDeliverableReadState } from "@/lib/projects/budget-queries";
import { buildProjectBudgetSnapshot } from "@/lib/projects/budget";
import { budgetDeliverable, budgetSpend, projectBudgetSnapshotFixture } from "./helpers/project-budget-snapshot";

async function loadRequired(value: unknown, source: "spend" | "invoice") {
  const data = projectBudgetSnapshotFixture(source === "spend" ? {
    project_spend_entries: { data: [{ ...budgetSpend("s"), amount: value }], error: null },
  } : {
    client_invoices: { data: [{ id: "i", status: "sent", client_invoice_line_items: [
      { id: "l", deliverable_id: null, amount: value },
    ] }], error: null },
  });
  return loadProjectBudgetInputs({ rpc: async () => ({ data, error: null }) }, "project-1");
}

describe("required NUMERIC(14,2) source amounts", () => {
  for (const source of ["spend", "invoice"] as const) {
    it.each([null, "9".repeat(400), Infinity, NaN, -0.01, "-0.01", "12junk", "", "1e2", "0x10",
      "1.001", 1.001, "1000000000000.00", 1000000000000, {}, undefined])(
      `refuses unsupported ${source} amounts (%#)`, async (value) => {
        const inputs = await loadRequired(value, source);
        expect(inputs.unreadable[source === "spend" ? "spendEntries" : "clientInvoices"]).toBe(true);
        expect(inputs.pending.snapshot).toBe(false);
        expect(inputs.readFailures).not.toEqual([]);
        expect(inputs.unreadable.deliverables).toBe(false);
        expect(inputs.unreadable.statedBudget).toBe(false);
      }
    );
    it.each([0, "0.00", 0.01, "0.01", 12.34, "12.34", 999999999999.99, "999999999999.99"])(
      `preserves supported ${source} amounts (%#)`, async (value) => {
        const inputs = await loadRequired(value, source);
        expect(inputs.readFailures).toEqual([]);
        const snapshot = buildProjectBudgetSnapshot({ project: null, ...inputs });
        expect(source === "spend" ? snapshot.spendToDate : snapshot.billedToDate).toBe(Number(value));
        expect(snapshot.actualToDate).toBe(source === "spend" ? Number(value) : 0);
      }
    );
  }

  it.each([null, 0, "0.00", "999999999999.99"])("preserves nullable optional budgets (%#)", async (value) => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ error: null,
      data: projectBudgetSnapshotFixture({ projects: { data: { budget_amount: value }, error: null },
        project_deliverables: { data: [{ ...budgetDeliverable("d"), budget_amount: value }], error: null } }),
    }) }, "project-1");
    expect(inputs.readFailures).toEqual([]);
    expect(inputs.statedBudgetAmount).toBe(value);
    expect(inputs.deliverables[0].budget_amount).toBe(value);
  });
});

describe("exact missing public snapshot function", () => {
  it.each([
    ["42883", "function public.project_budget_inputs_v1(uuid) does not exist"],
    ["42883", 'function "public"."project_budget_inputs_v1"(uuid) does not exist'],
    ["42883", 'function public."project_budget_inputs_v1"(p_project_id => uuid) does not exist'],
    ["PGRST202", "Could not find the function public.project_budget_inputs_v1 in the schema cache"],
    ["PGRST202", "Could not find the function public.project_budget_inputs_v1(p_project_id) in the schema cache"],
    ["PGRST202", 'Could not find the function "public"."project_budget_inputs_v1" with parameter p_project_id in the schema cache'],
  ])("marks only proven missing snapshot RPC pending (%#)", async (code, message) => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ data: null, error: { code, message } }) }, "project-1");
    expect(inputs.pending.snapshot).toBe(true);
    expect(projectDeliverableReadState(inputs)).toBe("pending");
    expect(inputs.pending.deliverables).toBe(false);
    expect(inputs.unreadable.deliverables).toBe(false);
    expect(inputs.readFailures).toEqual([]);
  });

  it.each([
    ["42883", "function public.workspace_policy_helper(uuid) does not exist"],
    ["42883", 'function "public"."workspace_policy_helper"(uuid) does not exist'],
    ["42883", 'function "public"."PROJECT_BUDGET_INPUTS_V1"(uuid) does not exist'],
    ["42883", "function other.project_budget_inputs_v1(uuid) does not exist"],
    ["42883", "function project_budget_inputs_v1(uuid) does not exist"],
    ["42883", "function public.project_budget_inputs_v1(integer) does not exist"],
    ["42883", "function public.project_budget_inputs_v1_helper(uuid) does not exist"],
    ["PGRST202", "Could not find the function public.workspace_policy_helper in the schema cache"],
    ["PGRST202", "schema cache is unavailable"],
    ["42703", "column workspace_policy_helper.unknown does not exist"],
    ["42501", "permission denied for function public.project_budget_inputs_v1"],
    ["42883", ""],
  ])("retains unproven or dependency failures as unreadable (%#)", async (code, message) => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ data: null, error: { code, message } }) }, "project-1");
    expect(inputs.pending.snapshot).toBe(false);
    expect(inputs.unreadable.deliverables).toBe(true);
    expect(projectDeliverableReadState(inputs)).toBe("unreadable");
    expect(inputs.readFailures[0].message).toBe(message || "no message reported");
  });

  it.each([
    ["42703", "column policy_helper.unknown does not exist"],
    ["42P01", 'relation "public.policy_helper" does not exist'],
    ["42883", "function public.workspace_policy_helper(uuid) does not exist"],
  ])("retains unknown deliverable read failures without inventing optional gaps (%#)", async (code, message) => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ error: null,
      data: projectBudgetSnapshotFixture({ project_deliverables: { data: null, error: { code, message } } }),
    }) }, "project-1");
    expect(inputs.pending.deliverables).toBe(false);
    expect(inputs.pending.deliverableAssigneeColumn).toBe(false);
    expect(inputs.pending.deliverableBudgetColumns).toBe(false);
    expect(inputs.unreadable.deliverables).toBe(true);
    expect(inputs.readFailures).toContainEqual({ label: "this project's deliverables", message, code });
  });

  it("still discloses the actually absent deliverable table", async () => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ error: null,
      data: projectBudgetSnapshotFixture({ project_deliverables: { data: null,
        error: { code: "42P01", message: 'relation "public.project_deliverables" does not exist' } } }),
    }) }, "project-1");
    expect(inputs.pending.deliverables).toBe(true);
    expect(inputs.unreadable.deliverables).toBe(false);
    expect(inputs.pending.deliverableAssigneeColumn).toBe(false);
    expect(inputs.readFailures).toEqual([]);
  });
});

describe("deliverable availability from complete project inputs", () => {
  it.each([{ rows: [] }, { rows: [budgetDeliverable("d")] }])("keeps genuinely complete deliverables readable (%#)", async ({ rows }) => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ error: null,
      data: projectBudgetSnapshotFixture({ project_deliverables: { data: rows, error: null } }),
    }) }, "project-1");
    expect(projectDeliverableReadState(inputs)).toBe("readable");
    expect(inputs.deliverables).toEqual(rows);
  });
  it.each([null, {}, { version: 1, project_id: "other-project" }])("withholds malformed transports (%#)", async data => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ data, error: null }) }, "project-1");
    expect(projectDeliverableReadState(inputs)).toBe("unreadable");
    expect(inputs.deliverables).toEqual([]);
  });
  it("withholds a rejected transport", async () => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => { throw new Error("Synthetic transport rejected"); } }, "project-1");
    expect(projectDeliverableReadState(inputs)).toBe("unreadable");
  });
  it("keeps a missing deliverable relation pending without a financial fallback", async () => {
    const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ error: null,
      data: projectBudgetSnapshotFixture({ project_deliverables: { data: null,
        error: { code: "42P01", message: 'relation "public.project_deliverables" does not exist' } } }),
    }) }, "project-1");
    expect(projectDeliverableReadState(inputs)).toBe("pending");
    expect(inputs.pending.snapshot).toBe(false);
  });
});


it.each([
  { source: "spendEntries" as const, label: "null data", payload: null },
  { source: "clientInvoices" as const, label: "null data", payload: null },
  { source: "clientInvoices" as const, label: "null nested lines", payload: [{ id: "i", status: "sent", client_invoice_line_items: null }] },
])("refuses malformed $source lane shape without discarding readable deliverables ($label)", async ({ source, payload }) => {
  const data = projectBudgetSnapshotFixture({ project_deliverables: { data: [budgetDeliverable("d")], error: null } });
  data[source] = { complete: true, data: payload, error: null };
  const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ data, error: null }) }, "project-1");
  expect(inputs.unreadable[source]).toBe(true);
  expect(inputs.unreadable.deliverables).toBe(false);
  expect(inputs.unreadable.statedBudget).toBe(false);
  expect(inputs.deliverables[0]).toMatchObject({ budget_amount: 1000, percent_complete: 50 });
  expect(inputs.readFailures[0].message).toMatch(/source is invalid/);
});

it("refuses progress beyond the source's recorded 0–100 range", async () => {
  const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ error: null,
    data: projectBudgetSnapshotFixture({ project_deliverables: {
      data: [{ ...budgetDeliverable("d"), percent_complete: 101 }], error: null,
    } }),
  }) }, "project-1");
  expect(inputs.unreadable.deliverables).toBe(true);
});

it.each([null, 0, "100.00"])("preserves nullable progress and its endpoints (%#)", async (value) => {
  const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ error: null,
    data: projectBudgetSnapshotFixture({ project_deliverables: {
      data: [{ ...budgetDeliverable("d"), percent_complete: value }], error: null,
    } }),
  }) }, "project-1");
  expect(inputs.readFailures).toEqual([]);
  expect(inputs.deliverables[0].percent_complete).toBe(value);
});
