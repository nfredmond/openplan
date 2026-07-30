import { z } from "zod";
import {
  parseEngagementGeometry,
  computeEngagementGeometryRepresentativePoint,
  type EngagementGeometry,
  type EngagementGeometryType,
} from "./geometry";

// Local copy of the whitespace normalizer (identical to public-submit's) so this
// pure lib stays CLIENT-SAFE — importing public-submit would pull node:crypto into
// the survey-builder client bundle.
function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

// ── Catalog vocabulary (single source of truth; DB CHECK mirrors this) ──────
export const SURVEY_QUESTION_TYPES_LIST = [
  "single_choice",
  "multiple_choice",
  "likert",
  "rating",
  "ranking",
  "map_point",
  "budget_allocation",
  "free_text",
  "file_upload",
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES_LIST)[number];

// Representativeness label threshold. DISTINCT from the demographics k=5
// re-identification suppression constant — different purpose (honest labelling,
// not privacy suppression), so it is its own constant.
export const SURVEY_SMALL_SAMPLE_N = 10;
export const SURVEY_FREE_TEXT_HARD_MAX = 5000;
export const SURVEY_BUDGET_TOLERANCE = 1e-6;
export const SURVEY_FILE_MAX_FILES_HARD_CAP = 5;

/**
 * HOW LONG A PART-FINISHED SURVEY IS KEPT, and why the number lives here.
 *
 * The participant is TOLD this number, and the server ENFORCES it — so there is
 * exactly one of it, in the one module both sides already import. A retention
 * promise made in a translated sentence while a different interval sat in a SQL
 * default would be a claim about a resident's own answers that the product does
 * not keep.
 *
 * The enforcement is a read filter first and a delete second: an expired draft
 * is unreadable the moment it expires, whether or not anything has swept the row
 * yet. That ordering is what makes "you can come back until {date}" true rather
 * than aspirational.
 */
export const SURVEY_DRAFT_RETENTION_DAYS = 30;
export const SURVEY_ALLOWED_FILE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

// ── Conditional visibility (see the block comment on `visibleWhenShape`) ─────

/**
 * How a question's condition compares an EARLIER question's answer.
 *
 * Deliberately small. Every operator here is one an operator can state in a
 * sentence and a participant would recognise as the reason a question appeared,
 * and each one is defined over the CANONICAL answer shapes in this file rather
 * than over widget state — the server is the authority on whether a question
 * applied, so the vocabulary has to be evaluable from stored answers alone.
 */
export const SURVEY_CONDITION_OPERATORS_LIST = [
  "answered",
  "not_answered",
  "equals",
  "not_equals",
  "includes",
  "gte",
  "lte",
] as const;
export type SurveyConditionOperator = (typeof SURVEY_CONDITION_OPERATORS_LIST)[number];

const CONDITION_OPERATORS_NEEDING_VALUE: readonly SurveyConditionOperator[] = [
  "equals",
  "not_equals",
  "includes",
  "gte",
  "lte",
];
const CONDITION_OPERATORS_NEEDING_NUMBER: readonly SurveyConditionOperator[] = ["gte", "lte"];

/**
 * Which operators mean anything against which controlling question type.
 *
 * `gte` on a free-text question is not a stricter rule that happens to fail — it
 * is a condition that can never be true, which means a question nobody will ever
 * be shown. Refusing it at authoring time (with a message naming the type) is
 * the only place that is cheap to fix.
 */
export const SURVEY_CONDITION_OPERATORS_BY_TYPE: Record<SurveyQuestionType, readonly SurveyConditionOperator[]> = {
  single_choice: ["answered", "not_answered", "equals", "not_equals"],
  multiple_choice: ["answered", "not_answered", "includes"],
  likert: ["answered", "not_answered", "equals", "not_equals", "gte", "lte"],
  rating: ["answered", "not_answered", "equals", "not_equals", "gte", "lte"],
  ranking: ["answered", "not_answered", "includes"],
  map_point: ["answered", "not_answered"],
  budget_allocation: ["answered", "not_answered"],
  free_text: ["answered", "not_answered"],
  file_upload: ["answered", "not_answered"],
};

/**
 * Operator + controller type combinations whose `value` names an ANSWER OPTION.
 *
 * EXPORTED because the builder has to ask the same question the evaluator does.
 * The answer depends on the CONTROLLING QUESTION'S TYPE and not on the operator
 * alone: `equals` against a single-choice question compares an option id, while
 * `equals` against a Likert or rating question compares a NUMBER on the scale.
 * A builder that decided from the operator alone would offer an option picker
 * for a question type that has no options — an empty dropdown, and a condition
 * the operator can see in the list but can never actually author.
 */
export function conditionValueIsOptionId(type: SurveyQuestionType, operator: SurveyConditionOperator): boolean {
  if (operator === "equals" || operator === "not_equals") return type === "single_choice";
  if (operator === "includes") return type === "multiple_choice" || type === "ranking";
  return false;
}

/** True when the condition's `value` is a number on the controlling question's scale. */
export function conditionValueIsNumber(type: SurveyQuestionType, operator: SurveyConditionOperator): boolean {
  if (operator === "answered" || operator === "not_answered") return false;
  return !conditionValueIsOptionId(type, operator);
}

export const surveyVisibilityConditionSchema = z
  .object({
    /** The EARLIER question whose answer decides this one. */
    question_id: z.string().uuid(),
    operator: z.enum(SURVEY_CONDITION_OPERATORS_LIST),
    /** An option id, or a scale value. Absent for `answered`/`not_answered`. */
    value: z.union([z.string().min(1).max(200), z.number()]).optional(),
  })
  .strict()
  .refine(
    (c) =>
      CONDITION_OPERATORS_NEEDING_VALUE.includes(c.operator) ? c.value !== undefined : c.value === undefined,
    { message: "This condition needs a value to compare against, and only comparison conditions may carry one." }
  )
  .refine((c) => !CONDITION_OPERATORS_NEEDING_NUMBER.includes(c.operator) || typeof c.value === "number", {
    message: "A greater-than / less-than condition compares numbers.",
  });
export type SurveyVisibilityCondition = z.infer<typeof surveyVisibilityConditionSchema>;

/**
 * WHY THE CONDITION LIVES IN `config_json` AND NOT IN A COLUMN OF ITS OWN.
 *
 * A question's authored shape is already one jsonb blob validated by these
 * schemas, and `loadSurveyDefinition` already projects it — so the condition
 * arrives everywhere a question does, with no `.select()` to forget. (This
 * repo's recurring defect is a column something renders that nobody added to
 * the projection; a second column here would be one more chance at it.) It is
 * folded into every per-type schema through this one shape rather than repeated
 * nine times, so a tenth question type cannot ship without it.
 *
 * `.nullish()` because clearing a condition writes `null` from the builder and
 * an absent key is the same fact.
 */
