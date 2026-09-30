import { describe, expect, it } from "vitest";
import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationRecords } from "@/lib/engagement/synthesis-generation-records";
import { createSynthesisGenerationTasks } from "@/lib/engagement/synthesis-generation-tasks";
import { assembleSynthesisGenerationResults, createSynthesisGenerationResult, verifySynthesisGenerationResult, verifySynthesisGenerationResults, type SynthesisGenerationCapture, type SynthesisGenerationJobBinding } from "@/lib/engagement/synthesis-generation-results";
import { makeSourceSnapshot, savedSource, sourceScope, sourceHash } from "./fixtures/engagement/synthesis-source";

function fixture(count = 1, empty = false) {
  const snapshot = makeSourceSnapshot(count);
  if (empty) { snapshot.answers = []; snapshot.counts.answers = 0; }
  const saved = savedSource(snapshot), input = createSynthesisGenerationInput(saved, sourceScope);
  const records = createSynthesisGenerationRecords(input, saved, sourceScope);
  const plan = createSynthesisGenerationTasks(records, input, saved, sourceScope, 4096);
  const job: SynthesisGenerationJobBinding = { jobId: "a0000000-0000-4000-8000-000000000010", planSha256: plan.manifestSha256,
    configurationRevisionId: "a0000000-0000-4000-8000-000000000011", configurationHash: "b".repeat(64), provider: "api_connection", modelId: "synthetic-fixture" };
  const selections = plan.tasks.map((task, index) => ({ taskSha256: task.sha256, attemptId: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
  const captures: SynthesisGenerationCapture[] = plan.tasks.map((task, index) => ({
    schemaVersion: 1, binding: { ...job, ...selections[index] }, startedAt: "2026-09-30T00:00:00Z", finishedAt: "2026-09-30T00:01:00Z",
    outcome: "returned", outputText: JSON.stringify({ status: "complete", coveredPartIds: JSON.parse(task.canonical).input.parts.map((part: { id: string }) => part.id), observations: [], uncertainty: "SYNTHETIC interpretation unassessed 意見" }, null, 2) + "\n",
    providerReceiptText: '{ "reportedModel": "SYNTHETIC server model", "requestId": "0001" }\n',
    finishReason: "stop", responseId: null, inputTokens: null, outputTokens: null, failureCode: null,
  }));
  const results = captures.map(capture => createSynthesisGenerationResult(capture.binding, capture));
  const args = { job, selections, results, plan, records, input, saved, scope: sourceScope, taskByteLimit: 4096 };
  return { args, captures };
}
function replaceCapture(args: ReturnType<typeof fixture>["args"], captures: SynthesisGenerationCapture[], patch: Partial<SynthesisGenerationCapture>) {
  const capture = { ...captures[0], ...patch };
  return { ...args, results: [createSynthesisGenerationResult(capture.binding, capture), ...args.results.slice(1)] };
}

describe("retained synthesis task result accounting", () => {
  it("preserves original output bytes and unknown metadata, with deterministic exact replay", () => {
    const { captures } = fixture(); const capture = captures[0];
    const receipt = createSynthesisGenerationResult(capture.binding, capture);
    expect(receipt.sha256).toBe(sourceHash(receipt.canonical));
    expect(verifySynthesisGenerationResult(capture.binding, receipt).capture).toEqual(capture);
    expect(JSON.parse(receipt.canonical).outputText).toBe(capture.outputText);
    expect(JSON.parse(receipt.canonical).providerReceiptText).toBe(capture.providerReceiptText);
    expect(JSON.parse(receipt.canonical).inputTokens).toBeNull();
    expect(JSON.parse(receipt.canonical).outputTokens).toBeNull();
    expect(createSynthesisGenerationResult(capture.binding, structuredClone(capture))).toEqual(receipt);
    expect(verifySynthesisGenerationResult(capture.binding, createSynthesisGenerationResult(capture.binding, { ...capture, inputTokens: 0, outputTokens: 0 })).capture.inputTokens).toBe(0);
    for (const outputText of [null, "", "partial\n😀", "\ud800"]) {
      const next = createSynthesisGenerationResult(capture.binding, { ...capture, outcome: "interrupted", outputText });
      expect(verifySynthesisGenerationResult(capture.binding, next).capture.outputText).toBe(outputText);
    }
  });

  it("accounts for every task beyond 300 contributions without declaring a completed synthesis", () => {
    const { args } = fixture(301); const before = JSON.stringify(args);
    const result = assembleSynthesisGenerationResults(args);
    expect(result.stage).toBe("segment_results");
    expect(result.status).toBe("ready_for_record_consolidation");
    expect(result.interpretation).toBe("not_assessed");
    expect(result.source).toEqual(args.records.source);
    expect(result.contributionIds).toEqual(args.records.contributionIds);
    expect(result.job).toEqual(args.job);
    expect(result.entries).toHaveLength(args.plan.tasks.length);
    for (const [index, entry] of result.entries.entries()) {
      expect(entry).toMatchObject({ taskIndex: index, taskSha256: args.plan.tasks[index].sha256,
        recordId: JSON.parse(args.plan.tasks[index].canonical).input.recordId, attemptId: args.selections[index].attemptId,
        receiptSha256: args.results[index].sha256, disposition: "validated_output" });
      expect(entry.parsed?.taskSha256).toBe(entry.taskSha256);
      expect(entry.parsed?.output.status).toBe("complete");
    }
    expect(result.results).toEqual(args.results);
    const { manifestSha256, ...manifest } = result;
    expect(manifestSha256).toBe(sourceHash(JSON.stringify({ ...manifest, results: result.results.map(row => ({ sha256: row.sha256 })) })));
    expect(verifySynthesisGenerationResults(structuredClone(result), args)).toEqual(result);
    expect(JSON.stringify(args)).toBe(before);
    expect(assembleSynthesisGenerationResults({ ...args, selections: [...args.selections].reverse(), results: [...args.results].reverse() })).toEqual(result);
  });

  it("distinguishes unstarted, awaiting and missing results without treating them as zero or complete", () => {
    const { args } = fixture();
    expect(assembleSynthesisGenerationResults({ ...args, selections: [], results: [] }).entries.every(row => row.disposition === "not_started")).toBe(true);
    const awaiting = assembleSynthesisGenerationResults({ ...args, results: [] });
    expect(awaiting.status).toBe("incomplete");
    expect(awaiting.entries.every(row => row.disposition === "awaiting_result" && row.receiptSha256 === null && row.parsed === null)).toBe(true);
    const missing = assembleSynthesisGenerationResults({ ...args, results: args.results.slice(1) });
    expect(missing.status).toBe("incomplete"); expect(missing.entries[0].disposition).toBe("awaiting_result");
    expect(missing.entries.slice(1).every(row => row.disposition === "validated_output")).toBe(true);
  });

  const incomplete: Array<[string, Partial<SynthesisGenerationCapture>, string]> = [
    ["failed despite valid JSON", { outcome: "failed", failureCode: "provider_failed" }, "failed"],
    ["interrupted despite valid JSON", { outcome: "interrupted" }, "interrupted"],
    ["length finish", { finishReason: "length" }, "provider_incomplete"],
    ["unknown finish", { finishReason: null }, "provider_incomplete"],
    ["tool request finish", { finishReason: "tool-calls" }, "provider_incomplete"],
    ["malformed output", { outputText: "{SYNTHETIC partial" }, "invalid_output"],
    ["empty output", { outputText: "" }, "invalid_output"],
    ["absent output", { outputText: null }, "invalid_output"],
    ["invalid structured output", { outputText: '{"status":"complete"}' }, "invalid_output"],
    ["declared incomplete", { outputText: JSON.stringify({ status: "incomplete", coveredPartIds: [], observations: [], uncertainty: "SYNTHETIC missing processing" }) }, "incomplete_output"],
  ];
  it.each(incomplete)("retains %s without allowing record consolidation", (_label, patch, disposition) => {
    const { args, captures } = fixture(); const changed = replaceCapture(args, captures, patch);
    const result = assembleSynthesisGenerationResults(changed);
    expect(result.status).toBe("incomplete"); expect(result.entries[0].disposition).toBe(disposition);
    expect(result.results[0]).toEqual(changed.results[0]);
    expect(JSON.parse(result.results[0].canonical).outputText).toBe(patch.outputText === undefined ? captures[0].outputText : patch.outputText);
  });

  it("rejects source, plan, attempt, backend and result substitution even when self-hashed", () => {
    const { args, captures } = fixture(); const capture = captures[0], expected = capture.binding;
    for (const patch of [{ jobId: sourceScope.requestId }, { planSha256: "c".repeat(64) }, { taskSha256: "d".repeat(64) },
      { configurationHash: "e".repeat(64) }, { configurationRevisionId: sourceScope.campaignId }, { attemptId: sourceScope.campaignId }, { provider: "codex" as const }, { modelId: "another-model" }]) {
      const changed = { ...capture, binding: { ...expected, ...patch } };
      const forged = { canonical: JSON.stringify(changed), sha256: sourceHash(JSON.stringify(changed)) };
      expect(() => verifySynthesisGenerationResult(expected, forged)).toThrow("different attempt");
    }
    const result = args.results[0];
    expect(() => verifySynthesisGenerationResult(expected, { ...result, sha256: "a".repeat(64) })).toThrow("differs");
    const canonical = " " + result.canonical;
    expect(() => verifySynthesisGenerationResult(expected, { canonical, sha256: sourceHash(canonical) })).toThrow("differs");
    expect(() => assembleSynthesisGenerationResults({ ...args, selections: [], results: [], job: { ...args.job, planSha256: "f".repeat(64) } })).toThrow("different plan");
    expect(() => assembleSynthesisGenerationResults({ ...args, scope: { ...args.scope, workspaceId: sourceScope.campaignId } })).toThrow();
    expect(() => assembleSynthesisGenerationResults({ ...args, taskByteLimit: 8192 })).toThrow("differ");
  });

  it("rejects ambiguous selections and original receipts substituted for a new attempt", () => {
    const { args } = fixture();
    expect(() => assembleSynthesisGenerationResults({ ...args, selections: [...args.selections, args.selections[0]] })).toThrow("duplicated");
    expect(() => assembleSynthesisGenerationResults({ ...args, selections: [...args.selections, { ...args.selections[0], attemptId: "e0000000-0000-4000-8000-000000000099" }] })).toThrow("duplicated");
    expect(() => assembleSynthesisGenerationResults({ ...args, selections: args.selections.map((row, index) => index === 1 ? { ...row, attemptId: args.selections[0].attemptId } : row) })).toThrow("duplicated");
    expect(() => assembleSynthesisGenerationResults({ ...args, selections: [...args.selections, { ...args.selections[0], taskSha256: "f".repeat(64), attemptId: "e0000000-0000-4000-8000-000000000099" }] })).toThrow("unknown");
    expect(() => assembleSynthesisGenerationResults({ ...args, results: [...args.results, args.results[0]] })).toThrow("unique selected");
    expect(() => assembleSynthesisGenerationResults({ ...args, selections: args.selections.slice(1) })).toThrow("unique selected");
    expect(() => assembleSynthesisGenerationResults({ ...args, selections: [{ ...args.selections[0], attemptId: "e0000000-0000-4000-8000-000000000099" }, ...args.selections.slice(1)] })).toThrow("different attempt");
  });

  it("refuses contradictory captures, invalid chronology and invalid token counts", () => {
    const { captures } = fixture(); const capture = captures[0];
    expect(() => createSynthesisGenerationResult(capture.binding, { ...capture, schemaVersion: 2 })).toThrow();
    expect(() => createSynthesisGenerationResult(capture.binding, { ...capture, extra: "unsupported" })).toThrow();
    expect(() => createSynthesisGenerationResult(capture.binding, { ...capture, finishedAt: "2026-09-29T23:59:59Z" })).toThrow("chronology");
    expect(() => createSynthesisGenerationResult(capture.binding, { ...capture, failureCode: "provider_failed" })).toThrow("contradicts");
    for (const count of [-1, 1.1, Number.MAX_SAFE_INTEGER + 1]) expect(() => createSynthesisGenerationResult(capture.binding, { ...capture, inputTokens: count })).toThrow();
  });

  it("retains an empty selection without requiring any model attempt", () => {
    const { args } = fixture(0, true);
    const result = assembleSynthesisGenerationResults({ ...args, selections: [], results: [] });
    expect(result.status).toBe("empty_selection"); expect(result.contributionIds).toEqual([]);
    expect(result.source).toEqual(args.records.source); expect(result.entries).toHaveLength(args.plan.tasks.length);
    expect(result.entries.every(row => row.disposition === "not_required_empty_selection")).toBe(true);
    expect(result.results).toEqual([]);
    expect(() => assembleSynthesisGenerationResults(args)).toThrow("does not require model attempts");
  });

  it("refuses an altered assembled inventory", () => {
    const { args } = fixture(); const result = assembleSynthesisGenerationResults(args); result.entries.pop();
    expect(() => verifySynthesisGenerationResults(result, args)).toThrow("differs");
  });
});
