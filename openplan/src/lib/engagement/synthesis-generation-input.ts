import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { prepareSynthesisSource } from "./synthesis-preparation";
import { verifySynthesisSource, type SynthesisSourceScope } from "./synthesis-sources-server";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const natural = z.number().int().nonnegative().safe();
const frameLimit = z.number().int().min(256).max(1_048_576);
const sourceId = z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const partAddress = z.object({
  index: natural, byteStart: natural, byteEnd: natural, sha256: digest,
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_generation_input"),
  source: z.object({ requestId: z.string().uuid(), campaignId: z.string().uuid(), workspaceId: z.string().uuid(),
    sha256: digest, utf8Bytes: natural }).strict(),
  frameByteLimit: frameLimit,
  coverage: z.object({
    sourceIds: z.array(sourceId), comments: natural, replies: natural, answers: natural,
    sessions: natural, sessionsWithoutSelectedAnswers: natural,
    interpretation: z.literal("not_assessed"),
  }).strict(),
  parts: z.array(partAddress).min(1),
}).strict();
const partSchema = partAddress.extend({ text: z.string().min(1) }).strict();
const inputSchema = z.object({ manifestText: z.string(), manifestSha256: digest, parts: z.array(partSchema).min(1) }).strict();
export type SynthesisGenerationInput = z.infer<typeof inputSchema>;
export type SynthesisGenerationInputManifest = z.infer<typeof manifestSchema>;
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

// Split only transport frames, never the selected source inventory or its text.
// Frames are continuations of one JSON document, not independent model prompts.
// Keep original JSON bytes, including numeric spellings and historical values.
function splitSource(text: string, limit: number) {
  if (!text.isWellFormed()) throw new Error("Synthesis input has invalid Unicode");
  const parts: SynthesisGenerationInput["parts"] = [];
  let start = 0, end = 0, bytes = 0, byteStart = 0;
  const retain = () => {
    const fragment = text.slice(start, end);
    parts.push({ index: parts.length, byteStart, byteEnd: byteStart + bytes, sha256: sha256(fragment), text: fragment });
    start = end; byteStart += bytes; bytes = 0;
  };
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > limit) retain();
    end += character.length; bytes += size;
  }
  if (bytes) retain();
  return parts;
}

/** Construct only from an authoritative saved-source response, never live rows or browser source text. */
export function createSynthesisGenerationInput(saved: unknown, scope: SynthesisSourceScope, frameByteLimit = 64 * 1024): SynthesisGenerationInput {
  const limit = frameLimit.parse(frameByteLimit);
  const source = verifySynthesisSource(saved, scope);
  const preparation = prepareSynthesisSource(source.snapshot, source.snapshotSha256);
  const parts = splitSource(source.snapshotText, limit);
  const manifest = manifestSchema.parse({
    schemaVersion: 1, purpose: "private_synthesis_generation_input",
    source: { ...scope, sha256: source.snapshotSha256, utf8Bytes: Buffer.byteLength(source.snapshotText, "utf8") },
    frameByteLimit: limit,
    coverage: {
      sourceIds: [...source.snapshot.items.map(row => `item:${row.id}`), ...source.snapshot.answers.map(row => `answer:${row.id}`)].sort(),
      comments: preparation.counts.comments, replies: preparation.counts.replies, answers: preparation.counts.answers,
      sessions: preparation.counts.sessions, sessionsWithoutSelectedAnswers: preparation.counts.sessionsWithoutSelectedAnswers,
      interpretation: "not_assessed",
    },
    parts: parts.map(({ text: _text, ...address }) => address),
  });
  const manifestText = JSON.stringify(manifest);
  return { manifestText, manifestSha256: sha256(manifestText), parts };
}

/** Verify all retained frames against their exact source before treating the input as available. */
export function verifySynthesisGenerationInput(raw: unknown, saved: unknown, scope: SynthesisSourceScope) {
  const input = inputSchema.parse(raw);
  const manifest = manifestSchema.parse(JSON.parse(input.manifestText));
  const expected = createSynthesisGenerationInput(saved, scope, manifest.frameByteLimit);
  // Rebuild from the authority, including full text, ordered offsets, counts,
  // per-part digests and exact manifest encoding. A self-consistent forged
  // manifest is insufficient, and a partial retrieval cannot appear complete.
  if (!isDeepStrictEqual(input, expected)) throw new Error("Synthesis input differs from the retained source");
  const snapshotText = input.parts.map(part => part.text).join("");
  return { manifest, manifestSha256: input.manifestSha256, snapshotText };
}