const visibleWhenShape = { visible_when: surveyVisibilityConditionSchema.nullish() } as const;

/** A per-type config object: the type's own keys, plus the shared condition. */
function questionConfig<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...shape, ...visibleWhenShape }).strict();
}

// ── Per-type config zod (all .strict()) ─────────────────────────────────────
export const singleChoiceConfigSchema = questionConfig({
  allow_other: z.boolean().optional(),
  randomize: z.boolean().optional(),
});
export const multipleChoiceConfigSchema = questionConfig({
  min_select: z.number().int().nonnegative().optional(),
  max_select: z.number().int().positive().optional(),
  allow_other: z.boolean().optional(),
  randomize: z.boolean().optional(),
}).refine((c) => c.min_select === undefined || c.max_select === undefined || c.min_select <= c.max_select, {
  message: "min_select must be <= max_select",
});
export const likertConfigSchema = questionConfig({
  scale: z.union([z.literal(5), z.literal(7)]).default(5),
  labels: z.array(z.string()).optional(),
  reverse: z.boolean().optional(),
}).refine((c) => !c.labels || c.labels.length === c.scale, {
  message: "labels length must equal scale",
});
export const ratingConfigSchema = questionConfig({
  max: z.number().int().min(2).max(10).default(5),
  allow_half: z.boolean().optional(),
  icon: z.enum(["star", "number"]).optional(),
});
export const rankingConfigSchema = questionConfig({
  max_ranked: z.number().int().positive().optional(),
  require_full: z.boolean().default(false),
});
export const mapPointConfigSchema = questionConfig({
    geometry_types: z.array(z.enum(["Point", "LineString", "Polygon"])).min(1).default(["Point"]),
    guidance: z.string().max(1000).optional(),
    require_within_corridor: z.boolean().optional(),
    // Where THIS question's map opens. Optional, and meant to stay that way: a
    // question can legitimately ask about one intersection inside a
    // campaign-wide area, but most do not need their own camera. An unset pair
    // is filled in from the campaign's framing by
    // `resolveMapPointQuestionView` below, which also returns the sentence
    // telling the participant which of the two they are looking at — before
    // that existed, an unset pair meant the whole country, silently.
  center: z.tuple([z.number(), z.number()]).optional(),
  zoom: z.number().optional(),
});

/**
 * Where a `map_point` question's map opens, AND the sentence that says so.
 *
 * `framingNote` is null only when the question carries a camera an operator
 * chose for it: the frame is then nothing inherited and nothing assumed, so
 * there is no assumption to disclose. Every other case gets a sentence,
 * including — especially — the one where the map ends up on the whole country.
 */
export type MapPointQuestionView = { config: unknown; framingNote: string | null };

/**
 * What the map opens on when the question states a zoom level but no centre.
 * Kept as its own sentence rather than borrowing the campaign's, because the
 * reason is the question's, not the campaign's.
 *
 * IT DOES NOT SAY "the whole country", and that is the point: a half-stated
 * camera keeps the question's zoom and falls back to `CONTINENTAL_US_CENTER`
 * for the centre, so at zoom 14 the map opens tightly on the geographic middle
 * of the United States — a farm field in Kansas — which is not the country and
 * not the campaign's area. Naming the zoom level would be guessing at the
 * widget's default; naming what it is NOT is the part that is knowable here.
 */
const MAP_POINT_UNFRAMED_NOTE =
  "This question sets a zoom level but no location, so this map does not open on the campaign's area.";
const MAP_POINT_UNREADABLE_CONFIG_NOTE =
  "This question's map settings could not be read, so this map opens on the whole country.";

/**
 * Resolve a `map_point` question's camera from the campaign's map framing, and
 * say which one the participant is looking at.
 *
 * WHY THIS EXISTS. `center`/`zoom` were reachable only by writing raw config
 * JSON, so in practice every `map_point` question opened on the continental
 * default and a resident had to find their own neighbourhood before they could
 * answer. The campaign now resolves a framing (its own area, the linked
 * project's, the workspace's, or where people have already pinned), and this is
 * how that answer reaches a question that never asked for one.
 *
 * The question always WINS. An operator who set a camera for one question meant
 * it, and a campaign-wide area must not overwrite a deliberately tighter frame.
 * Only a genuinely absent value is filled, and `center` and `zoom` are treated
 * as one decision — a centre from the campaign paired with a zoom from the
 * question would be a camera nobody chose.
 *
 * THE NOTE IS RETURNED WITH THE CONFIG, not computed separately, because the
 * two answers have to agree. The defect this replaces was a survey tab that
 * silently opened on the continental United States while the portal's own map,
 * one tab away, had just been taught to say when it did that. A second function
 * deciding the same thing is how those two drift apart again; here the camera
 * and the sentence about it are one decision with one exit.
 */
export function resolveMapPointQuestionView(
  config: unknown,
  framing: { view: { center: [number, number]; zoom: number } | null; summary: string }
): MapPointQuestionView {
  // `config_json` is nullable jsonb, and null is an ordinary question that
  // simply configured nothing — mergeable. A non-object that is not null is
  // corrupt: the widget will fall back to schema defaults and open on the whole
  // country, so that, and not the campaign's area, is what gets said.
  const current =
    config === null || config === undefined
      ? {}
      : typeof config === "object" && !Array.isArray(config)
        ? (config as Record<string, unknown>)
        : null;
  if (current === null) return { config, framingNote: MAP_POINT_UNREADABLE_CONFIG_NOTE };

  if (current.center !== undefined || current.zoom !== undefined) {
    // The question states a camera of its own and keeps it. A HALF-stated one is
    // kept too, and it still leaves the map centred on the continental default —
    // at the question's own zoom, which is why the sentence for that half names
    // what the map is NOT on rather than claiming a scale it cannot know.
    return { config, framingNote: current.center !== undefined ? null : MAP_POINT_UNFRAMED_NOTE };
  }

  // Nothing to inherit: the config is returned untouched rather than given a
  // plausible-looking place, and the campaign's own summary — which in this
  // branch already says the map opens on the whole country and why — is what
  // the participant is told.
  if (!framing.view) return { config, framingNote: framing.summary };

  return {
    config: { ...current, center: framing.view.center, zoom: framing.view.zoom },
    framingNote: framing.summary,
  };
}
export const budgetConfigSchema = questionConfig({
  total: z.number().positive(),
  unit: z.enum(["usd", "points", "percent"]).default("usd"),
  must_allocate_all: z.boolean().default(false),
  per_option_min: z.number().nonnegative().optional(),
  per_option_max: z.number().positive().optional(),
});
export const freeTextConfigSchema = questionConfig({
  max_length: z.number().int().positive().max(SURVEY_FREE_TEXT_HARD_MAX).default(2000),
  min_length: z.number().int().nonnegative().optional(),
  multiline: z.boolean().default(true),
});
export const fileUploadConfigSchema = questionConfig({
  max_files: z.number().int().positive().max(SURVEY_FILE_MAX_FILES_HARD_CAP).default(1),
  max_size_bytes: z.number().int().positive().default(5_242_880),
  accept: z.array(z.enum(SURVEY_ALLOWED_FILE_MIME)).min(1).default([...SURVEY_ALLOWED_FILE_MIME]),
});

