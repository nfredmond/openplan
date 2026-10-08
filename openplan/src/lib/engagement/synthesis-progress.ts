import { z } from "zod";
import { synthesisExecutionScopeSchema, type SynthesisExecutionScope } from "./synthesis-execution-records";

const natural = z.number().int().nonnegative().safe();
export const synthesisTaskDispositionSchema = z.enum(["not_started", "awaiting_result", "failed", "interrupted",
  "invalid_output", "provider_incomplete", "incomplete_output", "validated_output", "not_required_empty_selection",
  "unselected", "cleared", "claimed", "awaiting_output", "predecessor_changed", "blocked_by_predecessor", "resource_limit", "verified"]);
const segmentStates = ["empty_selection", "ready_for_record_consolidation", "incomplete", "not_prepared", "staging"] as const;
const contextStates = ["not_prepared", "staging", "incomplete", "frames_complete"] as const;
const thematicStates = ["inputs_not_sealed", "not_prepared", "staging", "incomplete", "proposal_complete"] as const;
export const synthesisProgressSchema = synthesisExecutionScopeSchema.extend({ schemaVersion: z.literal(1),
  resourceAssessment: z.object({ taskIndex: natural, requiredTaskBytes: natural,
    taskByteLimit: z.number().int().min(4096).max(1048576) }).strict().nullable().optional(),
  checkedAt: z.string().datetime({ offset: true }), cancelled: z.boolean(),
  status: z.enum([...segmentStates, ...contextStates, ...thematicStates]),
  interpretation: z.enum(["not_assessed", "machine_unreviewed"]),
  selectionSequence: natural.nullable(), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  taskCount: natural.nullable(), counts: z.array(z.object({ disposition: synthesisTaskDispositionSchema, count: natural.positive() }).strict()).max(18),
}).strict();
export type SynthesisProgress = z.infer<typeof synthesisProgressSchema>;

/** Check response scope and accounting before displaying private progress.
 * Only authenticated server reconstruction establishes original-output custody.
 */
export function verifySynthesisProgress(raw: unknown, scope: SynthesisExecutionScope): SynthesisProgress {
  const expected = synthesisExecutionScopeSchema.parse(scope), value = synthesisProgressSchema.parse(raw);
  if (Object.keys(expected).some(key => value[key as keyof SynthesisExecutionScope] !== expected[key as keyof SynthesisExecutionScope])) {
    throw new Error("Analysis progress belongs to another request or source");
  }
  const allowed: readonly string[] = value.stage === "segment" ? segmentStates : value.stage === "context" ? contextStates : thematicStates;
  const segmentDispositions = new Set(["not_started", "awaiting_result", "failed", "interrupted", "invalid_output", "provider_incomplete", "incomplete_output", "validated_output", "not_required_empty_selection"]);
  const continuationDispositions = new Set(["unselected", "cleared", "claimed", "awaiting_output", "provider_incomplete", "invalid_output", "predecessor_changed", "blocked_by_predecessor", "resource_limit", "verified"]);
  const seen = new Set<string>();
  let total = 0;
  for (const row of value.counts) {
    if (seen.has(row.disposition)) throw new Error("Analysis progress repeats a task state");
    if (!(value.stage === "segment" ? segmentDispositions : continuationDispositions).has(row.disposition)) throw new Error("Analysis progress has a different stage's task state");
    seen.add(row.disposition); total += row.count;
  }
  const unprepared = ["inputs_not_sealed", "not_prepared", "staging"].includes(value.status);
  if (!allowed.includes(value.status) || value.interpretation !== (value.stage === "segment" ? "not_assessed" : "machine_unreviewed") ||
    !Number.isSafeInteger(total) || (unprepared ? value.taskCount !== null || total !== 0 || value.selectionSequence !== null : value.taskCount === null || total !== value.taskCount)) {
    throw new Error("Analysis progress accounting differs");
  }
  const completed = value.status === "ready_for_record_consolidation" || value.status === "frames_complete" || value.status === "proposal_complete";
  const success = value.stage === "segment" ? "validated_output" : "verified";
  if (completed && (!value.taskCount || value.counts.some(row => row.disposition !== success))) throw new Error("Analysis progress completion differs");
  if (value.status === "empty_selection" && value.counts.some(row => row.disposition !== "not_required_empty_selection")) throw new Error("Empty selection contains required execution");
  const assessment = value.resourceAssessment;
  if (assessment && (value.stage === "segment" || value.status !== "incomplete" || value.taskCount === null ||
    assessment.taskIndex >= value.taskCount || assessment.requiredTaskBytes <= assessment.taskByteLimit)) {
    throw new Error("Analysis resource assessment differs");
  }
  return value;
}
