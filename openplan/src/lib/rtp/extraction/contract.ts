/**
 * THE AI EXTRACTION CONTRACT — what a model is asked for when OpenPlan reads an
 * adopted RTP, and the shape its answer must have to be looked at at all.
 *
 * EXTRACTION IS TRANSCRIPTION WITH PROVENANCE. It is never authorship. This
 * module holds the half of that sentence a model can see: the target kinds, the
 * fields each one may propose, the lexical terms that decide which passages are
 * read, and the prompt. The other half — the deterministic check that every
 * figure a candidate carries is present in the words it quoted — lives in
 * `./verify.ts` and is not a model.
 *
 * THREE PROPERTIES OF THIS FILE THAT ARE LOAD-BEARING.
 *
 * 1. THE PROMPT IS BLIND TO THE DATABASE. `buildExtractionPrompt` takes chunks
 *    of the uploaded document and nothing else. It cannot be handed the cycle's
 *    existing ledger, its bands, its measures or its projects, because a model
 *    shown the destination can copy it back and call it transcription — and the
 *    result would be a figure that travelled OUT of OpenPlan and returned
 *    wearing a page citation. The blindness is structural (there is no
 *    parameter for it) and it is also asserted, over the built string, in
 *    `src/test/rtp-extraction-contract.test.ts`.
 *
 *    The cost of the blindness is that the model cannot know what is already
 *    recorded. That is solved AFTER the model, deterministically, by comparing
 *    staged candidates against the cycle's rows in code — never by widening
 *    this prompt.
 *
 * 2. NO CONFIDENCE, NO CERTAINTY, NO LIKELIHOOD. The response shape has four
 *    keys and `parseExtractionResponse` keeps only those four, so a model that
 *    volunteers a score has it dropped before anything downstream could read
 *    it. A model grading its own certainty is the model grading itself, and a
 *    threshold over that score is a machine authoring a planning number with
 *    extra steps.
 *
 * 3. NOTHING HERE COMPUTES. No total, no balance, no year-of-expenditure
 *    dollars, no band midpoint, no score, no verdict. The fiscal finding stays
 *    computed at read time from rows a human accepted; this lane supplies
 *    inputs to that arithmetic and may never state its answer.
 *
 * WHY THE FIELD LIST IS SHORTER THAN THE WRITE ROUTES' BODIES. `proposed_json`
 * is a SUBSET of what the target route's POST accepts, not a whole body. Two
 * kinds of field are deliberately missing:
 *   - fields no document contains (`measureKey` is an OpenPlan slug, `notes` is
 *     a planner's own annotation, `sortOrder` is derived) — a model filling
 *     those in is authoring content, however harmless it looks; and
 *   - fields whose value is an identifier (`projectId`, `horizonBandId`) — a
 *     project is staged as a NAME STRING and bound by a person, and a band is
 *     resolved from the cycle's own rows by the verifier, never by the model.
 * Acceptance merges the reviewer's answers for the rest.
 */

import { RTP_PORTFOLIO_ROLE_OPTIONS } from "@/lib/rtp/catalog";

/**
 * The six target kinds, in the same order and spelling as the CHECK on
 * `rtp_extraction_candidates.target_kind` (20260811000008). Pinned to that
 * migration by `src/test/rtp-extraction-contract.test.ts`, in the shape
 * `KB_EXTRACTION_SOURCES` established: two copies of one vocabulary is how a
 * form the database refuses gets shipped.
 */
export const RTP_EXTRACTION_TARGET_KINDS = [
  "financial_line",
  "performance_measure",
  "horizon_band",
  "programmed_project",
  "cycle_financial_basis",
  "chapter_block",
] as const;

export type RtpExtractionTargetKind = (typeof RTP_EXTRACTION_TARGET_KINDS)[number];

/**
 * What a run reads when the caller does not say.
 *
 * `chapter_block` is EXCLUDED from the default on purpose. Verbatim chapter
 * prose does not land in an RTP table at all — it goes through the existing
 * `document_narrative_drafts` staging machinery, which is a different
 * acceptance path with a different reviewer flow. Transcribing hundreds of
 * blocks into a queue nobody has a screen for is the shipped-invisible defect
 * this repository has paid for repeatedly, so the block lane is opt-in until
 * its acceptance surface exists.
 */
