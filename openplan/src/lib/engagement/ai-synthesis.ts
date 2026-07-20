/**
 * AI synthesis of public engagement — the differentiator no PPGIS competitor
 * ships: theme clustering + sentiment + a narrative where EVERY sentence cites
 * the source comment(s) it summarizes, via the same `[fact:N]` grounding
 * contract used for grant narratives (`@/lib/planner-pack/grounding`).
 *
 * Design guarantees:
 * - **Grounded, not hallucinated.** Each approved item becomes a numbered fact
 *   (`item_<id>`); the model must cite `[fact:item_<id>]` for every claim, and
 *   the output is validated against the known fact ids (annotated mode) so
 *   ungrounded sentences are flagged, never silently shipped.
 * - **Deterministic fallback.** With no ANTHROPIC_API_KEY (or on any model
 *   error), `generateEngagementSynthesis` returns a category-grouped synthesis
 *   built from pure counting — the AI-offline posture the rest of the app uses.
 * - **Screening-grade.** This summarizes what was said; it is NOT a
 *   representativeness or legal-sufficiency finding (mirrors comment-matrix's
 *   caveat).
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

import {
  factClaimTextMap,
  renderNarrativeFactPromptLines,
  summarizeNarrativeGrounding,
  type NarrativeDraftGrounding,
  type NarrativeFact,
} from "@/lib/grants/narrative-grounding";
import { validateGroundedNarrative } from "@/lib/planner-pack/grounding";

const SYNTHESIS_MODEL_ID =
  process.env.OPENPLAN_ENGAGEMENT_SYNTHESIS_MODEL?.trim() || "claude-haiku-4-5-20251001";

/** Cap the number of items sent to the model so a huge campaign can't blow the
 * context window or the token budget; the deterministic counts still cover all. */
export const SYNTHESIS_MAX_ITEMS = 300;
/** Cap the body text per item in the prompt (comments are usually short). */
const ITEM_BODY_PROMPT_CAP = 600;

export const ENGAGEMENT_SENTIMENTS = ["positive", "mixed", "neutral", "negative"] as const;
export type EngagementSentiment = (typeof ENGAGEMENT_SENTIMENTS)[number];