// ── Per-type answer zod (structural only; semantics in validateSurveyAnswer) ──
const uuidish = z.string().min(1);
const singleChoiceAnswerSchema = z.object({ option_id: uuidish, other_text: z.string().optional() }).strict();
const multipleChoiceAnswerSchema = z
  .object({ option_ids: z.array(uuidish), other_text: z.string().optional() })
  .strict();
const likertAnswerSchema = z.object({ value: z.number() }).strict();
const ratingAnswerSchema = z.object({ value: z.number() }).strict();
const rankingAnswerSchema = z.object({ ranking: z.array(uuidish) }).strict();
const mapPointAnswerSchema = z.object({ geometry: z.unknown(), note: z.string().optional() }).strict();
const budgetAnswerSchema = z
  .object({ allocations: z.array(z.object({ option_id: uuidish, amount: z.number() }).strict()) })
  .strict();
const freeTextAnswerSchema = z.object({ text: z.string() }).strict();
const fileUploadAnswerSchema = z
  .object({
    files: z.array(
      z
        .object({
          path: z.string().min(1),
          mime: z.string().min(1),
          size: z.number().int().nonnegative(),
          original_name: z.string().optional(),
        })
        .strict()
    ),
  })
  .strict();

export type SurveyQuestionFamily = "choice" | "scale" | "geo" | "budget" | "text" | "file";

export type SurveyQuestionTypeDef = {
  type: SurveyQuestionType;
  label: string;
  family: SurveyQuestionFamily;
  usesOptions: boolean;
  configSchema: z.ZodTypeAny;
  answerSchema: z.ZodTypeAny;
};

export const SURVEY_QUESTION_TYPES: Record<SurveyQuestionType, SurveyQuestionTypeDef> = {
  single_choice: { type: "single_choice", label: "Single choice", family: "choice", usesOptions: true, configSchema: singleChoiceConfigSchema, answerSchema: singleChoiceAnswerSchema },
  multiple_choice: { type: "multiple_choice", label: "Multiple choice", family: "choice", usesOptions: true, configSchema: multipleChoiceConfigSchema, answerSchema: multipleChoiceAnswerSchema },
  likert: { type: "likert", label: "Likert scale", family: "scale", usesOptions: false, configSchema: likertConfigSchema, answerSchema: likertAnswerSchema },
  rating: { type: "rating", label: "Rating", family: "scale", usesOptions: false, configSchema: ratingConfigSchema, answerSchema: ratingAnswerSchema },
  ranking: { type: "ranking", label: "Ranking", family: "choice", usesOptions: true, configSchema: rankingConfigSchema, answerSchema: rankingAnswerSchema },
  map_point: { type: "map_point", label: "Map point", family: "geo", usesOptions: false, configSchema: mapPointConfigSchema, answerSchema: mapPointAnswerSchema },
  budget_allocation: { type: "budget_allocation", label: "Budget allocation", family: "budget", usesOptions: true, configSchema: budgetConfigSchema, answerSchema: budgetAnswerSchema },
  free_text: { type: "free_text", label: "Free text", family: "text", usesOptions: false, configSchema: freeTextConfigSchema, answerSchema: freeTextAnswerSchema },
  file_upload: { type: "file_upload", label: "File upload", family: "file", usesOptions: false, configSchema: fileUploadConfigSchema, answerSchema: fileUploadAnswerSchema },
};

export function isSurveyQuestionType(value: unknown): value is SurveyQuestionType {
  return typeof value === "string" && (SURVEY_QUESTION_TYPES_LIST as readonly string[]).includes(value);
}

// ── Validation contract ─────────────────────────────────────────────────────
export type SurveyAnswerErrorCode =
  | "REQUIRED_EMPTY"
  | "MALFORMED"
  | "UNKNOWN_OPTION"
  | "DUPLICATE_OPTION"
  | "SELECT_COUNT_OUT_OF_RANGE"
  | "VALUE_OUT_OF_RANGE"
  | "BUDGET_OVER"
  | "BUDGET_UNDER"
  | "RANKING_INCOMPLETE"
  | "RANKING_TOO_MANY"
  | "GEOMETRY_INVALID"
  | "GEOMETRY_TYPE_NOT_ALLOWED"
  | "TOO_MANY_FILES"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_MIME"
  | "TEXT_TOO_LONG"
  | "TEXT_TOO_SHORT"
  | "OTHER_TEXT_MISSING"
  | "CONFIG_INVALID";

export type SurveyQuestionContext = {
  id: string;
  question_type: SurveyQuestionType;
  required: boolean;
  config: unknown; // raw config_json (re-parsed defensively)
  optionIds: string[]; // ACTIVE option UUIDs
  optionLabelById: Map<string, string>;
  optionMetaById?: Map<string, Record<string, unknown>>;
};

export type SurveyAnswerValidationResult =
  | { ok: true; isEmpty: boolean; answer: unknown; answerText: string | null }
  | { ok: false; code: SurveyAnswerErrorCode; message: string };

