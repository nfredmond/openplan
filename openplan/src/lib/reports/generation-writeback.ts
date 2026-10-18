import type { SupabaseClient } from "@supabase/supabase-js";
import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

type WritebackError = { message: string; code?: string };

/** Record the exact automatic writeback, without overwriting a concurrent edit. */
export async function finishReportGeneration(input: {
  client: Pick<SupabaseClient, "from">;
  reportId: string;
  reportUpdatedAt: string;
  artifactId: string;
  artifactMetadata: Record<string, unknown>;
  update: Record<string, unknown>;
  legacyUpdate: Record<string, unknown>;
}): Promise<{ error: WritebackError | null; status: number }> {
  let result = await input.client.from("reports")
    .update(input.update).eq("id", input.reportId).eq("updated_at", input.reportUpdatedAt)
    .select("updated_at").maybeSingle();
  if (result.error && looksLikePendingSchema(result.error.message)) {
    const legacyResult = await input.client.from("reports")
      .update(input.legacyUpdate).eq("id", input.reportId).eq("updated_at", input.reportUpdatedAt)
      .select("updated_at").maybeSingle();
    result = legacyResult;
  }
  if (result.error && isWriteFailure(result.error)) return { error: result.error, status: 500 };
  if (writeMatchedNoRows(result)) {
    return { error: { code: "report_changed_during_generation", message: "The report changed during generation. Review it before generating again." }, status: 409 };
  }
  if (typeof result.data?.updated_at !== "string" || !Number.isFinite(Date.parse(result.data.updated_at))) {
    return { error: { message: "The report writeback revision could not be read." }, status: 500 };
  }
  const recorded = await input.client.from("report_artifacts").update({
    metadata_json: {
      ...input.artifactMetadata,
      generationWriteback: { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: result.data.updated_at },
    },
  }).eq("id", input.artifactId).eq("report_id", input.reportId).select("id").maybeSingle();
  if (recorded.error && isWriteFailure(recorded.error)) return { error: recorded.error, status: 500 };
  // The caller already inserted and read this artifact. A zero-row write is an
  // explicit persistence failure, not a confirmed receipt or a missing report.
  if (writeMatchedNoRows(recorded)) return { error: { message: "The database matched no artifact rows, so the report writeback receipt was not saved." }, status: 500 };
  return { error: null, status: 200 };
}
