import type { SupabaseClient } from "@supabase/supabase-js";
import { isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import {
  parseEngagementGeometry,
  computeEngagementGeometryRepresentativePoint,
} from "./geometry";
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

/** The projection the live survey is built from. Asserted by its own test. */
export const LIVE_SURVEY_QUESTION_SELECT =
  "id, question_type, prompt, help_text, required, sort_order, config_json, category_id";

/**
 * THE ONE READ THAT DECIDES WHAT THE PUBLIC IS ASKED.
 *
 * Three predicates, and each answers a different question: the campaign it
 * belongs to, whether it has been archived after being asked (`is_active`), and
 * whether it has ever been released to the public at all (`status`). A draft is
 * not an archived question and must not be confused with one.
 *
 * THE FALLBACK IS NOT A DEGRADATION, which is why it is safe here and was not in
 * the Title VI lane. On a database that predates 20260805000011 the `status`
 * column does not exist — and neither does any draft, because there is nowhere
 * to record one. Serving every active question is therefore the CORRECT answer
 * for that database, not an approximation of it. Refusing instead would empty a
 * live public survey for the length of a deploy window, which is a
 * public-facing outage caused by a migration that had not run yet.
 *
 * The retry is anchored on the column name, so a permission failure, an RLS
 * refusal or any other fault still surfaces as itself.
 */
async function readPublishedQuestions(
  supabase: QueryClient,
  campaignId: string
): Promise<{ data: unknown; error: { message: string } | null }> {
  const filtered = await supabase
    .from("engagement_survey_questions")
    .select(LIVE_SURVEY_QUESTION_SELECT)
    .eq("campaign_id", campaignId)
    .eq("is_active", true)
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!filtered.error || !looksLikePendingSurveyStatusColumn(filtered.error.message)) return filtered;

  return supabase
    .from("engagement_survey_questions")
    .select(LIVE_SURVEY_QUESTION_SELECT)
    .eq("campaign_id", campaignId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
}

/**
 * Does this error mean the deployment predates the draft/published column?
 *
 * ANCHORED ON THE COLUMN AND ITS TABLE, and the pattern is MEASURED rather than
 * reasoned about. Asked for a column it does not have, the local PostgREST
 * answers, for both a projection and a filter:
 *
 *   {"code":"42703","message":"column engagement_survey_questions.nosuchcol does not exist"}
 *
 * so the table name is always present and the match can be this tight. Nothing
 * else in this repository produces that string, which is what makes the fallback
 * below safe: a permission failure, an RLS refusal or a genuine outage cannot
 * reach it and will surface as itself.
 *
 * Exported because `campaign-translations.ts` asks the same question about the
 * same column. A second copy would be a second answer, and the two reads it
 * guards are the ones a test already pins together on purpose.
 */
export function looksLikePendingSurveyStatusColumn(message: string | null | undefined): boolean {
  return /engagement_survey_questions\.status does not exist|'status' column of 'engagement_survey_questions'/i.test(
    message ?? ""
  );
}

/** Active, PUBLISHED question definitions + options for a campaign (definition
 * tables). `error` is the first read that failed: a survey with no questions and
 * a survey nobody could read look identical in the two collections. */
export async function loadSurveyDefinition(
  supabase: QueryClient,
  campaignId: string
): Promise<{
  questions: SurveyQuestionRow[];
  optionsByQuestion: Map<string, SurveyOptionRow[]>;
  error: { message: string } | null;
}> {
  const questionsResult = await readPublishedQuestions(supabase, campaignId);
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
 *
 * `error` TRAVELS BACK BECAUSE THE CALLER IS ABOUT TO WRITE. An empty `refs` is
 * the same value for "this survey has no active questions" and for "the
 * definition read failed", and the difference decides whether an archive or a
 * delete is safe: no dependents found is a permission to proceed, and a caller
 * that cannot tell the two apart hands that permission out over an outage. Every
 * caller must fail CLOSED on a non-null error — refuse the edit — rather than
 * treat an unreadable survey as one with nothing in it.
 */
export async function readSurveyConditionRefs(
  supabase: QueryClient,
  campaignId: string
): Promise<{ refs: (SurveyConditionQuestionRef & { sortOrder: number })[]; error: { message: string } | null }> {
  const { questions, optionsByQuestion, error } = await loadSurveyDefinition(supabase, campaignId);
  return {
    refs: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      question_type: question.question_type,
      config: question.config_json,
      optionIds: (optionsByQuestion.get(question.id) ?? []).map((option) => option.id),
      sortOrder: question.sort_order,
    })),
    error,
  };
}

