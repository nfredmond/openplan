import type { SupabaseClient } from "@supabase/supabase-js";
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
  const update = (values: Record<string, unknown>) => input.client.from("reports")
    .update(values).eq("id", input.reportId).eq("updated_at", input.reportUpdatedAt)
    .select("updated_at").maybeSingle();
  let result = await update(input.update);
  if (result.error && looksLikePendingSchema(result.error.message)) result = await update(input.legacyUpdate);
  if (result.error) return { error: result.error, status: 500 };
  if (!result.data) {
    return { error: { code: "report_changed_during_generation", message: "The report changed during generation. Review it before generating again." }, status: 409 };
  }
  if (typeof result.data.updated_at !== "string" || !Number.isFinite(Date.parse(result.data.updated_at))) {
    return { error: { message: "The report writeback revision could not be read." }, status: 500 };
  }
  const recorded = await input.client.from("report_artifacts").update({
    metadata_json: {
      ...input.artifactMetadata,
      generationWriteback: { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: result.data.updated_at },
    },
  }).eq("id", input.artifactId).eq("report_id", input.reportId).select("id").maybeSingle();
  if (recorded.error) return { error: recorded.error, status: 500 };
  if (!recorded.data) return { error: { message: "The report writeback receipt could not be saved." }, status: 500 };
  return { error: null, status: 200 };
}