export const RTP_EXTRACTION_DEFAULT_TARGET_KINDS: readonly RtpExtractionTargetKind[] = [
  "financial_line",
  "performance_measure",
  "horizon_band",
  "programmed_project",
  "cycle_financial_basis",
];

/**
 * How a field's value is checked against the words the candidate quoted.
 *
 * - `numeric` — the value's numeric core must be present in the quote. This is
 *   the rule that makes a hallucinated figure produce ZERO rows rather than a
 *   wrong one, and it uses the same normaliser the narrative faithfulness belt
 *   uses (`$4.2M`, `$4.2 million` and `4,200,000` all reduce to `4200000`).
 * - `quoted_text` — the text must appear inside the quote (case-folded). A
 *   revenue source, a measure label, a project's name as the plan prints it.
 * - `classification` — a value from a fixed vocabulary that the plan expresses
 *   in its own words rather than OpenPlan's ("Constrained" in a column header,
 *   revenue vs cost by which side of a table a row sits on). It is NOT required
 *   to appear in the quote, because the document does not spell it the way the
 *   database does — which is exactly why a reviewer must confirm it, and why
 *   this kind is marked so the review surface can badge it differently.
 * - `verbatim_block` — the value IS the quote, character for character after
 *   whitespace normalisation. Chapter prose, never summarised.
 */
export type RtpExtractionFieldKind = "numeric" | "quoted_text" | "classification" | "verbatim_block";

export type RtpExtractionFieldSpec = {
  key: string;
  kind: RtpExtractionFieldKind;
  required: boolean;
  /** What the field is, in the words the prompt shows the model. */
  describe: string;
  /** `classification` only: the exact values the database accepts. */
  enumValues?: readonly string[];
  /** `numeric` only: whole numbers only (years). */
  integer?: boolean;
  min?: number;
  max?: number;
  /** `quoted_text` / `verbatim_block` only: refuse anything longer. */
  maxChars?: number;
  /**
   * `numeric` only. A zero here does not mean "free"; it means the plan did not
   * price the thing, and NULL is the honest answer for that — 20260805000003
   * calls the coercion out by name. A quote can contain a bare "0" for all
   * sorts of reasons ("Phase 0", "0 of 12 complete"), so the numeric rule alone
   * would let a fabricated zero through on a page that happens to contain one.
   */
  zeroMeansUnpriced?: boolean;
  /**
   * The band this row belongs to, staged as the band's LABEL. The verifier
   * resolves it against the cycle's own bands by exact label; an unresolved
   * label stages with the band unset for the reviewer to pick, because a
   * guessed band sets an escalation exponent.
   */
  resolvesHorizonBand?: boolean;
};

export type RtpExtractionTargetSpec = {
  kind: RtpExtractionTargetKind;
  /** Planner-voice name, used in the prompt and safe to show on a screen. */
  label: string;
  /**
   * The lexical terms that decide which of the document's passages are read for
   * this kind. Deterministic retrieval is what makes "why page 112?"
   * answerable: page 112 was read because it contains these words.
   *
   * ENGLISH, AND THAT IS A DISCLOSED LIMIT, not an assumption that plans are
   * American. A plan adopted in another language matches none of these, and the
   * run then reports that no passage matched rather than reporting that the
   * plan contains no revenue — the two are different answers and a planner is
   * owed the right one.
   */
  prefilterTerms: readonly string[];
  fields: readonly RtpExtractionFieldSpec[];
  /** The sentences that tell the model what one candidate of this kind is. */
  instructions: readonly string[];
};

const PORTFOLIO_ROLES = RTP_PORTFOLIO_ROLE_OPTIONS.map((option) => option.value);

/** Matches `fiscal-constraint.ts`'s `RtpFiscalEntryKind` and the route's enum. */
const FISCAL_ENTRY_KINDS = ["revenue", "operations_maintenance", "other_cost"] as const;

/** Matches `rtp_horizon_bands.cost_estimate_basis`. */
const COST_ESTIMATE_BASES = ["itemized", "banded"] as const;

const YEAR_MIN = 1900;
const YEAR_MAX = 2200;

/** The ledger column's ceiling, kept identical to the financial-assumptions route. */
const MAX_MONEY = 99_999_999_999_999;

function yearField(key: string, required: boolean, describe: string): RtpExtractionFieldSpec {
  return { key, kind: "numeric", required, integer: true, min: YEAR_MIN, max: YEAR_MAX, describe };
}

