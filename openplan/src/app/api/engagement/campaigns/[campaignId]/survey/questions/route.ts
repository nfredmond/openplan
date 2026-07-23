import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, validateCampaignCategoryAccess } from "@/lib/engagement/api";
import { loadSurveyDefinition } from "@/lib/engagement/survey-responses";
import { isSurveyQuestionType, validateSurveyConfig, type SurveyQuestionType } from "@/lib/engagement/survey";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({ campaignId: z.string().uuid() });

const createQuestionSchema = z.object({
  questionType: z.string().refine((v): v is SurveyQuestionType => isSurveyQuestionType(v), "Unknown question type"),
  prompt: z.string().trim().min(1).max(2000),
  helpText: z.string().trim().max(2000).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  categoryId: z.string().uuid().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

type RouteContext = { params: Promise<{ campaignId: string }> };

const QUESTION_SELECT =
  "id, campaign_id, category_id, question_type, prompt, help_text, required, is_active, sort_order, config_json, created_at, updated_at";

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.questions.list", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.read");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    const { questions, optionsByQuestion } = await loadSurveyDefinition(supabase, access.campaign.id);
    return NextResponse.json({
      questions: questions.map((q) => ({ ...q, options: optionsByQuestion.get(q.id) ?? [] })),
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while listing survey questions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.questions.create", request);
  const startedAt = Date.now();
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = createQuestionSchema.safeParse(payloadBody.data);
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid survey question payload", issues: parsed.error.issues }, { status: 400 });
    }

    // Type-specific config validation (likert scale, budget total, etc.).
    const configResult = validateSurveyConfig(parsed.data.questionType, parsed.data.config ?? {});
    if (!configResult.ok) {
      return NextResponse.json({ error: `Invalid question configuration: ${configResult.message}` }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.write");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    if (parsed.data.categoryId) {
      const categoryAccess = await validateCampaignCategoryAccess(supabase, access.campaign.id, parsed.data.categoryId);
      if (categoryAccess.error || !categoryAccess.category) {
        return NextResponse.json({ error: "Category does not belong to this campaign" }, { status: 400 });
      }
    }

    const { data: question, error: insertError } = await supabase
      .from("engagement_survey_questions")
      .insert({
        campaign_id: access.campaign.id,
        category_id: parsed.data.categoryId ?? null,
        question_type: parsed.data.questionType,
        prompt: parsed.data.prompt,
        help_text: parsed.data.helpText?.trim() || null,
        required: parsed.data.required ?? false,
        sort_order: parsed.data.sortOrder ?? 0,
        config_json: configResult.config,
        created_by: user.id,
      })
      .select(QUESTION_SELECT)
      .single();

    if (insertError || !question) {
      audit.error("question_insert_failed", { campaignId: access.campaign.id, message: insertError?.message ?? "unknown", code: insertError?.code ?? null });
      return NextResponse.json({ error: "Failed to create survey question" }, { status: 500 });
    }

    audit.info("question_created", { userId: user.id, campaignId: access.campaign.id, questionId: question.id, durationMs: Date.now() - startedAt });
    return NextResponse.json({ questionId: question.id, question }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while creating survey question" }, { status: 500 });
  }
}