function fail(code: SurveyAnswerErrorCode, message: string): SurveyAnswerValidationResult {
  return { ok: false, code, message };
}
function empty(): SurveyAnswerValidationResult {
  return { ok: true, isEmpty: true, answer: null, answerText: null };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Type-specific emptiness. An empty optional answer must write NO row. */
function isAnswerEmpty(type: SurveyQuestionType, raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  const rec = asRecord(raw);
  if (!rec) return true;
  switch (type) {
    case "single_choice":
      return !rec.option_id && !(typeof rec.other_text === "string" && rec.other_text.trim());
    case "multiple_choice":
      return !(Array.isArray(rec.option_ids) && rec.option_ids.length > 0) &&
        !(typeof rec.other_text === "string" && rec.other_text.trim());
    case "ranking":
      return !(Array.isArray(rec.ranking) && rec.ranking.length > 0);
    case "likert":
    case "rating":
      return rec.value === null || rec.value === undefined;
    case "map_point":
      return rec.geometry === null || rec.geometry === undefined;
    case "budget_allocation": {
      const allocs = Array.isArray(rec.allocations) ? rec.allocations : [];
      const sum = allocs.reduce((s: number, a) => s + (asRecord(a)?.amount as number || 0), 0);
      return allocs.length === 0 || sum === 0;
    }
    case "free_text":
      return normalizeText(typeof rec.text === "string" ? rec.text : "").length === 0;
    case "file_upload":
      return !(Array.isArray(rec.files) && rec.files.length > 0);
  }
}

function parseConfig<T = Record<string, unknown>>(def: SurveyQuestionTypeDef, raw: unknown): T | null {
  const parsed = def.configSchema.safeParse(raw ?? {});
  return parsed.success ? (parsed.data as T) : null;
}

/**
 * Validate a single participant answer against its question definition. Runs
 * emptiness → structural → per-type semantic rules, and on success returns the
 * canonical answer plus a denormalized answer_text for durable export/search.
 * Never throws.
 */
export function validateSurveyAnswer(
  question: SurveyQuestionContext,
  rawAnswer: unknown
): SurveyAnswerValidationResult {
  const def = SURVEY_QUESTION_TYPES[question.question_type];
  if (!def) return fail("MALFORMED", "Unknown question type");

  // 1. Emptiness first.
  if (isAnswerEmpty(question.question_type, rawAnswer)) {
    return question.required ? fail("REQUIRED_EMPTY", "This question is required.") : empty();
  }

  // 2. Structural parse.
  const parsed = def.answerSchema.safeParse(rawAnswer);
  if (!parsed.success) return fail("MALFORMED", "Answer does not match the expected shape.");
  const a = parsed.data as Record<string, unknown>;

  const config = parseConfig(def, question.config);
  if (config === null) return fail("CONFIG_INVALID", "This question is misconfigured.");
  const label = (id: string) => question.optionLabelById.get(id) ?? "(removed option)";

  switch (question.question_type) {
    case "single_choice": {
      const cfg = config as z.infer<typeof singleChoiceConfigSchema>;
      const optionId = a.option_id as string;
      const other = typeof a.other_text === "string" ? a.other_text.trim() : "";
      if (other && !cfg.allow_other) return fail("OTHER_TEXT_MISSING", "This question does not allow an 'other' response.");
      if (!other && !question.optionIds.includes(optionId)) return fail("UNKNOWN_OPTION", "Selected option is not part of this question.");
      // When "other" is chosen, store ONLY the free text — never also carry the
      // selected option_id, or tallyChoice would double-count it as a real option.
      const answer = other && cfg.allow_other ? { other_text: other } : { option_id: optionId };
      return { ok: true, isEmpty: false, answer, answerText: other ? other : label(optionId) };
    }
    case "multiple_choice": {
      const cfg = config as z.infer<typeof multipleChoiceConfigSchema>;
      const ids = (a.option_ids as string[]) ?? [];
      if (new Set(ids).size !== ids.length) return fail("DUPLICATE_OPTION", "Duplicate options selected.");
      for (const id of ids) if (!question.optionIds.includes(id)) return fail("UNKNOWN_OPTION", "A selected option is not part of this question.");
      const other = typeof a.other_text === "string" ? a.other_text.trim() : "";
      if (other && !cfg.allow_other) return fail("OTHER_TEXT_MISSING", "This question does not allow an 'other' response.");
      const selectedCount = ids.length + (other ? 1 : 0);
      if (cfg.min_select !== undefined && selectedCount < cfg.min_select) return fail("SELECT_COUNT_OUT_OF_RANGE", `Select at least ${cfg.min_select}.`);
      if (cfg.max_select !== undefined && selectedCount > cfg.max_select) return fail("SELECT_COUNT_OUT_OF_RANGE", `Select at most ${cfg.max_select}.`);
      const answer = other && cfg.allow_other ? { option_ids: ids, other_text: other } : { option_ids: ids };
      const parts = ids.map(label);
      if (other) parts.push(other);
      return { ok: true, isEmpty: false, answer, answerText: parts.join("; ") };
    }
    case "likert": {
      const cfg = config as z.infer<typeof likertConfigSchema>;
      const v = a.value as number;
      if (!Number.isInteger(v) || v < 1 || v > cfg.scale) return fail("VALUE_OUT_OF_RANGE", `Value must be an integer 1..${cfg.scale}.`);
      const text = cfg.labels?.[v - 1] ?? String(v);
      return { ok: true, isEmpty: false, answer: { value: v }, answerText: text };
    }
    case "rating": {
      const cfg = config as z.infer<typeof ratingConfigSchema>;
      const v = a.value as number;
      if (v < 1 || v > cfg.max) return fail("VALUE_OUT_OF_RANGE", `Rating must be 1..${cfg.max}.`);
      if (cfg.allow_half) {
        if (Math.round(v * 2) !== v * 2) return fail("VALUE_OUT_OF_RANGE", "Rating must be a whole or half step.");
      } else if (!Number.isInteger(v)) {
        return fail("VALUE_OUT_OF_RANGE", "Rating must be a whole number.");
      }
      return { ok: true, isEmpty: false, answer: { value: v }, answerText: String(v) };
    }
    case "ranking": {
      const cfg = config as z.infer<typeof rankingConfigSchema>;
      const ranking = (a.ranking as string[]) ?? [];
      if (new Set(ranking).size !== ranking.length) return fail("DUPLICATE_OPTION", "An option is ranked more than once.");
      for (const id of ranking) if (!question.optionIds.includes(id)) return fail("UNKNOWN_OPTION", "A ranked option is not part of this question.");
      if (cfg.require_full && ranking.length !== question.optionIds.length) return fail("RANKING_INCOMPLETE", "Rank every option.");
      if (cfg.max_ranked !== undefined && ranking.length > cfg.max_ranked) return fail("RANKING_TOO_MANY", `Rank at most ${cfg.max_ranked}.`);
      return { ok: true, isEmpty: false, answer: { ranking }, answerText: ranking.map(label).join(" > ") };
    }
    case "map_point": {
      const cfg = config as z.infer<typeof mapPointConfigSchema>;
      const geoResult = parseEngagementGeometry(a.geometry);
      if (!geoResult.ok) return fail("GEOMETRY_INVALID", geoResult.error);
      const geometry = geoResult.geometry;
      if (!cfg.geometry_types.includes(geometry.type as (typeof cfg.geometry_types)[number])) {
        return fail("GEOMETRY_TYPE_NOT_ALLOWED", `This question accepts: ${cfg.geometry_types.join(", ")}.`);
      }
      const note = typeof a.note === "string" ? a.note.trim() : "";
      const { longitude: lng, latitude: lat } = computeEngagementGeometryRepresentativePoint(geometry);
      const answer = note ? { geometry, note } : { geometry };
      return { ok: true, isEmpty: false, answer, answerText: note || `${lng.toFixed(5)},${lat.toFixed(5)}` };
    }
    case "budget_allocation": {
      const cfg = config as z.infer<typeof budgetConfigSchema>;
      const allocations = (a.allocations as { option_id: string; amount: number }[]) ?? [];
      if (new Set(allocations.map((x) => x.option_id)).size !== allocations.length) return fail("DUPLICATE_OPTION", "An option is allocated more than once.");
      for (const alloc of allocations) {
        if (!question.optionIds.includes(alloc.option_id)) return fail("UNKNOWN_OPTION", "An allocated option is not part of this question.");
        if (alloc.amount < 0) return fail("VALUE_OUT_OF_RANGE", "Allocations cannot be negative.");
        if (cfg.per_option_min !== undefined && alloc.amount > 0 && alloc.amount < cfg.per_option_min) return fail("VALUE_OUT_OF_RANGE", `Each allocation must be at least ${cfg.per_option_min}.`);
        if (cfg.per_option_max !== undefined && alloc.amount > cfg.per_option_max) return fail("VALUE_OUT_OF_RANGE", `Each allocation must be at most ${cfg.per_option_max}.`);
      }
      const sum = allocations.reduce((s, x) => s + x.amount, 0);
      if (sum > cfg.total + SURVEY_BUDGET_TOLERANCE) return fail("BUDGET_OVER", `Total allocated exceeds the ${cfg.total} budget.`);
      if (cfg.must_allocate_all && sum < cfg.total - SURVEY_BUDGET_TOLERANCE) return fail("BUDGET_UNDER", `Allocate the full ${cfg.total} budget.`);
      const nonZero = allocations.filter((x) => x.amount > 0);
      const answerText = nonZero.map((x) => `${label(x.option_id)}: ${x.amount}`).join("; ");
      return { ok: true, isEmpty: false, answer: { allocations: nonZero }, answerText };
    }
    case "free_text": {
      const cfg = config as z.infer<typeof freeTextConfigSchema>;
      const text = normalizeText(a.text as string);
      if (cfg.min_length !== undefined && text.length < cfg.min_length) return fail("TEXT_TOO_SHORT", `Please write at least ${cfg.min_length} characters.`);
      if (text.length > Math.min(cfg.max_length, SURVEY_FREE_TEXT_HARD_MAX)) return fail("TEXT_TOO_LONG", `Please keep it under ${cfg.max_length} characters.`);
      return { ok: true, isEmpty: false, answer: { text }, answerText: text };
    }
    case "file_upload": {
      const cfg = config as z.infer<typeof fileUploadConfigSchema>;
      const files = (a.files as { path: string; mime: string; size: number; original_name?: string }[]) ?? [];
      if (files.length > cfg.max_files) return fail("TOO_MANY_FILES", `Attach at most ${cfg.max_files} file(s).`);
      for (const f of files) {
        if (f.size > cfg.max_size_bytes) return fail("FILE_TOO_LARGE", "A file exceeds the size limit.");
        if (!cfg.accept.includes(f.mime as (typeof cfg.accept)[number])) return fail("UNSUPPORTED_MIME", "Unsupported file type.");
      }
      const answerText = files.map((f) => f.original_name ?? f.path.split("/").pop() ?? "file").join("; ");
      return { ok: true, isEmpty: false, answer: { files }, answerText };
    }
  }
}

/** Validate operator-supplied config_json on the builder write path. */
export function validateSurveyConfig(
  type: SurveyQuestionType,
  rawConfig: unknown
): { ok: true; config: unknown } | { ok: false; message: string } {
  const def = SURVEY_QUESTION_TYPES[type];
  if (!def) return { ok: false, message: "Unknown question type" };
  const parsed = def.configSchema.safeParse(rawConfig ?? {});
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid question configuration" };
  return { ok: true, config: parsed.data };
}

// ── Conditional visibility: evaluation ───────────────────────────────────────

/** The minimum a question has to carry for its applicability to be decided. */
export type SurveyVisibilityQuestion = {
  id: string;
  question_type: SurveyQuestionType;
  /** Raw `config_json` — the condition is read out of it defensively. */
  config: unknown;
};

/**
 * Read a question's condition out of its raw config, or null when it has none.
 *
 * A config that HAS a `visible_when` this schema cannot parse also returns null,
 * which means the question is shown. That direction is deliberate: a corrupt
 * condition should ask somebody a question that may not apply to them, never
 * silently withhold a question — and if the withheld one were required, the
 * participant would be unable to finish a form with no visible reason why.
 * Authoring-time validation is what stops a corrupt condition existing at all;
 * this is the behaviour when it does anyway.
 */
export function readSurveyVisibilityCondition(config: unknown): SurveyVisibilityCondition | null {
  const rec = asRecord(config);
  if (!rec || rec.visible_when === null || rec.visible_when === undefined) return null;
  const parsed = surveyVisibilityConditionSchema.safeParse(rec.visible_when);
  return parsed.success ? parsed.data : null;
}

/** True when a config states a condition that cannot be read — an authoring defect. */
export function hasUnreadableVisibilityCondition(config: unknown): boolean {
  const rec = asRecord(config);
  if (!rec || rec.visible_when === null || rec.visible_when === undefined) return false;
  return !surveyVisibilityConditionSchema.safeParse(rec.visible_when).success;
}

/**
 * Does a controlling question's stored answer satisfy this condition?
 *
 * `not_equals` requires a NON-EMPTY answer that differs, rather than being the
 * plain negation of `equals`. An untouched question does not "have an answer
 * other than X" — treating it that way would show every not-equals follow-up to
 * a participant the moment the form loaded, which is the opposite of what the
 * operator wrote.
 */
function surveyConditionMatches(
  condition: SurveyVisibilityCondition,
  controllerType: SurveyQuestionType,
  controllerAnswer: unknown
): boolean {
  const isEmpty = isAnswerEmpty(controllerType, controllerAnswer);
  if (condition.operator === "answered") return !isEmpty;
  if (condition.operator === "not_answered") return isEmpty;
  if (isEmpty) return false;

  const rec = asRecord(controllerAnswer);
  if (!rec) return false;
  const { value } = condition;

  switch (condition.operator) {
    case "equals":
    case "not_equals": {
      let equal = false;
      if (controllerType === "single_choice") equal = rec.option_id === value;
      else if (controllerType === "likert" || controllerType === "rating") equal = rec.value === value;
      return condition.operator === "equals" ? equal : !equal;
    }
    case "includes": {
      if (controllerType === "multiple_choice") {
        return Array.isArray(rec.option_ids) && (rec.option_ids as unknown[]).includes(value);
      }
      if (controllerType === "ranking") {
        return Array.isArray(rec.ranking) && (rec.ranking as unknown[]).includes(value);
      }
      return false;
    }
    case "gte":
    case "lte": {
      if (controllerType !== "likert" && controllerType !== "rating") return false;
      if (typeof rec.value !== "number" || typeof value !== "number") return false;
      return condition.operator === "gte" ? rec.value >= value : rec.value <= value;
    }
    default:
      return false;
  }
}

/** One pass: which questions apply, given exactly these answers. */
function computeSurveyVisibility(
  questions: SurveyVisibilityQuestion[],
  answers: Record<string, unknown>
): Map<string, boolean> {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const visible = new Map<string, boolean>();

  for (const question of questions) {
    const condition = readSurveyVisibilityCondition(question.config);
    if (!condition) {
      visible.set(question.id, true);
      continue;
    }
    const controller = byId.get(condition.question_id);
    // A dangling or self reference shows the question. The controller may have
    // been archived after the condition was written, and a question nobody can
    // ever see is a worse outcome than one asked when it might not apply.
    if (!controller || controller.id === question.id) {
      visible.set(question.id, true);
      continue;
    }
    // A CONTROLLER THAT IS ITSELF HIDDEN HIDES WHAT DEPENDS ON IT. Otherwise a
    // `not_answered` condition would fire on a question the participant was
    // never shown, and the chain would say "you skipped it" about something
    // never asked. Questions are walked in display order, so the controller's
    // own answer is already decided by the time this reads it; a forward
    // reference (refused at authoring time) falls back to treating the
    // controller as visible.
    const controllerVisible = visible.get(controller.id) ?? true;
    if (!controllerVisible) {
      visible.set(question.id, false);
      continue;
    }
    visible.set(question.id, surveyConditionMatches(condition, controller.question_type, answers[controller.id]));
  }
  return visible;
}

export type SurveyVisibilityResolution = {
  /** Question ids that apply to this respondent, given these answers. */
  visible: Set<string>;
  /** The answers with every inapplicable one removed. */
  answers: Record<string, unknown>;
  /** Question ids whose answers were dropped because the question did not apply. */
  discarded: string[];
};

/**
 * THE ONE PLACE CONDITIONAL LOGIC IS DECIDED — used by the browser to choose
 * what to render and by the submit route to choose what to store and what to
 * require.
 *
 * Shared rather than mirrored, because the two answers have to be identical: a
 * hidden question the server still requires is a form nobody can submit, and a
 * skipped question whose answer arrives anyway is an answer counted against a
 * question that did not apply to that person. Both are real, and both come from
 * two implementations of one rule.
 *
 * The loop exists because dropping an answer can change what applies: hiding Q3
 * removes its answer, which can hide Q5 that depended on Q3, and can equally
 * REVEAL a question conditioned on Q3 being unanswered. It runs to a fixed point,
 * bounded by the number of questions (each pass hides at least one more question
 * than the last, or stops).
 */
export function resolveSurveyVisibility(
  questions: SurveyVisibilityQuestion[],
  answers: Record<string, unknown>
): SurveyVisibilityResolution {
  const current: Record<string, unknown> = { ...answers };
  const discarded: string[] = [];

  for (let pass = 0; pass <= questions.length; pass += 1) {
    const visibility = computeSurveyVisibility(questions, current);
    const inapplicable = Object.keys(current).filter((questionId) => visibility.get(questionId) === false);
    if (inapplicable.length === 0) {
      const visible = new Set<string>();
      for (const [questionId, isVisible] of visibility) if (isVisible) visible.add(questionId);
      return { visible, answers: current, discarded };
    }
    for (const questionId of inapplicable) {
      delete current[questionId];
      discarded.push(questionId);
    }
  }

  // Unreachable while the loop bound holds; answering with the last computed
  // state rather than throwing keeps a public form up.
  const visibility = computeSurveyVisibility(questions, current);
  const visible = new Set<string>();
  for (const [questionId, isVisible] of visibility) if (isVisible) visible.add(questionId);
  return { visible, answers: current, discarded };
}

// ── Conditional visibility: authoring-time validation ────────────────────────

export type SurveyConditionProblemCode =
  | "MALFORMED"
  | "SELF_REFERENCE"
  | "UNKNOWN_QUESTION"
  | "CYCLE"
  | "FORWARD_REFERENCE"
  | "OPERATOR_NOT_SUPPORTED"
  | "UNKNOWN_OPTION";

export type SurveyConditionProblem = {
  questionId: string;
  code: SurveyConditionProblemCode;
  /** Operator-facing, and it NAMES the questions involved. */
  message: string;
};

/** One question as the condition validator needs to see it, in DISPLAY ORDER. */
export type SurveyConditionQuestionRef = {
  id: string;
  prompt: string;
  question_type: SurveyQuestionType;
  config: unknown;
  /** Active option ids, when the caller has them — enables the option check. */
  optionIds?: string[];
};

function quotePrompt(prompt: string): string {
  const trimmed = normalizeText(prompt);
  const shortened = trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
  return `“${shortened || "(untitled question)"}”`;
}

/**
 * Refuse a conditional survey that cannot be answered, and say why in words an
 * operator can act on.
 *
 * FOUR THINGS ARE REFUSED, and each is a form that would look fine in the
 * builder and fail a resident:
 *
 *  • a FORWARD REFERENCE — question 3 shown only when question 7 was answered.
 *    A participant reaches 3 before 7 exists to them, so 3 is hidden at exactly
 *    the moment it is asked; the operator sees a working survey and the public
 *    sees a question that never appears.
 *  • a CYCLE — 3 depends on 5 and 5 depends on 3. Neither can ever be shown.
 *    Unreachable once forward references are refused, and checked anyway,
 *    because this is the check that does not depend on the ordering being right.
 *  • an OPERATOR THAT CANNOT MATCH — "greater than 3" against a free-text
 *    question. A condition that is never true is a question nobody is asked.
 *  • an OPTION THAT IS NOT THERE — a condition naming an option that was
 *    deleted or belongs to another question.
 *
 * The list is passed in DISPLAY ORDER (what `loadSurveyDefinition` returns), and
 * every caller that changes order, conditions, or which questions are active has
 * to run this again — reordering a survey can turn a valid backward reference
 * into a forward one, which is why this takes the whole survey rather than one
 * question.
 */
export function validateSurveyConditionGraph(
  questions: SurveyConditionQuestionRef[]
): SurveyConditionProblem[] {
  const problems: SurveyConditionProblem[] = [];
  const indexById = new Map(questions.map((question, index) => [question.id, index]));
  const byId = new Map(questions.map((question) => [question.id, question]));

  // Edges for cycle detection, built only from resolvable references.
  const edges = new Map<string, string>();

  for (const [index, question] of questions.entries()) {
    if (hasUnreadableVisibilityCondition(question.config)) {
      problems.push({
        questionId: question.id,
        code: "MALFORMED",
        message: `${quotePrompt(question.prompt)} has a condition this survey cannot read. Set the condition again, or clear it.`,
      });
      continue;
    }
    const condition = readSurveyVisibilityCondition(question.config);
    if (!condition) continue;

    if (condition.question_id === question.id) {
      problems.push({
        questionId: question.id,
        code: "SELF_REFERENCE",
        message: `${quotePrompt(question.prompt)} is set to appear based on its own answer, which can never be decided.`,
      });
      continue;
    }

    const controller = byId.get(condition.question_id);
    if (!controller) {
      problems.push({
        questionId: question.id,
        code: "UNKNOWN_QUESTION",
        message: `${quotePrompt(question.prompt)} depends on a question that is not part of this survey any more. Archiving or deleting a question that others depend on breaks them, so choose a different question or clear the condition.`,
      });
      continue;
    }
    edges.set(question.id, controller.id);

    const controllerIndex = indexById.get(controller.id) ?? -1;
    if (controllerIndex >= index) {
      problems.push({
        questionId: question.id,
        code: "FORWARD_REFERENCE",
        message: `${quotePrompt(question.prompt)} is set to appear based on ${quotePrompt(controller.prompt)}, but that question comes later in the survey. A respondent would reach it before answering the one it depends on, so it would never appear. Move ${quotePrompt(controller.prompt)} earlier.`,
      });
      continue;
    }

    const allowed = SURVEY_CONDITION_OPERATORS_BY_TYPE[controller.question_type] ?? [];
    if (!allowed.includes(condition.operator)) {
      problems.push({
        questionId: question.id,
        code: "OPERATOR_NOT_SUPPORTED",
        message: `${quotePrompt(question.prompt)} compares ${quotePrompt(controller.prompt)} in a way a ${SURVEY_QUESTION_TYPES[controller.question_type].label.toLowerCase()} answer cannot be compared (${condition.operator}). That condition could never be true, so the question would never appear.`,
      });
      continue;
    }

    if (
      conditionValueIsOptionId(controller.question_type, condition.operator) &&
      controller.optionIds !== undefined &&
      !controller.optionIds.includes(String(condition.value))
    ) {
      problems.push({
        questionId: question.id,
        code: "UNKNOWN_OPTION",
        message: `${quotePrompt(question.prompt)} depends on an answer option that ${quotePrompt(controller.prompt)} no longer offers. Choose one of its current options.`,
      });
    }
  }

  // Cycle detection over the resolved edges (iterative walk per node, so a long
  // chain cannot blow the stack on a survey somebody generated).
  const reported = new Set<string>();
  for (const start of edges.keys()) {
    if (reported.has(start)) continue;
    const seen = new Set<string>([start]);
    const path = [start];
    let cursor = edges.get(start);
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        const loop = [...path.slice(path.indexOf(cursor)), cursor]
          .map((id) => quotePrompt(byId.get(id)?.prompt ?? id))
          .join(" → ");
        for (const id of path) {
          if (!reported.has(id)) reported.add(id);
        }
        problems.push({
          questionId: cursor,
          code: "CYCLE",
          message: `These questions depend on each other in a loop, so none of them could ever appear: ${loop}.`,
        });
        break;
      }
      seen.add(cursor);
      path.push(cursor);
      cursor = edges.get(cursor);
    }
  }

  return problems;
}