export const RTP_EXTRACTION_TARGETS: Record<RtpExtractionTargetKind, RtpExtractionTargetSpec> = {
  financial_line: {
    kind: "financial_line",
    label: "Revenue and cost line",
    prefilterTerms: [
      "revenue",
      "revenues",
      "funding",
      "fund",
      "sales tax",
      "federal",
      "state",
      "local",
      "operations",
      "maintenance",
      "o&m",
      "debt service",
      "financial",
      "fiscal",
      "million",
      "billion",
      "$",
    ],
    fields: [
      {
        key: "entryKind",
        kind: "classification",
        required: true,
        enumValues: FISCAL_ENTRY_KINDS,
        describe:
          "revenue (money the plan expects to receive), operations_maintenance (the cost of running and maintaining the system), or other_cost (any other cost, such as debt service or a reserve)",
      },
      {
        key: "sourceName",
        kind: "quoted_text",
        required: true,
        maxChars: 200,
        describe: "the name of the revenue source or cost item exactly as the plan prints it",
      },
      {
        key: "amount",
        kind: "numeric",
        required: true,
        min: 0,
        max: MAX_MONEY,
        zeroMeansUnpriced: true,
        describe:
          "the dollar amount as the plan states it, in whole dollars (write 412000000 for $412 million)",
      },
      yearField(
        "amountBasisYear",
        false,
        "the dollar year the amount is expressed in, ONLY if the plan states it on this page"
      ),
      {
        key: "horizonBandLabel",
        kind: "quoted_text",
        required: false,
        maxChars: 160,
        resolvesHorizonBand: true,
        describe:
          "the planning period this line belongs to, written exactly as the plan labels it (for example the period column of the table)",
      },
    ],
    instructions: [
      "One candidate per ROW of a revenue or cost table, or per figure stated in a sentence.",
      "Do not add rows together. A total, a subtotal and a balance are arithmetic OpenPlan does itself — never transcribe one.",
      "If the plan does not state an amount for a row, skip the row entirely. An amount nobody stated is not a zero.",
    ],
  },

  performance_measure: {
    kind: "performance_measure",
    label: "Performance measure",
    prefilterTerms: [
      "performance measure",
      "performance measures",
      "target",
      "targets",
      "baseline",
      "indicator",
      "objective",
      "measure",
      "fatalities",
      "serious injuries",
      "pavement",
      "bridge",
      "transit asset",
      "reliability",
      "vmt",
      "mode share",
    ],
    fields: [
      {
        key: "label",
        kind: "quoted_text",
        required: true,
        maxChars: 200,
        describe: "the measure's name exactly as the plan prints it",
      },
      {
        key: "unit",
        kind: "quoted_text",
        required: false,
        maxChars: 60,
        describe: "the unit the measure is counted in, as the plan writes it",
      },
      {
        key: "baselineValue",
        kind: "numeric",
        required: false,
        describe: "the measured starting value the plan reports",
      },
      yearField("baselineYear", false, "the year the baseline was measured, if the plan states it"),
      {
        key: "targetValue",
        kind: "numeric",
        required: false,
        describe: "the value the plan sets as its target",
      },
      yearField("targetYear", false, "the year the target is set for, if the plan states it"),
      {
        key: "dataSource",
        kind: "quoted_text",
        required: false,
        maxChars: 300,
        describe: "the source the plan credits the measurement to",
      },
    ],
    instructions: [
      "One candidate per measure.",
      "A baseline is a measurement of the world. If the plan does not print one, leave it out — do not estimate it and do not carry a target back into it.",
    ],
  },

  horizon_band: {
    kind: "horizon_band",
    label: "Planning period",
    prefilterTerms: [
      "horizon",
      "planning period",
      "near-term",
      "near term",
      "mid-term",
      "mid term",
      "long-term",
      "long term",
      "phase",
      "phasing",
      "tier",
      "constrained",
      "illustrative",
      "period",
    ],
    fields: [
      {
        key: "label",
        kind: "quoted_text",
        required: true,
        maxChars: 160,
        describe: "the period's name exactly as the plan writes it",
      },
      yearField("startYear", true, "the first year of the period, as the plan states it"),
      yearField("endYear", true, "the last year of the period, as the plan states it"),
      yearField(
        "escalationTargetYear",
        false,
        "the dollar year this period's costs are escalated to — ONLY if the plan states that exact year on this page"
      ),
      {
        key: "costEstimateBasis",
        kind: "classification",
        required: false,
        enumValues: COST_ESTIMATE_BASES,
        describe:
          "itemized (the period's cost is the sum of individual project costs) or banded (the plan gives the period one lump figure)",
      },
    ],
    instructions: [
      "One candidate per planning period the plan defines.",
      "Leave escalationTargetYear out unless the plan names that year. Leaving it out is not a gap: OpenPlan discloses that it assumed the period's midpoint, and filling this in silently deletes that disclosure.",
    ],
  },

  programmed_project: {
    kind: "programmed_project",
    label: "Programmed project",
    prefilterTerms: [
      "project",
      "projects",
      "project list",
      "programmed",
      "improvement",
      "corridor",
      "interchange",
      "widening",
      "constrained",
      "illustrative",
      "cost",
      "estimate",
      "$",
    ],
    fields: [
      {
        key: "projectName",
        kind: "quoted_text",
        required: true,
        maxChars: 300,
        describe: "the project's name exactly as the plan's project table prints it",
      },
      {
        key: "estimatedCost",
        kind: "numeric",
        required: false,
        min: 0,
        max: MAX_MONEY,
        zeroMeansUnpriced: true,
        describe: "the project's cost as the plan states it, in whole dollars",
      },
      yearField(
        "costBasisYear",
        false,
        "the dollar year the cost is expressed in, ONLY if the plan states it"
      ),
      {
        key: "portfolioRole",
        kind: "classification",
        required: false,
        enumValues: PORTFOLIO_ROLES,
        describe: `how the plan classifies the project: ${PORTFOLIO_ROLES.join(", ")}`,
      },
      {
        key: "horizonBandLabel",
        kind: "quoted_text",
        required: false,
        maxChars: 160,
        resolvesHorizonBand: true,
        describe: "the planning period the project is programmed in, exactly as the plan labels it",
      },
    ],
    instructions: [
      "One candidate per row of the plan's project list.",
      "Give the project's NAME as text. Never invent, guess or return an id of any kind.",
      "If the row's cost cell is blank, dashed or says the cost is not yet estimated, leave estimatedCost out. Unpriced is a real answer and it is not zero.",
    ],
  },

  cycle_financial_basis: {
    kind: "cycle_financial_basis",
    label: "Plan-wide dollar basis",
    prefilterTerms: [
      "constant dollars",
      "year of expenditure",
      "year-of-expenditure",
      "yoe",
      "base year",
      "base-year",
      "escalation",
      "escalated",
      "inflation",
      "annual rate",
      "dollars",
    ],
    /*
      THE BASIS YEAR ONLY, and the escalation rate DELIBERATELY NOT — recorded
      here because the omission looks like a gap and is a refusal.

      A plan writes its escalation rate as "3.5 percent".
      `rtp_cycles.annual_inflation_rate` stores it as `0.035`, and the cycle
      PATCH route's zod accepts that fraction. Those are the same rate in two
      representations, and turning one into the other is a conversion.

      There is nowhere honest to put that conversion. In the verifier it breaks
      the one rule the verifier exists for — the value must be present in the
      quoted words, and `0.035` is not in a page that says "3.5 percent". In
      `proposed_json` under a percent-shaped key it is worse: the PATCH schema
      is not `.strict()`, so an unrecognised key is STRIPPED, and a candidate
      carrying a basis year and a rate would write the year, silently drop the
      rate, and mark itself accepted. A planner who read two numbers off the
      card would have one of them land.

      So the rate is not transcribed in v1 and a planner types it — once per
      plan. If it is wanted later, the place for it is the review surface,
      showing the percent beside its quote and the fraction it would write, with
      the person pressing accept on both. Not a looser verifier.
    */
    fields: [
      yearField(
        "financialBasisYear",
        true,
        "the dollar year the plan says its money is expressed in"
      ),
    ],
    instructions: [
      "At most one candidate. This is the plan's own statement about what year its dollars are expressed in.",
      "Transcribe only the year. Do not transcribe the escalation rate, do not derive a rate from two dollar amounts, and do not convert anything.",
    ],
  },

  chapter_block: {
    kind: "chapter_block",
    label: "Verbatim policy or goal text",
    prefilterTerms: [
      "goal",
      "goals",
      "policy",
      "policies",
      "objective",
      "objectives",
      "action",
      "actions",
      "strategy",
      "strategies",
      "vision",
    ],
    fields: [
      {
        key: "text",
        kind: "verbatim_block",
        required: true,
        maxChars: 4000,
        describe: "the block of the plan's own text, copied character for character",
      },
    ],
    instructions: [
      "One candidate per goal, policy, objective or action statement.",
      "`text` and `quote` must be THE SAME STRING. This is a copy, not a summary: never shorten, never paraphrase, never join two statements, never fix the plan's grammar.",
    ],
  },
};

