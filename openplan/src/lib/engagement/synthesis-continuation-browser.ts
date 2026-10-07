import { z } from "zod";
import { synthesisContinuationCommandSchema, type SynthesisContinuationCommand } from "./synthesis-continuation-records";
import { inspectSynthesisGenerationRequest } from "./synthesis-generation-request-browser";
import type { SynthesisGenerationRequestScope } from "./synthesis-generation-request-records";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true }), text = z.string().max(4096).refine(value => new TextEncoder().encode(value).byteLength <= 4096);
const baseBinding = z.object({ schemaVersion: z.literal(1), parentRequestId: id, selectionSequence: z.number().int().nonnegative().safe(),
  segmentResultsManifestSha256: hash, contextManifestSha256: hash, frameByteLimit: z.number().int().min(4096).max(1_048_576) }).strict();
const contextBinding = baseBinding.extend({ contentManifestSha256: hash,
  targetRecordId: z.string().regex(/^(item|answer):[a-f0-9-]{36}$/) }).strict();
const contextRecord = z.object({ parentRequestId: id, contextText: text, contextSha256: hash, createdAt: date }).strict();
const thematicRecord = z.object({ parentRequestId: id, thematicText: text, thematicSha256: hash, createdAt: date }).strict();
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");

/** Verify the exact saved child and its parent binding before clearing browser
 * custody. A valid checksum alone does not establish native access or authorship.
 */
export async function inspectSynthesisContinuation(raw: unknown, scope: SynthesisGenerationRequestScope, rawCommand: SynthesisContinuationCommand) {
  const command = synthesisContinuationCommandSchema.parse(rawCommand);
  let base: Record<string, unknown>, binding: z.infer<typeof baseBinding>, savedParentId: string;
  if (command.stage === "context") {
    const { context, ...rest } = z.object({ context: contextRecord }).passthrough().parse(raw);
    if (await digest(context.contextText) !== context.contextSha256) throw new Error("Saved context bytes differ");
    const parsed = contextBinding.parse(JSON.parse(context.contextText));
    if (parsed.targetRecordId !== command.targetRecordId) throw new Error("Saved context contribution differs");
    base = rest; binding = parsed; savedParentId = context.parentRequestId;
  } else {
    const { thematic, ...rest } = z.object({ thematic: thematicRecord }).passthrough().parse(raw);
    if (await digest(thematic.thematicText) !== thematic.thematicSha256) throw new Error("Saved thematic bytes differ");
    base = rest; binding = baseBinding.parse(JSON.parse(thematic.thematicText)); savedParentId = thematic.parentRequestId;
  }
  if (savedParentId !== command.parent.parentRequestId || binding.parentRequestId !== savedParentId ||
    binding.selectionSequence !== command.parent.throughSequence || binding.segmentResultsManifestSha256 !== command.parent.segmentResultsManifestSha256 ||
    binding.frameByteLimit !== command.frameByteLimit || scope.requestId !== command.requestId) throw new Error("Saved continuation parent differs");
  const result = await inspectSynthesisGenerationRequest(base, scope);
  if (!result.state.request || result.state.request.intentText !== command.intentText ||
    result.intent?.sourceId !== command.parent.sourceId || result.intent.sourceSha256 !== command.parent.sourceSha256) throw new Error("Saved continuation source differs");
  return result;
}
