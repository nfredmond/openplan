import type { SupabaseClient } from "@supabase/supabase-js";
import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
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
  type SurveyConditionQuestionRef,
} from "./survey";

// The survey RESPONSE tables (sessions + answers) are sensitive + service-role
// only (RLS on, zero policies). Every read here is campaign_id-scoped and this
// file is the ONLY module allowed to read them (enforced by
// src/test/engagement-survey-reader-inventory.test.ts). Definition tables
// (questions/options) are operator-scoped RLS; service-role reads bypass that.
//
// engagement_survey_response_drafts (part-finished responses) is held to the
// SAME confinement, by src/test/a-part-finished-survey-can-be-resumed.test.ts.
// It is a separate table from the response tables on purpose — a draft must
// never be countable as a submission. See the migration for the argument.

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
 * Rows, and the error that produced them.
 *
 * A READ THAT FAILED AND A CAMPAIGN WITH NOTHING RECORDED ARE DIFFERENT FACTS.
 * These loaders used to return `result.data ?? []` and said the second one for
 * both, which left every caller asserting "no responses" over an outage — and
 * the survey export carried a paragraph refusing to print its own row count
 * because of it. The error travels back so a route can answer a status and a
 * page can disclose, rather than each caller inventing an absence.
 *
 * Only the `message` is carried, because that is all any caller uses: routes
 * hand it to `classifyRouteReadFailure` and to their own audit line.
 */
export type SurveyRowsResult<Row> = { rows: Row[]; error: { message: string } | null };

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

/** Active question definitions + options for a campaign (definition tables).
 * `error` is the first read that failed: a survey with no questions and a
 * survey nobody could read look identical in the two collections. */
export async function loadSurveyDefinition(
  supabase: QueryClient,
  campaignId: string
): Promise<{
  questions: SurveyQuestionRow[];
  optionsByQuestion: Map<string, SurveyOptionRow[]>;
  error: { message: string } | null;
}> {
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
  return {
    questions,
    optionsByQuestion,
    error: questionsResult.error ?? optionsResult.error ?? null,
  };
}

/**
 * The ACTIVE survey as the condition validator needs to see it: display order,
 * with each question's live option ids.
 *
 * Only active questions, because those are the only ones a participant is shown
 * and therefore the only ones a condition can be decided against. An archived
 * question that others still point at is exactly the state
 * `validateSurveyConditionGraph` refuses — which is why the authoring routes run
 * this BEFORE archiving one.
 *
 * `sortOrder` travels with each entry so a caller can splice a
 * not-yet-written question into the right position and validate the survey that
 * would exist, rather than the one that does.
 */
export async function loadSurveyConditionRefs(
  supabase: QueryClient,
  campaignId: string
): Promise<(SurveyConditionQuestionRef & { sortOrder: number })[]> {
  const { questions, optionsByQuestion } = await loadSurveyDefinition(supabase, campaignId);
  return questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    question_type: question.question_type,
    config: question.config_json,
    optionIds: (optionsByQuestion.get(question.id) ?? []).map((option) => option.id),
    sortOrder: question.sort_order,
  }));
}

// ── Operator builder view (ALL questions incl. archived; definition tables) ──
export type SurveyBuilderOption = {
  id: string;
  question_id: string;
  campaign_id: string;
  label: string;
  value: string | null;
  is_active: boolean;
  sort_order: number;
  metadata_json: Record<string, unknown>;
};
export type SurveyBuilderQuestion = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  question_type: SurveyQuestionType;
  prompt: string;
  help_text: string | null;
  required: boolean;
  is_active: boolean;
  sort_order: number;
  config_json: Record<string, unknown>;
  options: SurveyBuilderOption[];
};

/** Full survey definition for the operator builder: every question (active and
 * archived) with all builder columns + all options. Definition tables only. */
