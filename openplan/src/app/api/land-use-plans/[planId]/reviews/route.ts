import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess } from "@/lib/land-use-plans/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({ planId: z.string().uuid() });
const payloadSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("record_event"),
    versionId: z.string().uuid(),
    eventKind: z.enum(["internal_consistency", "environmental_review", "public_draft", "hearing", "recommendation", "comment_response"]),
    occurredOn: z.string().date().nullable().optional(),
    decisionBody: z.string().trim().max(240).nullable().optional(),
    engagementCampaignId: z.string().uuid().nullable().optional(),
    evidenceDocumentId: z.string().uuid().nullable().optional(),
    notes: z.string().max(20_000).nullable().optional(),
  }).strict(),
  z.object({
    operation: z.literal("record_consultation"),
    versionId: z.string().uuid(),
    status: z.enum(["not_started", "initiated", "in_progress", "complete", "not_applicable"]),
    evidenceDocumentId: z.string().uuid().nullable().optional(),
    confidentialNotes: z.string().max(50_000).nullable().optional(),
    containsSensitiveLocations: z.boolean().optional(),
  }).strict(),
]);

type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.reviews", request);
  audit.info("land_use_plan_review_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
  if (!body.ok) return body.response;
  const parsed = payloadSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid review operation", issues: parsed.error.issues }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const { access } = loaded;
  const payload = parsed.data;

  const { data: version, error: versionError } = await access.supabase.from("land_use_plan_versions").select("id").eq("id", payload.versionId).eq("plan_id", access.plan.id).maybeSingle();
  if (versionError) return NextResponse.json({ error: "Failed to verify the plan version" }, { status: 500 });
  if (!version) return NextResponse.json({ error: "Version is outside this plan" }, { status: 400 });

  async function checkWorkspaceRef(table: string, id: string | null | undefined) {
    if (!id) return true;
    const { data, error } = await access.supabase.from(table).select("*").eq("id", id).eq("workspace_id", access.plan.workspace_id).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }
  if ("engagementCampaignId" in payload && !(await checkWorkspaceRef("engagement_campaigns", payload.engagementCampaignId))) {
    return NextResponse.json({ error: "Engagement campaign is outside this workspace" }, { status: 400 });
  }
  if (!(await checkWorkspaceRef("kb_documents", payload.evidenceDocumentId))) {
    return NextResponse.json({ error: "Evidence document is outside this workspace" }, { status: 400 });
  }

  if (payload.operation === "record_consultation") {
    const { data: existing, error: existingError } = await access.supabase.from("land_use_plan_consultation_records").select("id").eq("version_id", payload.versionId).maybeSingle();
    if (existingError) return NextResponse.json({ error: "Failed to read the private consultation information" }, { status: 500 });
    const values = {
      status: payload.status,
      evidence_document_id: payload.evidenceDocumentId ?? null,
      confidential_notes: payload.confidentialNotes ?? null,
      contains_sensitive_locations: payload.containsSensitiveLocations ?? false,
    };
    const result = existing
      ? await access.supabase.from("land_use_plan_consultation_records").update(values).eq("id", existing.id).select("id").single()
      : await access.supabase.from("land_use_plan_consultation_records").insert({
          ...values,
          workspace_id: access.plan.workspace_id,
          plan_id: access.plan.id,
          version_id: payload.versionId,
          created_by: access.userId,
        }).select("id").single();
    if (isWriteFailure(result.error)) return NextResponse.json({ error: "Failed to save private consultation information" }, { status: 500 });
    if (existing && writeMatchedNoRows(result)) return noRowsMatchedResponse({ subject: "private consultation information", targetWasVerified: true });
    if (!result.data) return NextResponse.json({ error: "The consultation information was saved but could not be read back" }, { status: 500 });
    return NextResponse.json({ consultationId: result.data.id });
  }

  const { data, error } = await access.supabase.from("land_use_plan_review_events").insert({
    workspace_id: access.plan.workspace_id,
    version_id: payload.versionId,
    event_kind: payload.eventKind,
    occurred_on: payload.occurredOn ?? null,
    decision_body: payload.decisionBody ?? null,
    engagement_campaign_id: payload.engagementCampaignId ?? null,
    evidence_document_id: payload.evidenceDocumentId ?? null,
    notes: payload.notes ?? null,
    created_by: access.userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: "Failed to record review event" }, { status: 500 });
  return NextResponse.json({ reviewEventId: data.id }, { status: 201 });
}
