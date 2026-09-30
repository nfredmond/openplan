import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseSynthesisGenerationTaskOutput, verifySynthesisGenerationTasks } from "./synthesis-generation-tasks";
import type { SynthesisSourceScope } from "./synthesis-sources-server";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const jobSchema = z.object({
  jobId: z.string().uuid(), planSha256: hash, configurationRevisionId: z.string().uuid(), configurationHash: hash,
  provider: z.enum(["anthropic", "api_connection", "codex", "claude", "opencode"]), modelId: z.string().min(1),
}).strict();
const selectionSchema = z.object({ taskSha256: hash, attemptId: z.string().uuid() }).strict();
const bindingSchema = jobSchema.merge(selectionSchema);
const tokenCount = z.number().int().nonnegative().safe().nullable();
const captureSchema = z.object({
  schemaVersion: z.literal(1), binding: bindingSchema,
  startedAt: z.string().datetime({ offset: true }), finishedAt: z.string().datetime({ offset: true }),
  outcome: z.enum(["returned", "failed", "interrupted"]),
  outputText: z.string().nullable(), providerReceiptText: z.string().nullable(), finishReason: z.string().nullable(), responseId: z.string().nullable(),
  inputTokens: tokenCount, outputTokens: tokenCount,
  failureCode: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/).nullable(),
}).strict();
const resultSchema = z.object({ canonical: z.string(), sha256: hash }).strict();
export type SynthesisGenerationJobBinding = z.infer<typeof jobSchema>;
export type SynthesisGenerationAttemptBinding = z.infer<typeof bindingSchema>;
export type SynthesisGenerationCapture = z.infer<typeof captureSchema>;
export type SynthesisGenerationResult = z.infer<typeof resultSchema>;

/** Serialize a capture for a separately authorized attempt. This function does not persist it or establish provider authenticity. */
export function createSynthesisGenerationResult(expected: SynthesisGenerationAttemptBinding, raw: unknown): SynthesisGenerationResult {
  const binding = bindingSchema.parse(expected);
  const capture = captureSchema.parse(raw);
  if (!isDeepStrictEqual(capture.binding, binding)) throw new Error("Synthesis result belongs to a different attempt");
  if (Date.parse(capture.finishedAt) < Date.parse(capture.startedAt)) throw new Error("Synthesis result chronology is invalid");
  if (capture.outcome === "returned" && capture.failureCode !== null) throw new Error("Synthesis result outcome contradicts its failure code");
  const canonical = JSON.stringify(capture);
  return { canonical, sha256: digest(canonical) };
}

export function verifySynthesisGenerationResult(expected: SynthesisGenerationAttemptBinding, raw: unknown) {
  const result = resultSchema.parse(raw);
  const capture = captureSchema.parse(JSON.parse(result.canonical));
  const verified = createSynthesisGenerationResult(expected, capture);
  if (!isDeepStrictEqual(result, verified)) throw new Error("Synthesis result differs from its retained capture");
  return { ...verified, capture };
}

type Disposition = "not_started" | "awaiting_result" | "failed" | "interrupted" | "invalid_output" |
  "provider_incomplete" | "incomplete_output" | "validated_output" | "not_required_empty_selection";
type Parsed = ReturnType<typeof parseSynthesisGenerationTaskOutput>;

/** Account for the ledger's explicitly selected attempts. Older attempts remain separate history.
 * The caller must load job identity and selections from the authorized durable ledger, not browser input.
 * Complete part accounting only prepares record/context consolidation; it never approves a synthesis.
 */
export function assembleSynthesisGenerationResults(args: {
  job: SynthesisGenerationJobBinding; selections: unknown; results: unknown;
  plan: unknown; records: unknown; input: unknown; saved: unknown;
  scope: SynthesisSourceScope; taskByteLimit: number;
}) {
  const job = jobSchema.parse(args.job);
  const plan = verifySynthesisGenerationTasks(args.plan, args.records, args.input, args.saved, args.scope, args.taskByteLimit);
  if (job.planSha256 !== plan.manifestSha256) throw new Error("Synthesis job names a different plan");
  const selections = z.array(selectionSchema).parse(args.selections);
  const supplied = z.array(resultSchema).parse(args.results);
  const tasks = new Map(plan.tasks.map(task => [task.sha256, task]));
  const selected = new Map<string, z.infer<typeof selectionSchema>>();
  const attemptIds = new Set<string>();
  for (const selection of selections) {
    if (!tasks.has(selection.taskSha256) || selected.has(selection.taskSha256) || attemptIds.has(selection.attemptId)) {
      throw new Error("Synthesis attempt selection is unknown or duplicated");
    }
    selected.set(selection.taskSha256, selection); attemptIds.add(selection.attemptId);
  }
  const empty = plan.contributionIds.length === 0;
  if (empty && selections.length) throw new Error("Empty synthesis selection does not require model attempts");
  const receipts = new Map<string, ReturnType<typeof verifySynthesisGenerationResult>>();
  for (const result of supplied) {
    const capture = captureSchema.parse(JSON.parse(result.canonical));
    const selection = selected.get(capture.binding.taskSha256);
    if (!selection || receipts.has(selection.taskSha256)) throw new Error("Synthesis result has no unique selected attempt");
    const verified = verifySynthesisGenerationResult({ ...job, ...selection }, result);
    receipts.set(selection.taskSha256, verified);
  }
  const entries = plan.tasks.map(task => {
    const { input } = JSON.parse(task.canonical) as { input: { recordId: string } };
    const selection = selected.get(task.sha256), receipt = receipts.get(task.sha256);
    let disposition: Disposition = empty ? "not_required_empty_selection" : selection ? "awaiting_result" : "not_started";
    let parsed: Parsed | null = null;
    if (receipt) {
      const capture = receipt.capture;
      if (capture.outcome !== "returned") disposition = capture.outcome;
      else {
        try { parsed = parseSynthesisGenerationTaskOutput(task, JSON.parse(capture.outputText ?? "")); } catch { parsed = null; }
        if (capture.finishReason !== "stop") disposition = "provider_incomplete";
        else if (!parsed) disposition = "invalid_output";
        else disposition = parsed.output.status === "complete" ? "validated_output" : "incomplete_output";
      }
    }
    return { taskIndex: task.index, taskSha256: task.sha256, recordId: input.recordId,
      attemptId: selection?.attemptId ?? null, receiptSha256: receipt?.sha256 ?? null, disposition, parsed };
  });
  const complete = entries.every(entry => entry.disposition === "validated_output");
  const retained = plan.tasks.flatMap(task => {
    const receipt = receipts.get(task.sha256);
    return receipt ? [{ canonical: receipt.canonical, sha256: receipt.sha256 }] : [];
  });
  const value = {
    schemaVersion: 1 as const, stage: "segment_results" as const, job,
    status: empty ? "empty_selection" as const : complete ? "ready_for_record_consolidation" as const : "incomplete" as const,
    interpretation: "not_assessed" as const, source: plan.source, contributionIds: plan.contributionIds,
    entries, results: retained,
  };
  const manifest = { ...value, results: retained.map(result => ({ sha256: result.sha256 })) };
  return { ...value, manifestSha256: digest(JSON.stringify(manifest)) };
}

export function verifySynthesisGenerationResults(raw: unknown, args: Parameters<typeof assembleSynthesisGenerationResults>[0]) {
  const expected = assembleSynthesisGenerationResults(args);
  if (!isDeepStrictEqual(raw, expected)) throw new Error("Synthesis result inventory differs from its retained inputs");
  return expected;
}
