import { readEveryPage } from "@/lib/supabase/paged-read";

export const ATTEMPT_INSTRUMENT_PROJECTION = "id, workspace_id, model_run_id, stage_id, attempt_id, demand_method, model_output_artifact_id, model_output_sha256, input_bundle_artifact_id, match_audit_artifact_id, comparison_basis_artifact_id, assessment_artifact_id, diagnosis_artifact_id, input_bundle_sha256, match_audit_sha256, comparison_basis_sha256, assessment_sha256, diagnosis_sha256, scientific_outcome, created_at";

export type AttemptInstrument = {
  id: string;
  workspace_id: string;
  model_run_id: string;
  stage_id: string;
  attempt_id: string;
  demand_method: "aequilibrae" | "activitysim";
  scientific_outcome: "inconclusive";
  created_at: string;
} & Record<`${"model_output" | "input_bundle" | "match_audit" | "comparison_basis" | "assessment" | "diagnosis"}_${"artifact_id" | "sha256"}`, string>;

type ReadError = { message?: string };
type Query = PromiseLike<{ data: AttemptInstrument[] | null; error: ReadError | null }> & {
  in(column: string, values: string[]): Query;
  eq(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  range(from: number, to: number): Query;
};

/** Return all retained attempts or an explicit failed read. The caller's RLS still applies. */
export async function readAttemptInstruments(
  client: unknown,
  runIds: string[],
  workspaceId?: string,
): Promise<{ records: AttemptInstrument[]; readFailed: boolean }> {
  if (runIds.length === 0) return { records: [], readFailed: false };
  const db = client as { from(table: string): { select(columns: string): Query } };
  try {
    const result = await readEveryPage<AttemptInstrument, ReadError>(async (from, to) => {
      let query = db.from("model_attempt_instrument_custody")
        .select(ATTEMPT_INSTRUMENT_PROJECTION).in("model_run_id", runIds);
      if (workspaceId) query = query.eq("workspace_id", workspaceId);
      return await query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
    });
    return result.complete
      ? { records: result.rows, readFailed: false }
      : { records: [], readFailed: true };
  } catch {
    return { records: [], readFailed: true };
  }
}

export type CurrentModelStageAttempt = { stage_name: string; id: string; run_id: string; status: string; attempt_managed: boolean; active_attempt_id: string | null };
/** Read the existing user-visible active-stage projection after run authorization.
 * Managed commands own revocation and active pointers atomically. This reader
 * grants no access to private attempts, receipts or additional workspaces.
 */
export async function readCurrentModelStageAttempts(client: unknown, runId: string): Promise<{ records: CurrentModelStageAttempt[]; readFailed: boolean }> {
  type StageQuery = PromiseLike<{ data: CurrentModelStageAttempt[] | null; error: ReadError | null }> & {
    eq(column: string, value: string): StageQuery; order(column: string): StageQuery; range(from: number, to: number): StageQuery;
  };
  try {
    const db = client as { from(table: string): { select(columns: string): StageQuery } };
    const read = await readEveryPage<CurrentModelStageAttempt, ReadError>((from, to) => db.from("model_run_stages")
      .select("id, run_id, stage_name, status, attempt_managed, active_attempt_id").eq("run_id", runId).order("id").range(from, to));
    if (!read.complete || !read.rows.length || new Set(read.rows.map(row => row.id)).size !== read.rows.length ||
      read.rows.some(row => row.run_id !== runId || row.attempt_managed !== true || typeof row.id !== "string" || typeof row.stage_name !== "string" ||
        !["queued", "running", "succeeded", "failed", "cancelled", "skipped"].includes(row.status) ||
        (row.active_attempt_id !== null && typeof row.active_attempt_id !== "string"))) return { records: [], readFailed: true };
    return { records: read.rows.map(row => ({ id: row.id, run_id: row.run_id, stage_name: row.stage_name,
      status: row.status, attempt_managed: row.attempt_managed, active_attempt_id: row.active_attempt_id })), readFailed: false };
  } catch { return { records: [], readFailed: true }; }
}
