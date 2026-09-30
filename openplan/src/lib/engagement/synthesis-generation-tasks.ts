import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { synthesisGenerationSegmentRecipe } from "./synthesis-generation-recipe";
import { createSynthesisGenerationFields, type SynthesisGenerationRecords, type SynthesisGenerationField } from "./synthesis-generation-records";
import type { SynthesisSourceScope } from "./synthesis-sources-server";

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const limitSchema = z.number().int().min(4096).max(1_048_576);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const outputSchema = z.object({
  status: z.enum(["complete", "incomplete"]),
  coveredPartIds: z.array(hash),
  observations: z.array(z.object({
    text: z.string().min(1).max(4000),
    citations: z.array(z.object({ partId: hash, quote: z.string().min(1).max(4000) }).strict()).min(1),
  }).strict()),
  uncertainty: z.string().max(4000),
}).strict();
const { instructions, outputSchema: responseSchema } = synthesisGenerationSegmentRecipe();

type Part = { id: string; fieldIndex: number; fieldSha256: string; pointer: string; kind: SynthesisGenerationField["kind"] } & (
  | { childCount: number }
  | { text: string; start: number; end: number; length: number }
);
type TaskInput = {
  source: SynthesisGenerationRecords["source"];
  recordId: string; recordKind: SynthesisGenerationRecords["records"][number]["kind"];
  recordSha256: string; fieldsSha256: string; recordComplete: boolean;
  references: Array<{ id: string; retained: boolean; includedInTask: false }>;
  rangeUnit: "utf16_code_units"; parts: Part[];
};
export type SynthesisGenerationTask = { index: number; canonical: string; sha256: string; utf8Bytes: number };
function canonical(input: TaskInput) { return JSON.stringify({ schemaVersion: 1, instructions, input, outputSchema: responseSchema }); }
function safeEnd(text: string, end: number) {
  const previous = text.charCodeAt(end - 1), next = text.charCodeAt(end);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? end - 1 : end;
}

/** Plan full source processing without treating transport fragments as independent JSON documents.
 * The limit covers this frozen task encoding, not a model's tokenizer or vendor HTTP envelope.
 * No dispatch, interpretation, review acceptance or authorization is established here.
 */
export function createSynthesisGenerationTasks(rawRecords: unknown, input: unknown, saved: unknown, scope: SynthesisSourceScope, taskByteLimit = 64 * 1024) {
  const limit = limitSchema.parse(taskByteLimit);
  const fields = createSynthesisGenerationFields(rawRecords, input, saved, scope);
  // Field production has already compared the complete records to their authority.
  const records = rawRecords as SynthesisGenerationRecords;
  const tasks: SynthesisGenerationTask[] = [];
  for (const [recordIndex, record] of records.records.entries()) {
    const inventory = fields.records[recordIndex];
    const base = {
      source: records.source, recordId: record.id, recordKind: record.kind, recordSha256: record.sha256,
      fieldsSha256: inventory.fieldsSha256, recordComplete: false,
      references: record.references.map(reference => ({ ...reference, includedInTask: false as const })),
      rangeUnit: "utf16_code_units" as const,
    };
    const batches: Part[][] = [];
    let pending: Part[] = [];
    const fits = (part: Part) => Buffer.byteLength(canonical({ ...base, parts: [...pending, part] }), "utf8") <= limit;
    const flush = () => { if (pending.length) { batches.push(pending); pending = []; } };
    for (const [fieldIndex, field] of inventory.fields.entries()) {
      const address = { fieldIndex, fieldSha256: digest(JSON.stringify(field)), pointer: field.pointer, kind: field.kind };
      const part = (value: { childCount: number } | { text: string; start: number; end: number; length: number }): Part => {
        const data = { ...address, ...value };
        return { id: digest(JSON.stringify({ recordId: record.id, ...data })), ...data };
      };
      if ("childCount" in field || field.text.length === 0) {
        const whole = part("childCount" in field ? { childCount: field.childCount } : { text: "", start: 0, end: 0, length: 0 });
        if (!fits(whole)) flush();
        if (!fits(whole)) throw new Error("Synthesis task metadata exceeds the selected byte limit");
        pending.push(whole);
        continue;
      }
      let start = 0;
      while (start < field.text.length) {
        const fragment = (end: number) => part({ text: field.text.slice(start, end), start, end, length: field.text.length });
        let low = start + 1, high = Math.min(field.text.length, start + limit), best = start;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2), end = safeEnd(field.text, middle);
          if (end <= start) { low = middle + 1; continue; }
          if (fits(fragment(end))) { best = end; low = middle + 1; } else high = middle - 1;
        }
        if (best === start) {
          if (pending.length) { flush(); continue; }
          throw new Error("Synthesis task metadata exceeds the selected byte limit");
        }
        pending.push(fragment(best)); start = best;
        if (start < field.text.length) flush();
      }
    }
    flush();
    for (const parts of batches) {
      const text = canonical({ ...base, recordComplete: batches.length === 1, parts });
      tasks.push({ index: tasks.length, canonical: text, sha256: digest(text), utf8Bytes: Buffer.byteLength(text, "utf8") });
    }
  }
  const manifest = {
    schemaVersion: 1 as const, purpose: "private_synthesis_segment_analysis" as const,
    taskByteLimit: limit, source: records.source, recordsManifestSha256: records.manifestSha256,
    contributionIds: records.contributionIds, interpretation: "not_assessed" as const, contextFit: "not_assessed" as const,
    tasks: tasks.map(({ canonical: _canonical, ...descriptor }) => descriptor),
  };
  return { ...manifest, tasks, manifestSha256: digest(JSON.stringify(manifest)) };
}

export function verifySynthesisGenerationTasks(raw: unknown, records: unknown, input: unknown, saved: unknown, scope: SynthesisSourceScope, taskByteLimit = 64 * 1024) {
  const expected = createSynthesisGenerationTasks(records, input, saved, scope, taskByteLimit);
  if (!isDeepStrictEqual(raw, expected)) throw new Error("Synthesis tasks differ from the retained source");
  return expected;
}

/** Call only with a task loaded from a verified plan. Quotes prove supplied-text identity, not interpretation quality. */
export function parseSynthesisGenerationTaskOutput(task: SynthesisGenerationTask, raw: unknown) {
  if (digest(task.canonical) !== task.sha256 || Buffer.byteLength(task.canonical, "utf8") !== task.utf8Bytes) throw new Error("Synthesis task binding is invalid");
  const supplied = JSON.parse(task.canonical) as { input: TaskInput };
  const output = outputSchema.parse(raw);
  const parts = new Map(supplied.input.parts.map(part => [part.id, part]));
  const covered = new Set(output.coveredPartIds);
  if (covered.size !== output.coveredPartIds.length || [...covered].some(id => !parts.has(id)) ||
    output.status === "complete" && covered.size !== parts.size) throw new Error("Synthesis task coverage is incomplete or invalid");
  for (const observation of output.observations) for (const citation of observation.citations) {
    const part = parts.get(citation.partId);
    if (!covered.has(citation.partId) || !part || !("text" in part) || !part.text.includes(citation.quote)) throw new Error("Synthesis observation quote is not in the supplied part");
  }
  return { taskSha256: task.sha256, recordId: supplied.input.recordId, output, interpretation: "not_assessed" as const };
}