export async function loadSurveyBuilderDefinition(
  supabase: QueryClient,
  campaignId: string
): Promise<SurveyBuilderQuestion[]> {
  const questionsResult = await supabase
    .from("engagement_survey_questions")
    .select("id, campaign_id, category_id, question_type, prompt, help_text, required, is_active, sort_order, config_json")
    .eq("campaign_id", campaignId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  type RawQuestion = Omit<SurveyBuilderQuestion, "options" | "config_json"> & { config_json: unknown };
  const questions = (questionsResult.data ?? []) as RawQuestion[];

  const optionsResult = await supabase
    .from("engagement_survey_question_options")
    .select("id, question_id, campaign_id, label, value, is_active, sort_order, metadata_json")
    .eq("campaign_id", campaignId)
    .order("sort_order", { ascending: true });
  const optionsByQuestion = new Map<string, SurveyBuilderOption[]>();
  for (const option of (optionsResult.data ?? []) as SurveyBuilderOption[]) {
    const arr = optionsByQuestion.get(option.question_id) ?? [];
    arr.push(option);
    optionsByQuestion.set(option.question_id, arr);
  }
  return questions.map((question) => ({
    ...question,
    config_json: (question.config_json ?? {}) as Record<string, unknown>,
    options: optionsByQuestion.get(question.id) ?? [],
  }));
}

/** Moderation list of response sessions (SENSITIVE, campaign_id-scoped). */
export async function loadSurveyResponseSessions(
  supabase: QueryClient,
  campaignId: string,
  opts: { status?: SurveyResponseSessionRow["status"] } = {}
): Promise<SurveyRowsResult<SurveyResponseSessionRow>> {
  let query = supabase
    .from("engagement_survey_response_sessions")
    .select("id, status, submitted_by, source_type, moderation_notes, created_at, updated_at")
    .eq("campaign_id", campaignId);
  if (opts.status) query = query.eq("status", opts.status);
  const result = await query.order("created_at", { ascending: false });
  return { rows: (result.data ?? []) as SurveyResponseSessionRow[], error: result.error ?? null };
}

/** Approved answers for a campaign (SENSITIVE, campaign_id-scoped, inner-joined
 * to approved sessions so only moderated-in responses feed aggregation). */
export async function loadApprovedSurveyAnswers(
  supabase: QueryClient,
  campaignId: string
): Promise<SurveyRowsResult<SurveyAnswerRow>> {
  const result = await supabase
    .from("engagement_survey_answers")
    .select("question_id, question_type, answer_json, answer_text, engagement_survey_response_sessions!inner(status)")
    .eq("campaign_id", campaignId)
    .eq("engagement_survey_response_sessions.status", "approved");
  return { rows: (result.data ?? []) as SurveyAnswerRow[], error: result.error ?? null };
}

/** Recent response sessions for one fingerprint (SENSITIVE, campaign_id-scoped).
 * Feeds the public-submit rate limit + the one-response-per-fingerprint FLAG.
 *
 * THE ONE LOADER HERE THAT STILL SWALLOWS ITS ERROR, and the contract it is
 * waiting for. It sits on a resident's SUBMISSION path, so a failed read must
 * NOT refuse the submission — a duplicate-detection outage is not a reason to
 * turn a member of the public away. But an empty array currently makes the
 * route record `auto_flag_reason: null`, which is the positive claim that this
 * response was checked against the campaign's history and is not a repeat.
 * The decided shape is: rows + error; the submission proceeds, the route logs
 * the failure, and the response's metadata records the duplicate check as
 * UNVERIFIED rather than as passed. Landing it means changing
 * `api/engage/[shareToken]/survey/submit/route.ts` in the same commit as this
 * signature. */
export async function loadRecentFingerprintSessions(
  supabase: QueryClient,
  campaignId: string,
  fingerprint: string
): Promise<{ id: string; created_at: string }[]> {
  const result = await supabase
    .from("engagement_survey_response_sessions")
    .select("id, created_at")
    .eq("campaign_id", campaignId)
    .eq("respondent_fingerprint", fingerprint)
    .order("created_at", { ascending: false })
    .limit(25);
  return (result.data ?? []) as { id: string; created_at: string }[];
}

// ── Part-finished responses (SENSITIVE; see 20260730000003) ──────────────────
//
// A DRAFT IS NOT A RESPONSE. It lives in its own table so that nothing counting
// responses can count it: `aggregateCampaignSurvey`, `loadSurveyResponseSessions`
// and the representativeness reading all read sessions/answers, and none of them
// can reach these rows even by mistake. The one function below that touches a
// session is `deleteSurveyDraftByTokenHash`, called AFTER a real submission has
// been written — which is the moment a draft stops being a draft.

export type SurveyDraftRow = {
  id: string;
  answers_json: unknown;
  answered_count: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

/**
 * A read that FAILED and a draft that is NOT THERE are different facts.
 *
 * They must not collapse into one, because the sentence a participant is shown
 * differs completely: "your saved answers are gone" is a claim about their work,
 * and saying it because a query errored would be a lie told to somebody who
 * still has answers saved. Routes answer 500 on `ok: false` and only ever say
 * "no saved answers" on `ok: true, draft: null`.
 */
export type SurveyDraftReadResult =
  | { ok: true; draft: SurveyDraftRow | null }
  | { ok: false; error: string };

const SURVEY_DRAFT_SELECT = "id, answers_json, answered_count, expires_at, created_at, updated_at";

/**
 * Reopen a draft by the digest of the token its browser holds.
 *
 * Scoped by campaign AND by expiry. The expiry filter is the enforcement of the
 * retention promise: an expired draft is unreadable at the instant it expires,
 * whether or not the sweep below has removed the row yet.
 */
export async function loadSurveyDraftByTokenHash(
  supabase: QueryClient,
  campaignId: string,
  resumeTokenHash: string
): Promise<SurveyDraftReadResult> {
  const result = await supabase
    .from("engagement_survey_response_drafts")
    .select(SURVEY_DRAFT_SELECT)
    .eq("campaign_id", campaignId)
    .eq("resume_token_hash", resumeTokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (result.error) return { ok: false, error: result.error.message };
  return { ok: true, draft: (result.data ?? null) as SurveyDraftRow | null };
}

/** How many live drafts one connection holds on this campaign (the creation cap). */
export async function countLiveSurveyDrafts(
  supabase: QueryClient,
  campaignId: string,
  fingerprint: string
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const result = await supabase
    .from("engagement_survey_response_drafts")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("respondent_fingerprint", fingerprint)
    .gt("expires_at", new Date().toISOString())
    .limit(50);
  if (result.error) return { ok: false, error: result.error.message };
  return { ok: true, count: (result.data ?? []).length };
}

/**
 * Delete this campaign's expired drafts.
 *
 * Best-effort and opportunistic — every draft route sweeps the campaign it is
 * already touching, so retention is enforced by ordinary use rather than by a
 * scheduler this product does not require an operator to run. The read filter
 * above is what makes the PROMISE true regardless; this is what makes the data
 * actually go away.
 */
export async function purgeExpiredSurveyDrafts(
  supabase: QueryClient,
  campaignId: string
): Promise<{ swept: number }> {
  // `.select("id")` so the sweep can say how much it removed. A delete that
  // cannot observe its own row count reports success over zero rows, and a
  // retention promise nobody can see being kept is one nobody would notice
  // breaking.
  const result = await supabase
    .from("engagement_survey_response_drafts")
    .delete()
    .eq("campaign_id", campaignId)
    .lt("expires_at", new Date().toISOString())
    .select("id");
  return { swept: ((result.data ?? []) as { id: string }[]).length };
}

/** Create a draft against a freshly minted token digest. */
export async function insertSurveyDraft(
  supabase: QueryClient,
  input: {
    campaignId: string;
    resumeTokenHash: string;
    respondentFingerprint: string | null;
    answersJson: unknown;
    answeredCount: number;
    expiresAt: string;
  }
): Promise<{ ok: true; draft: SurveyDraftRow } | { ok: false; error: string }> {
  const result = await supabase
    .from("engagement_survey_response_drafts")
    .insert({
      campaign_id: input.campaignId,
      resume_token_hash: input.resumeTokenHash,
      respondent_fingerprint: input.respondentFingerprint,
      answers_json: input.answersJson,
      answered_count: input.answeredCount,
      expires_at: input.expiresAt,
    })
    .select(SURVEY_DRAFT_SELECT)
    .single();
  if (result.error || !result.data) {
    return { ok: false, error: result.error?.message ?? "Failed to save your answers" };
  }
  return { ok: true, draft: result.data as SurveyDraftRow };
}

/**
 * Replace a draft's answers, and push its expiry out from NOW.
 *
 * The expiry moves with the last save rather than the first, because the promise
 * made to the participant is about the answers in front of them — a resident who
 * came back on day 29 and added three answers has a draft saved today.
 */
export async function updateSurveyDraft(
  supabase: QueryClient,
  input: {
    campaignId: string;
    resumeTokenHash: string;
    answersJson: unknown;
    answeredCount: number;
    expiresAt: string;
  }
): Promise<{ ok: true; draft: SurveyDraftRow | null } | { ok: false; error: string }> {
  const result = await supabase
    .from("engagement_survey_response_drafts")
    .update({
      answers_json: input.answersJson,
      answered_count: input.answeredCount,
      expires_at: input.expiresAt,
    })
    .eq("campaign_id", input.campaignId)
    .eq("resume_token_hash", input.resumeTokenHash)
    .select(SURVEY_DRAFT_SELECT)
    .maybeSingle();
  // ZERO ROWS IS ITS OWN OUTCOME, not a failure. The draft expired, or was
  // discarded from another tab — a fact about the participant's own answers
  // that the route turns into a 404 they are told about, while a genuine
  // database error stays a 500. Folding the two together would report a
  // transient outage as "your saved answers are gone".
  if (isWriteFailure(result.error)) {
    return { ok: false, error: result.error?.message ?? "Failed to save your answers" };
  }
  if (writeMatchedNoRows(result)) return { ok: true, draft: null };
  return { ok: true, draft: result.data as SurveyDraftRow };
}

/** Discard a draft — on explicit request, and after a real submission. */
export async function deleteSurveyDraftByTokenHash(
  supabase: QueryClient,
  campaignId: string,
  resumeTokenHash: string
): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }> {
  const result = await supabase
    .from("engagement_survey_response_drafts")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("resume_token_hash", resumeTokenHash)
    .select("id");
  if (result.error) return { ok: false, error: result.error.message };
  // REMOVING NOTHING IS NOT AN ERROR — the draft may have expired, or been
  // discarded from another tab, or (after a submission) never have existed. It
  // is reported rather than swallowed so the audit trail can tell the two
  // apart, but no caller turns it into a failure the participant has to read.
  return { ok: true, removed: ((result.data ?? []) as { id: string }[]).length > 0 };
}

export type SurveyAnswerInsert = {
  questionId: string;
  questionType: SurveyQuestionType;
  questionPromptSnapshot: string;
  answerJson: unknown;
  answerText: string | null;
};

/** Insert one response session + its N answers (SENSITIVE, campaign-scoped write).
 * All sensitive-table writes go through here so the reader-inventory guard's
 * confinement rule holds. A failed answer insert removes the session (its answers
 * CASCADE) so no half-validated response persists. */
export async function insertSurveyResponse(
  supabase: QueryClient,
  input: {
    campaignId: string;
    submittedBy: string | null;
    sourceType: "public" | "internal" | "meeting" | "email";
    status: "pending" | "approved" | "rejected" | "flagged";
    respondentFingerprint: string | null;
    metadata: Record<string, unknown>;
    answers: SurveyAnswerInsert[];
  }
): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
  const sessionResult = await supabase
    .from("engagement_survey_response_sessions")
    .insert({
      campaign_id: input.campaignId,
      respondent_fingerprint: input.respondentFingerprint,
      source_type: input.sourceType,
      status: input.status,
      submitted_by: input.submittedBy,
      metadata_json: input.metadata,
      created_by: null,
    })
    .select("id")
    .single();
  const session = sessionResult.data as { id: string } | null;
  if (sessionResult.error || !session) {
    return { ok: false, error: sessionResult.error?.message ?? "Failed to record survey response" };
  }

  if (input.answers.length > 0) {
    const rows = input.answers.map((answer) => ({
      session_id: session.id,
      question_id: answer.questionId,
      campaign_id: input.campaignId,
      question_type: answer.questionType,
      question_prompt_snapshot: answer.questionPromptSnapshot,
      answer_json: answer.answerJson,
      answer_text: answer.answerText,
    }));
    const answersResult = await supabase.from("engagement_survey_answers").insert(rows);
    if (answersResult.error) {
      await supabase
        .from("engagement_survey_response_sessions")
        .delete()
        .eq("id", session.id)
        .eq("campaign_id", input.campaignId);
      return { ok: false, error: answersResult.error.message };
    }
  }
  return { ok: true, sessionId: session.id };
}

/** Full campaign survey aggregation: approved answers dispatched per question.
 *
 * `error` is the first of the three reads that failed, and it is what makes
 * `approvedResponseCount` readable: a zero with an error is not a count, it is
 * the absence of one. A caller that renders the count without checking it is
 * telling a planner their campaign has no approved responses on the strength of
 * a query that never answered. */
export async function aggregateCampaignSurvey(
  supabase: QueryClient,
  campaignId: string
): Promise<{
  approvedResponseCount: number;
  questions: SurveyQuestionAggregation[];
  error: { message: string } | null;
}> {
  const definition = await loadSurveyDefinition(supabase, campaignId);
  const { questions, optionsByQuestion } = definition;
  const answers = await loadApprovedSurveyAnswers(supabase, campaignId);
  const approvedSessions = await loadSurveyResponseSessions(supabase, campaignId, { status: "approved" });

  const answersByQuestion = new Map<string, SurveyAnswerRow[]>();
  for (const answer of answers.rows) {
    if (!answer.question_id) continue;
    const arr = answersByQuestion.get(answer.question_id) ?? [];
    arr.push(answer);
    answersByQuestion.set(answer.question_id, arr);
  }

  const aggregated = questions.map((question) => {
    const options = (optionsByQuestion.get(question.id) ?? []).map((o) => ({ id: o.id, label: o.label }));
    return aggregateSurveyQuestion(question, options, answersByQuestion.get(question.id) ?? []);
  });
  return {
    approvedResponseCount: approvedSessions.rows.length,
    questions: aggregated,
    error: definition.error ?? answers.error ?? approvedSessions.error ?? null,
  };
}
