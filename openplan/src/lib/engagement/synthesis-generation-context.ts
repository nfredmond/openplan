import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { SynthesisGenerationRecords } from "./synthesis-generation-records";
import { assembleSynthesisGenerationResults, verifySynthesisGenerationResults } from "./synthesis-generation-results";

const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const natural = z.number().int().nonnegative().safe();
const recordId = z.string().regex(/^(?:context|definition|session|item|answer):[0-9a-fA-F-]{36}$/);
const segmentSchema = z.object({ taskIndex: natural, taskSha256: hash, attemptId: z.string().uuid().nullable(),
  receiptSha256: hash.nullable(), disposition: z.enum(["not_started", "awaiting_result", "failed", "interrupted",
    "invalid_output", "provider_incomplete", "incomplete_output", "validated_output", "not_required_empty_selection"]),
}).strict();
const nodeSchema = z.object({ id: recordId, kind: z.enum(["context", "definition", "session", "item", "answer"]),
  sha256: hash, utf8Bytes: natural, contribution: z.boolean(),
  references: z.array(z.object({ id: recordId, retained: z.boolean() }).strict()), segments: z.array(segmentSchema),
}).strict();
const manifestSchema = z.object({ schemaVersion: z.literal(1), purpose: z.literal("private_synthesis_context_dependencies"),
  interpretation: z.literal("not_assessed"), source: z.object({ requestId: z.string().uuid(), campaignId: z.string().uuid(),
    workspaceId: z.string().uuid(), sha256: hash }).strict(), requestId: z.string().uuid(), selectionSequence: natural,
  recordsManifestSha256: hash, segmentResultsManifestSha256: hash,
  inputStatus: z.enum(["empty_selection", "incomplete", "ready_for_context_processing"]),
  contributionIds: z.array(recordId), records: z.array(nodeSchema),
}).strict();
type Manifest = z.infer<typeof manifestSchema>;
export type SynthesisGenerationContext = Manifest & { manifestSha256: string };
type ResultArgs = Parameters<typeof assembleSynthesisGenerationResults>[0];

/** Freeze the complete dependency inventory from verified source and selected
 * results. Sequence alone cannot bind an output that arrives later. This is
 * memory-resident preparation, not semantic consolidation or permission to run.
 * The caller obtains the sequence from the authenticated selection inventory.
 */
export function createSynthesisGenerationContext(rawResults: unknown, args: ResultArgs, selectionSequence: number): SynthesisGenerationContext {
  natural.parse(selectionSequence);
  const results = verifySynthesisGenerationResults(rawResults, args);
  // Result verification reconstructs the source records and task plan first.
  const records = args.records as SynthesisGenerationRecords;
  if (results.entries.filter(entry => entry.attemptId !== null).length > selectionSequence) {
    throw new Error("Synthesis selection sequence precedes selected attempts");
  }
  const contributions = new Set(records.contributionIds);
  const segments = new Map<string, z.infer<typeof segmentSchema>[]>();
  for (const { recordId, parsed: _parsed, ...entry } of results.entries) {
    const members = segments.get(recordId) ?? [];
    members.push(entry); segments.set(recordId, members);
  }
  const manifest: Manifest = {
    schemaVersion: 1, purpose: "private_synthesis_context_dependencies", interpretation: "not_assessed",
    source: records.source, requestId: results.job.jobId, selectionSequence,
    recordsManifestSha256: records.manifestSha256, segmentResultsManifestSha256: results.manifestSha256,
    inputStatus: results.status === "ready_for_record_consolidation" ? "ready_for_context_processing" : results.status,
    contributionIds: [...records.contributionIds],
    records: records.records.map(record => ({ id: record.id, kind: record.kind, sha256: record.sha256, utf8Bytes: record.utf8Bytes,
      contribution: contributions.has(record.id), references: record.references.map(reference => ({ ...reference })),
      segments: segments.get(record.id) ?? [],
    })),
  };
  const canonical = manifestSchema.parse(manifest);
  return { ...canonical, manifestSha256: digest(JSON.stringify(canonical)) };
}

/** A rehashed graph cannot replace the authoritative source/result inventories. */
export function verifySynthesisGenerationContext(raw: unknown, rawResults: unknown, args: ResultArgs, selectionSequence: number) {
  const expected = createSynthesisGenerationContext(rawResults, args, selectionSequence);
  if (!isDeepStrictEqual(raw, expected)) throw new Error("Synthesis context differs from its retained dependencies");
  return expected;
}

