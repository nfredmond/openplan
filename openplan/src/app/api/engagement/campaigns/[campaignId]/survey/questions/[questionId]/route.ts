import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, validateCampaignCategoryAccess } from "@/lib/engagement/api";
import { validateSurveyConfig, type SurveyQuestionType } from "@/lib/engagement/survey";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({ campaignId: z.string().uuid(), questionId: z.string().uuid() });

// question_type is intentionally immutable — changing it would invalidate stored
// answers. Archive via isActive=false (keeps response history) instead of delete.
const patchQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2000).optional(),
    helpText: z.string().trim().max(2000).nullable().optional(),
    required: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    categoryId: z.string().uuid().nullable().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: "No fields to update" });

type RouteContext = { params: Promise<{ campaignId: string; questionId: string }> };

const QUESTION_SELECT =
  "id, campaign_id, category_id, question_type, prompt, help_text, required, is_active, sort_order, config_json, created_at, updated_at";

async function authorize(request: NextRequest, campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const access = await loadCampaignAccess(supabase, campaignId, user.id, "engagement.write");
  if (access.error) return { response: NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 }) };
  if (!access.campaign) return { response: NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 }) };
  if (!access.allowed) return { response: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) };
  return { supabase, user, campaign: access.campaign };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.questions.update", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = patchQuestionSchema.safeParse(payloadBody.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid survey question update", issues: parsed.error.issues }, { status: 400 });

    const auth = await authorize(request, routeParams.data.campaignId);
    if ("response" in auth) return auth.response;
    const { supabase, campaign } = auth;

    const { data: existing } = await supabase
      .from("engagement_survey_questions")
      .select("id, question_type")
      .eq("id", routeParams.data.questionId)
      .eq("campaign_id", campaign.id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Survey question not found" }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (parsed.data.prompt !== undefined) updates.prompt = parsed.data.prompt;
    if (parsed.data.helpText !== undefined) updates.help_text = parsed.data.helpText?.trim() || null;
    if (parsed.data.required !== undefined) updates.required = parsed.data.required;
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder;
    if (parsed.data.isActive !== undefined) updates.is_active = parsed.data.isActive;
    if (parsed.data.categoryId !== undefined) {
      if (parsed.data.categoryId) {
        const categoryAccess = await validateCampaignCategoryAccess(supabase, campaign.id, parsed.data.categoryId);
        if (categoryAccess.error || !categoryAccess.category) {
          return NextResponse.json({ error: "Category does not belong to this campaign" }, { status: 400 });
        }
      }
      updates.category_id = parsed.data.categoryId;
    }
    if (parsed.data.config !== undefined) {
      const configResult = validateSurveyConfig(existing.question_type as SurveyQuestionType, parsed.data.config);
      if (!configResult.ok) return NextResponse.json({ error: `Invalid question configuration: ${configResult.message}` }, { status: 400 });
      updates.config_json = configResult.config;
    }

    const { data: question, error: updateError } = await supabase
      .from("engagement_survey_questions")
      .update(updates)
      .eq("id", routeParams.data.questionId)
      .eq("campaign_id", campaign.id)
      .select(QUESTION_SELECT)
      .single();
    if (updateError || !question) {
      audit.error("question_update_failed", { questionId: routeParams.data.questionId, message: updateError?.message ?? "unknown" });
      return NextResponse.json({ error: "Failed to update survey question" }, { status: 500 });
    }
    return NextResponse.json({ question });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while updating survey question" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.questions.delete", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const auth = await authorize(request, routeParams.data.campaignId);
    if ("response" in auth) return auth.response;
    const { supabase, campaign } = auth;

    // Hard delete is data-safe: engagement_survey_answers.question_id is
    // ON DELETE SET NULL and answers snapshot question_type + prompt + answer_text,
    // so prior responses stay interpretable. (Builder UI prefers isActive=false.)
    const { error: deleteError } = await supabase
      .from("engagement_survey_questions")
      .delete()
      .eq("id", routeParams.data.questionId)
      .eq("campaign_id", campaign.id);
    if (deleteError) {
      audit.error("question_delete_failed", { questionId: routeParams.data.questionId, message: deleteError.message });
      return NextResponse.json({ error: "Failed to delete survey question" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while deleting survey question" }, { status: 500 });
  }
}
