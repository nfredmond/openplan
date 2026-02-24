import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export interface InterpretationResult {
  text: string;
  source: "ai" | "summary-fallback";
}

export async function generateGrantInterpretation(
  metrics: Record<string, unknown>,
  summaryText: string
): Promise<InterpretationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return { text: summaryText, source: "summary-fallback" };
  }

  try {
    const { text } = await generateText({
      model: anthropic("claude-3-5-haiku-latest"),
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
      return { text: summaryText, source: "summary-fallback" };
    }

    return { text: cleaned, source: "ai" };
  } catch {
    return { text: summaryText, source: "summary-fallback" };
  }
}
