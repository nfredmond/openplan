import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { synthesisGenerationJSONFields, type SynthesisGenerationField } from "./synthesis-generation-records";
import { createSynthesisThematicInputManifest, verifySynthesisThematicInputSeal } from "./synthesis-thematic-input-manifest";
import { verifySynthesisThematicRequest } from "./synthesis-thematic-requests-server";
import type { loadSynthesisThematicProposalInputs } from "./synthesis-thematic-proposal-inputs-server";

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
export type SynthesisThematicPreparedInputs = Awaited<ReturnType<typeof loadSynthesisThematicProposalInputs>>;
type EntityKind = "source" | "context_binding" | "context_output";
export type SynthesisThematicPart = { id: string; entityId: string; entityKind: EntityKind; sourceId: string;
  fieldIndex: number; fieldSha256: string; pointer: string; kind: SynthesisGenerationField["kind"] } & (
  | { childCount: number } | { text: string; start: number; end: number; length: number });
const outputSchema = z.object({ notes: z.array(z.object({ id: z.number().int().nonnegative().safe(), text: z.string() })),
  uncertainties: z.array(z.string()) });

/** Frame original source and context bytes only after the caller reconstructs
 * sealed inputs under current native authority. These checks catch inconsistent
 * in-memory projections; self-hashes cannot replace that authenticated replay.
 * Exact numeric tokens, Unicode, empty values and historical definitions remain
 * in typed field fragments. Frames and originals are still memory resident.
 */
