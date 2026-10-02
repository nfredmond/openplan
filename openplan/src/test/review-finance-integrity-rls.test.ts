import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { loadWorkspaceOperationsSummaryForWorkspace } from "@/lib/operations/workspace-summary";

// Native checks cover parent relationships and actual query projections, not just route mocks.
describe.skipIf(!LIVE_RLS)("review financial parent and dashboard regressions", () => {
 let service: SupabaseClient, owner: SupabaseClient, userId = "";
 const workspaces = [randomUUID(), randomUUID()];
 const funds = [randomUUID(), randomUUID(), randomUUID()];
 const periods = [randomUUID(), randomUUID()];
 const projectIds = [randomUUID(), randomUUID()];
 async function insert(table: string, value: Record<string, unknown>) {
  const result = await service.from(table).insert(value);
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
 }
 beforeAll(async () => {
  const env = getLocalSupabaseEnv();
  service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "review-finance-service");
  owner = liveClient(env.API_URL, env.ANON_KEY, "review-finance-owner");
  const password = `${randomUUID()}!Aa9`, email = `review-finance-${randomUUID()}@example.test`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Could not create synthetic account");
  userId = created.data.user.id;
  for (const id of workspaces) await insert("workspaces", { id, name: "Synthetic integrity test", slug: `integrity-${id}` });
  await insert("workspace_members", { workspace_id: workspaces[0], user_id: userId, role: "owner" });
  for (const [i, fund] of funds.entries()) {
   const workspace = workspaces[i === 2 ? 1 : 0], program = randomUUID();
   await insert("programs", { id: program, workspace_id: workspace, title: "Synthetic fund", program_type: "local_measure", cycle_name: "FY26" });
   await insert("measure_funds", { id: fund, workspace_id: workspace, program_id: program, receipt_cadence: "quarterly", currency_code: "USD" });
  }
  for (const [i, id] of periods.entries()) {
   await insert("measure_fund_periods", { id, workspace_id: workspaces[i], measure_fund_id: funds[i === 0 ? 0 : 2], period_label: "Q1", fiscal_year_label: "FY26", period_start: "2026-01-01", period_end: "2026-03-31", received_amount: 1000 });
   await insert("projects", { id: projectIds[i], workspace_id: workspaces[i], name: "Synthetic project" });
   await insert("project_submittals", { project_id: projectIds[i], title: "Synthetic submittal", submittal_type: "reimbursement", status: "submitted" });
  }
  const signedIn = await owner.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
 }, 90_000);
 afterAll(async () => {
  if (!service || !userId) return;
  await owner?.auth.signOut();
  const memberships = await service.from("workspace_members").select("workspace_id").eq("user_id", userId);
  const ids = new Set([...workspaces, ...(memberships.data ?? []).map(row => row.workspace_id)]);
  for (const id of ids) await service.from("workspaces").delete().eq("id", id);
  await service.auth.admin.deleteUser(userId);
 });
 const row = (fund = funds[0], amount = 100) => ({ workspace_id: workspaces[0], measure_fund_id: fund, period_id: periods[0], category_id: "all", amount, computation_basis: "manual", rationale: "Synthetic integrity fixture", stated_by: userId, stated_on: "2026-10-01" });
 const replace = (fund: string, period: string, allocations: unknown[]) => owner.rpc("replace_measure_period_allocation", { p_measure_fund_id: fund, p_period_id: period, p_allocations: allocations, p_off_the_top: [], p_reserves: [] });
 it("accepts exact replacement and refuses mismatched parents before any deletion", async () => {
  expect((await replace(funds[0], periods[0], [row()])).error).toBeNull();
  expect((await replace(funds[0], periods[0], [{ ...row(), rationale: "Harmless changed note" }])).error).toBeNull();
  expect((await replace(funds[1], periods[0], [row(funds[1])])).error?.code).toBe("23503");
  expect((await replace(funds[1], periods[0], [])).error?.code).toBe("23503");
  expect((await replace(funds[0], periods[1], [])).error?.code).toBe("23503");
  expect((await replace(funds[0], periods[0], [row(funds[0], -0.01)])).error?.code).toBe("23514");
  const retained = await owner.from("measure_allocations").select("amount,measure_fund_id").eq("period_id", periods[0]);
  expect(retained.error).toBeNull();
  expect(retained.data).toEqual([{ amount: 100, measure_fund_id: funds[0] }]);
 });
 it("refuses direct mismatched allocation writes, independently of the RPC", async () => {
  const result = await owner.from("measure_allocations").insert({ ...row(funds[1]), category_id: "wrong-parent" });
  expect(result.error?.code).toBe("23503");
 });
 it("loads actual project submittals through the workspace join", async () => {
  // Capture the real loader query while still executing it on native PostgREST.
  const reads: { data: unknown; error: unknown }[] = [];
  const client = new Proxy(owner, { get(target, property) {
   if (property !== "from") return Reflect.get(target, property);
   return (table: string) => {
    const query = target.from(table);
    if (table !== "project_submittals") return query;
    const select = query.select.bind(query);
    query.select = ((...args: Parameters<typeof query.select>) => {
     const selected = select(...args); const then = selected.then.bind(selected);
     selected.then = ((resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => then(result => { reads.push(result); return resolve(result); }, reject)) as typeof selected.then;
     return selected;
    }) as typeof query.select;
    return query;
   };
  } });
  await loadWorkspaceOperationsSummaryForWorkspace(client as unknown as Parameters<typeof loadWorkspaceOperationsSummaryForWorkspace>[0], workspaces[0]);
  expect(reads).toHaveLength(1); expect(reads[0].error).toBeNull();
  expect(reads[0].data).toEqual([expect.objectContaining({ project_id: projectIds[0], status: "submitted" })]);
 });
});
