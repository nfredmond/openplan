import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/programs/work-program/server", () => ({ authorizeWorkProgram: vi.fn() }));
vi.mock("@/lib/assistant/action-approval-server", () => ({ readAssistantExecutionSource: vi.fn() }));
import { loadActualVersions, reportingRows } from "@/lib/programs/work-program/reporting-server";
it("reads all actuals and allocations with stable ranges, source cutoff and complete projections", async () => {
 const seen: { table: string; columns: string; range: number[]; filters: unknown[][] }[] = [];
 const client = { from(table: string) {
  const call = { table, columns: "", range: [] as number[], filters: [] as unknown[][] }; seen.push(call);
  const query = { select(columns: string) { call.columns = columns; return query; }, eq(...args: unknown[]) { call.filters.push(args); return query; }, order(column: string) { expect(column).toBe("id"); return query; }, range(a: number, b: number) { call.range = [a, b]; return query; }, lte(...args: unknown[]) { call.filters.push(args); return query; }, then(resolve: (v: unknown) => unknown) {
   const allocation = table === "work_program_actual_allocations";
   return Promise.resolve(resolve({ error: null, data: Array.from({ length: 1201 }, (_, i) => allocation ? { id: `allocation-${i}`, actual_version_id: `actual-${i}`, amount: 0.01, hours: null, element_id: "element", task_id: null, share: 10000 } : { id: `actual-${i}`, entry_id: `entry-${i}`, version: 1, amount: 0.01, hours: null }).slice(call.range[0], call.range[1] + 1) }));
  } }; return query;
 } } as unknown as Parameters<typeof loadActualVersions>[0];
 const rows = await loadActualVersions(client, "program", "2026-09-01T00:00:00Z");
 expect(rows).toHaveLength(1201); expect(rows.every(r => r.allocations.length === 1 && r.allocations[0].amount === "0.01")).toBe(true);
 for (const table of ["work_program_actual_versions", "work_program_actual_allocations"]) {
  const calls = seen.filter(c => c.table === table); expect(calls).toHaveLength(7); expect(calls.at(-1)!.range).toEqual([1200, 1399]);
  const relation = table.endsWith("allocations") ? "work_program_actual_versions." : "";
  for (const call of calls) { expect(call.filters).toContainEqual([relation + "program_id", "program"]); expect(call.filters).toContainEqual([relation + "created_at", "2026-09-01T00:00:00Z"]); expect(call.columns).toContain("amount"); }
 }
 expect(seen[0].columns).toContain("detail"); expect(seen[0].columns).toContain("cost_rate_id"); expect(seen[7].columns).toContain("actual_version_id"); expect(seen[7].columns).toContain("work_program_actual_versions!inner(program_id, created_at)");
});
it("refuses a failed ledger page instead of treating missing costs as an empty result", async () => {
 const query = { select() { return query; }, eq() { return query; }, order() { return query; }, range() { return query; }, then(resolve: (v: unknown) => unknown) { return Promise.resolve(resolve({ data: null, error: { message: "Synthetic read failure" } })); } };
 const client = { from: () => query } as unknown as Parameters<typeof reportingRows>[0];
 await expect(reportingRows(client, "work_program_actual_versions", "id", ["program_id", "program"])).rejects.toThrow("Could not read work_program_actual_versions");
});
