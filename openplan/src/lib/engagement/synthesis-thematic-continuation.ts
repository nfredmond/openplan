import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import frozenRecipe from "./synthesis-generation-thematic-v1.json";
import { createSynthesisThematicContent, reconstructSynthesisThematicContent, type SynthesisThematicPart, type SynthesisThematicPreparedInputs } from "./synthesis-thematic-content";
import { createSynthesisThematicProposal, SynthesisThematicOutputError } from "./synthesis-thematic-proposal";

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/), index = z.number().int().nonnegative().safe();
const text = z.string().min(1).refine(value => Array.from(value).length <= 4000, "Thematic text exceeds 4000 code points");
const uncertainty = text.refine(value => value.isWellFormed() && !value.includes("\0") && value.trim().length > 0, "Use valid thematic uncertainty text");
const outputSchema = z.object({ status: z.enum(["complete", "incomplete"]), coveredPartIds: z.array(hash),
  notes: z.array(z.object({ id: index, text, citations: z.array(z.object({ partId: hash, quote: text }).strict()).min(1),
    relatedNoteIds: z.array(index) }).strict()), uncertainties: z.array(uncertainty) }).strict();
const observationSchema = z.object({ taskSha256: hash, outputText: z.string(), finishReason: z.string().nullable() }).strict();
const resultSchema = z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_thematic_step_result"),
  requestId: z.string().uuid(), headerSha256: hash, taskIndex: index, taskSha256: hash,
  previousResultSha256: hash.nullable(), outputText: z.string(), outputSha256: hash, finishReason: z.literal("stop") }).strict();
const retainedSchema = z.object({ canonical: z.string(), sha256: hash }).strict();
type Retained = z.infer<typeof retainedSchema>;

/** Frozen independently from existing segment and context recipes. */
export function synthesisThematicRecipe() { return { ...structuredClone(frozenRecipe), sha256: digest(JSON.stringify(frozenRecipe)) }; }

/** Bind original content, complete seal, actor, request and recipe before a
 * separate native staging/execution grant. This pure plan authorizes no calls.
 */
export function createSynthesisThematicPlan(prepared: SynthesisThematicPreparedInputs) {
  return planForContent(createSynthesisThematicContent(prepared));
}

/** Reconstruct the frozen historical plan without clearing cancellation. */
export function reconstructSynthesisThematicPlan(prepared: SynthesisThematicPreparedInputs) {
  return planForContent(reconstructSynthesisThematicContent(prepared));
}

function planForContent(content: ReturnType<typeof createSynthesisThematicContent>) {
  const recipe = synthesisThematicRecipe(), request = content.request;
  const header = { schemaVersion: 1, purpose: "private_synthesis_thematic_continuation_plan", requestId: request.state.request.id,
    actorId: request.state.request.actorId, intentSha256: request.state.request.intentSha256,
    thematicRequestSha256: request.state.thematic.thematicSha256, inputManifestSha256: content.manifest.inputManifestSha256,
    inputSealSha256: content.manifest.inputSealSha256, recipeId: recipe.id, recipeSha256: recipe.sha256,
    contentManifestSha256: content.manifestSha256, frameCount: content.frames.length, taskCount: content.frames.length + 1,
    taskByteLimit: request.intent.taskByteLimit };
  const headerText = JSON.stringify(header);
  return { header, headerText, headerSha256: digest(headerText), content };
}

/** Replay every retained response before the next bounded frame or final
 * proposal task. Earlier notes/uncertainty remain unchanged, and final conversion
 * checks complete source membership and original contextual quotations. Native
 * original-response custody and current execution authority remain separate.
 */
export function createSynthesisThematicContinuation(prepared: SynthesisThematicPreparedInputs, retainedSteps: readonly unknown[] = []) {
  return continuePlan(createSynthesisThematicPlan(prepared), retainedSteps);
}

/** Inspect original historical responses without authorizing new work. */
export function replaySynthesisThematicContinuation(prepared: SynthesisThematicPreparedInputs, retainedSteps: readonly unknown[] = []) {
  return continuePlan(reconstructSynthesisThematicPlan(prepared), retainedSteps);
}

