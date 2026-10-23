import { z } from "zod";
import { jsonValuesEqual } from "@/lib/models/demand-agreement-artifact";
import { readEveryPage } from "@/lib/supabase/paged-read";
import { createServiceRoleClient } from "@/lib/supabase/server";

const outputSchema = z.object({
  kind: z.enum(["artifact", "kpi"]),
  ownership_state: z.enum([
    "legacy_unknown", "invalid_binding", "retained_inactive", "current_in_progress", "current_completed",
  ]),
  record: z.object({
    id: z.string().uuid(),
    run_id: z.string().uuid(),
    attempt_id: z.string().uuid().nullable(),
  }).passthrough(),
}).strict();
const outputsSchema = z.object({
  run_id: z.string().uuid(),
  run_status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  outputs: z.array(outputSchema),
}).strict();

export type ModelAttemptOutput = z.infer<typeof outputSchema>;
export type ModelAttemptOutputRead =
  | { available: true; runStatus: z.infer<typeof outputsSchema>["run_status"]; outputs: ModelAttemptOutput[] }
  | { available: false };

/** Read only after the caller authorizes this workspace and run. Retained rows
 * remain available for inspection; only current completed rows supply results.
 */
export async function readModelAttemptOutputs(workspaceId: string, runId: string): Promise<ModelAttemptOutputRead> {
  try {
    const { data, error } = await createServiceRoleClient().rpc("read_model_attempt_outputs", {
      p_run_id: runId,
      p_workspace_id: workspaceId,
    });
    if (error) return { available: false };
    const parsed = outputsSchema.safeParse(data);
    if (!parsed.success || parsed.data.run_id !== runId ||
      parsed.data.outputs.some(output => output.record.run_id !== runId ||
        (output.ownership_state.startsWith("current_") && output.record.attempt_id === null)) ||
      new Set(parsed.data.outputs.map(output => `${output.kind}:${output.record.id}`)).size !== parsed.data.outputs.length) {
      return { available: false };
    }
    return { available: true, runStatus: parsed.data.run_status, outputs: parsed.data.outputs };
  } catch {
    return { available: false };
  }
}

/** A successful stage on an unfinished parent does not establish completed run results. */
export function currentCompletedModelOutputs(read: Extract<ModelAttemptOutputRead, { available: true }>, kind: ModelAttemptOutput["kind"]) {
  return read.runStatus === "succeeded"
    ? read.outputs.filter(output => output.kind === kind && output.ownership_state === "current_completed").map(output => output.record)
    : [];
}

/** Intersect an authorized literal projection with native current custody.
 * This preserves the caller's fields and access scope instead of returning
 * extra service-role fields. Do not apply it to retained snapshots or history.
 */
export function filterCompletedAttemptRows<T extends object>(read: Extract<ModelAttemptOutputRead, { available: true }>, kind: ModelAttemptOutput["kind"], rows: T[]): T[] {
  const current = currentCompletedModelOutputs(read, kind);
  return rows.filter(row => {
    const projection = row as Record<string, unknown>;
    const matches = current.filter(record => record.id === projection.id);
    return matches.length === 1 && Object.entries(projection).every(([key, value]) => jsonValuesEqual(value, matches[0][key]));
  });
}

type Run = { id: string; workspace_id: string; attempt_managed: boolean; status: string };
type Result = { data: Run[] | null; error: { message: string } | null };
type Query = PromiseLike<Result> & {
  in(column: string, values: string[]): Query;
  eq(column: string, value: string): Query;
  order(column: string): Query;
  range(from: number, to: number): Query;
};

/** Current-result callers supply only rows already read under their original
 * authorization. Legacy rows retain their existing meaning, never new custody.
 */
export async function currentModelResultRows<T extends object>(client: unknown, workspaceId: string, runIds: string[], kind: ModelAttemptOutput["kind"], rows: T[], retainOriginalCitation = false, kpiNames?: readonly string[]): Promise<{ data: T[]; error: { message: string } | null }> {
  const unavailable = { data: [] as T[], error: { message: "Current model output custody could not be verified" } };
  const ids = [...new Set(runIds)];
  if (!ids.length) return rows.length ? unavailable : { data: [], error: null };
  try {
    const db = client as { from(table: string): { select(columns: string): Query } };
    const read = await readEveryPage<Run, { message: string }>((from, to) => db.from("model_runs")
      .select("id, workspace_id, attempt_managed, status").eq("workspace_id", workspaceId).in("id", ids).order("id").range(from, to));
    if (!read.complete || read.rows.length !== ids.length || new Set(read.rows.map(run => run.id)).size !== ids.length ||
      read.rows.some(run => !ids.includes(run.id) || run.workspace_id !== workspaceId || typeof run.attempt_managed !== "boolean") ||
      rows.some(row => !ids.includes(String((row as Record<string, unknown>).run_id)))) return unavailable;
    const selected: T[] = [];
    for (const run of read.rows) {
      const scoped = rows.filter(row => (row as Record<string, unknown>).run_id === run.id);
      if (!run.attempt_managed) { selected.push(...scoped); continue; }
      const outputRead = await readModelAttemptOutputs(workspaceId, run.id);
      if (!outputRead.available) return unavailable;
      if (retainOriginalCitation && outputRead.outputs.some(output => output.ownership_state === "retained_inactive")) return unavailable;
      const current = filterCompletedAttemptRows(outputRead, kind, scoped);
      const expected = currentCompletedModelOutputs(outputRead, kind).filter(record =>
        !kpiNames || kpiNames.includes(String(record.kpi_name)));
      if (current.length !== expected.length) return unavailable;
      selected.push(...current);
    }
    return { data: selected, error: null };
  } catch { return unavailable; }
}