export type SynthesisItem = {
  id: string;
  body: string | null;
  title?: string | null;
  category_label?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type SynthesisCategoryLike = {
  id: string;
  label?: string | null;
};

export type EngagementSynthesisTheme = {
  label: string;
  sentiment: EngagementSentiment;
  item_count: number;
  /** Fact ids (`item_<id>`) the theme is drawn from — the provenance trail. */
  fact_ids: string[];
  summary: string;
};

export type EngagementSynthesisSource = "ai" | "deterministic-fallback";

export type EngagementSynthesis = {
  source: EngagementSynthesisSource;
  model: string | null;
  fallback_reason: "missing_api_key" | "generation_error" | "empty_output" | "invalid_output" | null;
  item_count: number;
  analyzed_item_count: number;
  overall_sentiment: EngagementSentiment;
  themes: EngagementSynthesisTheme[];
  /** Narrative with `[fact:item_<id>]` citation tokens preserved (provenance). */
  narrative: string;
  grounding: NarrativeDraftGrounding;
  caveat: string;
};

const SYNTHESIS_CAVEAT =
  "AI synthesis of submitted comments — a screening-grade summary of what was said, with every claim cited to a source comment. NOT a representativeness, statistical, or legal-sufficiency finding.";

function normalizeSentiment(value: unknown): EngagementSentiment {
  const text = String(value ?? "").toLowerCase().trim();
  return (ENGAGEMENT_SENTIMENTS as readonly string[]).includes(text)
    ? (text as EngagementSentiment)
    : "neutral";
}

/** Fact id for an item: `item_<id>` (dashes are allowed by the grounding token
 * pattern `[A-Za-z0-9][A-Za-z0-9_.-]*`, so a UUID needs no rewriting). */
export function itemFactId(itemId: string): string {
  return `item_${itemId}`;
}

/** Build the numbered fact list (one per item) + a lookup from fact_id → item. */
export function buildSynthesisFacts(items: SynthesisItem[]): {
  facts: NarrativeFact[];
  factIdByItemId: Map<string, string>;
} {
  const capped = items.slice(0, SYNTHESIS_MAX_ITEMS);
  const factIdByItemId = new Map<string, string>();
  const claimTexts: string[] = [];
  for (const item of capped) {
    const factId = itemFactId(item.id);
    factIdByItemId.set(item.id, factId);
    const body = (item.body ?? "").trim().slice(0, ITEM_BODY_PROMPT_CAP);
    const bits: string[] = [];
    if (item.category_label) bits.push(`[${item.category_label}]`);
    if (typeof item.latitude === "number" && typeof item.longitude === "number") {
      bits.push(`(@ ${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)})`);
    }
    bits.push(body || "(no text)");
    claimTexts.push(bits.join(" "));
  }
  // buildNarrativeFactList assigns fact_1..fact_N; we want item_<id>, so build
  // the fact list directly to keep ids stable and traceable to comments.
  const facts: NarrativeFact[] = capped.map((item, index) => ({
    fact_id: itemFactId(item.id),
    claim_text: claimTexts[index],
  }));
  return { facts, factIdByItemId };
}

/** Group items by category label into deterministic themes (no LLM). */
function deterministicThemes(items: SynthesisItem[]): EngagementSynthesisTheme[] {
  const byLabel = new Map<string, { count: number; factIds: string[] }>();
  for (const item of items) {
    const label = item.category_label || "Uncategorized";
    const bucket = byLabel.get(label) ?? { count: 0, factIds: [] };
    bucket.count += 1;
    if (bucket.factIds.length < 8) bucket.factIds.push(itemFactId(item.id));
    byLabel.set(label, bucket);
  }
  return Array.from(byLabel.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([label, bucket]) => ({
      label,
      sentiment: "neutral" as EngagementSentiment,
      item_count: bucket.count,
      fact_ids: bucket.factIds,
      summary: `${bucket.count} comment${bucket.count === 1 ? "" : "s"} in "${label}".`,
    }));
}

/** A fully grounded deterministic narrative: one cited sentence per theme. */
function deterministicNarrative(themes: EngagementSynthesisTheme[]): string {
  if (themes.length === 0) return "";
  return themes
    .map((theme) => {
      const cites = theme.fact_ids.map((id) => `[fact:${id}]`).join(" ");
      return `${theme.summary} ${cites}`.trim();
    })
    .join("\n");
}

/** Build the deterministic (non-AI) synthesis — also the offline fallback. */
export function buildDeterministicSynthesis(
  items: SynthesisItem[],
  fallbackReason: EngagementSynthesis["fallback_reason"] = null
): EngagementSynthesis {
  const { facts } = buildSynthesisFacts(items);
  const themes = deterministicThemes(items.slice(0, SYNTHESIS_MAX_ITEMS));
  const narrative = deterministicNarrative(themes);
  const validated = validateGroundedNarrative(
    narrative,
    facts.map((f) => f.fact_id),
    "annotated"
  );
  return {
    source: "deterministic-fallback",
    model: null,
    fallback_reason: fallbackReason,
    item_count: items.length,
    analyzed_item_count: Math.min(items.length, SYNTHESIS_MAX_ITEMS),
    overall_sentiment: "neutral",
    themes,
    narrative,
    grounding: summarizeNarrativeGrounding(validated, facts),
    caveat: SYNTHESIS_CAVEAT,
  };
}

type ModelThemePayload = {
  label?: unknown;
  sentiment?: unknown;
  fact_ids?: unknown;
  summary?: unknown;
};

type ModelSynthesisPayload = {
  overall_sentiment?: unknown;
  themes?: unknown;
  narrative?: unknown;
};

/** Extract the first JSON object from a model response (handles code fences). */
function parseModelJson(text: string): ModelSynthesisPayload | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as ModelSynthesisPayload;
  } catch {
    return null;
  }
}

