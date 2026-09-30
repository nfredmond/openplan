import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import frozenRecipe from "./synthesis-generation-context-v1.json";
import { createSynthesisGenerationContextContent } from "./synthesis-generation-context-content";
import { verifySynthesisContextRequest } from "./synthesis-context-requests-server";

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/), index = z.number().int().nonnegative().safe();
// JSON Schema maxLength counts Unicode code points, not UTF-16 code units.
const textSchema = z.string().min(1).refine(text => Array.from(text).length <= 4000, "Context text exceeds 4000 code points");
const citationSchema = z.object({ partId: hash, quote: textSchema }).strict();
const noteSchema = z.object({ id: index, text: textSchema,
  citations: z.array(citationSchema).min(1), relatedNoteIds: z.array(index) }).strict();
const outputSchema = z.object({ status: z.enum(["complete", "incomplete"]), coveredPartIds: z.array(hash),
  notes: z.array(noteSchema), uncertainties: z.array(textSchema) }).strict();
const observationSchema = z.object({ taskSha256: hash, outputText: z.string(), finishReason: z.string().nullable() }).strict();
const resultSchema = z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_context_step_result"),
  requestId: z.string().uuid(), headerSha256: hash, frameIndex: index, taskSha256: hash,
  previousResultSha256: hash.nullable(), outputText: z.string(), outputSha256: hash,
  finishReason: z.literal("stop") }).strict();
const retainedSchema = z.object({ canonical: z.string(), sha256: hash }).strict();
type Scope = Parameters<typeof verifySynthesisContextRequest>[1];
type ContentArgs = Parameters<typeof createSynthesisGenerationContextContent>;
type FramePart = { id: string; text?: string };
type Retained = z.infer<typeof retainedSchema>;

/** Frozen separately from segment v1. Neither recipe identity nor a request
 * provides dispatch permission; the future native executor must bind both.
 */
export function synthesisContextRecipe() {
  return { ...structuredClone(frozenRecipe), sha256: digest(JSON.stringify(frozenRecipe)) };
}

/** Reconstruct every frame from original inputs, then compare the requested
 * identities. The plan permits no clipped frame or substituted self-hashed input.
 */
export function createSynthesisContextPlan(rawRequest: unknown, scope: Scope, contentArgs: ContentArgs) {
  const request = verifySynthesisContextRequest(rawRequest, scope);
  const content = createSynthesisGenerationContextContent(...contentArgs), binding = request.binding;
  if (content.inputStatus !== "ready_for_context_processing" || !content.frames.length ||
    !content.contributionIds.includes(content.targetRecordId)) throw new Error("Context plan requires complete contribution inputs");
  if (content.source.campaignId !== request.state.campaignId || content.source.workspaceId !== request.state.workspaceId ||
    binding.parentRequestId !== content.requestId || binding.selectionSequence !== content.selectionSequence ||
    binding.segmentResultsManifestSha256 !== content.segmentResultsManifestSha256 ||
    binding.contextManifestSha256 !== content.contextManifestSha256 || binding.contentManifestSha256 !== content.manifestSha256 ||
    binding.targetRecordId !== content.targetRecordId || binding.frameByteLimit !== content.frameByteLimit ||
    request.intent.sourceId !== content.source.requestId || request.intent.sourceSha256 !== content.source.sha256) {
    throw new Error("Context plan differs from requested inputs");
  }
  const recipe = synthesisContextRecipe();
  const header = { schemaVersion: 1, purpose: "private_synthesis_context_continuation_plan", requestId: request.state.request.id,
    actorId: request.state.request.actorId,
    intentSha256: request.state.request.intentSha256, contextRequestSha256: request.state.context.contextSha256,
    recipeId: recipe.id, recipeSha256: recipe.sha256, contentManifestSha256: content.manifestSha256,
    targetRecordId: content.targetRecordId, frameCount: content.frames.length, taskByteLimit: request.intent.taskByteLimit };
  const headerText = JSON.stringify(header);
  return { header, headerText, headerSha256: digest(headerText), content };
}

/** Replay checked continuation bytes before preparing the next frame. Native
 * custody and original-provider-response verification remain the caller's duty.
 * This pure processor makes no network call and grants no execution authority.
 * Every step carries the whole preceding output. A byte ceiling stops progress
 * explicitly rather than truncating source, prior notes or uncertainty.
 */
