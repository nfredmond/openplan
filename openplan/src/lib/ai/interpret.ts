import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { splitSentences, validateGroundedNarrative } from "@/lib/planner-pack/grounding";
import {
  factClaimTextMap,
  renderNarrativeFactPromptLines,
  type NarrativeFact,
} from "@/lib/grants/narrative-grounding";

const HAIKU_MODEL_ID = "claude-haiku-4-5-20251001";
const HAIKU_INPUT_USD_PER_MTOKEN = 1.0;
const HAIKU_OUTPUT_USD_PER_MTOKEN = 5.0;

export type InterpretationSource = "ai" | "summary-fallback";
export type InterpretationFallbackReason =
  | "missing_api_key"
  | "generation_error"
  | "empty_output"
  | null;

export interface InterpretationResult {
  text: string;
  source: InterpretationSource;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  fallbackReason: InterpretationFallbackReason;
}

function nullIfUndefined(value: number | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function estimateHaikuCostUsd(
  inputTokens: number | null,
  outputTokens: number | null
): number | null {
  if (inputTokens === null && outputTokens === null) return null;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  const raw =
    (input / 1_000_000) * HAIKU_INPUT_USD_PER_MTOKEN +
    (output / 1_000_000) * HAIKU_OUTPUT_USD_PER_MTOKEN;
  return Math.round(raw * 1_000_000) / 1_000_000;
}

function fallback(
  summaryText: string,
  reason: InterpretationFallbackReason
): InterpretationResult {
  return {
    text: summaryText,
    source: "summary-fallback",
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCostUsd: null,
    fallbackReason: reason,
  };
}

/**
 * Turn the corridor metrics and deterministic summary into a citable fact list.
 * Metric entries become `m_<key>` facts ("<key>: <value>") so any figure the
 * model uses is traceable; summary sentences become `s_<n>` facts so the model
 * can cite the deterministic interpretation for qualitative statements.
 */
function buildInterpretationFacts(metrics: Record<string, unknown>, summaryText: string): NarrativeFact[] {
  const facts: NarrativeFact[] = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    facts.push({ fact_id: `m_${key}`, claim_text: `${key}: ${String(value)}` });
  }
  splitSentences(summaryText).forEach((sentence, index) => {
    facts.push({ fact_id: `s_${index + 1}`, claim_text: sentence });
  });
  return facts;
}

export async function generateGrantInterpretation(
  metrics: Record<string, unknown>,
  summaryText: string
): Promise<InterpretationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return fallback(summaryText, "missing_api_key");
  }

  const facts = buildInterpretationFacts(metrics, summaryText);
  const factIds = facts.map((fact) => fact.fact_id);

  try {
    const { text, usage } = await generateText({
      model: anthropic(HAIKU_MODEL_ID),
      temperature: 0.2,
      maxOutputTokens: 600,
      system:
        "You are a transportation planning analyst writing grant-ready corridor narratives for U.S. public funding applications. Every factual sentence you write MUST end with one or more [fact:<id>] citations drawn only from the numbered fact list. Never state a number that does not appear in a fact you cite.",
      prompt: [
        "Write 2-3 concise paragraphs interpreting corridor need and opportunity for a grant application.",
        "Every sentence must end with one or more [fact:<id>] citations for the facts it relies on. Cite only ids from the list below.",
        "Do not introduce any figure that is not present in a cited fact. Avoid markdown bullets and headings; keep tone professional and evidence-based.",
        "",
        "FACTS:",
        ...renderNarrativeFactPromptLines(facts),
      ].join("\n"),
    });

    const cleaned = text.trim();
    if (!cleaned) {
      return fallback(summaryText, "empty_output");
    }

    // Grounding contract: keep only sentences that cite a known fact AND whose
    // figures appear in those cited facts. The kept text retains its [fact:N]
    // tokens as an in-place provenance record; render sites strip them for
    // display. If nothing survives, ship the deterministic summary instead of
    // ungrounded AI prose.
    const validated = validateGroundedNarrative(cleaned, factIds, "annotated", factClaimTextMap(facts));
    const groundedText = validated.sentences
      .filter((sentence) => sentence.isGrounded)
      .map((sentence) => sentence.text)
      .join(" ")
      .trim();

    if (!groundedText) {
      return fallback(summaryText, "empty_output");
    }

    const inputTokens = nullIfUndefined(usage?.inputTokens);
    const outputTokens = nullIfUndefined(usage?.outputTokens);
    const totalTokens = nullIfUndefined(usage?.totalTokens);

    return {
      text: groundedText,
      source: "ai",
      model: HAIKU_MODEL_ID,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: estimateHaikuCostUsd(inputTokens, outputTokens),
      fallbackReason: null,
    };
  } catch {
    return fallback(summaryText, "generation_error");
  }
}
