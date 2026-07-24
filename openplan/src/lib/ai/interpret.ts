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
  | "all_ungrounded"
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
  /**
   * Sentences the grounding contract removed from the model's draft (uncited,
   * unknown fact ids, or unfaithful figures). Non-zero means the shipped
   * narrative is a grounded SUBSET of what the model wrote — callers must
   * disclose that (audit log, run provenance), not present silence as fidelity.
   */
  droppedSentenceCount: number;
  /** One issue summary per dropped sentence, e.g. `missing_citation: <text>`. */
  droppedSentenceIssues: string[];
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
    droppedSentenceCount: 0,
    droppedSentenceIssues: [],
  };
}

/**
 * Turn the corridor metrics and deterministic summary into a citable fact list.
 * Metric entries become `m_<key>` facts ("<key>: <value>") so any figure the
 * model uses is traceable; summary sentences become `s_<n>` facts so the model
 * can cite the deterministic interpretation for qualitative statements.
 */
/**
 * Equity / Justice40 metric scalars that must NOT become bare `m_<key>` facts.
 *
 * The grounding contract enforces citation-presence + numeric faithfulness, not
 * semantic framing, so a bare fact like `federalJustice40Status: disadvantaged`
 * or `disadvantagedTracts: 5` lets the model assert CURRENT federal Justice40
 * eligibility, or present the ACS income PROXY as a federal designation, with a
 * valid citation and no caveat. The deterministic summary already contains the
 * caveated proxy line and the discontinued-program federal line as `s_<n>`
 * sentence facts — so excluding these scalars makes the ONLY citable equity
 * claims the ones that carry their own caveat. This does not make the narrative
 * perfectly safe (the model can still paraphrase a sentence fact), but it
 * removes the caveat-free hooks the model would otherwise cite verbatim.
 */
const NON_CITABLE_METRIC_KEYS: ReadonlySet<string> = new Set([
  "federalJustice40Status",
  "federalJustice40Source",
  "federalJustice40DatasetLabel",
  "federalJustice40DeterminedTracts",
  "federalJustice40UndeterminedTracts",
  "federalJustice40DisadvantagedTracts",
  "proxyDisadvantagedFlag",
  "disadvantagedTracts",
  "pctDisadvantaged",
]);

export function buildInterpretationFacts(metrics: Record<string, unknown>, summaryText: string): NarrativeFact[] {
  const facts: NarrativeFact[] = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    if (NON_CITABLE_METRIC_KEYS.has(key)) continue;
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
        "You are a transportation planning analyst writing grant-ready corridor narratives for U.S. public funding applications. Every factual sentence you write MUST end with one or more [fact:<id>] citations drawn only from the numbered fact list. Never state a number that does not appear in a fact you cite. " +
        "EQUITY CLAIMS: never assert that a corridor is a currently federally designated Justice40 / disadvantaged community or that a project 'qualifies' for a specific federal program — the federal Justice40 Initiative and CEJST were rescinded in 2025. If a fact reports a CEJST designation, describe it only as a frozen historical CEJST v1.0 (2022) snapshot of a discontinued program, not a current eligibility. Describe any income/burden 'proxy' flag as a screening proxy, never as a federal designation.",
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
    // display. Validation runs per paragraph so surviving text keeps the
    // model's paragraph structure. If nothing survives, ship the deterministic
    // summary instead of ungrounded AI prose.
    const claimTexts = factClaimTextMap(facts);
    const droppedSentenceIssues: string[] = [];
    const groundedParagraphs: string[] = [];
    for (const paragraph of cleaned.split(/\n{2,}/)) {
      if (!paragraph.trim()) continue;
      const validated = validateGroundedNarrative(paragraph, factIds, "annotated", claimTexts);
      droppedSentenceIssues.push(
        ...validated.issues.map((issue) => `${issue.kind}: ${issue.sentence}`)
      );
      const kept = validated.sentences
        .filter((sentence) => sentence.isGrounded)
        .map((sentence) => sentence.text)
        .join(" ")
        .trim();
      if (kept) groundedParagraphs.push(kept);
    }
    const groundedText = groundedParagraphs.join("\n\n");

    if (!groundedText) {
      return fallback(summaryText, "all_ungrounded");
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
      droppedSentenceCount: droppedSentenceIssues.length,
      droppedSentenceIssues,
    };
  } catch {
    return fallback(summaryText, "generation_error");
  }
}
