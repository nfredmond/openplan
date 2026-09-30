import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { synthesisGenerationContextPage, verifySynthesisGenerationContext, type SynthesisGenerationContextDependency } from "./synthesis-generation-context";
import { synthesisGenerationJSONFields, type SynthesisGenerationField } from "./synthesis-generation-records";
import { assembleSynthesisGenerationResults, verifySynthesisGenerationResults } from "./synthesis-generation-results";
import type { createSynthesisGenerationTasks, SynthesisGenerationTaskInput } from "./synthesis-generation-tasks";

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
type ResultArgs = Parameters<typeof assembleSynthesisGenerationResults>[0];
type Part = { id: string; entityId: string; fieldIndex: number; fieldSha256: string;
  pointer: string; kind: SynthesisGenerationField["kind"] } & (
  | { childCount: number }
  | { text: string; start: number; end: number; length: number }
);
type Entity = { index: number; id: string; kind: SynthesisGenerationContextDependency["kind"]; recordId: string;
  canonical: string; sha256: string; utf8Bytes: number; fieldsSha256: string };

function safeEnd(text: string, end: number) {
  const previous = text.charCodeAt(end - 1), next = text.charCodeAt(end);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? end - 1 : end;
}

/** Materialize the entire retained context closure. Source parts retain original
 * numeric spellings; parsed model observations retain every citation and uncertainty.
 * The authenticated caller supplies the frozen selection sequence and authorities.
 * These typed content frames are not independent model tasks or execution permission.
 * Source, result and entity collections are still memory resident.
 */
export function createSynthesisGenerationContextContent(rawContext: unknown, rawResults: unknown, args: ResultArgs,
  selectionSequence: number, targetRecordId: string, frameByteLimit = 64 * 1024,
) {
  const limit = z.number().int().min(4096).max(1_048_576).parse(frameByteLimit);
  const context = verifySynthesisGenerationContext(rawContext, rawResults, args, selectionSequence);
  const results = verifySynthesisGenerationResults(rawResults, args);
  if (!context.records.some(record => record.id === targetRecordId)) throw new Error("Synthesis context content target is unavailable");
  // Context verification has already reconstructed this exact task plan.
  const plan = args.plan as ReturnType<typeof createSynthesisGenerationTasks>;
  const entities: Entity[] = [];
  const frames: Array<{ index: number; canonical: string; sha256: string; utf8Bytes: number }> = [];
  const base = { schemaVersion: 1, purpose: "private_synthesis_context_content_frame", contextManifestSha256: context.manifestSha256,
    targetRecordId, rangeUnit: "utf16_code_units" } as const;
  let pending: Part[] = [];
  let pendingBytes = 0;
  const encode = (parts: Part[]) => JSON.stringify({ ...base, index: frames.length, parts });
  const partBytes = (part: Part) => Buffer.byteLength(JSON.stringify(part), "utf8");
  // Count serialized parts and separators once instead of re-encoding the
  // complete pending frame for each candidate fragment.
  const fits = (part: Part) => Buffer.byteLength(encode([]), "utf8") + pendingBytes + (pending.length ? 1 : 0) + partBytes(part) <= limit;
  function append(part: Part) {
    pendingBytes += (pending.length ? 1 : 0) + partBytes(part);
    pending.push(part);
  }
  function flush() {
    if (!pending.length) return;
    const canonical = encode(pending);
    frames.push({ index: frames.length, canonical, sha256: digest(canonical), utf8Bytes: Buffer.byteLength(canonical, "utf8") });
    pending = []; pendingBytes = 0;
  }
  function retain(dependency: SynthesisGenerationContextDependency) {
    let payload: unknown = dependency;
    if (dependency.kind === "segment") {
      const task = plan.tasks[dependency.taskIndex], entry = results.entries[dependency.taskIndex];
      const { input } = JSON.parse(task.canonical) as { input: SynthesisGenerationTaskInput };
      payload = { ...dependency, originalRecordSha256: input.recordSha256, originalFieldsSha256: input.fieldsSha256,
        sourceParts: input.parts, selectedOutput: entry.parsed?.output ?? null };
    }
    const canonical = JSON.stringify(payload), sha256 = digest(canonical), fields = synthesisGenerationJSONFields(canonical);
    const index = entities.length, id = digest(`${context.manifestSha256}:${targetRecordId}:${index}:${sha256}`);
    entities.push({ index, id, kind: dependency.kind, recordId: dependency.recordId, canonical, sha256,
      utf8Bytes: Buffer.byteLength(canonical, "utf8"), fieldsSha256: digest(JSON.stringify(fields)) });
    for (const [fieldIndex, field] of fields.entries()) {
      const address = { entityId: id, fieldIndex, fieldSha256: digest(JSON.stringify(field)), pointer: field.pointer, kind: field.kind };
      const part = (value: { childCount: number } | { text: string; start: number; end: number; length: number }): Part => {
        const valueWithAddress = { ...address, ...value };
        return { id: digest(JSON.stringify(valueWithAddress)), ...valueWithAddress };
      };
      if ("childCount" in field || field.text.length === 0) {
        const whole = part("childCount" in field ? { childCount: field.childCount } : { text: "", start: 0, end: 0, length: 0 });
        if (!fits(whole)) flush();
        if (!fits(whole)) throw new Error("Synthesis context field metadata exceeds the content frame limit");
        append(whole); continue;
      }
      let start = 0;
      while (start < field.text.length) {
        const fragment = (end: number) => part({ text: field.text.slice(start, end), start, end, length: field.text.length });
        const whole = fragment(field.text.length);
        if (fits(whole)) { append(whole); break; }
        let low = start + 1, high = Math.min(field.text.length, start + limit), best = start;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2), end = safeEnd(field.text, middle);
          if (end <= start) { low = middle + 1; continue; }
          if (fits(fragment(end))) { best = end; low = middle + 1; } else high = middle - 1;
        }
        if (best === start) {
          if (pending.length) { flush(); continue; }
          throw new Error("Synthesis context field metadata exceeds the content frame limit");
        }
        append(fragment(best)); start = best;
        if (start < field.text.length) flush();
      }
    }
  }
  if (context.inputStatus !== "empty_selection") {
    let offset = 0;
    for (;;) {
      const page = synthesisGenerationContextPage(context, context.manifestSha256, targetRecordId, { offset });
      const body = JSON.parse(page.canonical) as { items: SynthesisGenerationContextDependency[] };
      for (const dependency of body.items) retain(dependency);
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    flush();
  }
  const manifest = { schemaVersion: 1 as const, purpose: "private_synthesis_context_content" as const,
    contextManifestSha256: context.manifestSha256, segmentResultsManifestSha256: context.segmentResultsManifestSha256,
    source: context.source, requestId: context.requestId, selectionSequence, targetRecordId,
    inputStatus: context.inputStatus, interpretation: "not_assessed" as const, frameByteLimit: limit,
    contributionIds: context.contributionIds,
    entities: entities.map(({ canonical: _canonical, ...descriptor }) => descriptor),
    frames: frames.map(({ canonical: _canonical, ...descriptor }) => descriptor) };
  return { ...manifest, entities, frames, manifestSha256: digest(JSON.stringify(manifest)) };
}

/** Self-hashed content cannot replace the selected native results or saved source. */
export function verifySynthesisGenerationContextContent(raw: unknown, ...args: Parameters<typeof createSynthesisGenerationContextContent>) {
  const expected = createSynthesisGenerationContextContent(...args);
  if (!isDeepStrictEqual(raw, expected)) throw new Error("Synthesis context content differs from its retained inputs");
  return expected;
}
