import { describe, expect, it, vi } from "vitest";
import { loadProjectBudgetInputs, type ProjectBudgetInputs } from "@/lib/projects/budget-queries";
import { budgetDeliverable, budgetSpend, projectBudgetSnapshotFixture } from "./helpers/project-budget-snapshot";

type SourceError = { code?: string; message: string };
const lanes = [
  { source: "statedBudget", label: "this project's stated budget", relations: ["projects"] },
  { source: "spendEntries", label: "this project's direct spend ledger", relations: ["project_spend_entries"] },
  { source: "clientInvoices", label: "client invoices billed to this project", relations: ["client_invoices", "client_invoice_line_items"] },
] as const;
type Source = typeof lanes[number]["source"];

function healthy() {
  return projectBudgetSnapshotFixture({
    projects: { data: { budget_amount: "4321.09" }, error: null },
    project_deliverables: { data: [{ ...budgetDeliverable("d"), percent_complete: 0 }], error: null },
    project_spend_entries: { data: [{ ...budgetSpend("s", "d"), amount: "1.23" }], error: null },
    client_invoices: { data: [{ id: "i", status: "sent", client_invoice_line_items: [
      { id: "l", deliverable_id: "d", amount: "2.34" },
    ] }], error: null },
  });
}

async function load(data: ReturnType<typeof healthy>) {
  const rpc = vi.fn(async () => ({ data, error: null }));
  const inputs = await loadProjectBudgetInputs({ rpc }, "project-1");
  expect(rpc.mock.calls).toEqual([["project_budget_inputs_v1", { p_project_id: "project-1" }]]);
  return inputs;
}

async function fail(source: Source, error: SourceError) {
  const data = healthy();
  data[source] = { complete: false, data: null, error: Object.freeze(error) };
  return load(data);
}

function expectDelivery(inputs: ProjectBudgetInputs) {
  expect(inputs.pending.snapshot).toBe(false);
  expect(inputs.unreadable.deliverables).toBe(false);
  expect(inputs.pending.deliverables).toBe(false);
  expect(inputs.pending.deliverableBudgetColumns).toBe(false);
  expect(inputs.pending.deliverableAssigneeColumn).toBe(false);
  expect(inputs.deliverables).toEqual([{ ...budgetDeliverable("d"), percent_complete: 0 }]);
}

// Synthetic RPC envelopes exercise the production loader, not PostgreSQL origin,
// RLS, cancellation reachability, PostgREST, rendered UI or native money claims.
describe("deliverable source error classification", () => {
  it.each([
    { label: "D01-public-absent", code: "42P01", message: 'relation "public.project_deliverables" does not exist', pending: true },
    { label: "D02-unqualified-absent", code: "42P01", message: 'relation "project_deliverables" does not exist', pending: true },
    { label: "D03-terminal-LF", code: "42P01", message: 'relation "public.project_deliverables" does not exist\n', pending: false },
    { label: "D04-code-absent", message: 'relation "public.project_deliverables" does not exist', pending: false },
    { label: "D05-code-permission", code: "42501", message: 'relation "public.project_deliverables" does not exist', pending: false },
    { label: "D06-code-internal", code: "XX000", message: 'relation "public.project_deliverables" does not exist', pending: false },
    { label: "D07-private-relation", code: "42P01", message: 'relation "private.project_deliverables" does not exist', pending: false },
    { label: "D08-deliverable-helper", code: "42P01", message: 'relation "public.project_deliverables_helper" does not exist', pending: false },
    { label: "D09-other-relation", code: "42P01", message: 'relation "public.policy_helper" does not exist', pending: false },
    { label: "D10-column-error", code: "42703", message: "column project_deliverables.budget_amount does not exist", pending: false },
    { label: "D11-cache-unavailable", code: "PGRST204", message: "schema cache is unavailable", pending: false },
    { label: "D12-permission-denied", code: "42501", message: "permission denied for table project_deliverables", pending: false },
  ])("preserves deliverable code and source identity [$label]", async ({ label: _label, pending, ...error }) => {
    const data = healthy();
    data.deliverables = { complete: false, data: null, error };
    const inputs = await load(data);
    expect(inputs.pending.deliverables).toBe(pending);
    expect(inputs.unreadable.deliverables).toBe(!pending);
    expect(inputs.readFailures).toEqual(pending ? [] : [{ label: "this project's deliverables", ...error }]);
    expect(inputs.deliverables).toEqual([]);
    expect(inputs.pending.snapshot).toBe(false);
    expect(inputs.pending.deliverableBudgetColumns).toBe(false);
    expect(inputs.pending.deliverableAssigneeColumn).toBe(false);
    expect(inputs.statedBudgetAmount).toBe("4321.09");
    expect(inputs.spendEntries).toEqual([{ ...budgetSpend("s", "d"), amount: "1.23" }]);
    expect(inputs.billedLines).toEqual([
      { id: "l", invoice_id: "i", deliverable_id: "d", amount: "2.34", invoice_status: "sent" },
    ]);
    for (const lane of lanes) {
      expect(inputs.pending[lane.source]).toBe(false);
      expect(inputs.unreadable[lane.source]).toBe(false);
    }
  });
});

