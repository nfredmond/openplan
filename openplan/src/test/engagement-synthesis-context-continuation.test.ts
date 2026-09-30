import { describe, expect, it } from "vitest";
import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationRecords } from "@/lib/engagement/synthesis-generation-records";
import { createSynthesisGenerationTasks, type SynthesisGenerationTaskInput } from "@/lib/engagement/synthesis-generation-tasks";
import { assembleSynthesisGenerationResults, createSynthesisGenerationResult, type SynthesisGenerationCapture } from "@/lib/engagement/synthesis-generation-results";
import { createSynthesisGenerationContext } from "@/lib/engagement/synthesis-generation-context";
import { createSynthesisGenerationContextContent } from "@/lib/engagement/synthesis-generation-context-content";
import { makeSourceSnapshot, savedSource, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";

function inputs(snapshot = makeSourceSnapshot(1), changeSaved?: (saved: ReturnType<typeof savedSource>) => void,
  changeCapture?: (capture: SynthesisGenerationCapture, index: number) => void) {
  const saved = savedSource(snapshot); changeSaved?.(saved);
  const input = createSynthesisGenerationInput(saved, sourceScope), records = createSynthesisGenerationRecords(input, saved, sourceScope);
  const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
  const job = { jobId: "a0000000-0000-4000-8000-000000000010", planSha256: plan.manifestSha256,
    configurationRevisionId: "a0000000-0000-4000-8000-000000000011", configurationHash: "b".repeat(64),
    provider: "api_connection" as const, modelId: "synthetic-content" };
  const selections = records.contributionIds.length ? plan.tasks.map((task, index) => ({ taskSha256: task.sha256,
    attemptId: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}` })) : [];
  const results = selections.map((selection, index) => {
    const binding = { ...job, ...selection }, { input } = JSON.parse(plan.tasks[index].canonical) as { input: SynthesisGenerationTaskInput };
    const cited = input.parts.find(part => "text" in part && part.text.length);
    const observations = cited && "text" in cited ? [
      { text: `SYNTHETIC position ${index}`, citations: [{ partId: cited.id, quote: cited.text.slice(0, 1) }] },
      { text: `SYNTHETIC conflicting position ${index}`, citations: [{ partId: cited.id, quote: cited.text.slice(0, 1) }] },
    ] : [];
    const capture: SynthesisGenerationCapture = { schemaVersion: 1, binding, startedAt: "2026-09-30T00:00:00Z",
      finishedAt: "2026-09-30T00:01:00Z", outcome: "returned", outputText: JSON.stringify({ status: "complete",
        coveredPartIds: input.parts.map(part => part.id), observations, uncertainty: `SYNTHETIC uncertainty ${index}` }),
      providerReceiptText: null, finishReason: "stop", responseId: null, inputTokens: null, outputTokens: null, failureCode: null };
    changeCapture?.(capture, index);
    return createSynthesisGenerationResult(binding, capture);
  });
  const args = { job, selections, results, plan, records, input, saved, scope: sourceScope, taskByteLimit: 4096 };
  const inventory = assembleSynthesisGenerationResults(args), sequence = selections.length;
  const context = createSynthesisGenerationContext(inventory, args, sequence);
  return { args, inventory, sequence, context };
}
import { createSynthesisContextPlan, createSynthesisContextContinuation, synthesisContextRecipe } from "@/lib/engagement/synthesis-context-continuation";

function fixture(snapshot = makeSourceSnapshot(1), taskByteLimit = 65536) {
  const f = inputs(snapshot), target = f.args.records.contributionIds[0];
  const args: Parameters<typeof createSynthesisGenerationContextContent> = [f.context, f.inventory, f.args, f.sequence, target, 4096];
  const content = createSynthesisGenerationContextContent(...args);
  const scope = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, requestId: "a0000000-0000-4000-8000-000000000080" };
  const intentText = JSON.stringify({ schemaVersion: 1, sourceId: sourceScope.requestId, sourceSha256: f.args.saved.snapshotSha256,
    connectionId: "a0000000-0000-4000-8000-000000000081", configurationRevisionId: f.args.job.configurationRevisionId,
    configurationHash: f.args.job.configurationHash, modelId: "synthetic-context", taskByteLimit });
  const contextText = JSON.stringify({ schemaVersion: 1, parentRequestId: f.args.job.jobId, selectionSequence: f.sequence,
    segmentResultsManifestSha256: f.inventory.manifestSha256, contextManifestSha256: f.context.manifestSha256,
    contentManifestSha256: content.manifestSha256, targetRecordId: target, frameByteLimit: 4096 });
  const request = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    request: { id: scope.requestId, actorId: "a0000000-0000-4000-8000-000000000082", intentText,
      intentSha256: sourceHash(intentText), createdAt: "2026-09-30T00:00:00Z" },
    context: { parentRequestId: f.args.job.jobId, contextText, contextSha256: sourceHash(contextText), createdAt: "2026-09-30T00:00:00Z" }, cancellation: null };
  return { f, args, content, scope, request };
}
type Processor = ReturnType<typeof createSynthesisContextContinuation>;
const processor = (f: ReturnType<typeof fixture>, records: readonly unknown[] = []) => createSynthesisContextContinuation(f.request, f.scope, f.args, records);
function response(p: Processor) {
  const next = p.next(); if (next.status !== "ready") throw new Error(`Expected ready, got ${next.status}`);
  const task = JSON.parse(next.task.canonical);
  const previous = task.input.previous ? JSON.parse(task.input.previous.outputText) : { notes: [], uncertainties: [] };
  const parts: Array<{ id: string; text?: string }> = task.input.frame.parts;
  const cited = parts.find(part => typeof part.text === "string" && part.text.length)!;
  const note = { id: previous.notes.length, text: `SYNTHETIC contextual note ${next.frameIndex}`,
    citations: [{ partId: cited.id, quote: cited.text!.slice(0, 1) }], relatedNoteIds: previous.notes.length ? [0] : [] };
  const output = { status: "complete", coveredPartIds: parts.map(part => part.id), notes: [...previous.notes, note],
    uncertainties: [...previous.uncertainties, `SYNTHETIC uncertainty ${next.frameIndex}`] };
  return { next, task, output, observe: () => ({ taskSha256: next.task.sha256, outputText: JSON.stringify(output), finishReason: "stop" }) };
}
function alterBinding(f: ReturnType<typeof fixture>, patch: Record<string, unknown>) {
  f.request.context.contextText = JSON.stringify({ ...JSON.parse(f.request.context.contextText), ...patch });
  f.request.context.contextSha256 = sourceHash(f.request.context.contextText);
}

describe("context continuation protocol", () => {
  it("binds the independent recipe and reconstructs requested source and content", () => {
    const f = fixture(), plan = createSynthesisContextPlan(f.request, f.scope, f.args);
    expect(plan.header.recipeId).toBe("openplan.engagement.synthesis.context.v1");
    expect(plan.header.recipeSha256).toBe(synthesisContextRecipe().sha256);
    expect(synthesisContextRecipe().sha256).toBe("1ef05631ff83fbf8a85e08110c800f820586580b91c76824728de944d0d88abc");
    expect(plan.header.contentManifestSha256).toBe(f.content.manifestSha256);
    expect(plan.header.frameCount).toBe(f.content.frames.length);
    expect(plan.header.intentSha256).toBe(f.request.request.intentSha256);
    expect(plan.header.contextRequestSha256).toBe(f.request.context.contextSha256);
    expect(plan.header.actorId).toBe(f.request.request.actorId);
    expect(plan.headerSha256).toBe(sourceHash(plan.headerText));
    expect(plan.content).toEqual(f.content);
    const recipe = synthesisContextRecipe(); recipe.instructions = "changed"; recipe.outputSchema.properties.notes.type = "string";
    expect(synthesisContextRecipe().outputSchema.properties.notes.type).toBe("array");
    expect(synthesisContextRecipe().instructions).not.toBe("changed");
  });

  it("processes every long multilingual frame, preserving exact prior responses and replay", () => {
    const snapshot = makeSourceSnapshot(1); snapshot.items[0].body = "交通意見 é 😀 ".repeat(500) + "FINAL ORIGINAL";
    const f = fixture(snapshot), p = processor(f); expect(f.content.frames.length).toBeGreaterThan(3);
    const accepted: ReturnType<Processor["accept"]>[] = [];
    for (const frame of f.content.frames) {
      const r = response(p);
      expect(r.next.frameIndex).toBe(frame.index); expect(r.task.input.frame).toEqual(JSON.parse(frame.canonical));
      expect(r.task.input.headerSha256).toBe(p.headerSha256);
      expect(r.next.task.sha256).toBe(sourceHash(r.next.task.canonical));
      expect(r.next.task.utf8Bytes).toBe(Buffer.byteLength(r.next.task.canonical, "utf8"));
      if (accepted.length) {
        const prior = accepted.at(-1)!;
        expect(r.task.input.previous).toEqual({ resultSha256: prior.sha256, outputText: JSON.parse(prior.canonical).outputText });
      } else expect(r.task.input.previous).toBeNull();
      const value = p.accept(r.observe()); accepted.push(value);
      expect(value.sha256).toBe(sourceHash(value.canonical));
    }
    expect(p.next()).toMatchObject({ status: "frames_complete", frameCount: f.content.frames.length,
      previousResultSha256: accepted.at(-1)!.sha256, interpretation: "machine_unreviewed" });
    expect(processor(f, accepted).next()).toEqual(p.next());
    expect(processor(f, accepted.slice(0, 2)).retained()).toEqual(accepted.slice(0, 2));
    expect(() => p.accept({})).toThrow("no executable next frame");
    accepted[0].canonical = "changed"; expect(p.retained()[0].canonical).not.toBe("changed");
    const returned = p.retained(); returned[0].canonical = "changed"; returned.pop();
    expect(p.retained()).toHaveLength(f.content.frames.length); expect(p.retained()[0].canonical).not.toBe("changed");
  });

  it("refuses changed proposed bindings even when their hashes are recomputed", () => {
    for (const patch of [{ parentRequestId: "a0000000-0000-4000-8000-000000000099" }, { selectionSequence: 0 },
      { segmentResultsManifestSha256: "0".repeat(64) }, { contextManifestSha256: "0".repeat(64) },
      { contentManifestSha256: "0".repeat(64) }, { targetRecordId: "item:a0000000-0000-4000-8000-000000000099" }, { frameByteLimit: 8192 }]) {
      const f = fixture(); alterBinding(f, patch);
      if (patch.parentRequestId) f.request.context.parentRequestId = patch.parentRequestId;
      expect(() => processor(f)).toThrow("differs from requested inputs");
    }
    for (const key of ["sourceId", "sourceSha256"] as const) {
      const f = fixture(), intent = JSON.parse(f.request.request.intentText);
      intent[key] = key === "sourceId" ? f.scope.requestId : "0".repeat(64);
      f.request.request.intentText = JSON.stringify(intent); f.request.request.intentSha256 = sourceHash(f.request.request.intentText);
      expect(() => processor(f)).toThrow("differs from requested inputs");
    }
    for (const key of ["campaignId", "workspaceId"] as const) {
      const f = fixture(); f.scope[key] = f.scope.requestId; f.request[key] = f.scope.requestId;
      expect(() => processor(f)).toThrow("differs from requested inputs");
    }
    const damaged = fixture(); damaged.f.args.saved.snapshotText += " "; expect(() => processor(damaged)).toThrow();
    const changedPlan = fixture(); changedPlan.f.args.plan.tasks.pop(); expect(() => processor(changedPlan)).toThrow();
  });

  it("does not treat incomplete results as a context plan", () => {
    const f = fixture(); f.f.args.results.pop();
    const inventory = assembleSynthesisGenerationResults(f.f.args), context = createSynthesisGenerationContext(inventory, f.f.args, f.f.sequence);
    f.args[0] = context; f.args[1] = inventory;
    expect(() => processor(f)).toThrow("complete contribution inputs");
  });

  it("leaves malformed, truncated, partial and uncited outputs unaccepted", () => {
    const f = fixture();
    const changes = [
      (r: ReturnType<typeof response>) => { r.output.status = "incomplete"; },
      (r: ReturnType<typeof response>) => { r.output.coveredPartIds.pop(); },
      (r: ReturnType<typeof response>) => { r.output.coveredPartIds.push(r.output.coveredPartIds[0]); },
      (r: ReturnType<typeof response>) => { r.output.notes[0].citations[0].quote = "NOT RETAINED QUOTE"; },
      (r: ReturnType<typeof response>) => { r.output.notes[0].citations[0].partId = "0".repeat(64); },
      (r: ReturnType<typeof response>) => { r.output.notes[0].id = 99; },
      (r: ReturnType<typeof response>) => { r.output.notes[0].relatedNoteIds = [0]; },
    ];
    for (const change of changes) {
      const p = processor(f), r = response(p); change(r);
      expect(() => p.accept(r.observe())).toThrow(); expect(p.retained()).toEqual([]); expect(p.next()).toEqual(r.next);
    }
    for (const patch of [{ finishReason: "length" }, { finishReason: null }, { taskSha256: "0".repeat(64) },
      { outputText: "{" }, { outputText: "x".repeat(4_194_305) }]) {
      const p = processor(f), r = response(p); expect(() => p.accept({ ...r.observe(), ...patch })).toThrow(); expect(p.retained()).toEqual([]);
    }
    const p = processor(f), r = response(p); r.output.notes[0].citations = [];
    expect(() => p.accept(r.observe())).toThrow(); expect(p.retained()).toEqual([]);
  });

  it("matches Unicode code-point limits without cleaning original unusual output", () => {
    const f = fixture(), p = processor(f), r = response(p);
    r.output.notes[0].text = "😀".repeat(4000); r.output.uncertainties = ["SYNTHETIC original\u0000\ud800"];
    const saved = p.accept(r.observe()); expect(JSON.parse(saved.canonical).outputText).toBe(r.observe().outputText);
    const oversized = processor(f), tooLong = response(oversized); tooLong.output.notes[0].text = "😀".repeat(4001);
    expect(() => oversized.accept(tooLong.observe())).toThrow("4000 code points"); expect(oversized.retained()).toEqual([]);
  });

  it("counts the full UTF-8 task and refuses oversized output before advancing", () => {
    function start(taskByteLimit: number) {
      const p = processor(fixture(makeSourceSnapshot(1), taskByteLimit)), r = response(p);
      r.output.uncertainties = ["😀".repeat(1000)]; p.accept(r.observe()); return p;
    }
    const full = start(65536), next = full.next(); if (next.status !== "ready") throw new Error("Expected ready");
    expect(next.task.utf8Bytes).toBeGreaterThan(next.task.canonical.length);
    expect(start(next.task.utf8Bytes).next().status).toBe("ready");
    expect(start(next.task.utf8Bytes - 1).next()).toMatchObject({ status: "resource_limit", requiredTaskBytes: next.task.utf8Bytes });
    const oversized = processor(fixture()), r = response(oversized);
    expect(() => oversized.accept({ ...r.observe(), outputText: r.observe().outputText + " ".repeat(4_194_304) })).toThrow("retention limit");
    expect(oversized.retained()).toEqual([]);
  });

  it("preserves prior notes and uncertainty, permitting new qualifications with earlier citations", () => {
    const f = fixture();
    for (const change of [
      (r: ReturnType<typeof response>) => { r.output.notes.shift(); },
      (r: ReturnType<typeof response>) => { r.output.notes[0].text += " changed"; },
      (r: ReturnType<typeof response>) => { r.output.uncertainties.shift(); },
      (r: ReturnType<typeof response>) => { r.output.uncertainties[0] += " changed"; },
      (r: ReturnType<typeof response>) => { r.output.notes[1].relatedNoteIds = [0, 0]; },
    ]) {
      const p = processor(f), first = response(p); p.accept(first.observe()); const retained = p.retained(), r = response(p); change(r);
      expect(() => p.accept(r.observe())).toThrow(); expect(p.retained()).toEqual(retained);
    }
    const p = processor(f), first = response(p); p.accept(first.observe()); const r = response(p);
    r.output.notes[1].text = "SYNTHETIC qualification preserves earlier interpretation";
    r.output.notes[1].citations = first.output.notes[0].citations;
    p.accept(r.observe()); expect(p.retained()).toHaveLength(2);
  });

  it.each(["requestId", "headerSha256", "frameIndex", "previousResultSha256", "taskSha256", "outputSha256", "finishReason", "recordSha256"])("rejects changed resumed %s", field => {
    const f = fixture(), p = processor(f); p.accept(response(p).observe()); const record = p.retained()[0];
    if (field === "recordSha256") {
      expect(() => processor(f, [{ ...record, sha256: "0".repeat(64) }])).toThrow(); return;
    }
    const value = field === "requestId" ? f.scope.workspaceId : field === "frameIndex" ? 1 : field === "finishReason" ? "length" : "0".repeat(64);
    const canonical = JSON.stringify({ ...JSON.parse(record.canonical), [field]: value });
    expect(() => processor(f, [{ canonical, sha256: sourceHash(canonical) }])).toThrow();
  });

  it("rejects reordered, duplicate and respelled history", () => {
    const f = fixture(), p = processor(f); p.accept(response(p).observe()); p.accept(response(p).observe());
    const records = p.retained();
    const spaced = records[0].canonical + " "; expect(() => processor(f, [{ canonical: spaced, sha256: sourceHash(spaced) }])).toThrow("bytes differ");
    expect(() => processor(f, records.toReversed())).toThrow(); expect(() => processor(f, [records[0], records[0]])).toThrow();
  });

  it("retains original output whitespace, isolates caller mutation and stops at the complete task byte limit", () => {
    const f = fixture(), p = processor(f), first = response(p), observation = first.observe(); observation.outputText += " ";
    p.accept(observation); f.scope.requestId = f.scope.workspaceId;
    expect(response(p).task.input.requestId).toBe(f.request.request.id);
    expect(response(p).task.input.previous.outputText).toBe(observation.outputText);
    const low = fixture(makeSourceSnapshot(1), 4096), held = processor(low);
    expect(held.next()).toMatchObject({ status: "resource_limit", frameIndex: 0, taskByteLimit: 4096 });
    expect(() => held.accept({})).toThrow("no executable next frame"); expect(held.retained()).toEqual([]);
    const large = processor(fixture()), r = response(large); r.output.uncertainties = Array.from({ length: 20 }, () => "😀".repeat(1900));
    large.accept(r.observe()); expect(large.next()).toMatchObject({ status: "resource_limit", frameIndex: 1 });
    expect(JSON.parse(large.retained()[0].canonical).outputText).toBe(r.observe().outputText);
  });
});