/**
 * THE OLD ARRAY SHAPE, KEPT ONLY FOR THE ONE CALLER NOT YET MIGRATED, and it is
 * unsafe in a way the shape itself cannot express.
 *
 * Discarding the error here does not produce a display lie, it produces a
 * PERMISSIVE WRITE. Every caller feeds these refs to
 * `findSurveyQuestionsDependingOn` to decide whether other questions are gated
 * on the one being archived, deleted, or reordered — so a read that FAILED
 * arrives as an empty survey, reads as "nothing depends on this", and the
 * destructive edit proceeds. The dependent questions then start appearing to
 * every respondent unconditionally and nobody is told why.
 *
 * The remaining caller is `POST /api/engagement/campaigns/[campaignId]/survey/
 * questions` (`survey/questions/route.ts`), where the same failure validates a
 * NEW question's condition against a survey that appears to be empty. Migrate it
 * to `readSurveyConditionRefs` and delete this adapter; there is nothing else to
 * preserve here.
 */
export async function loadSurveyConditionRefs(
  supabase: QueryClient,
  campaignId: string
): Promise<(SurveyConditionQuestionRef & { sortOrder: number })[]> {
  return (await readSurveyConditionRefs(supabase, campaignId)).refs;
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
  /**
   * 'draft' or 'published'. Absent on a database that predates 20260805000011,
   * where no draft can exist — the builder reads that absence as published,
   * which is what such a database actually serves.
   */
  status: SurveyQuestionStatus | null;
  sort_order: number;
  config_json: Record<string, unknown>;
  options: SurveyBuilderOption[];
};

export type SurveyQuestionStatus = "draft" | "published";

/** A question the public is being asked, as opposed to one merely written. */
export function isPublishedSurveyQuestion(question: { status: string | null }): boolean {
  // Null is the pre-migration shape, where every stored question is live.
  return question.status === null || question.status === "published";
}

/** Full survey definition for the operator builder: every question (active and
 * archived) with all builder columns + all options. Definition tables only.
 *
 * STILL SWALLOWS BOTH ITS READS, and this comment is the only record of it.
 * `loadSurveyDefinition` above was given a `{ questions, optionsByQuestion,
 * error }` seam; this one was not, so a permission failure or an unapplied
 * migration hands the operator AN EMPTY SURVEY BUILDER for a survey that exists
 * — the same screen as a campaign nobody has written a question for, which is
 * the screen an operator fixes by starting over.
 *
 * IT IS NOT FIXED HERE ONLY BECAUSE THE FIX SPANS A FILE THIS LANE DOES NOT OWN.
 * The shape is settled and the change is two edits: return
 * `{ questions, error }` from here, and in the sole caller —
 * `src/app/(app)/engagement/[campaignId]/page.tsx` (~line 233) — destructure it
 * and hand `error` to the `ReadFailureLog` that page already builds (`reads`),
 * beside the checks it already makes for categories and comments. Doing so also
 * lowers `src/lib/engagement/survey-responses.ts` from 4 to 2 on the R2 ratchet
 * in `src/test/a-library-may-not-discard-a-read-error.test.ts`, which must be
 * edited in the same commit or its staleness assertion fails. */
/** The builder's projection, without `status`. Asserted by its own test. */
export const SURVEY_BUILDER_QUESTION_SELECT =
  "id, campaign_id, category_id, question_type, prompt, help_text, required, is_active, sort_order, config_json";

