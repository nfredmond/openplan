import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

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

export async function generateGrantInterpretation(
  metrics: Record<string, unknown>,
  summaryText: string
): Promise<InterpretationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return fallback(summaryText, "missing_api_key");
  }

  try {
    const { text, usage } = await generateText({
      model: anthropic(HAIKU_MODEL_ID),
      temperature: 0.2,
      maxOutputTokens: 500,
      system:
        "You are a transportation planning analyst writing grant-ready corridor narratives for U.S. public funding applications.",
      prompt: [
        "Write exactly 2-3 concise paragraphs in natural language for a grant application narrative.",
        "Use the summary and metrics to interpret corridor need and opportunity.",
        "Include specific corridor recommendations (project types, sequencing, and why they match the data).",
        "Avoid markdown bullets and headings. Keep tone professional and evidence-based.",
        "",
        "CORRIDOR SUMMARY:",
        summaryText,
        "",
        "METRICS JSON:",
        JSON.stringify(metrics, null, 2),
      ].join("\n"),
    });

    const cleaned = text.trim();
    if (!cleaned) {
      return fallback(summaryText, "empty_output");
    }

    const inputTokens = nullIfUndefined(usage?.inputTokens);
    const outputTokens = nullIfUndefined(usage?.outputTokens);
    const totalTokens = nullIfUndefined(usage?.totalTokens);

    return {
      text: cleaned,
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
