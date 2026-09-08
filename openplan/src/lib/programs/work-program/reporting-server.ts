import "server-only";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient, type createClient } from "@/lib/supabase/server";
import { authorizeWorkProgram } from "./server";
import { actualCommandSchema, type ActualVersion } from "./reporting";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";

type Client = Awaited<ReturnType<typeof createClient>>;
/** Stable pagination over an explicitly bounded immutable history; query failures never become empty ledgers. */
export async function reportingRows(client: Client, table: string, columns: string, filter: [string, string], cutoff?: string, cutoffColumn = "created_at") {
 const rows: Record<string, unknown>[] = [];
 for (let offset = 0; ; offset += 200) {
  let query = client.from(table).select(columns).eq(...filter).order("id").range(offset, offset + 199);
  if (cutoff) query = query.lte(cutoffColumn, cutoff);
  const result = await query;
  if (result.error) throw new Error(`Could not read ${table}`);
  const page = result.data as unknown as Record<string, unknown>[];
  rows.push(...page);
  if (page.length < 200) return rows;
 }
}
export function reportingError(error: { code?: string; message: string }) {
 const status = error.code === "42501" ? 403 : error.code === "PT409" || error.code === "23505" ? 409 : ["22023", "23514", "22007", "22008", "22P02", "23502"].includes(error.code ?? "") ? 400 : 503;
 return NextResponse.json({ error: status === 503 ? "Save could not be confirmed. Retry the same saved request to recover it." : error.message }, { status });
}
export async function saveWorkProgramActual(request: NextRequest, programId: string, body: unknown, requiredKind?: "labor" | "expense", projectId?: string) {
 const audit = createApiAuditLogger("programs.workProgram.actual", request);
 const access = await authorizeWorkProgram(request, programId, false);
 if (access.response) return access.response;
 if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Actuals are not a registered Planner Agent action. Record them in Programs." }, { status: 403 });
 const command = actualCommandSchema.safeParse(body);
 if (!command.success) return NextResponse.json({ error: "Complete the actual record, dates, exact amounts and source reference.", issues: command.error.issues }, { status: 400 });
 if ((requiredKind && command.data.kind !== requiredKind) || (projectId && command.data.projectId !== projectId)) return NextResponse.json({ error: "Actual does not match this source route" }, { status: 400 });
 const result = await createServiceRoleClient().rpc("record_work_program_actual", { p_program_id: programId, p_actor_id: access.user.id, p_command: command.data });
 if (result.error) audit.warn("actual_refused", { programId, code: result.error.code });
 else audit.info("actual_saved", { programId, entryId: result.data.entryId, version: result.data.version });
 return result.error ? reportingError(result.error) : NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}
export async function loadActualVersions(client: Client, programId: string, cutoff: string): Promise<ActualVersion[]> {
 const rows = await reportingRows(client, "work_program_actual_versions", "id, entry_id, version, revision_id, source_key, entry_date, kind, staff_id, time_entry_id, spend_entry_id, cost_rate_id, hours, amount, status, valuation_basis, detail, created_at", ["program_id", programId], cutoff);
 const allocations = await reportingRows(client, "work_program_actual_allocations", "id, actual_version_id, element_id, task_id, deliverable_id, amount, hours, share, work_program_actual_versions!inner(program_id, created_at)", ["work_program_actual_versions.program_id", programId], cutoff, "work_program_actual_versions.created_at");
 const grouped = new Map<string, Record<string, unknown>[]>();
 for (const allocation of allocations) {
  const id = String(allocation.actual_version_id);
  if (!grouped.has(id)) grouped.set(id, []);
  grouped.get(id)!.push(allocation);
 }
 return rows.map(row => ({ ...row, amount: row.amount == null ? null : String(row.amount), hours: row.hours == null ? null : String(row.hours), allocations: (grouped.get(String(row.id)) ?? []).map(a => ({ ...a, amount: a.amount == null ? null : String(a.amount), hours: a.hours == null ? null : String(a.hours) })) } as ActualVersion));
}