describe.each(lanes)("$source source error classification", ({ source, label, relations }) => {
  it("retains dependency, ambiguous and code-mismatched errors as original failures", async () => {
    const failures: SourceError[] = [
      { code: "42703", message: "column budget_proof_helper.missing does not exist" },
      { code: "42883", message: "function public.budget_proof_helper(uuid) does not exist" },
      { code: "42501", message: "permission denied for table proof_source" },
      { code: "57014", message: "canceling statement due to statement timeout" },
      { code: "42P01", message: 'relation "public.budget_proof_helper" does not exist' },
      { code: "42703", message: "column p.budget_amount does not exist" },
      { code: "42703", message: 'column "budget_amount" does not exist' },
      { code: "42703", message: "column projects.unknown does not exist" },
      { code: "42703", message: 'column projects."BUDGET_AMOUNT" does not exist' },
      { code: "42703", message: "column private.projects.budget_amount does not exist" },
      { code: "42P01", message: `relation "private.${relations[0]}" does not exist` },
      { code: "42P01", message: `relation "public.${relations[0]}_helper" does not exist` },
      { code: "PGRST204", message: "schema cache is unavailable" },
      { code: "PGRST204", message: "Could not find the 'budget_amount' column of 'budget_proof_helper' in the schema cache" },
      { code: "XX000", message: "unrecognized source failure" },
      { message: "column budget_proof_helper.missing does not exist" },
      ...["42703", "42883", "42501", "57014", "XX000"].map((code) => ({
        code, message: `relation "public.${relations[0]}" does not exist`,
      })),
      ...["42883", "42501", "57014", "PGRST204", "XX000"].map((code) => ({
        code, message: "column projects.budget_amount does not exist",
      })),
      { code: "42703", message: "Could not find the 'budget_amount' column of 'projects' in the schema cache" },
    ];
    if (source !== "statedBudget") failures.push({ code: "42703", message: "column projects.budget_amount does not exist" });
    for (const error of failures) {
      const inputs = await fail(source, error);
      expect(inputs.pending[source], `${source}: ${JSON.stringify(error)}`).toBe(false);
      expect(inputs.unreadable[source]).toBe(true);
      expect(inputs.readFailures).toEqual([{ label, ...error }]);
      if (error.code === undefined) expect(inputs.readFailures[0]).not.toHaveProperty("code");
      expectDelivery(inputs);
    }
  });

  it("recognizes exact source absence without broad schema guesses", async () => {
    const missing: SourceError[] = relations.flatMap((relation) => [
      { code: "42P01", message: `relation "public.${relation}" does not exist` },
      { code: "42P01", message: `relation "${relation}" does not exist` },
      { message: `relation "public.${relation}" does not exist` },
    ]);
    if (source === "statedBudget") missing.push(
      { code: "42703", message: "column projects.budget_amount does not exist" },
      { code: "42703", message: 'column public.projects."budget_amount" does not exist' },
      { message: "column projects.budget_amount does not exist" },
      { code: "PGRST204", message: "Could not find the 'budget_amount' column of 'projects' in the schema cache" },
      { message: "Could not find the 'budget_amount' column of 'projects' in the schema cache" },
    );
    for (const error of missing) {
      const inputs = await fail(source, error);
      expect(inputs.pending[source], JSON.stringify(error)).toBe(true);
      expect(inputs.unreadable[source]).toBe(false);
      expect(inputs.readFailures).toEqual([]);
      expectDelivery(inputs);
    }
  });

  it("keeps other valid sources and unavailable values separate from recorded zero", async () => {
    const inputs = await fail(source, { code: "42703", message: "column policy_helper.missing does not exist" });
    expectDelivery(inputs);
    expect(inputs.statedBudgetAmount).toBe(source === "statedBudget" ? null : "4321.09");
    expect(inputs.spendEntries).toEqual(source === "spendEntries" ? [] : [{ ...budgetSpend("s", "d"), amount: "1.23" }]);
    expect(inputs.billedLines).toEqual(source === "clientInvoices" ? [] : [
      { id: "l", invoice_id: "i", deliverable_id: "d", amount: "2.34", invoice_status: "sent" },
    ]);
    for (const lane of lanes) {
      expect(inputs.unreadable[lane.source]).toBe(lane.source === source);
      expect(inputs.pending[lane.source]).toBe(false);
    }
  });
});

it("preserves stated budget precedence, recorded zero and not-entered states", async () => {
  for (const amount of ["4321.09", "0.00", null]) {
    const data = healthy();
    data.statedBudget = { complete: true, data: { budget_amount: amount }, error: null };
    const inputs = await load(data);
    expect(inputs.statedBudgetAmount).toBe(amount);
    expect(inputs.readFailures).toEqual([]);
    expect(Object.values(inputs.unreadable).some(Boolean)).toBe(false);
    expect(Object.values(inputs.pending).some(Boolean)).toBe(false);
    expectDelivery(inputs);
  }
});

it("retains the actual outer RPC failure code and message", async () => {
  const error = Object.freeze({ code: "42501", message: "permission denied for function project_budget_inputs_v1" });
  const inputs = await loadProjectBudgetInputs({ rpc: async () => ({ data: null, error }) }, "project-1");
  expect(inputs.pending.snapshot).toBe(false);
  expect(inputs.unreadable.statedBudget).toBe(true);
  expect(inputs.readFailures).toEqual([{ label: "this project's complete budget inputs", ...error }]);
});