function coerceThemes(
  raw: unknown,
  knownFactIds: Set<string>
): EngagementSynthesisTheme[] {
  if (!Array.isArray(raw)) return [];
  const themes: EngagementSynthesisTheme[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const theme = entry as ModelThemePayload;
    const label = String(theme.label ?? "").trim();
    if (!label) continue;
    const factIds = Array.isArray(theme.fact_ids)
      ? theme.fact_ids
          .map((id) => String(id).replace(/^\[fact:|\]$/g, "").trim())
          .filter((id) => knownFactIds.has(id))
      : [];
    themes.push({
      label: label.slice(0, 120),
      sentiment: normalizeSentiment(theme.sentiment),
      item_count: factIds.length,
      fact_ids: factIds,
      summary: String(theme.summary ?? "").trim().slice(0, 600),
    });
  }
  return themes;
}

/**
 * Generate an AI synthesis of a campaign's approved items, grounded to source
 * comment ids. Falls back to the deterministic synthesis with no API key or on
 * any model/parse error, so this never throws for AI reasons.
 */
export async function generateEngagementSynthesis(
  items: SynthesisItem[]
): Promise<EngagementSynthesis> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return buildDeterministicSynthesis(items, "missing_api_key");
  }
  if (items.length === 0) {
    return buildDeterministicSynthesis(items, null);
  }

  const { facts } = buildSynthesisFacts(items);
  const knownFactIds = new Set(facts.map((f) => f.fact_id));
  const factLines = renderNarrativeFactPromptLines(facts);

  try {
    const { text } = await generateText({
      model: anthropic(SYNTHESIS_MODEL_ID),
      temperature: 0.2,
      maxOutputTokens: 1600,
      system:
        "You are a public-engagement analyst summarizing community comments for a transportation/urban planning agency. You never invent input: every claim you write must cite the source comment ids it summarizes.",
      prompt: [
        "You are given a numbered list of community comments (facts). Each fact id is `item_<id>`.",
        "",
        "Return ONLY a JSON object with this exact shape:",
        '{ "overall_sentiment": "positive|mixed|neutral|negative",',
        '  "themes": [ { "label": string, "sentiment": "positive|mixed|neutral|negative", "fact_ids": ["item_...", ...], "summary": string } ],',
        '  "narrative": string }',
        "",
        "Rules:",
        "- Identify 2–6 themes across the comments. Each theme lists the fact_ids of the comments it covers.",
        "- `narrative` is 2–4 short paragraphs. EVERY sentence MUST end with one or more `[fact:item_<id>]` citations for the comments it summarizes. Cite only fact ids from the list below.",
        "- Do not editorialize beyond what the comments say. Do not claim representativeness.",
        "",
        "COMMENTS:",
        ...factLines,
      ].join("\n"),
    });

    const cleaned = text.trim();
    if (!cleaned) return buildDeterministicSynthesis(items, "empty_output");

    const payload = parseModelJson(cleaned);
    if (!payload) return buildDeterministicSynthesis(items, "invalid_output");

    const narrative = String((payload as ModelSynthesisPayload).narrative ?? "").trim();
    if (!narrative) return buildDeterministicSynthesis(items, "invalid_output");

    const validated = validateGroundedNarrative(narrative, knownFactIds, "annotated", factClaimTextMap(facts));
    const themes = coerceThemes(payload.themes, knownFactIds);

    return {
      source: "ai",
      model: SYNTHESIS_MODEL_ID,
      fallback_reason: null,
      item_count: items.length,
      analyzed_item_count: Math.min(items.length, SYNTHESIS_MAX_ITEMS),
      overall_sentiment: normalizeSentiment(payload.overall_sentiment),
      themes: themes.length > 0 ? themes : deterministicThemes(items.slice(0, SYNTHESIS_MAX_ITEMS)),
      narrative,
      grounding: summarizeNarrativeGrounding(validated, facts),
      caveat: SYNTHESIS_CAVEAT,
    };
  } catch {
    return buildDeterministicSynthesis(items, "generation_error");
  }
}
