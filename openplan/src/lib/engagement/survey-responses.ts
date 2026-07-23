import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SURVEY_QUESTION_TYPES,
  tallyChoice,
  summarizeLikert,
  summarizeRating,
  summarizeRanking,
  summarizeBudget,
  summarizeMapPoints,
  summarizeFreeText,
  type SurveyQuestionType,
  type SurveyQuestionFamily,
} from "./survey";

// The survey RESPONSE tables (sessions + answers) are sensitive + service-role
// only (RLS on, zero policies). Every read here is campaign_id-scoped and this
// file is the ONLY module allowed to read them (enforced by
// src/test/engagement-survey-reader-inventory.test.ts). Definition tables
// (questions/options) are operator-scoped RLS; service-role reads bypass that.

type QueryClient = Pick<SupabaseClient, "from">;

export type SurveyQuestionRow = {
  id: string;
  question_type: SurveyQuestionType;
  prompt: string;
  help_text: string | null;
  required: boolean;
  sort_order: number;
  config_json: unknown;
  category_id: string | null;
};
export type SurveyOptionRow = {
  id: string;
  question_id: string;
  label: string;
  value: string | null;
  sort_order: number;
  metadata_json: Record<string, unknown>;
};
export type SurveyResponseSessionRow = {
  id: string;
  status: "pending" | "approved" | "rejected" | "flagged";
  submitted_by: string | null;
  source_type: string;
  moderation_notes: string | null;
  created_at: string;
  updated_at: string;
};
export type SurveyAnswerRow = {
  question_id: string | null;
  question_type: SurveyQuestionType;
  answer_json: unknown;
  answer_text: string | null;
};

export type SurveyQuestionAggregation = {
  questionId: string;
  questionType: SurveyQuestionType;
  family: SurveyQuestionFamily;
  prompt: string;
  answeredCount: number;
  aggregation: unknown;
};

/**
 * Pure aggregation dispatch: given a question, its active options, and the
 * approved answers for it, produce the honest screening-grade aggregate. No DB.
 */
export function aggregateSurveyQuestion(
  question: Pick<SurveyQuestionRow, "id" | "question_type" | "prompt" | "config_json">,
  options: { id: string; label: string }[],
  answers: { answer_json: unknown; answer_text?: string | null }[]
): SurveyQuestionAggregation {
  const def = SURVEY_QUESTION_TYPES[question.question_type];
  const parsed = def.configSchema.safeParse(question.config_json ?? {});
  const config = (parsed.success ? parsed.data : {}) as Record<string, unknown>;

  let aggregation: unknown;
  let answeredCount = 0;
  switch (question.question_type) {
    case "single_choice":
    case "multiple_choice": {
      const agg = tallyChoice(answers, options);
      aggregation = agg;
      answeredCount = agg.n;
      break;
    }
    case "likert": {
      const agg = summarizeLikert(answers, { scale: Number(config.scale ?? 5), labels: config.labels as string[] | undefined });
      aggregation = agg;
      answeredCount = agg.n;
      break;
    }
    case "rating": {
      const agg = summarizeRating(answers, { max: Number(config.max ?? 5) });
      aggregation = agg;
      answeredCount = agg.n;
      break;
    }
    case "ranking": {
      const agg = summarizeRanking(answers, options);
      aggregation = agg;
      answeredCount = agg.n;
      break;
    }
    case "budget_allocation": {
      const agg = summarizeBudget(answers, options, { total: Number(config.total ?? 0), unit: String(config.unit ?? "usd") });
      aggregation = agg;
      answeredCount = agg.n;
      break;
    }
    case "map_point": {
      const agg = summarizeMapPoints(answers);
      aggregation = agg;
      answeredCount = agg.n;
      break;
    }
    case "free_text":
    case "file_upload": {
      const agg = summarizeFreeText(answers);
      aggregation = agg;
      answeredCount = agg.n;
      break;
    }
  }
  return { questionId: question.id, questionType: question.question_type, family: def.family, prompt: question.prompt, answeredCount, aggregation };
}

/** Active question definitions + options for a campaign (definition tables). */
export async function loadSurveyDefinition(
  supabase: QueryClient,
  campaignId: string
): Promise<{ questions: SurveyQuestionRow[]; optionsByQuestion: Map<string, SurveyOptionRow[]> }> {
  const questionsResult = await supabase
    .from("engagement_survey_questions")
    .select("id, question_type, prompt, help_text, required, sort_order, config_json, category_id")
    .eq("campaign_id", campaignId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const questions = (questionsResult.data ?? []) as SurveyQuestionRow[];

  const optionsResult = await supabase
    .from("engagement_survey_question_options")
    .select("id, question_id, label, value, sort_order, metadata_json")
    .eq("campaign_id", campaignId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  const optionsByQuestion = new Map<string, SurveyOptionRow[]>();
  for (const option of (optionsResult.data ?? []) as SurveyOptionRow[]) {
    const arr = optionsByQuestion.get(option.question_id) ?? [];
    arr.push(option);
    optionsByQuestion.set(option.question_id, arr);
  }
  return { questions, optionsByQuestion };
}

/** Moderation list of response sessions (SENSITIVE, campaign_id-scoped). */
export async function loadSurveyResponseSessions(
  supabase: QueryClient,
  campaignId: string,
  opts: { status?: SurveyResponseSessionRow["status"] } = {}
): Promise<SurveyResponseSessionRow[]> {
  let query = supabase
    .from("engagement_survey_response_sessions")
    .select("id, status, submitted_by, source_type, moderation_notes, created_at, updated_at")
    .eq("campaign_id", campaignId);
  if (opts.status) query = query.eq("status", opts.status);
  const result = await query.order("created_at", { ascending: false });
  return (result.data ?? []) as SurveyResponseSessionRow[];
}

/** Approved answers for a campaign (SENSITIVE, campaign_id-scoped, inner-joined
 * to approved sessions so only moderated-in responses feed aggregation). */
export async function loadApprovedSurveyAnswers(
  supabase: QueryClient,
  campaignId: string
): Promise<SurveyAnswerRow[]> {
  const result = await supabase
    .from("engagement_survey_answers")
    .select("question_id, question_type, answer_json, answer_text, engagement_survey_response_sessions!inner(status)")
    .eq("campaign_id", campaignId)
    .eq("engagement_survey_response_sessions.status", "approved");
  return (result.data ?? []) as SurveyAnswerRow[];
}

/** Full campaign survey aggregation: approved answers dispatched per question. */
export async function aggregateCampaignSurvey(
  supabase: QueryClient,
  campaignId: string
): Promise<{ approvedResponseCount: number; questions: SurveyQuestionAggregation[] }> {
  const { questions, optionsByQuestion } = await loadSurveyDefinition(supabase, campaignId);
  const answers = await loadApprovedSurveyAnswers(supabase, campaignId);
  const approvedSessions = await loadSurveyResponseSessions(supabase, campaignId, { status: "approved" });

  const answersByQuestion = new Map<string, SurveyAnswerRow[]>();
  for (const answer of answers) {
    if (!answer.question_id) continue;
    const arr = answersByQuestion.get(answer.question_id) ?? [];
    arr.push(answer);
    answersByQuestion.set(answer.question_id, arr);
  }

  const aggregated = questions.map((question) => {
    const options = (optionsByQuestion.get(question.id) ?? []).map((o) => ({ id: o.id, label: o.label }));
    return aggregateSurveyQuestion(question, options, answersByQuestion.get(question.id) ?? []);
  });
  return { approvedResponseCount: approvedSessions.length, questions: aggregated };
}