export async function loadSurveyBuilderDefinition(
  supabase: QueryClient,
  campaignId: string
): Promise<SurveyBuilderQuestion[]> {
  type RawQuestion = Omit<SurveyBuilderQuestion, "options" | "config_json"> & { config_json: unknown };

  // `status` LAST in the projection and retried without it, for the same reason
  // the live-survey read falls back: a builder that renders nothing during a
  // deploy window is the screen an operator fixes by starting over.
  const readBuilderQuestions = (projection: string) =>
    supabase
      .from("engagement_survey_questions")
      .select(projection)
      .eq("campaign_id", campaignId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }) as unknown as Promise<{
      data: unknown;
      error: { message: string } | null;
    }>;

  let questionsResult = await readBuilderQuestions(`${SURVEY_BUILDER_QUESTION_SELECT}, status`);

  if (questionsResult.error && looksLikePendingSurveyStatusColumn(questionsResult.error.message)) {
    questionsResult = await readBuilderQuestions(SURVEY_BUILDER_QUESTION_SELECT);
  }

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
    status: (question.status ?? null) as SurveyQuestionStatus | null,
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

// ── Full answer export (SENSITIVE; the door answer CONTENT leaves through) ──

/** One answer, ATTRIBUTED to its response session, as the export needs it.
 * `question_prompt_snapshot` is the prompt AS THE RESPONDENT READ IT — the
 * schema snapshots it at submit time precisely so history survives question
 * edits, and the export must render the snapshot, never the live prompt. */
export type SurveyAnswerExportRow = {
  session_id: string;
  question_id: string | null;
  question_type: SurveyQuestionType;
  question_prompt_snapshot: string | null;
  answer_json: unknown;
  answer_text: string | null;
  created_at: string;
};

/**
 * Every answer for a campaign, with its `session_id`, for the member-gated
 * answer export. This is deliberately the ONLY reader that hands answer content
 * out attributed to a response — `loadApprovedSurveyAnswers` above strips the
 * session on purpose because aggregation must not be able to follow one
 * respondent across questions. The export route may, because it sits behind the
 * same workspace-member gate as the moderation register and is audited.
 */
export async function loadSurveyAnswersForExport(
  supabase: QueryClient,
  campaignId: string
): Promise<SurveyRowsResult<SurveyAnswerExportRow>> {
  const result = await supabase
    .from("engagement_survey_answers")
    .select(
      "session_id, question_id, question_type, question_prompt_snapshot, answer_json, answer_text, created_at"
    )
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  return { rows: (result.data ?? []) as SurveyAnswerExportRow[], error: result.error ?? null };
}

export type SurveyOptionLabelRow = { id: string; label: string };

/**
 * ALL option labels for a campaign — archived options INCLUDED, unlike every
 * other definition read here. An answer outlives the option it named (options
 * are soft-archived once responses exist), and an export that resolved labels
 * only from the active set would render a resident's real choice as
 * "(removed option)" the day an operator retired it.
 */
export async function loadSurveyOptionLabels(
  supabase: QueryClient,
  campaignId: string
): Promise<SurveyRowsResult<SurveyOptionLabelRow>> {
  const result = await supabase
    .from("engagement_survey_question_options")
    .select("id, label")
    .eq("campaign_id", campaignId);
  return { rows: (result.data ?? []) as SurveyOptionLabelRow[], error: result.error ?? null };
}

/** A flattened answer: `text` for the CSV cell, `value` for the JSON export. */
export type FlattenedSurveyAnswer = { text: string; value: Record<string, unknown> };

const REMOVED_OPTION_LABEL = "(removed option)";

/**
 * Flatten one stored answer for export, per question type. Pure — no DB.
 *
 * TWO SNAPSHOTS ARE IN PLAY and each is preferred where it is the stronger
 * record. `answer_text` was written by `validateSurveyAnswer` at submit time, so
 * for option-bearing types it carries the labels the respondent actually saw —
 * it wins over labels re-resolved today. The structured `value` re-resolves ids
 * against `optionLabelById` (pass ALL options, archived included) so the JSON
 * side stays machine-readable. Two types override the submit-time text:
 * map_point always derives lon/lat from the stored geometry (its text snapshot
 * is the note OR the coords, never reliably both), and file_upload always emits
 * a count + file names, never bytes or storage internals.
 */