/**
 * Which questions would break if this one were archived or deleted.
 *
 * The builder calls this BEFORE the write, because the alternative is a survey
 * whose remaining conditions point at nothing — every dependent question then
 * shows unconditionally (see `computeSurveyVisibility`), which is safe for the
 * respondent and silently wrong for the operator, who believes those questions
 * are still gated.
 */
export function findSurveyQuestionsDependingOn(
  questions: SurveyConditionQuestionRef[],
  questionId: string
): { id: string; prompt: string }[] {
  return questions
    .filter((question) => {
      if (question.id === questionId) return false;
      return readSurveyVisibilityCondition(question.config)?.question_id === questionId;
    })
    .map((question) => ({ id: question.id, prompt: question.prompt }));
}

// ── Aggregation helpers ──────────────────────────────────────────────────────
// Callers pass APPROVED-ONLY answer sets. `n` = ANSWERED count (never respondent
// count). `lowN` flags screening-grade small samples — a label, not suppression.
export type SurveyAgg<T> = { n: number; lowN: boolean } & T;
type AnswerRow = { answer_json: unknown; answer_text?: string | null };
type OptionRef = { id: string; label: string };

function meta<T extends object>(n: number, body: T): SurveyAgg<T> {
  return { n, lowN: n < SURVEY_SMALL_SAMPLE_N, ...body };
}
function json(row: AnswerRow): Record<string, unknown> {
  return asRecord(row.answer_json) ?? {};
}

