import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({
  campaignId: z.string().uuid(),
  questionId: z.string().uuid(),
  optionId: z.string().uuid(),
});
const patchOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(500).optional(),
    value: z.string().trim().min(1).max(200).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    isActive: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: "No fields to update" });

type RouteContext = { params: Promise<{ campaignId: string; questionId: string; optionId: string }> };
const OPTION_SELECT = "id, question_id, campaign_id, label, value, is_active, sort_order, metadata_json, created_at, updated_at";
const DUPLICATE_KEY_CODE = "23505";

async function authorize(request: NextRequest, campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const access = await loadCampaignAccess(supabase, campaignId, user.id, "engagement.write");
  if (access.error) return { response: NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 }) };
  if (!access.campaign) return { response: NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 }) };
  if (!access.allowed) return { response: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) };
  return { supabase, campaign: access.campaign };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.options.update", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = patchOptionSchema.safeParse(payloadBody.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid survey option update", issues: parsed.error.issues }, { status: 400 });

    const auth = await authorize(request, routeParams.data.campaignId);
    if ("response" in auth) return auth.response;
    const { supabase, campaign } = auth;

    const updates: Record<string, unknown> = {};
    if (parsed.data.label !== undefined) updates.label = parsed.data.label;
    if (parsed.data.value !== undefined) updates.value = parsed.data.value;
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder;
    if (parsed.data.isActive !== undefined) updates.is_active = parsed.data.isActive;
    if (parsed.data.metadata !== undefined) updates.metadata_json = parsed.data.metadata;

    const { data: option, error: updateError } = await supabase
      .from("engagement_survey_question_options")
      .update(updates)
      .eq("id", routeParams.data.optionId)
      .eq("campaign_id", campaign.id)
      .eq("question_id", routeParams.data.questionId)
      .select(OPTION_SELECT)
      .single();
    if (updateError || !option) {
      if (updateError?.code === DUPLICATE_KEY_CODE) return NextResponse.json({ error: "An option with that value already exists" }, { status: 409 });
      audit.error("option_update_failed", { optionId: routeParams.data.optionId, message: updateError?.message ?? "not found" });
      return NextResponse.json({ error: "Failed to update survey option" }, { status: updateError ? 500 : 404 });
    }
    return NextResponse.json({ option });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while updating survey option" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.options.delete", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const auth = await authorize(request, routeParams.data.campaignId);
    if ("response" in auth) return auth.response;
    const { supabase, campaign } = auth;

    // Safe hard delete: answers reference option_id inside answer_json (no FK) and
    // snapshot answer_text, so aggregation renders "(removed option)" rather than
    // breaking. The builder UI prefers isActive=false once responses exist.
    const { error: deleteError } = await supabase
      .from("engagement_survey_question_options")
      .delete()
      .eq("id", routeParams.data.optionId)
      .eq("campaign_id", campaign.id)
      .eq("question_id", routeParams.data.questionId);
    if (deleteError) {
      audit.error("option_delete_failed", { optionId: routeParams.data.optionId, message: deleteError.message });
      return NextResponse.json({ error: "Failed to delete survey option" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while deleting survey option" }, { status: 500 });
  }
}