// ---------------------------------------------------------------------------
// Caps. Every one of them is disclosed to the caller by the run route, because
// a document read only as far as a ceiling looks, from every screen
// downstream, exactly like a document that ends there.
// ---------------------------------------------------------------------------

/** Passages sent to the model in one call. */
export const EXTRACTION_CHUNKS_PER_CALL = 6;
/** Characters of one passage put in the prompt. Chunks are ~3200 (chunk.ts). */
export const EXTRACTION_CHUNK_PROMPT_CHARS = 3600;
/** Passages read per target kind across a whole run. */
export const EXTRACTION_CHUNKS_PER_TARGET = 24;
/**
 * Model calls one run may make. The rate limiter counts one usage event per
 * call, so this is also the most a single click can spend.
 */
export const EXTRACTION_MAX_MODEL_CALLS = 20;
/** Candidates accepted from one call before the rest are ignored. */
export const EXTRACTION_MAX_CANDIDATES_PER_CALL = 40;
/** Chunk rows a run will page through when scanning the document. */
export const EXTRACTION_MAX_CHUNKS_SCANNED = 4000;
/** Rows per PostgREST page while scanning (its default ceiling is 1000). */
export const EXTRACTION_CHUNK_PAGE_SIZE = 1000;

export const RTP_EXTRACTION_MODEL_ENV = "OPENPLAN_RTP_EXTRACTION_MODEL";