export function tallyChoice(
  answers: AnswerRow[],
  options: OptionRef[]
): SurveyAgg<{ rows: { option_id: string; label: string; count: number; pct: number }[]; otherTexts: string[] }> {
  const counts = new Map<string, number>(options.map((o) => [o.id, 0]));
  const otherTexts: string[] = [];
  for (const row of answers) {
    const a = json(row);
    const ids = Array.isArray(a.option_ids) ? (a.option_ids as string[]) : a.option_id ? [a.option_id as string] : [];
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    if (typeof a.other_text === "string" && a.other_text.trim()) otherTexts.push(a.other_text.trim());
  }
  const n = answers.length;
  const rows = options.map((o) => ({ option_id: o.id, label: o.label, count: counts.get(o.id) ?? 0, pct: n > 0 ? (counts.get(o.id) ?? 0) / n : 0 }));
  return meta(n, { rows, otherTexts });
}

export function summarizeLikert(
  answers: AnswerRow[],
  config: { scale: number; labels?: string[] }
): SurveyAgg<{ mean: number | null; distribution: Record<number, number>; topBoxPct: number | null }> {
  const distribution: Record<number, number> = {};
  for (let i = 1; i <= config.scale; i++) distribution[i] = 0;
  let sum = 0;
  let n = 0;
  for (const row of answers) {
    const v = json(row).value;
    if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= config.scale) {
      distribution[v] += 1;
      sum += v;
      n += 1;
    }
  }
  const topBox = distribution[config.scale] ?? 0;
  return meta(n, { mean: n > 0 ? sum / n : null, distribution, topBoxPct: n > 0 ? topBox / n : null });
}

