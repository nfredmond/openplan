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
export const SURVEY_ALLOWED_FILE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

// ── Per-type config zod (all .strict()) ─────────────────────────────────────
export const singleChoiceConfigSchema = z
  .object({ allow_other: z.boolean().optional(), randomize: z.boolean().optional() })
  .strict();
export const multipleChoiceConfigSchema = z
  .object({
    min_select: z.number().int().nonnegative().optional(),
    max_select: z.number().int().positive().optional(),
    allow_other: z.boolean().optional(),
    randomize: z.boolean().optional(),
  })
  .strict()
  .refine((c) => c.min_select === undefined || c.max_select === undefined || c.min_select <= c.max_select, {
    message: "min_select must be <= max_select",
  });
export const likertConfigSchema = z
  .object({
    scale: z.union([z.literal(5), z.literal(7)]).default(5),
    labels: z.array(z.string()).optional(),
    reverse: z.boolean().optional(),
  })
  .strict()
  .refine((c) => !c.labels || c.labels.length === c.scale, {
    message: "labels length must equal scale",
  });
export const ratingConfigSchema = z
  .object({
    max: z.number().int().min(2).max(10).default(5),
    allow_half: z.boolean().optional(),
    icon: z.enum(["star", "number"]).optional(),
  })
  .strict();
export const rankingConfigSchema = z
  .object({
    max_ranked: z.number().int().positive().optional(),
    require_full: z.boolean().default(false),
  })
  .strict();
export const mapPointConfigSchema = z
  .object({
    geometry_types: z.array(z.enum(["Point", "LineString", "Polygon"])).min(1).default(["Point"]),
    guidance: z.string().max(1000).optional(),
    require_within_corridor: z.boolean().optional(),
    center: z.tuple([z.number(), z.number()]).optional(),
    zoom: z.number().optional(),
  })
  .strict();
export const budgetConfigSchema = z
  .object({
    total: z.number().positive(),
    unit: z.enum(["usd", "points", "percent"]).default("usd"),
    must_allocate_all: z.boolean().default(false),
    per_option_min: z.number().nonnegative().optional(),
    per_option_max: z.number().positive().optional(),
  })
  .strict();
export const freeTextConfigSchema = z
  .object({
    max_length: z.number().int().positive().max(SURVEY_FREE_TEXT_HARD_MAX).default(2000),
    min_length: z.number().int().nonnegative().optional(),
    multiline: z.boolean().default(true),
  })
  .strict();
export const fileUploadConfigSchema = z
  .object({
    max_files: z.number().int().positive().max(SURVEY_FILE_MAX_FILES_HARD_CAP).default(1),
    max_size_bytes: z.number().int().positive().default(5_242_880),
    accept: z.array(z.enum(SURVEY_ALLOWED_FILE_MIME)).min(1).default([...SURVEY_ALLOWED_FILE_MIME]),
  })
  .strict();

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
