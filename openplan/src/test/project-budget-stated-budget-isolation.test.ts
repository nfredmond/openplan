import { describe, expect, it } from "vitest";
import { loadProjectBudgetInputs } from "@/lib/projects/budget-queries";
import { budgetDeliverable, budgetSpend, projectBudgetSnapshotFixture } from "./helpers/project-budget-snapshot";

function response(value: unknown) {
  return projectBudgetSnapshotFixture({
    projects: { data: { budget_amount: value }, error: null },
    project_deliverables: { data: [{ ...budgetDeliverable("d"), percent_complete: 0 }], error: null },
    project_spend_entries: { data: [budgetSpend("s", "d")], error: null },
    client_invoices: { data: [{ id: "i", status: "sent", client_invoice_line_items: [
      { id: "l", deliverable_id: "d", amount: "2.00" },
    ] }], error: null },
  });
}

async function load(data: unknown) {
  return loadProjectBudgetInputs({ rpc: async (name, args) => {
    expect(name).toBe("project_budget_inputs_v1");
    expect(args).toEqual({ p_project_id: "project-1" });
    return { data, error: null };
  } }, "project-1");
}

describe("stated-budget source failure preserves delivery records", () => {
  it.each(["9".repeat(400), "1.001", true, {}, undefined])(
    "isolates malformed stated-budget money (%#)", async (value) => {
      const inputs = await load(response(value));
      expect(inputs.unreadable.statedBudget).toBe(true);
      expect(inputs.pending.statedBudget).toBe(false);
      expect(inputs.pending.snapshot).toBe(false);
      expect(inputs.unreadable.deliverables).toBe(false);
      expect(inputs.unreadable.spendEntries).toBe(false);
      expect(inputs.unreadable.clientInvoices).toBe(false);
      expect(inputs.statedBudgetAmount).toBeNull();
      expect(inputs.deliverables).toEqual([{ ...budgetDeliverable("d"), percent_complete: 0 }]);
      expect(inputs.spendEntries).toEqual([budgetSpend("s", "d")]);
      expect(inputs.billedLines).toEqual([{ id: "l", invoice_id: "i", deliverable_id: "d", amount: "2.00", invoice_status: "sent" }]);
      expect(inputs.readFailures).toEqual([{
        label: "this project's stated budget",
        message: "Complete budget snapshot stated-budget source is invalid.",
      }]);
    }
  );

  it.each([null, 0, "0.00", "2500.25", "999999999999.99"])(
    "retains honest optional stated-budget values (%#)", async (value) => {
      const inputs = await load(response(value));
      expect(inputs.statedBudgetAmount).toBe(value);
      expect(inputs.unreadable.statedBudget).toBe(false);
      expect(inputs.readFailures).toEqual([]);
      expect(inputs.deliverables[0].percent_complete).toBe(0);
    }
  );

  it("retains the actual stated-budget permission failure", async () => {
    const data = response(2500);
    data.statedBudget = { complete: false, data: null, error: { code: "42501", message: "permission denied for table projects" } };
    const inputs = await load(data);
    expect(inputs.unreadable.statedBudget).toBe(true);
    expect(inputs.unreadable.deliverables).toBe(false);
    expect(inputs.readFailures).toEqual([{ label: "this project's stated budget", message: "permission denied for table projects", code: "42501" }]);
  });

  it.each([{ version: 2 }, { project_id: "another-project" }])(
    "refuses an invalid outer identity (%#)", async (invalid) => {
      const inputs = await load({ ...response("9".repeat(400)), ...invalid });
      expect(inputs.unreadable.deliverables).toBe(true);
      expect(inputs.deliverables).toEqual([]);
      expect(inputs.readFailures[0].message).toMatch(/invalid or belongs to another project/);
    }
  );

  it("does not hide invalid delivery records behind a stated-budget failure", async () => {
    const data = response("9".repeat(400));
    data.deliverables = { complete: true, data: [{ ...budgetDeliverable("d"), percent_complete: 101 }], error: null };
    const inputs = await load(data);
    expect(inputs.unreadable.deliverables).toBe(true);
    expect(inputs.deliverables).toEqual([]);
  });
});