export function summarizeRating(
  answers: AnswerRow[],
  config: { max: number }
): SurveyAgg<{ mean: number | null; min: number | null; max: number | null; distribution: Record<string, number> }> {
  const distribution: Record<string, number> = {};
  let sum = 0;
  let n = 0;
  let lo: number | null = null;
  let hi: number | null = null;
  for (const row of answers) {
    const v = json(row).value;
    if (typeof v === "number" && v >= 1 && v <= config.max) {
      const key = String(v);
      distribution[key] = (distribution[key] ?? 0) + 1;
      sum += v;
      n += 1;
      lo = lo === null ? v : Math.min(lo, v);
      hi = hi === null ? v : Math.max(hi, v);
    }
  }
  return meta(n, { mean: n > 0 ? sum / n : null, min: lo, max: hi, distribution });
}

export function summarizeRanking(
  answers: AnswerRow[],
  options: OptionRef[]
): SurveyAgg<{
  rows: { option_id: string; label: string; bordaScore: number; meanRank: number | null; timesRanked: number }[];
  partialCoverage: boolean;
}> {
  const borda = new Map<string, number>(options.map((o) => [o.id, 0]));
  const rankSum = new Map<string, number>(options.map((o) => [o.id, 0]));
  const timesRanked = new Map<string, number>(options.map((o) => [o.id, 0]));
  let partialCoverage = false;
  let n = 0;
  const N = options.length;
  for (const row of answers) {
    const ranking = json(row).ranking;
    if (!Array.isArray(ranking) || ranking.length === 0) continue;
    n += 1;
    if (ranking.length < N) partialCoverage = true;
    ranking.forEach((id, idx) => {
      const optId = id as string;
      if (!borda.has(optId)) return;
      // N-based Borda: a top pick scores N-1 regardless of how many items the
      // ballot ranked; unranked options implicitly score 0. Weighting by the
      // per-ballot length instead would give a single-item ballot 0 points for
      // its own top pick and systematically underweight partial ballots.
      borda.set(optId, (borda.get(optId) ?? 0) + (N - 1 - idx));
      rankSum.set(optId, (rankSum.get(optId) ?? 0) + (idx + 1));
      timesRanked.set(optId, (timesRanked.get(optId) ?? 0) + 1);
    });
  }
  const rows = options
    .map((o) => {
      const tr = timesRanked.get(o.id) ?? 0;
      return {
        option_id: o.id,
        label: o.label,
        bordaScore: borda.get(o.id) ?? 0,
        meanRank: tr > 0 ? (rankSum.get(o.id) ?? 0) / tr : null,
        timesRanked: tr,
      };
    })
    .sort((x, y) => y.bordaScore - x.bordaScore);
  return meta(n, { rows, partialCoverage });
}

