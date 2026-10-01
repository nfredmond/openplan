import { createSynthesisGenerationInput } from "@/lib/engagement/synthesis-generation-input";
import { createSynthesisGenerationRecords } from "@/lib/engagement/synthesis-generation-records";
import { createSynthesisGenerationTasks, type SynthesisGenerationTaskInput } from "@/lib/engagement/synthesis-generation-tasks";
import { assembleSynthesisGenerationResults, createSynthesisGenerationResult, type SynthesisGenerationCapture } from "@/lib/engagement/synthesis-generation-results";
import { createSynthesisGenerationContext } from "@/lib/engagement/synthesis-generation-context";
import { createSynthesisGenerationContextContent } from "@/lib/engagement/synthesis-generation-context-content";
import { makeSourceSnapshot, savedSource, sourceHash, sourceScope } from "./synthesis-source";

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
export function contextInputFixture(snapshot = makeSourceSnapshot(1), taskByteLimit = 65536, frameByteLimit = 4096) {
  const f = inputs(snapshot), target = f.args.records.contributionIds[0];
  const args: Parameters<typeof createSynthesisGenerationContextContent> = [f.context, f.inventory, f.args, f.sequence, target, frameByteLimit];
  const content = createSynthesisGenerationContextContent(...args);
  const scope = { campaignId: sourceScope.campaignId, workspaceId: sourceScope.workspaceId, requestId: "a0000000-0000-4000-8000-000000000080" };
  const intentText = JSON.stringify({ schemaVersion: 1, sourceId: sourceScope.requestId, sourceSha256: f.args.saved.snapshotSha256,
    connectionId: "a0000000-0000-4000-8000-000000000081", configurationRevisionId: f.args.job.configurationRevisionId,
    configurationHash: f.args.job.configurationHash, modelId: "synthetic-context", taskByteLimit });
  const contextText = JSON.stringify({ schemaVersion: 1, parentRequestId: f.args.job.jobId, selectionSequence: f.sequence,
    segmentResultsManifestSha256: f.inventory.manifestSha256, contextManifestSha256: f.context.manifestSha256,
    contentManifestSha256: content.manifestSha256, targetRecordId: target, frameByteLimit });
  const request = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    request: { id: scope.requestId, actorId: "a0000000-0000-4000-8000-000000000082", intentText,
      intentSha256: sourceHash(intentText), createdAt: "2026-09-30T00:00:00Z" },
    context: { parentRequestId: f.args.job.jobId, contextText, contextSha256: sourceHash(contextText), createdAt: "2026-09-30T00:00:00Z" }, cancellation: null };
  return { f, args, content, scope, request };
}
