import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { SURVEY_QUESTION_TYPES, type SurveyQuestionType } from "@/lib/engagement/survey";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";

const paramsSchema = z.object({ campaignId: z.string().uuid(), questionId: z.string().uuid() });
const createOptionSchema = z.object({
  label: z.string().trim().min(1).max(500),
  value: z.string().trim().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type RouteContext = { params: Promise<{ campaignId: string; questionId: string }> };
const OPTION_SELECT = "id, question_id, campaign_id, label, value, is_active, sort_order, metadata_json, created_at, updated_at";
const DUPLICATE_KEY_CODE = "23505";

async function loadQuestionForWrite(request: NextRequest, campaignId: string, questionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const access = await loadCampaignAccess(supabase, campaignId, user.id, "engagement.write");
  if (access.error) return { response: NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 }) };
  if (!access.campaign) return { response: NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 }) };
  if (!access.allowed) return { response: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) };
  const { data: question } = await supabase
    .from("engagement_survey_questions")
    .select("id, question_type")
    .eq("id", questionId)
    .eq("campaign_id", access.campaign.id)
    .maybeSingle();
  if (!question) return { response: NextResponse.json({ error: "Survey question not found" }, { status: 404 }) };
  return { supabase, user, campaign: access.campaign, question };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.options.list", request);
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const access = await loadCampaignAccess(supabase, routeParams.data.campaignId, user.id, "engagement.read");
    if (access.error) return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    if (!access.campaign) return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    if (!access.allowed) return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

    const { data: options } = await supabase
      .from("engagement_survey_question_options")
      .select(OPTION_SELECT)
      .eq("campaign_id", access.campaign.id)
      .eq("question_id", routeParams.data.questionId)
      .order("sort_order", { ascending: true });
    return NextResponse.json({ options: options ?? [] });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while listing survey options" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.survey.options.create", request);
  const startedAt = Date.now();
  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const parsed = createOptionSchema.safeParse(payloadBody.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid survey option payload", issues: parsed.error.issues }, { status: 400 });

    const loaded = await loadQuestionForWrite(request, routeParams.data.campaignId, routeParams.data.questionId);
    if ("response" in loaded) return loaded.response;
    const { supabase, campaign, question } = loaded;

    if (!SURVEY_QUESTION_TYPES[question.question_type as SurveyQuestionType]?.usesOptions) {
      return NextResponse.json({ error: "This question type does not use options" }, { status: 400 });
    }

    const { data: option, error: insertError } = await supabase
      .from("engagement_survey_question_options")
      .insert({
        question_id: question.id,
        campaign_id: campaign.id, // denormalized; the DB trigger enforces it matches the question
        label: parsed.data.label,
        value: parsed.data.value ?? null,
        sort_order: parsed.data.sortOrder ?? 0,
        metadata_json: parsed.data.metadata ?? {},
      })
      .select(OPTION_SELECT)
      .single();

    if (insertError || !option) {
      if (insertError?.code === DUPLICATE_KEY_CODE) return NextResponse.json({ error: "An option with that value already exists" }, { status: 409 });
      audit.error("option_insert_failed", { questionId: question.id, message: insertError?.message ?? "unknown", code: insertError?.code ?? null });
      return NextResponse.json({ error: "Failed to create survey option" }, { status: 500 });
    }
    audit.info("option_created", { campaignId: campaign.id, questionId: question.id, optionId: option.id, durationMs: Date.now() - startedAt });
    return NextResponse.json({ optionId: option.id, option }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Unexpected error while creating survey option" }, { status: 500 });
  }
}
