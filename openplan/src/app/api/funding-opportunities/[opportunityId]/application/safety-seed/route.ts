import { SAFETY_PLAN_PERSISTENCE_SELECT } from "@/lib/reports/safety-plan-persistence";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION } from "@/lib/safety/crash-evidence";
import { readSafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import { buildSafetySeedPreview, SafetySeedRefusal, SS4A_SEED_MIGRATION, SS4A_SECTION_PROJECTION, SS4A_PROJECT_PROJECTION, SS4A_REPORT_PROJECTION, SS4A_ARTIFACT_PROJECTION, type SeedSourceRows } from "@/lib/grants/ss4a-safety-seed";

const bodySchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("preview"), artifactId: z.string().uuid() }).strict(),
  z.object({ operation: z.literal("apply"), artifactId: z.string().uuid(), previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
type Context = { params: Promise<{ opportunityId: string }> };

/** Human-operated only until this workflow has a registered, approved agent action. */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("funding-opportunities.application.safety-seed", request);
  if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Safety plan seeding is a user-operated action. No registered approved assistant action exists; nothing was written." }, { status: 403 });
  try {
    const { opportunityId } = await context.params;
    if (!z.string().uuid().safeParse(opportunityId).success) return NextResponse.json({ error: "Invalid opportunity id" }, { status: 400 });
    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;
    const parsed = bodySchema.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid Safety seed request" }, { status: 400 });
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const access = await loadFundingOpportunityAccess(client, opportunityId, user.id, "programs.write");
    if (access.error) throw new Error("Failed to load opportunity access");
    if (!access.opportunity) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    if (!access.membership || !access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    const o = access.opportunity;
    if (!o.project_id) throw new SafetySeedRefusal("Link the opportunity to the exact Safety report project first.");
    if (parsed.data.operation === "apply") {
      const prior = await client.from("funding_opportunity_safety_seeds").select("id, artifact_id, preview_hash, draft_ids")
        .eq("workspace_id", o.workspace_id).eq("opportunity_id", o.id).eq("preview_hash", parsed.data.previewHash).maybeSingle();
      if (prior.error) return pendingOrFailure(prior.error);
      if (prior.data) {
        if (prior.data.artifact_id !== parsed.data.artifactId || !Array.isArray(prior.data.draft_ids) || prior.data.draft_ids.length !== 6) throw new SafetySeedRefusal("The retained seed receipt is inconsistent. No new drafts were written.");
        const replay = await createServiceRoleClient().rpc("apply_ss4a_safety_seed", {
          p_actor: user.id, p_rows: { opportunity: { id: o.id }, artifact: { id: parsed.data.artifactId } },
          p_preview_hash: parsed.data.previewHash, p_sections: [],
        });
        if (replay.error) return pendingOrFailure(replay.error);
        return NextResponse.json({ applied: true, replayed: true, receipt: replay.data });
      }
    }
    const [opportunity, project, artifact, sections] = await Promise.all([
      client.from("funding_opportunities").select("id, workspace_id, project_id, pursuit_kind, updated_at").eq("id", o.id).eq("workspace_id", o.workspace_id).maybeSingle(),
      client.from("projects").select(SS4A_PROJECT_PROJECTION).eq("id", o.project_id).eq("workspace_id", o.workspace_id).maybeSingle(),
      client.from("report_artifacts").select(SS4A_ARTIFACT_PROJECTION).eq("id", parsed.data.artifactId).maybeSingle(),
      client.from("funding_opportunity_application_sections").select(SS4A_SECTION_PROJECTION).eq("opportunity_id", o.id).eq("workspace_id", o.workspace_id).order("id"),
    ]);
    if ([opportunity, project, artifact, sections].some((result) => result.error)) throw new Error("Failed to read the complete Safety seed sources");
    if (!opportunity.data || !project.data || !artifact.data || !sections.data) throw new SafetySeedRefusal("The selected source is unavailable in this workspace and project.");
    const snapshot = readSafetyPlanSnapshot(artifact.data.metadata_json?.safetyPlanSnapshotV1);
    if (!snapshot) throw new SafetySeedRefusal("Legacy or malformed Safety snapshot. Regenerate the Safety report and select the new artifact. HTML cannot be used.");
    const [report, acquisition, drafts, persistence] = await Promise.all([
      client.from("reports").select(SS4A_REPORT_PROJECTION).eq("id", artifact.data.report_id).eq("workspace_id", o.workspace_id).eq("project_id", o.project_id).maybeSingle(),
      client.from("safety_crash_ingests").select(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION).eq("id", snapshot.acquisition.id).eq("workspace_id", o.workspace_id).eq("project_id", o.project_id).maybeSingle(),
      client.from("funding_opportunity_section_drafts").select("id, section_id", { count: "exact" }).eq("opportunity_id", o.id).eq("workspace_id", o.workspace_id).order("id").limit(1001),
      client.from("report_safety_snapshot_persistence").select(SAFETY_PLAN_PERSISTENCE_SELECT)
        .eq("artifact_id", parsed.data.artifactId).eq("report_id", artifact.data.report_id)
        .eq("workspace_id", o.workspace_id).eq("project_id", o.project_id).maybeSingle(),
    ]);
    if ([report, acquisition, drafts, persistence].some((result) => result.error)) throw new Error("Failed to read Safety provenance or draft history");
    if (!report.data || !acquisition.data || !persistence.data || !drafts.data || drafts.count === null || drafts.count !== drafts.data.length || drafts.data.length > 1000) throw new SafetySeedRefusal("Safety provenance is unavailable or draft history exceeds this seed's review window.");
    // Supabase's dynamic select strings are untyped. The validator checks source identity and snapshot shape.
    const rows = { opportunity: opportunity.data, project: project.data, artifact: artifact.data, sections: sections.data, report: report.data, acquisition: acquisition.data, drafts: drafts.data, persistence: persistence.data } as unknown as SeedSourceRows;
    const preview = buildSafetySeedPreview(rows);
    if (parsed.data.operation === "preview") return NextResponse.json({ preview });
    if (preview.previewHash !== parsed.data.previewHash) return NextResponse.json({ error: "Preview is stale. Sources or application work changed. Preview again before applying." }, { status: 409 });
    const result = await createServiceRoleClient().rpc("apply_ss4a_safety_seed", {
      p_actor: user.id, p_rows: rows, p_preview_hash: preview.previewHash, p_sections: preview.sections,
    });
    if (result.error) {
      audit.warn("safety_seed_apply_refused", { opportunityId: o.id, userId: user.id, code: result.error.code });
      if (result.error.code === "40001") return NextResponse.json({ error: "Sources or application work changed during apply. Preview again." }, { status: 409 });
      return pendingOrFailure(result.error);
    }
    audit.info("safety_seed_applied", { opportunityId: o.id, artifactId: parsed.data.artifactId, userId: user.id, previewHash: preview.previewHash });
    return NextResponse.json({ applied: true, receipt: result.data });
  } catch (error) {
    if (error instanceof SafetySeedRefusal) return NextResponse.json({ error: error.message }, { status: 422 });
    audit.error("safety_seed_failed", { message: error instanceof Error ? error.message : "Unexpected error" });
    return NextResponse.json({ error: "Safety seed failed. No partial seed is accepted. Retry the same apply after a lost response, or refresh the preview." }, { status: 500 });
  }
}

function pendingOrFailure(error: { message: string; code?: string }) {
  const pending = /schema cache|does not exist|could not find.*function|could not find.*table/i.test(error.message);
  return NextResponse.json({ error: pending ? `Safety seeding requires migration ${SS4A_SEED_MIGRATION}. Regenerate the preview after migration.` : "Failed to retain the Safety seed. Retry the same apply after a lost response." }, { status: pending ? 503 : 500 });
}
