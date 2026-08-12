/**
 * ONE EXTRACTION RUN: pick the passages, ask the model, verify what comes back.
 *
 * Pure orchestration over an INJECTED text generator. The route supplies the
 * Anthropic call and the metering callback; this module supplies the order of
 * operations, the caps, the counts and the failure posture — which is why the
 * whole thing is unit-testable without mocking an SDK, and why the rules below
 * are provable rather than asserted.
 *
 * RETRIEVAL IS DETERMINISTIC AND DOCUMENT-SCOPED. Each target kind declares
 * lexical prefilter terms; passages are ranked by how many distinct terms they
 * contain, ties broken by the document's own order. "Why page 112?" has an
 * answer a planner can check: page 112 contains these words, and it was the Nth
 * such page.
 *
 * WHY NOT `kb_search_chunks`. The design memo named that RPC, and it is the
 * right door for its own job — screening-grade retrieval across a workspace's
 * corpus for a question. It is the wrong one here, for two reasons that are
 * visible in its definition (20260723000003): it takes no document parameter,
 * so it ranks THIS plan's pages against every other ready document in the
 * workspace; and it ends `LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 25)`,
 * a hard ceiling of twenty-five rows. Transcribing an adopted RTP means reading
 * the parts of ONE three-hundred-page document that contain money — twenty-five
 * workspace-wide rows would silently read a fraction of it, and some of what it
 * read would come from a different document entirely. Reading the document's
 * own chunks costs one indexed query per page of 1000 rows
 * (`idx_kb_document_chunks_document`) and removes both problems.
 *
 * FAILURE MEANS FAILURE. No key, a model error, or an answer that is not JSON
 * ends the run as `failed` with a NAMED reason and ZERO candidates. There is no
 * deterministic fallback, because the deterministic version of transcription is
 * a human typing, and a half-read plan presented as a finished one is precisely
 * the failure this feature exists to prevent. (Contrast
 * `lib/engagement/ai-synthesis.ts`, which DOES fall back — counting comments by
 * category without a model is a real, honest answer. There is no honest
 * offline answer to "what does page 112 say".)
 *
 * EVERY MODEL CALL IS METERED. `onModelCall` fires once per call, not once per
 * run: a three-hundred-page plan is many calls, and per-run metering would
 * understate spend by an order of magnitude.
 */

import {
  EXTRACTION_CHUNKS_PER_CALL,
  EXTRACTION_CHUNKS_PER_TARGET,
  EXTRACTION_MAX_MODEL_CALLS,
  RTP_EXTRACTION_TARGETS,
  buildExtractionPrompt,
  parseExtractionResponse,
  type ExtractionPassage,
  type RtpExtractionTargetKind,
} from "./contract";
import {
  countDiscardsByReason,
  verifyExtractionCandidates,
  type ExtractionBand,
  type RtpExtractionDiscard,
  type VerifiedExtractionCandidate,
} from "./verify";

/** The model call, injected. Returns the model's raw text. */
export type ExtractionGenerator = (params: {
  system: string;
  prompt: string;
  targetKind: RtpExtractionTargetKind;
}) => Promise<string>;

export const RTP_EXTRACTION_FAILURE_REASONS = [
  "model_error",
  "unreadable_model_answer",
  "call_budget_exhausted",
] as const;

export type RtpExtractionFailureReason = (typeof RTP_EXTRACTION_FAILURE_REASONS)[number];

/**
 * A NAMED reason and the words to show for it. `rtp_extraction_runs` refuses a
 * failed run with no reason (`rtp_extraction_runs_failure_reason_shape`), and
 * the 2026-08-10 modeling defect — a crashed run that read as benign because
 * nothing wrote its error — is why the sentence is composed here rather than
 * left to whichever screen notices.
 */
export function describeExtractionFailure(
  reason: RtpExtractionFailureReason,
  detail?: string | null
): string {
  const base: Record<RtpExtractionFailureReason, string> = {
    model_error: "The reading service did not answer, so nothing was transcribed from this document.",
    unreadable_model_answer:
      "The reading service answered in a form this deployment could not read, so nothing was transcribed from this document.",
    call_budget_exhausted:
      "This run reached the limit on how much of a document it may read in one go, before it finished.",
  };
  const trimmed = (detail ?? "").trim();
  return trimmed ? `${base[reason]} (${trimmed})` : base[reason];
}

export type ExtractionTargetOutcome = {
  targetKind: RtpExtractionTargetKind;
  /** Passages that matched this kind's terms, before the per-target cap. */
  passagesMatched: number;
  /** Passages actually sent to the model. */
  passagesRead: number;
  modelCalls: number;
  accepted: number;
  discarded: number;
};