type Dependency =
  | { kind: "record"; recordId: string; recordKind: z.infer<typeof nodeSchema>["kind"]; sha256: string; utf8Bytes: number; contribution: boolean }
  | { kind: "reference"; recordId: string; targetId: string; retained: boolean }
  | ({ kind: "segment"; recordId: string } & z.infer<typeof segmentSchema>);
export type SynthesisGenerationContextDependency = Dependency;

// Use an iterative queue so long reply threads and cycles do not exhaust the
// call stack. Emit every edge, including unavailable targets and cycle edges.
function* dependencies(manifest: Manifest, target: string): Generator<Dependency> {
  const records = new Map(manifest.records.map(record => [record.id, record]));
  if (!records.has(target)) throw new Error("Synthesis context target is unavailable");
  const queue = [target], visited = new Set(queue);
  for (let index = 0; index < queue.length; index++) {
    const record = records.get(queue[index])!;
    yield { kind: "record", recordId: record.id, recordKind: record.kind, sha256: record.sha256,
      utf8Bytes: record.utf8Bytes, contribution: record.contribution };
    for (const reference of record.references) {
      yield { kind: "reference", recordId: record.id, targetId: reference.id, retained: reference.retained };
      if (reference.retained && !visited.has(reference.id)) { visited.add(reference.id); queue.push(reference.id); }
    }
    for (const segment of record.segments) yield { kind: "segment", recordId: record.id, ...segment };
  }
}

/** Page the dependency addresses under a separately trusted retained manifest
 * hash. A caller must verify that manifest against authority before saving the
 * hash. These pages contain addresses, not the original source or model input.
 * Reconstructing the graph is still memory resident; page bounds are not an
 * out-of-core capacity claim. No provider call or new permission is created.
 */
export function synthesisGenerationContextPage(raw: unknown, expectedManifestSha256: string, targetRecordId: string,
  options: { offset?: number; byteLimit?: number; maxEntries?: number } = {},
) {
  const retained = manifestSchema.extend({ manifestSha256: hash }).parse(raw);
  const { manifestSha256, ...manifest } = retained;
  if (hash.parse(expectedManifestSha256) !== manifestSha256 || digest(JSON.stringify(manifest)) !== manifestSha256) {
    throw new Error("Synthesis context page belongs to a different retained manifest");
  }
  const target = recordId.parse(targetRecordId), offset = natural.parse(options.offset ?? 0);
  const byteLimit = z.number().int().min(256).max(4 * 1024 * 1024).parse(options.byteLimit ?? 64 * 1024);
  const maxEntries = z.number().int().min(1).max(128).parse(options.maxEntries ?? 128);
  const ids = new Set(manifest.records.map(record => record.id));
  if (ids.size !== manifest.records.length || manifest.records.some(record =>
    record.references.some(reference => reference.retained !== ids.has(reference.id)))) {
    throw new Error("Synthesis context dependency addresses are inconsistent");
  }
  const items: Dependency[] = [];
  const encode = (entries: Dependency[], nextOffset: number | null) => JSON.stringify({ schemaVersion: 1,
    purpose: "private_synthesis_context_dependency_page", manifestSha256, targetRecordId: target, offset, nextOffset, items: entries });
  if (Buffer.byteLength(encode([], null), "utf8") > byteLimit) throw new Error("Synthesis context page header exceeds the page byte limit");
  let index = 0, more = false;
  for (const dependency of dependencies(manifest, target)) {
    if (index++ < offset) continue;
    const candidate = [...items, dependency];
    const bytes = Math.max(Buffer.byteLength(encode(candidate, offset + candidate.length), "utf8"),
      Buffer.byteLength(encode(candidate, null), "utf8"));
    if (items.length === maxEntries || bytes > byteLimit) {
      more = true; break;
    }
    items.push(dependency);
  }
  if (index < offset) throw new Error("Synthesis context cursor exceeds its dependencies");
  if (more && items.length === 0) throw new Error("Synthesis context dependency exceeds the page byte limit");
  const nextOffset = more ? offset + items.length : null;
  const canonical = encode(items, nextOffset);
  return { canonical, sha256: digest(canonical), utf8Bytes: Buffer.byteLength(canonical, "utf8"), nextOffset };
}
