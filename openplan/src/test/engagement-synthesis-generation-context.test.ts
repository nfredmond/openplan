import { describe, expect, it } from "vitest";
import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationRecords } from "@/lib/engagement/synthesis-generation-records";
import { createSynthesisGenerationTasks } from "@/lib/engagement/synthesis-generation-tasks";
import { assembleSynthesisGenerationResults, createSynthesisGenerationResult } from "@/lib/engagement/synthesis-generation-results";
import { createSynthesisGenerationContext, verifySynthesisGenerationContext, synthesisGenerationContextPage, type SynthesisGenerationContext } from "@/lib/engagement/synthesis-generation-context";
import { makeSourceSnapshot, savedSource, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

function fixture(snapshot = makeSourceSnapshot(3)) {
  const saved = savedSource(snapshot), input = createSynthesisGenerationInput(saved, sourceScope);
  const records = createSynthesisGenerationRecords(input, saved, sourceScope);
  const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
  const job = { jobId: "a0000000-0000-4000-8000-000000000010", planSha256: plan.manifestSha256,
    configurationRevisionId: "a0000000-0000-4000-8000-000000000011", configurationHash: "b".repeat(64),
    provider: "api_connection" as const, modelId: "synthetic-context" };
  const selections = plan.tasks.map((task, index) => ({ taskSha256: task.sha256,
    attemptId: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
  const results = plan.tasks.map((task, index) => {
    const binding = { ...job, ...selections[index] };
    return createSynthesisGenerationResult(binding, { schemaVersion: 1, binding,
      startedAt: "2026-09-30T00:00:00Z", finishedAt: "2026-09-30T00:01:00Z", outcome: "returned",
      outputText: JSON.stringify({ status: "complete", coveredPartIds: JSON.parse(task.canonical).input.parts.map((part: { id: string }) => part.id),
        observations: [], uncertainty: "SYNTHETIC context not interpreted" }), providerReceiptText: null,
      finishReason: "stop", responseId: null, inputTokens: null, outputTokens: null, failureCode: null });
  });
  const args = { job, selections, results, plan, records, input, saved, scope: sourceScope, taskByteLimit: 4096 };
  const inventory = assembleSynthesisGenerationResults(args), sequence = selections.length;
  return { args, inventory, sequence, context: createSynthesisGenerationContext(inventory, args, sequence) };
}
type Page = { offset: number; nextOffset: number | null; items: Array<Record<string, unknown>> };
function pages(context: SynthesisGenerationContext, target: string, byteLimit = 1024, maxEntries = 3) {
  const pages: ReturnType<typeof synthesisGenerationContextPage>[] = [];
  let offset = 0;
  do {
    const page = synthesisGenerationContextPage(context, context.manifestSha256, target, { offset, byteLimit, maxEntries });
    expect(page.utf8Bytes).toBeLessThanOrEqual(byteLimit);
    expect(page.utf8Bytes).toBe(Buffer.byteLength(page.canonical, "utf8"));
    expect(page.sha256).toBe(sourceHash(page.canonical));
    expect((JSON.parse(page.canonical) as Page).items.length).toBeLessThanOrEqual(maxEntries);
    expect(synthesisGenerationContextPage(context, context.manifestSha256, target, { offset, byteLimit, maxEntries })).toEqual(page);
    pages.push(page);
    if (page.nextOffset === null) break;
    expect(page.nextOffset).toBeGreaterThan(offset); offset = page.nextOffset;
    if (pages.length > 10000) throw new Error("Context cursor did not terminate");
  } while (true);
  return pages;
}
const items = (retained: ReturnType<typeof pages>) => retained.flatMap(page => (JSON.parse(page.canonical) as Page).items);

describe("complete synthesis context dependencies", () => {
  it("binds every source record and selected result beyond 300 contributions without inflating participation", () => {
    const f = fixture(makeSourceSnapshot(301)), before = JSON.stringify(f.args);
    expect(f.context.records).toHaveLength(f.args.records.records.length);
    expect(f.context.contributionIds).toEqual(f.args.records.contributionIds);
    expect(f.context.records.filter(row => row.contribution)).toHaveLength(302);
    expect(f.context.records.filter(row => !row.contribution).map(row => row.kind)).toEqual(["context", "definition", "session"]);
    expect(f.context.source).toEqual(f.args.records.source); expect(f.context.requestId).toBe(f.args.job.jobId);
    expect(f.context.recordsManifestSha256).toBe(f.args.records.manifestSha256);
    expect(f.context.segmentResultsManifestSha256).toBe(f.inventory.manifestSha256);
    expect(f.context.selectionSequence).toBe(f.sequence);
    expect(f.context.inputStatus).toBe("ready_for_context_processing"); expect(f.context.interpretation).toBe("not_assessed");
    for (const [index, record] of f.context.records.entries()) {
      const original = f.args.records.records[index];
      expect(record).toMatchObject({ id: original.id, kind: original.kind, sha256: original.sha256,
        utf8Bytes: original.utf8Bytes, references: original.references });
      expect(record.segments).toEqual(f.inventory.entries.filter(row => row.recordId === record.id).map(({ recordId: _id, parsed: _parsed, ...entry }) => entry));
    }
    expect(JSON.stringify(f.args)).toBe(before);
    expect(verifySynthesisGenerationContext(structuredClone(f.context), f.inventory, f.args, f.sequence)).toEqual(f.context);
  });

  it("traverses full reply, question and session context once while retaining all cycle and missing edges", () => {
    const snapshot = makeSourceSnapshot(4);
    snapshot.items[0].parent_item_id = snapshot.items[1].id;
    snapshot.items[1].parent_item_id = snapshot.items[0].id;
    snapshot.items[2].parent_item_id = "e0000000-0000-4000-8000-000000000099";
    const f = fixture(snapshot), target = `item:${snapshot.items[0].id}`;
    const result = items(pages(f.context, target));
    const recordRows = result.filter(row => row.kind === "record");
    expect(recordRows.map(row => row.recordId)).toEqual([target, `context:${sourceScope.requestId}`,
      `definition:${snapshot.definitions[0].id}`, `item:${snapshot.items[1].id}`]);
    expect(result.filter(row => row.kind === "reference")).toHaveLength(7);
    expect(result).toContainEqual({ kind: "reference", recordId: `item:${snapshot.items[1].id}`, targetId: target, retained: true });
    const recordIds = new Set(recordRows.map(row => row.recordId));
    expect(result.filter(row => row.kind === "segment").map(row => row.taskIndex)).toEqual(
      recordRows.flatMap(row => f.context.records.find(record => record.id === row.recordId)!.segments.map(segment => segment.taskIndex)));
    expect(result.filter(row => row.kind === "segment").length).toBe(f.inventory.entries.filter(row => recordIds.has(row.recordId)).length);
    const missing = items(pages(f.context, `item:${snapshot.items[2].id}`));
    expect(missing).toContainEqual({ kind: "reference", recordId: `item:${snapshot.items[2].id}`,
      targetId: `item:${snapshot.items[2].parent_item_id}`, retained: false });
    expect(missing.filter(row => row.kind === "record")).toHaveLength(3);
    const survey = items(pages(f.context, `answer:${snapshot.answers[0].id}`));
    expect(survey.filter(row => row.kind === "record").map(row => row.recordKind)).toEqual(["answer", "context", "session", "definition"]);
    expect(survey.filter(row => row.kind === "record" && row.contribution)).toHaveLength(1);
  });

  it("pages a long reply chain iteratively without dropping the final source or its segments", () => {
    const snapshot = makeSourceSnapshot(301);
    for (let index = 0; index < snapshot.items.length - 1; index++) snapshot.items[index].parent_item_id = snapshot.items[index + 1].id;
    const f = fixture(snapshot), target = `item:${snapshot.items[0].id}`;
    const all = items(pages(f.context, target, 64000, 128));
    expect(all.filter(row => row.kind === "record")).toHaveLength(303);
    expect(all.some(row => row.kind === "record" && row.recordId === `item:${snapshot.items[300].id}`)).toBe(true);
    expect(all.filter(row => row.kind === "segment")).toHaveLength(f.inventory.entries.filter(row => !row.recordId.startsWith("answer:") && !row.recordId.startsWith("session:")).length);
  });

  it("freezes late output arrival separately from the unchanged selection sequence", () => {
    const f = fixture(), args = { ...f.args, results: f.args.results.slice(1) };
    const missing = assembleSynthesisGenerationResults(args), context = createSynthesisGenerationContext(missing, args, f.sequence);
    expect(context.inputStatus).toBe("incomplete"); expect(context.selectionSequence).toBe(f.context.selectionSequence);
    expect(context.records[0].segments[0]).toMatchObject({ receiptSha256: null, disposition: "awaiting_result" });
    expect(context.manifestSha256).not.toBe(f.context.manifestSha256);
    expect(() => synthesisGenerationContextPage(f.context, context.manifestSha256, f.context.records[0].id)).toThrow("different retained manifest");
    expect(() => verifySynthesisGenerationContext(context, f.inventory, f.args, f.sequence)).toThrow("differs");
  });

  it("preserves empty selection and rejects impossible or unsafe sequence anchors", () => {
    const snapshot = makeSourceSnapshot(0); snapshot.answers = []; snapshot.counts.answers = 0;
    // Construct the source/plan without submitting the fixture's otherwise selected attempts.
    const ordinary = fixture();
    const saved = savedSource(snapshot), input = createSynthesisGenerationInput(saved, sourceScope), records = createSynthesisGenerationRecords(input, saved, sourceScope);
    const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
    const args = { ...ordinary.args, saved, input, records, plan, selections: [], results: [], job: { ...ordinary.args.job, planSha256: plan.manifestSha256 } };
    const inventory = assembleSynthesisGenerationResults(args), context = createSynthesisGenerationContext(inventory, args, 0);
    expect(context.inputStatus).toBe("empty_selection"); expect(context.contributionIds).toEqual([]);
    expect(context.records.every(record => !record.contribution)).toBe(true);
    expect(() => createSynthesisGenerationContext(ordinary.inventory, ordinary.args, 0)).toThrow("selected attempts");
    expect(() => createSynthesisGenerationContext(ordinary.inventory, ordinary.args, 1)).toThrow("selected attempts");
    for (const sequence of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      expect(() => createSynthesisGenerationContext(ordinary.inventory, ordinary.args, sequence)).toThrow();
    }
  });

  it("rejects changed source/result authority and independently rehashed dependency graphs", () => {
    const f = fixture();
    for (const mutate of [
      (value: SynthesisGenerationContext) => { value.records.pop(); },
      (value: SynthesisGenerationContext) => { value.records[2].contribution = true; },
      (value: SynthesisGenerationContext) => { value.records[0].segments.pop(); },
      (value: SynthesisGenerationContext) => { value.records[1].references = []; },
      (value: SynthesisGenerationContext) => { value.selectionSequence++; },
    ]) {
      const changed = structuredClone(f.context); mutate(changed);
      const { manifestSha256: _hash, ...manifest } = changed; changed.manifestSha256 = sourceHash(JSON.stringify(manifest));
      expect(() => verifySynthesisGenerationContext(changed, f.inventory, f.args, f.sequence)).toThrow("differs");
      expect(() => synthesisGenerationContextPage(changed, f.context.manifestSha256, f.context.records[0].id)).toThrow("different retained manifest");
    }
    const changed = structuredClone(f.inventory); changed.results.pop();
    expect(() => createSynthesisGenerationContext(changed, f.args, f.sequence)).toThrow("inventory differs");
    expect(() => createSynthesisGenerationContext(f.inventory, { ...f.args, scope: { ...sourceScope, workspaceId: sourceScope.campaignId } }, f.sequence)).toThrow();
  });

  it("enforces exact byte and cursor bounds, with stable empty terminal pages", () => {
    const f = fixture(), target = f.context.records[0].id;
    const all = pages(f.context, target, 64000, 128), count = items(all).length;
    const end = synthesisGenerationContextPage(f.context, f.context.manifestSha256, target, { offset: count });
    expect(JSON.parse(end.canonical).items).toEqual([]); expect(end.nextOffset).toBeNull();
    expect(all).toHaveLength(1);
    const exactLimit = all[0].utf8Bytes - 1;
    const narrow = synthesisGenerationContextPage(f.context, f.context.manifestSha256, target, { byteLimit: exactLimit });
    expect(narrow.utf8Bytes).toBeLessThanOrEqual(exactLimit); expect(narrow.nextOffset).not.toBeNull();
    expect(() => synthesisGenerationContextPage(f.context, f.context.manifestSha256, target, { offset: count + 1 })).toThrow("cursor exceeds");
    for (const options of [{ offset: -1 }, { offset: 0.5 }, { byteLimit: 255 }, { byteLimit: 4194305 }, { maxEntries: 0 }, { maxEntries: 129 }]) {
      expect(() => synthesisGenerationContextPage(f.context, f.context.manifestSha256, target, options)).toThrow();
    }
    expect(() => synthesisGenerationContextPage(f.context, f.context.manifestSha256, target, { byteLimit: 256 })).toThrow("exceeds the page byte limit");
    expect(() => synthesisGenerationContextPage(f.context, f.context.manifestSha256, target, { byteLimit: end.utf8Bytes + 5 })).toThrow("dependency exceeds");
    expect(() => synthesisGenerationContextPage(f.context, f.context.manifestSha256, "item:e0000000-0000-4000-8000-000000000099")).toThrow("target is unavailable");
    for (let limit = 1024; limit <= 1800; limit++) {
      const page = synthesisGenerationContextPage(f.context, f.context.manifestSha256, target, { byteLimit: limit });
      expect(page.utf8Bytes).toBeLessThanOrEqual(limit);
    }
  });

  it("bounds the metadata of an empty terminal page", () => {
    const f = fixture(), target = f.context.records[0].id, count = items(pages(f.context, target)).length;
    const terminal = synthesisGenerationContextPage(f.context, f.context.manifestSha256, target, { offset: count });
    expect(terminal.utf8Bytes).toBeGreaterThan(256);
    expect(() => synthesisGenerationContextPage(f.context, f.context.manifestSha256, target, { offset: count, byteLimit: 256 })).toThrow("page header exceeds");
  });

  it("preserves unknown historical configuration without substituting a current definition", () => {
    const snapshot = makeSourceSnapshot(1);
    snapshot.items[0].configuration_version_id = null;
    const f = fixture(snapshot), target = `item:${snapshot.items[0].id}`;
    const all = items(pages(f.context, target));
    expect(all.filter(row => row.kind === "record").map(row => row.recordId)).toEqual([target, `context:${sourceScope.requestId}`]);
    expect(f.context.contributionIds).toContain(target);
    expect(JSON.parse(f.args.records.records.find(row => row.id === target)!.text).configuration_version_id).toBeNull();
    snapshot.items[0].configuration_version_id = "e0000000-0000-4000-8000-000000000099";
    expect(() => fixture(snapshot)).toThrow("definition is missing");
  });

  it("checks digest and graph consistency against the retained page authority", () => {
    const f = fixture(), target = f.context.records[0].id;
    const altered = structuredClone(f.context); altered.records[0].utf8Bytes++;
    expect(() => synthesisGenerationContextPage(altered, f.context.manifestSha256, target)).toThrow("different retained manifest");
    for (const change of [
      (value: SynthesisGenerationContext) => { value.records.push(value.records[0]); },
      (value: SynthesisGenerationContext) => { value.records[1].references[0].retained = false; },
    ]) {
      const value = structuredClone(f.context); change(value);
      const { manifestSha256: _hash, ...manifest } = value; value.manifestSha256 = sourceHash(JSON.stringify(manifest));
      expect(() => synthesisGenerationContextPage(value, value.manifestSha256, target)).toThrow("addresses are inconsistent");
    }
  });
});