/**
 * The model id this deployment transcribes with.
 *
 * Defaults to the repo's current strong id rather than the cheap one: this task
 * is copying figures out of a table, and a model that paraphrases a number is
 * the whole failure mode. The verifier catches it, but every catch is a figure
 * the planner does not get.
 */
export const DEFAULT_RTP_EXTRACTION_MODEL_ID = "claude-opus-4-8";

export function resolveRtpExtractionModelId(
  env: Record<string, string | undefined> = process.env
): string {
  return env[RTP_EXTRACTION_MODEL_ENV]?.trim() || DEFAULT_RTP_EXTRACTION_MODEL_ID;
}

// ---------------------------------------------------------------------------
// Passages, prompt, response.
// ---------------------------------------------------------------------------

/**
 * One passage of the uploaded document, as the prompt and the verifier both see
 * it. `page` is the chunk's OWN `page_from`; nothing the model says can change
 * it, and `verify.ts` refuses a passage that cannot name a single page.
 */
export type ExtractionPassage = {
  chunkId: string;
  page: number;
  content: string;
};

/** `chunk_<uuid>` — the id the model is asked to echo back. */
export function passageFactId(chunkId: string): string {
  return `chunk_${chunkId}`;
}

/** Accepts `chunk_<uuid>` or a bare uuid; returns the bare id. */
export function parsePassageFactId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const bare = text.startsWith("chunk_") ? text.slice("chunk_".length) : text;
  return bare.trim() || null;
}