export type RtpExtractionRunOutcome =
  | {
      status: "succeeded";
      candidates: VerifiedExtractionCandidate[];
      discarded: RtpExtractionDiscard[];
      discardsByReason: Record<string, number>;
      modelCalls: number;
      modelPageMismatches: number;
      unresolvedBandCount: number;
      perTarget: ExtractionTargetOutcome[];
    }
  | {
      status: "failed";
      failureReason: RtpExtractionFailureReason;
      failureMessage: string;
      modelCalls: number;
    };

/**
 * How many of a kind's terms a passage contains.
 *
 * Distinct terms, not occurrences: a page that says "revenue" forty times is
 * one signal, and a page that says "revenue", "sales tax" and "million" is
 * three. Matching is case-folded substring, which is cruder than the tsvector
 * the RPC uses (no stemming, no inverse document frequency) and is the price of
 * scoping to one document. It is also the reason the score is only a ranking:
 * every passage that matches at least one term is eligible, and the cap decides
 * how many are read.
 */
export function scorePassage(content: string, terms: readonly string[]): number {
  const folded = content.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (folded.includes(term.toLowerCase())) score += 1;
  }
  return score;
}

/** The passages one target kind reads, most term-dense first, document order breaking ties. */
export function selectPassagesForTarget(
  passages: readonly ExtractionPassage[],
  targetKind: RtpExtractionTargetKind,
  limit: number = EXTRACTION_CHUNKS_PER_TARGET
): { selected: ExtractionPassage[]; matched: number } {
  const terms = RTP_EXTRACTION_TARGETS[targetKind].prefilterTerms;
  const scored = passages
    .map((passage, index) => ({ passage, index, score: scorePassage(passage.content, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return { selected: scored.slice(0, limit).map((entry) => entry.passage), matched: scored.length };
}

function batch<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export async function runRtpExtraction(params: {
  passages: readonly ExtractionPassage[];
  targetKinds: readonly RtpExtractionTargetKind[];
  /** The cycle's own bands. For the VERIFIER's label resolution — never the prompt. */
  bands?: readonly ExtractionBand[];
  generate: ExtractionGenerator;
  /** Fires once per model call, before the answer is read. Metering. */
  onModelCall?: (targetKind: RtpExtractionTargetKind) => void;
  maxModelCalls?: number;
}): Promise<RtpExtractionRunOutcome> {
  const maxCalls = params.maxModelCalls ?? EXTRACTION_MAX_MODEL_CALLS;

  const candidates: VerifiedExtractionCandidate[] = [];
  const discarded: RtpExtractionDiscard[] = [];
  const perTarget: ExtractionTargetOutcome[] = [];
  let modelCalls = 0;

  for (const targetKind of params.targetKinds) {
    const { selected, matched } = selectPassagesForTarget(params.passages, targetKind);
    const outcome: ExtractionTargetOutcome = {
      targetKind,
      passagesMatched: matched,
      passagesRead: 0,
      modelCalls: 0,
      accepted: 0,
      discarded: 0,
    };
    perTarget.push(outcome);
    if (selected.length === 0) continue;

    for (const passageBatch of batch(selected, EXTRACTION_CHUNKS_PER_CALL)) {
      if (modelCalls >= maxCalls) {
        return {
          status: "failed",
          failureReason: "call_budget_exhausted",
          failureMessage: describeExtractionFailure(
            "call_budget_exhausted",
            `stopped after ${modelCalls} reads`
          ),
          modelCalls,
        };
      }

      const { system, prompt } = buildExtractionPrompt({ targetKind, passages: passageBatch });

      modelCalls += 1;
      outcome.modelCalls += 1;
      outcome.passagesRead += passageBatch.length;
      params.onModelCall?.(targetKind);

      let text: string;
      try {
        text = await params.generate({ system, prompt, targetKind });
      } catch (error) {
        return {
          status: "failed",
          failureReason: "model_error",
          failureMessage: describeExtractionFailure(
            "model_error",
            error instanceof Error ? error.message : String(error)
          ),
          modelCalls,
        };
      }

      const parsed = parseExtractionResponse(text);
      if (parsed === null) {
        return {
          status: "failed",
          failureReason: "unreadable_model_answer",
          failureMessage: describeExtractionFailure("unreadable_model_answer"),
          modelCalls,
        };
      }

      const verified = verifyExtractionCandidates({
        targetKind,
        candidates: parsed,
        passages: passageBatch,
        bands: params.bands,
      });
      candidates.push(...verified.accepted);
      discarded.push(...verified.discarded);
      outcome.accepted += verified.accepted.length;
      outcome.discarded += verified.discarded.length;
    }
  }

  return {
    status: "succeeded",
    candidates,
    discarded,
    discardsByReason: countDiscardsByReason(discarded),
    modelCalls,
    modelPageMismatches: candidates.filter((candidate) => candidate.modelPageMismatch).length,
    unresolvedBandCount: candidates.filter((candidate) => candidate.horizonBandUnresolved).length,
    perTarget,
  };
}
