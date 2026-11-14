import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Whether a newer Safety report was generated after the one an SS4A
 * application was seeded from.
 *
 * The seed is frozen on purpose: the export prints the artifact the drafts
 * came from. This read only tells the planner a newer one exists, so an old
 * plan is not exported unknowingly. It never re-seeds. A failed read is
 * "unknown", never "current".
 */
type SafetySeedFreshness =
  | { status: "not_seeded" }
  | { status: "current" }
  | { status: "newer"; seededGeneratedAt: string; newestGeneratedAt: string; newestArtifactId: string }
  | { status: "unknown" };

const SAFETY_SEED_RECEIPT_SELECT = "artifact_id, created_at";
const SAFETY_SEED_ARTIFACT_DATE_SELECT = "id, generated_at";
/** Only seedable artifacts: a version 1 Safety plan snapshot. */
const SAFETY_SEED_NEWEST_SELECT = "id, generated_at, reports!inner(id)";
const SAFETY_SEED_V1_FILTER = "metadata_json->>safetyPlanSnapshotV1";

const receiptRow = z.object({ artifact_id: z.string().uuid(), created_at: z.string() });
const datedArtifactRow = z.object({ id: z.string().uuid(), generated_at: z.string().datetime({ offset: true }) });

export async function loadSafetySeedFreshness(
  client: SupabaseClient,
  scope: { workspaceId: string; opportunityId: string; projectId: string },
): Promise<SafetySeedFreshness> {
  try {
    const seed = await client.from("funding_opportunity_safety_seeds").select(SAFETY_SEED_RECEIPT_SELECT)
      .eq("workspace_id", scope.workspaceId).eq("opportunity_id", scope.opportunityId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (seed.error) return { status: "unknown" };
    if (seed.data === null) return { status: "not_seeded" };
    const receipt = receiptRow.safeParse(seed.data);
    if (!receipt.success) return { status: "unknown" };

    const [seeded, newest] = await Promise.all([
      client.from("report_artifacts").select(SAFETY_SEED_ARTIFACT_DATE_SELECT).eq("id", receipt.data.artifact_id).maybeSingle(),
      client.from("report_artifacts").select(SAFETY_SEED_NEWEST_SELECT)
        .eq("reports.workspace_id", scope.workspaceId).eq("reports.project_id", scope.projectId)
        .not(SAFETY_SEED_V1_FILTER, "is", null).not("generated_at", "is", null)
        .order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (seeded.error || newest.error) return { status: "unknown" };
    const seededRow = datedArtifactRow.safeParse(seeded.data);
    if (!seededRow.success) return { status: "unknown" };
    if (newest.data === null) return { status: "current" };
    const newestRow = datedArtifactRow.safeParse(newest.data);
    if (!newestRow.success) return { status: "unknown" };
    if (newestRow.data.id === seededRow.data.id
      || Date.parse(newestRow.data.generated_at) <= Date.parse(seededRow.data.generated_at)) return { status: "current" };
    return {
      status: "newer",
      seededGeneratedAt: seededRow.data.generated_at,
      newestGeneratedAt: newestRow.data.generated_at,
      newestArtifactId: newestRow.data.id,
    };
  } catch {
    return { status: "unknown" };
  }
}