function continuePlan(plan: ReturnType<typeof createSynthesisThematicPlan>, retainedSteps: readonly unknown[]) {
  const recipe = synthesisThematicRecipe();
  const frames = plan.content.frames.map(frame => ({ ...frame, parts: (JSON.parse(frame.canonical) as { parts: SynthesisThematicPart[] }).parts }));
  const saved: Retained[] = [], seenParts = new Map<string, SynthesisThematicPart>();
  let previousOutput: z.infer<typeof outputSchema> | null = null, previousOutputText: string | null = null;
  let proposal: ReturnType<typeof createSynthesisThematicProposal> | null = null;
  function next() {
    const taskIndex = saved.length, previousResultSha256 = saved.at(-1)?.sha256 ?? null;
    if (proposal !== null) return { status: "proposal_complete" as const, taskCount: plan.header.taskCount,
      previousResultSha256, proposal: structuredClone(proposal), interpretation: "machine_unreviewed" as const };
    const frame = frames[taskIndex], stage = frame ? "frame" as const : "proposal" as const;
    const input = { purpose: "private_synthesis_thematic_continuation", requestId: plan.header.requestId,
      headerSha256: plan.headerSha256, inputManifestSha256: plan.header.inputManifestSha256,
      contentManifestSha256: plan.content.manifestSha256, taskIndex, frameCount: frames.length, stage,
      previous: previousOutputText === null ? null : { resultSha256: previousResultSha256, outputText: previousOutputText },
      ...(frame ? { frame: JSON.parse(frame.canonical) } : { contexts: plan.content.input.contexts }) };
    const canonical = JSON.stringify({ schemaVersion: 1, instructions: frame ? recipe.frameInstructions : recipe.proposalInstructions,
      input, outputSchema: frame ? recipe.frameOutputSchema : recipe.proposalOutputSchema });
    const utf8Bytes = Buffer.byteLength(canonical, "utf8");
    if (utf8Bytes > plan.header.taskByteLimit) return { status: "resource_limit" as const, taskIndex, stage,
      requiredTaskBytes: utf8Bytes, taskByteLimit: plan.header.taskByteLimit, previousResultSha256 };
    return { status: "ready" as const, taskIndex, stage, previousResultSha256,
      task: { canonical, sha256: digest(canonical), utf8Bytes } };
  }
  function accept(raw: unknown) {
    const task = next();
    if (task.status !== "ready") throw new Error("Thematic continuation has no executable next task");
    const observation = observationSchema.parse(raw);
    if (observation.taskSha256 !== task.task.sha256 || observation.finishReason !== "stop") {
      throw new SynthesisThematicOutputError("Thematic continuation output is truncated or belongs to another task");
    }
    if (Buffer.byteLength(observation.outputText, "utf8") > 4_194_304) throw new SynthesisThematicOutputError("Thematic continuation output exceeds retention limit");
    let decoded: unknown;
    try { decoded = JSON.parse(observation.outputText); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new SynthesisThematicOutputError("Thematic continuation output is not valid JSON", { cause: error });
    }
    let frameOutput: z.infer<typeof outputSchema> | null = null;
    let proposed: typeof proposal = null;
    if (task.stage === "frame") {
      const parsed = outputSchema.safeParse(decoded);
      if (!parsed.success) throw new SynthesisThematicOutputError("Thematic continuation output schema differs", { cause: parsed.error });
      const output = parsed.data, frame = frames[task.taskIndex];
      if (output.status !== "complete" || !isDeepStrictEqual(output.coveredPartIds, frame.parts.map(part => part.id))) {
        throw new SynthesisThematicOutputError("Thematic continuation frame coverage is incomplete");
      }
      if (!isDeepStrictEqual(output.notes.slice(0, previousOutput?.notes.length ?? 0), previousOutput?.notes ?? [])
        || !isDeepStrictEqual(output.uncertainties.slice(0, previousOutput?.uncertainties.length ?? 0), previousOutput?.uncertainties ?? [])) {
        throw new SynthesisThematicOutputError("Thematic continuation discarded or rewrote preceding state");
      }
      const available = new Map(seenParts); for (const part of frame.parts) available.set(part.id, part);
      for (const [noteIndex, note] of output.notes.entries()) {
        if (note.id !== noteIndex || new Set(note.relatedNoteIds).size !== note.relatedNoteIds.length || note.relatedNoteIds.some(id => id >= note.id)) {
          throw new SynthesisThematicOutputError("Thematic continuation note references differ");
        }
        for (const citation of note.citations) {
          const part = available.get(citation.partId);
          if (!part || !("text" in part) || !part.text.includes(citation.quote)) throw new SynthesisThematicOutputError("Thematic continuation citation is not retained evidence");
        }
      }
      frameOutput = output;
    } else {
      proposed = createSynthesisThematicProposal(plan.content.source, { requestId: plan.content.source.requestId,
        campaignId: plan.content.source.campaignId, workspaceId: plan.content.source.workspaceId }, plan.content.input, task.task.sha256, observation);
      if (!isDeepStrictEqual(proposed.content.thematicUncertainties.slice(0, previousOutput?.uncertainties.length ?? 0), previousOutput?.uncertainties ?? [])) {
        throw new SynthesisThematicOutputError("Thematic proposal discarded or rewrote preceding uncertainty");
      }
    }
    const result = { schemaVersion: 1, purpose: "private_synthesis_thematic_step_result", requestId: plan.header.requestId,
      headerSha256: plan.headerSha256, taskIndex: task.taskIndex, taskSha256: task.task.sha256,
      previousResultSha256: task.previousResultSha256, outputText: observation.outputText,
      outputSha256: digest(observation.outputText), finishReason: "stop" };
    const canonical = JSON.stringify(result), retained = { canonical, sha256: digest(canonical) };
    saved.push(retained); previousOutputText = observation.outputText;
    if (frameOutput) { previousOutput = frameOutput; for (const part of frames[task.taskIndex].parts) seenParts.set(part.id, part); }
    proposal = proposed;
    return { ...retained };
  }
  for (const raw of z.array(z.unknown()).parse(retainedSteps)) {
    const retained = retainedSchema.parse(raw), result = resultSchema.parse(JSON.parse(retained.canonical));
    if (digest(retained.canonical) !== retained.sha256 || digest(result.outputText) !== result.outputSha256
      || result.requestId !== plan.header.requestId || result.headerSha256 !== plan.headerSha256 || result.taskIndex !== saved.length
      || result.previousResultSha256 !== (saved.at(-1)?.sha256 ?? null)) throw new Error("Retained thematic continuation identity differs");
    if (!isDeepStrictEqual(accept({ taskSha256: result.taskSha256, outputText: result.outputText, finishReason: result.finishReason }), retained)) {
      throw new Error("Retained thematic continuation bytes differ");
    }
  }
  return { headerText: plan.headerText, headerSha256: plan.headerSha256, next, accept, retained: () => saved.map(row => ({ ...row })) };
}