export function createSynthesisThematicContent(prepared: SynthesisThematicPreparedInputs) {
  const scope = { campaignId: prepared.request.state.campaignId, workspaceId: prepared.request.state.workspaceId,
    requestId: prepared.request.state.request.id };
  const request = verifySynthesisThematicRequest(prepared.request.state, scope);
  if (request.state.cancellation !== null) throw new Error("Thematic content preparation was cancelled");
  const metadata = prepared.originals.map(row => ({ targetRecordId: row.targetRecordId, proofText: row.proofText,
    proofSha256: digest(row.proofText), outputSha256: digest(row.outputText), outputBytes: Buffer.byteLength(row.outputText, "utf8") }));
  const plan = createSynthesisThematicInputManifest(request.state, scope, prepared.source, metadata);
  const { receipt: _receipt, ...rawSeal } = prepared.seal;
  const seal = verifySynthesisThematicInputSeal(rawSeal, plan);
  if (!isDeepStrictEqual(plan, prepared.plan) || prepared.input.manifestSha256 !== plan.manifestSha256
    || prepared.input.sourceId !== prepared.source.requestId || prepared.input.sourceSha256 !== prepared.source.snapshotSha256
    || !isDeepStrictEqual(prepared.input.contexts.map(row => row.sourceId), plan.entries.map(row => row.metadata.targetRecordId))) {
    throw new Error("Thematic content differs from reconstructed input inventory");
  }
  const originals = new Map(prepared.originals.map(row => [row.targetRecordId, row]));
  const entities: Array<{ index: number; id: string; kind: EntityKind; sourceId: string; canonical: string; sha256: string; utf8Bytes: number }> = [];
  function entity(kind: EntityKind, sourceId: string, canonical: string) {
    const index = entities.length, sha256 = digest(canonical);
    entities.push({ index, id: digest(`${plan.manifestSha256}:${index}:${kind}:${sourceId}:${sha256}`), kind, sourceId,
      canonical, sha256, utf8Bytes: Buffer.byteLength(canonical, "utf8") });
  }
  entity("source", prepared.source.requestId, prepared.source.snapshotText);
  for (const [index, entry] of plan.entries.entries()) {
    const original = originals.get(entry.metadata.targetRecordId)!, context = prepared.input.contexts[index];
    const output = outputSchema.parse(JSON.parse(original.outputText));
    const { selectionSequence, ...projection } = context;
    z.number().int().nonnegative().safe().parse(selectionSequence);
    const expected = { sourceId: entry.metadata.targetRecordId, contextRequestId: entry.proof.contextRequestId,
      historyManifestSha256: entry.proof.historyManifestSha256, finalCaptureSha256: entry.proof.finalCaptureSha256,
      finalResultSha256: entry.proof.finalResultSha256, notes: output.notes, uncertainties: output.uncertainties };
    if (!isDeepStrictEqual(projection, expected) || output.notes.some((note, i) => note.id !== i)) {
      throw new Error("Thematic content projection differs from original context");
    }
    entity("context_binding", context.sourceId, JSON.stringify({ selectionSequence, proofText: original.proofText }));
    entity("context_output", context.sourceId, original.outputText);
  }
  const frameByteLimit = request.binding.frameByteLimit;
  const frames: Array<{ index: number; canonical: string; sha256: string; utf8Bytes: number }> = [];
  let parts: SynthesisThematicPart[] = [], pendingBytes = 0;
  const encode = (value: SynthesisThematicPart[]) => JSON.stringify({ schemaVersion: 1, purpose: "private_synthesis_thematic_content_frame",
    inputManifestSha256: plan.manifestSha256, index: frames.length, rangeUnit: "utf16_code_units", parts: value });
  const fits = (part: SynthesisThematicPart) => Buffer.byteLength(encode([]), "utf8") + pendingBytes + (parts.length ? 1 : 0)
    + Buffer.byteLength(JSON.stringify(part), "utf8") <= frameByteLimit;
  function append(part: SynthesisThematicPart) { pendingBytes += (parts.length ? 1 : 0) + Buffer.byteLength(JSON.stringify(part), "utf8"); parts.push(part); }
  function flush() {
    if (!parts.length) return;
    const canonical = encode(parts); frames.push({ index: frames.length, canonical, sha256: digest(canonical), utf8Bytes: Buffer.byteLength(canonical, "utf8") });
    parts = []; pendingBytes = 0;
  }
  for (const row of entities) {
    // Provider JSON can contain duplicate keys or significant original escapes.
    // Frame its exact text; the separately verified projection supplies meaning.
    const fieldsText = row.kind === "context_output" ? JSON.stringify({ originalOutputText: row.canonical }) : row.canonical;
    for (const [fieldIndex, field] of synthesisGenerationJSONFields(fieldsText).entries()) {
      const address = { entityId: row.id, entityKind: row.kind, sourceId: row.sourceId, fieldIndex,
        fieldSha256: digest(JSON.stringify(field)), pointer: field.pointer, kind: field.kind };
      const part = (value: { childCount: number } | { text: string; start: number; end: number; length: number }): SynthesisThematicPart => {
        const body = { ...address, ...value }; return { id: digest(JSON.stringify(body)), ...body };
      };
      if ("childCount" in field || !field.text.length) {
        const whole = part("childCount" in field ? { childCount: field.childCount } : { text: "", start: 0, end: 0, length: 0 });
        if (!fits(whole)) flush();
        if (!fits(whole)) throw new Error("Thematic field metadata exceeds the frame limit");
        append(whole); continue;
      }
      let start = 0;
      while (start < field.text.length) {
        const fragment = (end: number) => part({ text: field.text.slice(start, end), start, end, length: field.text.length });
        const whole = fragment(field.text.length);
        if (fits(whole)) { append(whole); break; }
        let low = start + 1, high = Math.min(field.text.length, start + frameByteLimit), best = start;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2), before = field.text.charCodeAt(middle - 1), after = field.text.charCodeAt(middle);
          const end = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff ? middle - 1 : middle;
          if (end <= start) { low = middle + 1; continue; }
          if (fits(fragment(end))) { best = end; low = middle + 1; } else high = middle - 1;
        }
        if (best === start) {
          if (parts.length) { flush(); continue; }
          throw new Error("Thematic field metadata exceeds the frame limit");
        }
        append(fragment(best)); start = best;
        if (start < field.text.length) flush();
      }
    }
  }
  flush();
  const manifest = { schemaVersion: 1, purpose: "private_synthesis_thematic_content", requestId: scope.requestId,
    inputManifestSha256: plan.manifestSha256, inputSealSha256: seal.receiptSha256, sourceSha256: prepared.source.snapshotSha256,
    frameByteLimit, contributionIds: plan.entries.map(row => row.metadata.targetRecordId),
    entities: entities.map(({ canonical: _canonical, ...row }) => row), frames: frames.map(({ canonical: _canonical, ...row }) => row) };
  return { request, source: structuredClone(prepared.source), input: structuredClone(prepared.input), entities, frames,
    manifest, manifestSha256: digest(JSON.stringify(manifest)) };
}