export function createSynthesisContextContinuation(rawRequest: unknown, scope: Scope, contentArgs: ContentArgs,
  retainedSteps: readonly unknown[] = [],
) {
  const plan = createSynthesisContextPlan(rawRequest, scope, contentArgs), recipe = synthesisContextRecipe();
  const frames = plan.content.frames.map(frame => ({ ...frame, parts: (JSON.parse(frame.canonical) as { parts: FramePart[] }).parts }));
  const saved: Retained[] = [], seenParts = new Map<string, FramePart>();
  let previousOutput: z.infer<typeof outputSchema> | null = null;
  let previousOutputText: string | null = null;

  function next() {
    const frameIndex = saved.length, frame = frames[frameIndex], previousResultSha256 = saved.at(-1)?.sha256 ?? null;
    if (!frame) return { status: "frames_complete" as const, frameCount: frames.length, previousResultSha256,
      outputText: previousOutputText, interpretation: "machine_unreviewed" as const };
    const canonical = JSON.stringify({ schemaVersion: 1, instructions: recipe.instructions,
      input: { purpose: "private_synthesis_context_continuation", requestId: plan.header.requestId, headerSha256: plan.headerSha256,
        contentManifestSha256: plan.content.manifestSha256, targetRecordId: plan.content.targetRecordId,
        frameCount: frames.length, frame: JSON.parse(frame.canonical),
        previous: previousOutputText === null ? null : { resultSha256: previousResultSha256, outputText: previousOutputText } },
      outputSchema: recipe.outputSchema });
    const utf8Bytes = Buffer.byteLength(canonical, "utf8");
    if (utf8Bytes > plan.header.taskByteLimit) return { status: "resource_limit" as const, frameIndex,
      requiredTaskBytes: utf8Bytes, taskByteLimit: plan.header.taskByteLimit, previousResultSha256 };
    return { status: "ready" as const, frameIndex, previousResultSha256,
      task: { canonical, sha256: digest(canonical), utf8Bytes } };
  }

  function accept(raw: unknown) {
    const task = next();
    if (task.status !== "ready") throw new Error("Context continuation has no executable next frame");
    const observation = observationSchema.parse(raw);
    if (observation.taskSha256 !== task.task.sha256 || observation.finishReason !== "stop") {
      throw new Error("Context continuation output is truncated or belongs to another task");
    }
    if (Buffer.byteLength(observation.outputText, "utf8") > 4_194_304) throw new Error("Context continuation output exceeds retention limit");
    const output = outputSchema.parse(JSON.parse(observation.outputText)), frame = frames[task.frameIndex];
    if (output.status !== "complete" || !isDeepStrictEqual(output.coveredPartIds, frame.parts.map(part => part.id))) {
      throw new Error("Context continuation frame coverage is incomplete");
    }
    const oldNotes = previousOutput?.notes ?? [], oldUncertainties = previousOutput?.uncertainties ?? [];
    if (!isDeepStrictEqual(output.notes.slice(0, oldNotes.length), oldNotes) ||
      !isDeepStrictEqual(output.uncertainties.slice(0, oldUncertainties.length), oldUncertainties)) {
      throw new Error("Context continuation discarded or rewrote preceding state");
    }
    const available = new Map(seenParts);
    for (const part of frame.parts) available.set(part.id, part);
    for (const [noteIndex, note] of output.notes.entries()) {
      if (note.id !== noteIndex || new Set(note.relatedNoteIds).size !== note.relatedNoteIds.length ||
        note.relatedNoteIds.some(id => id >= note.id)) throw new Error("Context continuation note references differ");
      for (const citation of note.citations) {
        const part = available.get(citation.partId);
        if (typeof part?.text !== "string" || !part.text.includes(citation.quote)) throw new Error("Context continuation citation is not retained evidence");
      }
    }
    const result = { schemaVersion: 1, purpose: "private_synthesis_context_step_result", requestId: plan.header.requestId,
      headerSha256: plan.headerSha256, frameIndex: task.frameIndex, taskSha256: task.task.sha256,
      previousResultSha256: task.previousResultSha256, outputText: observation.outputText,
      outputSha256: digest(observation.outputText), finishReason: "stop" };
    const canonical = JSON.stringify(result), retained = { canonical, sha256: digest(canonical) };
    saved.push(retained); previousOutput = output; previousOutputText = observation.outputText;
    for (const part of frame.parts) seenParts.set(part.id, part);
    return { ...retained };
  }

  for (const raw of z.array(z.unknown()).parse(retainedSteps)) {
    const retained = retainedSchema.parse(raw), result = resultSchema.parse(JSON.parse(retained.canonical));
    if (digest(retained.canonical) !== retained.sha256 || digest(result.outputText) !== result.outputSha256 ||
      result.requestId !== plan.header.requestId || result.headerSha256 !== plan.headerSha256 || result.frameIndex !== saved.length ||
      result.previousResultSha256 !== (saved.at(-1)?.sha256 ?? null)) throw new Error("Retained context continuation identity differs");
    const replayed = accept({ taskSha256: result.taskSha256, outputText: result.outputText, finishReason: result.finishReason });
    if (!isDeepStrictEqual(replayed, retained)) throw new Error("Retained context continuation bytes differ");
  }
  return { headerText: plan.headerText, headerSha256: plan.headerSha256, next, accept,
    retained: () => saved.map(value => ({ ...value })) };
}
