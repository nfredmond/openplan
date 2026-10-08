// @vitest-environment node
import { describe, expect, it } from "vitest";
import { verifySynthesisThematicInputSeal } from "@/lib/engagement/synthesis-thematic-input-manifest";
import { synthesisGenerationJSONFields } from "@/lib/engagement/synthesis-generation-records";
import { createSynthesisThematicContent, type SynthesisThematicPart } from "@/lib/engagement/synthesis-thematic-content";
import { createSynthesisThematicPlan, synthesisThematicRecipe } from "@/lib/engagement/synthesis-thematic-continuation";
import { loadSynthesisThematicPlan } from "@/lib/engagement/synthesis-thematic-plan-server";
import { thematicProposalInputsFixture } from "./fixtures/engagement/synthesis-thematic-proposal-inputs";
import { thematicContinuationFixture as fixture, thematicSyntheticResponse as response } from "./fixtures/engagement/synthesis-thematic-continuation";
import { sourceHash as hash } from "./fixtures/engagement/synthesis-source";

function finish(f = fixture()) {
  const continuation = f.create();
  for (;;) {
    const task = continuation.next(); if (task.status !== "ready") return { f, continuation, task };
    continuation.accept({ taskSha256: task.task.sha256, outputText: JSON.stringify(response(task)), finishReason: "stop" });
  }
}