export function flattenSurveyAnswerForExport(
  answer: Pick<SurveyAnswerExportRow, "question_type" | "answer_json" | "answer_text">,
  optionLabelById: Map<string, string>
): FlattenedSurveyAnswer {
  const raw = (
    answer.answer_json && typeof answer.answer_json === "object" ? answer.answer_json : {}
  ) as Record<string, unknown>;
  const snapshotText = (answer.answer_text ?? "").trim();
  const label = (id: unknown) =>
    typeof id === "string" ? optionLabelById.get(id) ?? REMOVED_OPTION_LABEL : REMOVED_OPTION_LABEL;

  switch (answer.question_type) {
    case "single_choice": {
      const other = typeof raw.other_text === "string" ? raw.other_text.trim() : "";
      if (other) return { text: snapshotText || other, value: { other_text: other } };
      const optionLabel = label(raw.option_id);
      return { text: snapshotText || optionLabel, value: { option_label: optionLabel } };
    }
    case "multiple_choice": {
      const ids = Array.isArray(raw.option_ids) ? raw.option_ids : [];
      const labels = ids.map(label);
      const other = typeof raw.other_text === "string" && raw.other_text.trim() ? raw.other_text.trim() : null;
      const parts = other ? [...labels, other] : labels;
      return {
        text: snapshotText || parts.join("; "),
        value: other ? { option_labels: labels, other_text: other } : { option_labels: labels },
      };
    }
    case "likert":
    case "rating": {
      const value = typeof raw.value === "number" ? raw.value : null;
      return { text: snapshotText || (value === null ? "" : String(value)), value: { value } };
    }
    case "ranking": {
      const ids = Array.isArray(raw.ranking) ? raw.ranking : [];
      const labels = ids.map(label);
      return { text: snapshotText || labels.join(" > "), value: { ranked_option_labels: labels } };
    }
    case "budget_allocation": {
      const allocations = (Array.isArray(raw.allocations) ? raw.allocations : []).map((entry) => {
        const rec = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
        return {
          option_label: label(rec.option_id),
          amount: typeof rec.amount === "number" ? rec.amount : null,
        };
      });
      return {
        text:
          snapshotText ||
          allocations.map((a) => `${a.option_label}: ${a.amount ?? "?"}`).join("; "),
        value: { allocations },
      };
    }
    case "map_point": {
      const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : null;
      const parsed = parseEngagementGeometry(raw.geometry);
      if (!parsed.ok) {
        // No coordinates to state; the note (or the submit-time text) is all
        // that can honestly leave.
        return { text: snapshotText || note || "(unreadable geometry)", value: note ? { note } : {} };
      }
      const { longitude, latitude } = computeEngagementGeometryRepresentativePoint(parsed.geometry);
      const coords = `${longitude.toFixed(5)},${latitude.toFixed(5)}`;
      return {
        text: note ? `${coords} — ${note}` : coords,
        value: note ? { longitude, latitude, note } : { longitude, latitude },
      };
    }
    case "free_text": {
      const text = typeof raw.text === "string" ? raw.text : snapshotText;
      return { text, value: { text } };
    }
    case "file_upload": {
      const files = Array.isArray(raw.files) ? raw.files : [];
      const names = files.map((entry, index) => {
        const rec = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
        if (typeof rec.original_name === "string" && rec.original_name) return rec.original_name;
        if (typeof rec.path === "string" && rec.path) return rec.path.split("/").pop() || `file ${index + 1}`;
        return `file ${index + 1}`;
      });
      return {
        text: `${files.length} file${files.length === 1 ? "" : "s"}${names.length ? `: ${names.join("; ")}` : ""}`,
        value: { file_count: files.length, file_names: names },
      };
    }
  }
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