/** The four keys a candidate may have. Anything else the model sends is dropped. */
export type RawExtractionCandidate = {
  target_kind: string | null;
  fields: Record<string, unknown>;
  source_chunk_id: string | null;
  /** The model's own page claim. An AUDIT CROSS-CHECK, never the stored page. */
  page: number | null;
  quote: string;
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)} […]` : text;
}

function describeField(field: RtpExtractionFieldSpec): string {
  const bits: string[] = [`  - ${field.key}${field.required ? " (required)" : " (optional)"}: ${field.describe}`];
  if (field.kind === "classification" && field.enumValues) {
    bits.push(`    one of exactly: ${field.enumValues.join(" | ")}`);
  }
  if (field.kind === "numeric") {
    bits.push("    a JSON number, and the SAME digits must appear in your quote");
  }
  return bits.join("\n");
}

const SYSTEM_PROMPT = [
  "You transcribe figures and statements out of an adopted long-range transportation plan for a public planning agency.",
  "You are a copyist, not an analyst. You never calculate, never estimate, never round, never convert units, and never fill a gap.",
  "Every value you return must appear, in those characters, inside the passage you quote. If it does not, you do not return it.",
].join(" ");

/**
 * Build the prompt for ONE target kind over ONE batch of passages.
 *
 * The parameter list is the guarantee: passages and a kind. There is nowhere to
 * put the cycle's existing rows, and adding one would be the change that turns
 * this feature into a machine authoring a planning number.
 */
export function buildExtractionPrompt(params: {
  targetKind: RtpExtractionTargetKind;
  passages: readonly ExtractionPassage[];
}): { system: string; prompt: string } {
  const spec = RTP_EXTRACTION_TARGETS[params.targetKind];

  const passageLines = params.passages.map((passage) =>
    [
      `${passageFactId(passage.chunkId)} (p.${passage.page}):`,
      truncate(passage.content, EXTRACTION_CHUNK_PROMPT_CHARS),
    ].join("\n")
  );

  const prompt = [
    `Read the numbered passages below and transcribe every ${spec.label.toLowerCase()} they contain.`,
    "",
    "Return ONLY a JSON object with this exact shape:",
    '{ "candidates": [ { "target_kind": "' +
      spec.kind +
      '", "fields": { … }, "source_chunk_id": "chunk_<id>", "page": <number>, "quote": "…" } ] }',
    "",
    "FIELDS:",
    ...spec.fields.map(describeField),
    "",
    "WHAT ONE CANDIDATE IS:",
    ...spec.instructions.map((line) => `- ${line}`),
    "",
    "RULES THAT DECIDE WHETHER A CANDIDATE IS KEPT AT ALL:",
    "- `quote` must be copied character for character out of ONE passage below, and `source_chunk_id` must be that passage's id. A quote that is not in the passage is discarded.",
    "- Every number in `fields` must appear inside your own `quote`. A figure that is not in the quote is discarded — the whole candidate, not just the field.",
    "- Quote enough of the passage to contain every value you return, and no more than a few sentences or one table row.",
    "- Never return a total, a subtotal, a balance, a sum, an average, a year-of-expenditure figure, a period midpoint, a score or a ranking. OpenPlan computes those itself and will not accept them from you.",
    "- Never return an id, a uuid, or a database key of any kind.",
    "- Never return a confidence, certainty, likelihood, probability or quality score. There is nowhere to put one and it would be discarded.",
    "- Leave a field out when the passage does not state it. An empty cell is not a zero, and a missing year is not this year.",
    "- If the passages contain nothing of this kind, return { \"candidates\": [] }. An empty answer is a correct answer.",
    "",
    `Return at most ${EXTRACTION_MAX_CANDIDATES_PER_CALL} candidates.`,
    "",
    "PASSAGES:",
    ...passageLines,
  ].join("\n");

  return { system: SYSTEM_PROMPT, prompt };
}

/**
 * Read the model's answer, keeping only the four keys a candidate may have.
 *
 * Returns `null` when there is no JSON object to read — which the run treats as
 * a FAILED run, not an empty one. A parse that could not happen is not evidence
 * that the plan says nothing.
 *
 * Fence-tolerant in the shape `lib/engagement/ai-synthesis.ts` established; the
 * key-narrowing is this module's own, and it is what makes "no confidence score
 * can reach the database" true rather than merely instructed.
 */
export function parseExtractionResponse(text: string): RawExtractionCandidate[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const rawList = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(rawList)) return null;

  const candidates: RawExtractionCandidate[] = [];
  for (const entry of rawList.slice(0, EXTRACTION_MAX_CANDIDATES_PER_CALL)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const rawFields = row.fields;
    const fields: Record<string, unknown> = {};
    if (rawFields && typeof rawFields === "object" && !Array.isArray(rawFields)) {
      for (const [key, value] of Object.entries(rawFields as Record<string, unknown>)) {
        fields[key] = value;
      }
    }
    const page = typeof row.page === "number" && Number.isFinite(row.page) ? row.page : null;
    candidates.push({
      target_kind: typeof row.target_kind === "string" ? row.target_kind : null,
      fields,
      source_chunk_id: parsePassageFactId(row.source_chunk_id),
      page,
      quote: typeof row.quote === "string" ? row.quote : "",
    });
  }
  return candidates;
}
