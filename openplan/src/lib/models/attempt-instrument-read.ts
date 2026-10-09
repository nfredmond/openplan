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