export function summarizeBudget(
  answers: AnswerRow[],
  options: OptionRef[],
  config: { total: number; unit: string }
): SurveyAgg<{
  rows: { option_id: string; label: string; totalAllocated: number; meanAllocated: number; pctOfPool: number }[];
  pool: number;
  unit: string;
}> {
  const totals = new Map<string, number>(options.map((o) => [o.id, 0]));
  let pool = 0;
  let n = 0;
  for (const row of answers) {
    const allocations = json(row).allocations;
    if (!Array.isArray(allocations) || allocations.length === 0) continue;
    n += 1;
    for (const alloc of allocations) {
      const rec = asRecord(alloc);
      if (!rec) continue;
      const id = rec.option_id as string;
      const amount = typeof rec.amount === "number" ? rec.amount : 0;
      if (totals.has(id) && amount > 0) {
        totals.set(id, (totals.get(id) ?? 0) + amount);
        pool += amount;
      }
    }
  }
  const rows = options
    .map((o) => {
      const total = totals.get(o.id) ?? 0;
      return { option_id: o.id, label: o.label, totalAllocated: total, meanAllocated: n > 0 ? total / n : 0, pctOfPool: pool > 0 ? total / pool : 0 };
    })
    .sort((x, y) => y.totalAllocated - x.totalAllocated);
  return meta(n, { rows, pool, unit: config.unit });
}

export function summarizeMapPoints(
  answers: AnswerRow[]
): SurveyAgg<{ points: [number, number][]; clusterCount: number }> {
  const points: [number, number][] = [];
  const cells = new Set<string>();
  const GRID = 0.005; // ~0.5 km screening-grade grid
  for (const row of answers) {
    const geometry = json(row).geometry as EngagementGeometry | undefined;
    if (!geometry) continue;
    const parsed = parseEngagementGeometry(geometry);
    if (!parsed.ok) continue;
    const { longitude: lng, latitude: lat } = computeEngagementGeometryRepresentativePoint(parsed.geometry);
    points.push([lng, lat]);
    cells.add(`${Math.round(lng / GRID)}:${Math.round(lat / GRID)}`);
  }
  return meta(points.length, { points, clusterCount: cells.size });
}

export function summarizeFreeText(
  answers: AnswerRow[]
): SurveyAgg<{ answered: number; sample: string[] }> {
  const texts = answers
    .map((r) => (typeof r.answer_text === "string" ? r.answer_text : (json(r).text as string)))
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  return meta(texts.length, { answered: texts.length, sample: texts.slice(0, 10) });
}

// Re-export for callers building question context.
export type { EngagementGeometry, EngagementGeometryType };
