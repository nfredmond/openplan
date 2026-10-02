import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { synthesisReviewGroupSchema } from "./synthesis-review";
import { verifySynthesisSource, type SynthesisSourceScope } from "./synthesis-sources-server";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const natural = z.number().int().nonnegative().safe();
const sourceId = z.string().regex(/^(item|answer):[a-f0-9-]{36}$/);
const text = z.string().refine(value => value.isWellFormed() && !value.includes("\0"), "Use valid text without NUL characters");
const label = text.refine(value => value.trim().length > 0, "Enter meaningful text");
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const citation = z.object({ noteId: natural, quote: label }).strict();
const membership = z.object({ sourceId, rationale: label, citations: z.array(citation).min(1) }).strict();
const unassigned = z.object({ sourceId, reason: label, citations: z.array(citation) }).strict();
const outputSchema = z.object({
  status: z.literal("complete"), title: label, notes: text,
  groups: z.array(synthesisReviewGroupSchema.omit({ sourceIds: true }).extend({ members: z.array(membership).min(1) }).strict()),
  unassigned: z.array(unassigned), uncertainties: z.array(label),
}).strict();
const evidenceSchema = z.object({
  sourceId, contextRequestId: z.string().uuid(), selectionSequence: natural,
  historyManifestSha256: hash, finalCaptureSha256: hash, finalResultSha256: hash,
  notes: z.array(z.object({ id: natural, text: z.string() }).strict()), uncertainties: z.array(z.string()),
}).strict();
const inputSchema = z.object({
  manifestSha256: hash, sourceId: z.string().uuid(), sourceSha256: hash,
  contexts: z.array(evidenceSchema),
}).strict();
const observationSchema = z.object({
  taskSha256: hash, outputText: z.string(), finishReason: z.literal("stop"),
}).strict();
export type SynthesisThematicProposalInput = z.infer<typeof inputSchema>;
export class SynthesisThematicOutputError extends Error {}

/** Compile a thematic response against a complete, already authenticated input
 * manifest. The future retained-input reader must reconstruct manifestSha256 and
 * every context from original history before calling this processor. These
 * supplied references are NOT signatures or execution permission. This function
 * checks content and coverage only; it cannot prove custody or semantic quality.
 * It neither writes a review nor changes an approval.
 */
export function createSynthesisThematicProposal(
  savedSource: unknown, scope: SynthesisSourceScope, rawInput: SynthesisThematicProposalInput,
  expectedTaskSha256: string, rawObservation: unknown,
) {
  const source = verifySynthesisSource(savedSource, scope), input = inputSchema.parse(rawInput);
  const expected = hash.parse(expectedTaskSha256);
  if (input.sourceId !== source.requestId || input.sourceSha256 !== source.snapshotSha256) throw new Error("Thematic input source differs");
  const sourceIds = [...source.snapshot.items.map(row => `item:${row.id}`), ...source.snapshot.answers.map(row => `answer:${row.id}`)].sort();
  const contexts = new Map(input.contexts.map(row => [row.sourceId, row]));
  if (!sourceIds.length) throw new Error("Empty synthesis source requires no model proposal");
  if (contexts.size !== input.contexts.length || !isDeepStrictEqual([...contexts.keys()].sort(), sourceIds)
    || new Set(input.contexts.map(row => row.contextRequestId)).size !== input.contexts.length) {
    throw new Error("Thematic input must bind one context per selected contribution");
  }
  for (const context of input.contexts) {
    if (context.notes.some((note, index) => note.id !== index)) throw new Error("Thematic context note identifiers differ");
  }
  const observation = observationSchema.safeParse(rawObservation);
  if (!observation.success || observation.data.taskSha256 !== expected) throw new SynthesisThematicOutputError("Thematic output is truncated or belongs to another task");
  if (Buffer.byteLength(observation.data.outputText, "utf8") > 4_194_304) throw new SynthesisThematicOutputError("Thematic output exceeds retention limit");
  let decoded: unknown;
  try { decoded = JSON.parse(observation.data.outputText); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new SynthesisThematicOutputError("Thematic output is not valid JSON", { cause: error });
  }
  const parsed = outputSchema.safeParse(decoded);
  if (!parsed.success) throw new SynthesisThematicOutputError("Thematic output schema differs", { cause: parsed.error });
  const output = parsed.data, frequencies = new Map<string, number>(), notAssigned = new Set<string>();
  const fail = (message: string): never => { throw new SynthesisThematicOutputError(message); };
  function checkCitations(member: { sourceId: string; citations: z.infer<typeof citation>[] }) {
    const context = contexts.get(member.sourceId);
    if (!context) return fail("Thematic output references an unknown contribution");
    const seen = new Set<string>();
    for (const reference of member.citations) {
      const key = JSON.stringify(reference);
      if (seen.has(key)) fail("Thematic output repeats a citation");
      seen.add(key);
      const note = context.notes[reference.noteId];
      if (!note || !note.text.includes(reference.quote)) fail("Thematic citation is not retained context evidence");
    }
  }
  if (new Set(output.groups.map(group => group.id)).size !== output.groups.length) fail("Thematic output repeats a group identifier");
  for (const group of output.groups) {
    if (new Set(group.members.map(member => member.sourceId)).size !== group.members.length) fail("Thematic group repeats a contribution");
    for (const member of group.members) {
      checkCitations(member);
      frequencies.set(member.sourceId, (frequencies.get(member.sourceId) ?? 0) + 1);
    }
  }
  for (const member of output.unassigned) {
    checkCitations(member);
    if (notAssigned.has(member.sourceId) || frequencies.has(member.sourceId)) fail("Thematic unassigned membership conflicts");
    notAssigned.add(member.sourceId);
  }
  if (sourceIds.some(id => !frequencies.has(id) && !notAssigned.has(id))) fail("Thematic output omits a selected contribution");
  const content = {
    schemaVersion: 1 as const, status: "machine_unreviewed" as const, sourceId: source.requestId, sourceSha256: source.snapshotSha256,
    inputManifestSha256: input.manifestSha256, taskSha256: expected,
    outputSha256: digest(observation.data.outputText), title: output.title, notes: output.notes,
    groups: output.groups.map(({ members, ...group }) => ({ ...group, sourceIds: members.map(member => member.sourceId).sort(), members })),
    unassigned: output.unassigned, assignedSourceCount: frequencies.size,
    overlappingSourceCount: [...frequencies.values()].filter(count => count > 1).length,
    unassignedSourceIds: [...notAssigned].sort(),
    // Machine prose cannot delete earlier uncertainty, including the absence of
    // usable contextual notes. Preserve each contribution and its exact wording.
    contextEvidence: [...input.contexts].sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0),
    thematicUncertainties: output.uncertainties,
  };
  const canonical = JSON.stringify(content);
  return { content, canonical, sha256: digest(canonical), outputText: observation.data.outputText };
}
