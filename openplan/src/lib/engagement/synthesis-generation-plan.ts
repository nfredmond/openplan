import { createHash } from "node:crypto";
import { z } from "zod";
import { createSynthesisGenerationInput } from "./synthesis-generation-input";
import { createSynthesisGenerationRecords } from "./synthesis-generation-records";
import { createSynthesisGenerationTasks } from "./synthesis-generation-tasks";
import { synthesisGenerationSegmentRecipe } from "./synthesis-generation-recipe";
import type { SynthesisSourceScope } from "./synthesis-sources-server";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const natural = z.number().int().nonnegative().safe();
const intentSchema = z.object({
  schemaVersion: z.literal(1), sourceId: z.string().uuid(), sourceSha256: hash,
  connectionId: z.string().uuid(), configurationRevisionId: z.string().uuid(), configurationHash: hash,
  modelId: z.string().min(1).max(160).regex(/^\S+$/), taskByteLimit: z.number().int().min(4096).max(1_048_576),
}).strict();
const requestSchema = z.object({ id: z.string().uuid(), intentText: z.string(), intentSha256: hash }).strict();
export { intentSchema as synthesisGenerationRequestIntentSchema };
const stateSchema = z.object({
  schemaVersion: z.literal(1), requestId: z.string().uuid(), headerText: z.string(), headerSha256: hash,
  nextIndex: natural, taskBytes: natural, tailSha256: hash, cancelled: z.boolean(),
  seal: z.object({ receiptText: z.string(), receiptSha256: hash }).strict().nullable(),
}).strict();
export const SYNTHESIS_PLAN_BATCH_BYTES = 4 * 1024 * 1024;
export const SYNTHESIS_PLAN_BATCH_TASKS = 128;

/** Reconstruct a deterministic plan from a native request and its authoritative saved source.
 * This remains memory resident. The database stores bounded batches outside browser requests.
 * A plan prepares work; it grants no permission to spend, dispatch, adopt or publish.
 */
export function createSynthesisGenerationPlan(rawRequest: unknown, saved: unknown, scope: SynthesisSourceScope) {
  const request = requestSchema.parse(rawRequest);
  if (digest(request.intentText) !== request.intentSha256) throw new Error("Synthesis request checksum differs");
  const intent = intentSchema.parse(JSON.parse(request.intentText));
  const input = createSynthesisGenerationInput(saved, scope);
  const records = createSynthesisGenerationRecords(input, saved, scope);
  if (intent.sourceId !== scope.requestId || intent.sourceSha256 !== records.source.sha256) throw new Error("Synthesis request source differs");
  const taskPlan = createSynthesisGenerationTasks(records, input, saved, scope, intent.taskByteLimit);
  const recipe = synthesisGenerationSegmentRecipe();
  const seedSha256 = digest(`synthesis-plan-v1:${request.id}:${request.intentSha256}:${recipe.sha256}:${taskPlan.manifestSha256}`);
  let tail = seedSha256, bytes = 0;
  const entries = taskPlan.tasks.map(task => {
    const previousSha256 = tail;
    tail = digest(`${tail}:${task.index}:${task.sha256}:${task.utf8Bytes}`);
    bytes += task.utf8Bytes;
    if (!Number.isSafeInteger(bytes)) throw new Error("Synthesis plan byte count exceeds exact integer range");
    return { ...task, previousSha256, chainSha256: tail, cumulativeBytes: bytes };
  });
  const header = {
    schemaVersion: 1, purpose: "private_synthesis_segment_plan", requestId: request.id, intentSha256: request.intentSha256,
    recipeId: recipe.id, recipeSha256: recipe.sha256, taskManifestSha256: taskPlan.manifestSha256,
    taskCount: entries.length, taskBytes: bytes, contributionCount: taskPlan.contributionIds.length, tailSha256: tail,
  };
  const headerText = JSON.stringify(header);
  return { header, headerText, headerSha256: digest(headerText), seedSha256, entries, taskPlan };
}
export type SynthesisGenerationPlan = ReturnType<typeof createSynthesisGenerationPlan>;

/** Compare a retained cursor to the reconstructed prefix before resuming or accepting a seal.
 * This proves byte custody, not semantic quality or authorization for a provider call.
 */
export function verifySynthesisGenerationPlanState(plan: SynthesisGenerationPlan, raw: unknown) {
  const state = stateSchema.parse(raw);
  if (state.requestId !== plan.header.requestId || state.headerText !== plan.headerText || state.headerSha256 !== plan.headerSha256 ||
    state.nextIndex > plan.entries.length) throw new Error("Retained synthesis plan differs");
  const last = plan.entries[state.nextIndex - 1];
  if (state.taskBytes !== (last?.cumulativeBytes ?? 0) || state.tailSha256 !== (last?.chainSha256 ?? plan.seedSha256)) throw new Error("Retained synthesis plan prefix differs");
  if (state.seal) {
    if (state.nextIndex !== plan.entries.length || digest(state.seal.receiptText) !== state.seal.receiptSha256) throw new Error("Synthesis plan seal is incomplete or corrupt");
    const receipt = z.object({
      schemaVersion: z.literal(1), requestId: z.literal(plan.header.requestId), headerSha256: z.literal(plan.headerSha256),
      taskCount: z.literal(plan.header.taskCount), taskBytes: z.literal(plan.header.taskBytes), tailSha256: z.literal(plan.header.tailSha256),
      sealedAt: z.iso.datetime({ offset: true }),
    }).strict();
    receipt.parse(JSON.parse(state.seal.receiptText));
  }
  return state;
}

/** An acknowledged batch is atomic. Retrying the exact batch cannot append duplicate tasks. */
export function synthesisGenerationPlanBatch(plan: SynthesisGenerationPlan, start: number) {
  natural.max(plan.entries.length).parse(start);
  if (start === plan.entries.length) return null;
  const texts: string[] = [];
  let tasksText = "[]";
  for (const task of plan.entries.slice(start, start + SYNTHESIS_PLAN_BATCH_TASKS)) {
    const candidate = JSON.stringify([...texts, task.canonical]);
    if (Buffer.byteLength(candidate, "utf8") > SYNTHESIS_PLAN_BATCH_BYTES) break;
    texts.push(task.canonical); tasksText = candidate;
  }
  if (!texts.length) throw new Error("Synthesis task exceeds the staging packet limit");
  return { start, previousSha256: plan.entries[start].previousSha256, tasksText, nextIndex: start + texts.length };
}