describe("versioned thematic content and continuation", () => {
  it("accepts the complete UTF-8 task at its byte limit and refuses one byte less", () => {
    function nextAfterUnicode(taskByteLimit: number) {
      const run = fixture(1, taskByteLimit).create(), first = run.next();
      if (first.status !== "ready") throw new Error("Expected executable first task");
      const output = { ...response(first), uncertainties: ["😀".repeat(1000)] };
      run.accept({ taskSha256: first.task.sha256, outputText: JSON.stringify(output), finishReason: "stop" });
      return run.next();
    }
    const next = nextAfterUnicode(65536);
    if (next.status !== "ready") throw new Error("Expected executable continuation");
    expect(next.task.utf8Bytes).toBeGreaterThan(next.task.canonical.length);
    expect(nextAfterUnicode(next.task.utf8Bytes).status).toBe("ready");
    expect(nextAfterUnicode(next.task.utf8Bytes - 1)).toMatchObject({ status: "resource_limit", requiredTaskBytes: next.task.utf8Bytes });
  });

  it("frames all 302 mixed contributions and reconstructs every original field without clipping", () => {
    const f = fixture(301), content = createSynthesisThematicContent(f.prepared);
    expect(content.manifest.contributionIds).toEqual(f.targets); expect(content.entities).toHaveLength(605);
    expect(content.entities[0].canonical).toBe(f.source.snapshotText);
    expect(content.entities.filter(row => row.kind === "context_output").map(row => row.canonical)).toEqual(f.prepared.originals.map(row => row.outputText));
    const parts: SynthesisThematicPart[] = [];
    for (const [index, frame] of content.frames.entries()) {
      expect(frame.index).toBe(index); expect(frame.sha256).toBe(hash(frame.canonical));
      expect(frame.utf8Bytes).toBe(Buffer.byteLength(frame.canonical)); expect(frame.utf8Bytes).toBeLessThanOrEqual(4096);
      const body = JSON.parse(frame.canonical); expect(body.purpose).toBe("private_synthesis_thematic_content_frame"); expect(body.rangeUnit).toBe("utf16_code_units"); expect(body.inputManifestSha256).toBe(f.prepared.plan.manifestSha256); parts.push(...body.parts);
    }
    for (const entity of content.entities) {
      expect(entity.sha256).toBe(hash(entity.canonical));
      const fields = entity.kind === "context_output" ? [
        { pointer: "", kind: "object" as const, childCount: 1 },
        { pointer: "/originalOutputText", kind: "string" as const, text: entity.canonical },
      ] : synthesisGenerationJSONFields(entity.canonical);
      for (const [fieldIndex, field] of fields.entries()) {
        const fragments = parts.filter(part => part.entityId === entity.id && part.fieldIndex === fieldIndex);
        expect(fragments.length).toBeGreaterThan(0);
        for (const part of fragments) {
          const { id, ...body } = part; expect(id).toBe(hash(JSON.stringify(body)));
          expect(part).toMatchObject({ entityKind: entity.kind, sourceId: entity.sourceId, pointer: field.pointer, kind: field.kind, fieldSha256: hash(JSON.stringify(field)) });
        }
        if ("childCount" in field) expect(fragments).toHaveLength(1);
        if ("childCount" in field) expect(fragments[0]).toMatchObject({ childCount: field.childCount });
        else {
          let end = 0, reconstructed = "";
          for (const part of fragments) { expect("text" in part).toBe(true); if (!("text" in part)) throw new Error("Missing scalar");
            expect(part.start).toBe(end); expect(part.end).toBe(part.start + part.text.length); expect(part.length).toBe(field.text.length);
            if (field.text.isWellFormed()) expect(part.text.isWellFormed()).toBe(true);
            reconstructed += part.text; end = part.end; }
          expect(reconstructed).toBe(field.text); expect(end).toBe(field.text.length);
        }
      }
    }
    expect(content.manifestSha256).toBe(hash(JSON.stringify(content.manifest)));
  });
  it("completes all 302 mixed contributions without losing contextual uncertainty", () => {
    const { f, continuation, task } = finish(fixture(301)); expect(task.status).toBe("proposal_complete");
    if (task.status !== "proposal_complete") throw new Error("Missing complete proposal");
    expect(task.proposal.content.assignedSourceCount).toBe(302); expect(task.proposal.content.contextEvidence).toEqual(f.prepared.input.contexts);
    expect(task.proposal.content.groups[0].sourceIds).toEqual(f.targets);
    expect(f.create(continuation.retained()).next()).toEqual(task);
  });
  it("preserves exact numeric tokens and explicitly missing historical definitions", () => {
    const f = fixture(0, 1_048_576, text => text.replace('"missing": null', '"missing": 9007199254740993'));
    const content = createSynthesisThematicContent(f.prepared);
    const parts = content.frames.flatMap(frame => JSON.parse(frame.canonical).parts) as SynthesisThematicPart[];
    expect(parts.find(part => part.entityKind === "source" && part.pointer === "/answers/0/answer_json/missing")).toMatchObject({ kind: "number", text: "9007199254740993" });
    const missing = fixture(0, 1_048_576, text => { const source = JSON.parse(text); source.definitions = []; source.campaign.configurationVersionId = null; source.sessions.forEach((row: { configuration_version_id: string | null }) => { row.configuration_version_id = null; }); return JSON.stringify(source); });
    const original = createSynthesisThematicContent(missing.prepared).entities[0];
    expect(JSON.parse(original.canonical).definitions).toEqual([]);
    expect(JSON.parse(original.canonical).answers[0].question_prompt_snapshot).toBe("SYNTHETIC original question");
  });
  it.each(["duplicate-key", "escape"])("preserves exact provider %s bytes through frames", kind => {
    const f = fixture(0), original = f.prepared.originals[0], entry = f.entries[0];
    original.outputText = kind === "duplicate-key" ? '{"uncertainties":["SYNTHETIC SHADOWED ORIGINAL"],' + original.outputText.trim().slice(1)
      : original.outputText.replace("SYNTHETIC", "\\u0053YNTHETIC");
    original.proofText = JSON.stringify({ ...JSON.parse(original.proofText), outputSha256: hash(original.outputText) });
    Object.assign(entry, { proofText: original.proofText, proofSha256: hash(original.proofText), outputSha256: hash(original.outputText), outputBytes: Buffer.byteLength(original.outputText) });
    f.prepared.plan = f.build(); f.prepared.seal = verifySynthesisThematicInputSeal(f.makeSeal(f.prepared.plan), f.prepared.plan);
    f.prepared.input.manifestSha256 = f.prepared.plan.manifestSha256;
    const content = createSynthesisThematicContent(f.prepared);
    const parts = content.frames.flatMap(frame => JSON.parse(frame.canonical).parts) as SynthesisThematicPart[];
    const originalParts = parts.filter(part => part.entityKind === "context_output" && part.sourceId === original.targetRecordId && part.pointer === "/originalOutputText");
    const reconstructed = originalParts.map(part => "text" in part ? part.text : "").join("");
    expect(reconstructed).toBe(original.outputText);
    expect(content.input.contexts).toEqual(f.prepared.input.contexts);
    if (kind === "duplicate-key") expect(reconstructed).toContain("SYNTHETIC SHADOWED ORIGINAL");
    else expect(reconstructed).toContain("\\u0053YNTHETIC");
  });
  it.each(["container", "scalar"])("refuses %s field metadata above the selected frame budget", kind => {
    const f = fixture(0, 1_048_576, text => { const source = JSON.parse(text);
      source.answers[0].answer_json = { ["K".repeat(6000)]: kind === "container" ? {} : "value" }; return JSON.stringify(source); });
    expect(() => createSynthesisThematicContent(f.prepared)).toThrow("field metadata exceeds the frame limit");
  });
  it("refuses a nonsequential note even when its projection and sealed bytes agree", () => {
    const f = fixture(0), original = f.prepared.originals[0], entry = f.entries[0], output = JSON.parse(original.outputText);
    output.notes[0].id = 2; f.prepared.input.contexts[0].notes[0].id = 2;
    original.outputText = JSON.stringify(output); original.proofText = JSON.stringify({ ...JSON.parse(original.proofText), outputSha256: hash(original.outputText) });
    Object.assign(entry, { proofText: original.proofText, proofSha256: hash(original.proofText), outputSha256: hash(original.outputText), outputBytes: Buffer.byteLength(original.outputText) });
    f.prepared.plan = f.build(); f.prepared.seal = verifySynthesisThematicInputSeal(f.makeSeal(f.prepared.plan), f.prepared.plan);
    f.prepared.input.manifestSha256 = f.prepared.plan.manifestSha256;
    expect(() => createSynthesisThematicContent(f.prepared)).toThrow("projection differs from original context");
  });
  it("loads a plan through actual sealed input replay with transport mocked and no writes", async () => {
    const f = await thematicProposalInputsFixture(), plan = await loadSynthesisThematicPlan(f.service, f.scope, f.f.f.controller.signal);
    expect(plan.content.input.contexts).toHaveLength(2); expect(plan.header.inputManifestSha256).toBe(f.plan().manifestSha256);
    expect(f.calls.every(call => call.name.startsWith("read_"))).toBe(true);
    f.f.bundle.thematic.cancellation = { retained: true };
    await expect(loadSynthesisThematicPlan(f.service, f.scope, f.f.f.controller.signal)).rejects.toThrow("cancelled");
  });
  it("binds the request, complete seal, recipe and all content in a deterministic plan", () => {
    const f = fixture(), plan = createSynthesisThematicPlan(f.prepared), recipe = synthesisThematicRecipe();
    expect(recipe.sha256).toBe("7310c615ecff9ec8d67f498d188321c2bc104cec6020b206481953c7f88eda69");
    expect(plan.header).toMatchObject({ requestId: f.scope.requestId, actorId: f.request.request.actorId,
      intentSha256: f.request.request.intentSha256, thematicRequestSha256: f.request.thematic.thematicSha256,
      inputSealSha256: f.prepared.seal.receiptSha256, inputManifestSha256: f.prepared.plan.manifestSha256,
      recipeId: recipe.id, recipeSha256: recipe.sha256, contentManifestSha256: plan.content.manifestSha256,
      frameCount: plan.content.frames.length, taskCount: plan.content.frames.length + 1, taskByteLimit: 1_048_576 });
    expect(plan.headerSha256).toBe(hash(plan.headerText)); expect(createSynthesisThematicPlan(f.prepared)).toEqual(plan);
    recipe.frameInstructions = "caller changed"; expect(synthesisThematicRecipe().frameInstructions).not.toBe(recipe.frameInstructions);
  });
  it("preserves Unicode code-point limits and refuses uncertainty that cannot enter the final proposal", () => {
    const run = fixture().create(), task = run.next(); if (task.status !== "ready") throw new Error("Missing frame");
    const output = response(task) as { notes: Array<{ text: string }>; uncertainties: string[] };
    for (const bad of ["\ud800", "NUL\0text", " "]) {
      output.uncertainties = [bad]; expect(() => run.accept({ taskSha256: task.task.sha256, outputText: JSON.stringify(output), finishReason: "stop" })).toThrow("schema differs");
    }
    output.uncertainties = ["SYNTHETIC uncertainty"]; output.notes[0].text = "😀".repeat(4001);
    expect(() => run.accept({ taskSha256: task.task.sha256, outputText: JSON.stringify(output), finishReason: "stop" })).toThrow("schema differs");
    output.notes[0].text = "😀".repeat(4000);
    expect(run.accept({ taskSha256: task.task.sha256, outputText: JSON.stringify(output), finishReason: "stop" }).sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(["cancelled", "inventory", "source", "output", "projection", "missing", "seal", "sequence"])("refuses inconsistent prepared %s", kind => {
    const f = fixture();
    if (kind === "cancelled") f.prepared.request.state.cancellation = {};
    if (kind === "inventory") f.prepared.input.manifestSha256 = "0".repeat(64);
    if (kind === "source") f.prepared.source.snapshotText += " ";
    if (kind === "output") f.prepared.originals[0].outputText += " ";
    if (kind === "projection") f.prepared.input.contexts[0].notes[0].text = "lost";
    if (kind === "missing") f.prepared.originals.pop();
    if (kind === "seal") f.prepared.seal.receiptSha256 = "0".repeat(64);
    if (kind === "sequence") f.prepared.input.contexts[0].selectionSequence = -1;
    expect(() => f.create()).toThrow();
  });
  it("replays interrupted survey-only and mixed processing through an original unreviewed proposal", () => {
    for (const count of [0, 2]) {
      const { f, continuation, task } = finish(fixture(count)); expect(task.status).toBe("proposal_complete");
      if (task.status !== "proposal_complete") throw new Error("Missing proposal");
      expect(task.proposal.content.assignedSourceCount).toBe(count + 1);
      expect(task.proposal.content.contextEvidence).toEqual(f.prepared.input.contexts);
      expect(task.proposal.content.thematicUncertainties).toEqual(["SYNTHETIC minority position remains uncertain"]);
      const retained = continuation.retained();
      expect(retained.length).toBe(createSynthesisThematicPlan(f.prepared).header.taskCount);
      expect(task.proposal.outputText).toBe(JSON.parse(retained.at(-1)!.canonical).outputText);
      const split = Math.floor(retained.length / 2), resumed = f.create(retained.slice(0, split));
      for (const record of retained.slice(split)) { const body = JSON.parse(record.canonical); expect(resumed.accept({ taskSha256: body.taskSha256,
        outputText: body.outputText, finishReason: body.finishReason })).toEqual(record); }
      expect(resumed.next()).toEqual(task); expect(f.create(retained).next()).toEqual(task);
      retained[0].canonical = "changed"; task.proposal.content.notes = "changed";
      expect(continuation.retained()[0].canonical).not.toBe("changed"); expect(continuation.next()).toEqual(resumed.next());
      expect(() => continuation.accept({})).toThrow("no executable next task");
    }
  });
  it("binds every task to its original frame or final evidence and exact preceding response", () => {
    const f = fixture(), run = f.create(), plan = createSynthesisThematicPlan(f.prepared), recipe = synthesisThematicRecipe();
    let index = 0, prior: { resultSha256: string; outputText: string } | null = null;
    for (;;) {
      const task = run.next(); if (task.status === "proposal_complete") break;
      if (task.status !== "ready") throw new Error("Unexpected resource limit");
      expect(task.task.sha256).toBe(hash(task.task.canonical)); expect(task.task.utf8Bytes).toBe(Buffer.byteLength(task.task.canonical));
      expect(task.task.utf8Bytes).toBeLessThanOrEqual(plan.header.taskByteLimit);
      const body = JSON.parse(task.task.canonical);
      expect(body.input).toMatchObject({ purpose: "private_synthesis_thematic_continuation", requestId: f.scope.requestId,
        headerSha256: plan.headerSha256, inputManifestSha256: plan.header.inputManifestSha256, contentManifestSha256: plan.content.manifestSha256,
        taskIndex: index, frameCount: plan.header.frameCount, stage: task.stage, previous: prior });
      if (task.stage === "frame") { expect(body.input.frame).toEqual(JSON.parse(plan.content.frames[index].canonical));
        expect(body.instructions).toBe(recipe.frameInstructions); expect(body.outputSchema).toEqual(recipe.frameOutputSchema); }
      else { expect(body.input.contexts).toEqual(f.prepared.input.contexts); expect(body.input).not.toHaveProperty("frame");
        expect(body.instructions).toBe(recipe.proposalInstructions); expect(body.outputSchema).toEqual(recipe.proposalOutputSchema); }
      const outputText = JSON.stringify(response(task), null, 2);
      const retained = run.accept({ taskSha256: task.task.sha256, outputText, finishReason: "stop" });
      prior = { resultSha256: retained.sha256, outputText }; index++;
    }
    expect(index).toBe(plan.header.taskCount);
  });
  it("keeps inputs detached from later caller changes", () => {
    const f = fixture(), run = f.create(), before = run.next();
    f.prepared.input.contexts[0].notes[0].text = "changed"; f.prepared.source.snapshotText = "changed";
    expect(run.next()).toEqual(before);
  });
  it.each(["task", "truncated", "json", "schema", "coverage", "incomplete", "citation", "reference", "oversize"])("refuses %s without advancing the journal", kind => {
    const run = fixture().create(), task = run.next(); if (task.status !== "ready" || task.stage !== "frame") throw new Error("Missing frame");
    const output = response(task) as { status: string; coveredPartIds: string[]; notes: Array<{ id: number; citations: Array<{ partId: string; quote: string }>; relatedNoteIds: number[] }> };
    if (kind === "coverage") output.coveredPartIds.pop(); if (kind === "incomplete") output.status = "incomplete";
    if (kind === "citation") output.notes[0].citations[0].quote = "NEVER RETAINED QUOTE";
    if (kind === "reference") output.notes[0].relatedNoteIds = [0];
    const outputText = kind === "json" ? "{" : kind === "schema" ? "{}" : kind === "oversize" ? JSON.stringify({ ...output, uncertainties: Array.from({ length: 1100 }, () => "S".repeat(4000)) }) : JSON.stringify(output);
    expect(() => run.accept({ taskSha256: kind === "task" ? "0".repeat(64) : task.task.sha256, outputText,
      finishReason: kind === "truncated" ? "length" : "stop" })).toThrow();
    expect(run.retained()).toEqual([]); expect(run.next()).toEqual(task);
  });
  it.each(["notes", "uncertainties"])("refuses rewritten earlier %s", field => {
    const run = fixture().create(), first = run.next(); if (first.status !== "ready") throw new Error("Missing frame");
    run.accept({ taskSha256: first.task.sha256, outputText: JSON.stringify(response(first)), finishReason: "stop" });
    const second = run.next(); if (second.status !== "ready" || second.stage !== "frame") throw new Error("Missing next frame");
    const output = { ...response(second), [field]: [] };
    expect(() => run.accept({ taskSha256: second.task.sha256, outputText: JSON.stringify(output), finishReason: "stop" })).toThrow("discarded or rewrote");
    expect(run.retained()).toHaveLength(1);
  });
  it("refuses final missing membership, unsupported citation and lost uncertainty", () => {
    const run = fixture().create(); let task = run.next();
    while (task.status === "ready" && task.stage === "frame") { run.accept({ taskSha256: task.task.sha256, outputText: JSON.stringify(response(task)), finishReason: "stop" }); task = run.next(); }
    if (task.status !== "ready") throw new Error("Missing proposal task");
    for (const kind of ["membership", "citation", "uncertainty"]) {
      const output = response(task) as { groups: Array<{ members: Array<{ citations: Array<{ quote: string }> }> }>; uncertainties: string[] };
      if (kind === "membership") output.groups[0].members.pop();
      if (kind === "citation") output.groups[0].members[0].citations[0].quote = "NOT ORIGINAL";
      if (kind === "uncertainty") output.uncertainties = [];
      expect(() => run.accept({ taskSha256: task.task.sha256, outputText: JSON.stringify(output), finishReason: "stop" })).toThrow();
      expect(run.next()).toEqual(task);
    }
  });
  it.each(["hash", "request", "header", "index", "prior", "output-hash", "task", "extra", "encoding", "reorder"])("rejects corrupted retained %s", kind => {
    const { f, continuation } = finish(), retained = continuation.retained(); const result = JSON.parse(retained[0].canonical);
    if (kind === "request") result.requestId = f.source.requestId;
    if (kind === "header") result.headerSha256 = "0".repeat(64);
    if (kind === "index") result.taskIndex = 1;
    if (kind === "prior") result.previousResultSha256 = "0".repeat(64);
    if (kind === "output-hash") result.outputSha256 = "0".repeat(64);
    if (kind === "task") result.taskSha256 = "0".repeat(64);
    if (kind === "extra") result.extra = true;
    retained[0] = { canonical: JSON.stringify(result), sha256: hash(JSON.stringify(result)) };
    if (kind === "hash") retained[0].sha256 = "0".repeat(64);
    if (kind === "encoding") { retained[0].canonical = JSON.stringify(result, null, 2); retained[0].sha256 = hash(retained[0].canonical); }
    if (kind === "reorder") retained.reverse();
    if (["hash", "request", "header", "index", "prior", "output-hash", "reorder"].includes(kind)) expect(() => f.create(retained)).toThrow("continuation identity differs");
    else if (kind === "encoding") expect(() => f.create(retained)).toThrow("continuation bytes differ");
    else expect(() => f.create(retained)).toThrow();
  });
  it("stops at a final proposal byte ceiling after retaining every evidence frame", () => {
    const f = fixture(301, 65536), { continuation, task } = finish(f);
    expect(task.status).toBe("resource_limit"); if (task.status !== "resource_limit") throw new Error("Missing final limit");
    expect(task.stage).toBe("proposal"); expect(task.requiredTaskBytes).toBeGreaterThan(65536);
    expect(continuation.retained()).toHaveLength(createSynthesisThematicPlan(f.prepared).header.frameCount);
    expect(f.create(continuation.retained()).next()).toEqual(task);
  });
  it("stops when full preceding state exceeds the next task ceiling", () => {
    const f = fixture(1, 65536), run = f.create(), first = run.next(); if (first.status !== "ready") throw new Error("Missing frame");
    const output = { ...response(first), uncertainties: Array.from({ length: 20 }, () => "S".repeat(4000)) };
    const retained = run.accept({ taskSha256: first.task.sha256, outputText: JSON.stringify(output), finishReason: "stop" });
    const next = run.next(); expect(next.status).toBe("resource_limit");
    expect(JSON.parse(retained.canonical).outputText).toBe(JSON.stringify(output)); expect(f.create([retained]).next()).toEqual(next);
  });
  it("reports a task byte limit without clipping any input or accepting output", () => {
    const f = fixture(1, 4096), run = f.create(), task = run.next(); expect(task.status).toBe("resource_limit");
    if (task.status !== "resource_limit") throw new Error("Missing resource limit");
    expect(task.requiredTaskBytes).toBeGreaterThan(task.taskByteLimit); expect(task.taskIndex).toBe(0);
    expect(() => run.accept({})).toThrow("no executable next task"); expect(run.retained()).toEqual([]);
  });
});
