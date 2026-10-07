// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inspectSynthesisThematicChoicePreview, inspectSynthesisThematicChoiceReceipt, synthesisThematicChoiceCommandSchema } from "@/lib/engagement/synthesis-thematic-choice-command";

const id = (n: number) => `c7720000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const scope = { campaignId: id(1), workspaceId: id(2), actorId: id(3) };
const selection = { requestId: id(4), contextRequestId: id(5), throughSequence: 7, targetRecordId: `item:${id(6)}` };
const choice = { schemaVersion: 1, targetRecordId: selection.targetRecordId, contextRequestId: selection.contextRequestId,
  selectionSequence: 7, historyManifestSha256: hash("history"), finalCaptureSha256: hash("capture"), finalResultSha256: hash("result") };
const choiceText = JSON.stringify(choice);
const command = { ...selection, expected: { requestIntentSha256: hash("intent"), thematicSha256: hash("thematic"), choiceText } };
const outputExcerpt = JSON.stringify({ status: "complete", coveredPartIds: [], notes: [], uncertainties: ["SYNTHETIC completed context, sin aprobación"] });
const preview = { schemaVersion: 1, ...scope, command, choiceSha256: hash(choiceText), cancelled: false,
  outputText: outputExcerpt, outputExcerpt, outputExcerptTruncated: false, outputBytes: Buffer.byteLength(outputExcerpt), outputSha256: hash(outputExcerpt), interpretation: "machine_unreviewed" };
const receipt = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: selection.requestId,
  targetRecordId: selection.targetRecordId, choiceText, choiceSha256: hash(choiceText), createdBy: scope.actorId,
  createdAt: "2026-10-07T08:00:00Z", replayed: false };

describe("exact inspected thematic choice contract", () => {
  it("accepts scoped original and replayed receipts, preserving exact choice text", async () => {
    expect(await inspectSynthesisThematicChoicePreview(preview, scope, selection)).toEqual(preview);
    for (const replayed of [false, true]) expect(await inspectSynthesisThematicChoiceReceipt({ ...receipt, replayed }, scope, command)).toEqual({ ...receipt, replayed });
  });
  it.each(["targetRecordId", "contextRequestId", "selectionSequence"])("refuses choice bytes for a different %s", key => {
    const changed = { ...choice, [key]: key === "selectionSequence" ? 8 : key === "targetRecordId" ? `item:${id(90)}` : id(90) };
    expect(synthesisThematicChoiceCommandSchema.safeParse({ ...command, expected: { ...command.expected, choiceText: JSON.stringify(changed) } }).success).toBe(false);
  });
  it.each([{ ...command, expected: undefined }, { ...command, actorId: id(99) }, { ...command, execute: true },
    { ...command, requestId: selection.contextRequestId }, { ...command, throughSequence: 7.5 },
    { ...command, expected: { ...command.expected, choiceText: "{" } },
    { ...command, expected: { ...command.expected, choiceText: JSON.stringify({ ...choice, approve: true }) } },
  ])("refuses incomplete, ambiguous or unregistered command %j", value => {
    expect(synthesisThematicChoiceCommandSchema.safeParse(value).success).toBe(false);
  });
  it.each(["campaignId", "workspaceId", "createdBy", "requestId", "targetRecordId", "choiceSha256", "choiceText"])("rejects altered receipt %s", async key => {
    const changed = { ...receipt, [key]: key === "choiceSha256" ? hash("changed") : key === "choiceText" ? choiceText + " " : key === "targetRecordId" ? `item:${id(99)}` : id(99) };
    await expect(inspectSynthesisThematicChoiceReceipt(changed, scope, command)).rejects.toThrow("differs");
  });
  it("refuses self-hashed substituted choice bytes and missing replay state", async () => {
    const changed = choiceText + " ";
    await expect(inspectSynthesisThematicChoiceReceipt({ ...receipt, choiceText: changed, choiceSha256: hash(changed) }, scope, command)).rejects.toThrow("differs");
    await expect(inspectSynthesisThematicChoiceReceipt({ ...receipt, replayed: undefined }, scope, command)).rejects.toThrow();
  });
  it.each(["campaignId", "workspaceId", "actorId", "choiceSha256", "outputSha256", "outputBytes", "outputExcerpt"])("refuses altered preview %s", async key => {
    const changed = { ...preview, [key]: key === "outputBytes" ? 1 : key.endsWith("Sha256") ? hash("changed") : key === "outputExcerpt" ? "changed" : id(99) };
    await expect(inspectSynthesisThematicChoicePreview(changed, scope, selection)).rejects.toThrow("differs");
  });
  it.each(["requestId", "contextRequestId", "throughSequence", "targetRecordId"] as const)("refuses a preview for another selected %s", async key => {
    const expected = { ...selection, [key]: key === "throughSequence" ? 8 : key === "targetRecordId" ? `item:${id(99)}` : id(99) };
    await expect(inspectSynthesisThematicChoicePreview(preview, scope, expected)).rejects.toThrow("differs");
  });
  it("verifies complete output beyond a shortened raw excerpt", async () => {
    const outputText = JSON.stringify({ status: "complete", coveredPartIds: Array(50).fill(hash("part")), notes: [], uncertainties: ["SYNTHETIC meaning after identifiers"] });
    const full = { ...preview, outputText, outputExcerpt: outputText.slice(0, 1600), outputExcerptTruncated: true,
      outputBytes: Buffer.byteLength(outputText), outputSha256: hash(outputText) };
    expect((await inspectSynthesisThematicChoicePreview(full, scope, selection)).outputText).toBe(outputText);
    await expect(inspectSynthesisThematicChoicePreview({ ...full, outputText: outputText.replace("meaning", "altered") }, scope, selection)).rejects.toThrow("differs");
    await expect(inspectSynthesisThematicChoicePreview({ ...full, outputExcerptTruncated: false }, scope, selection)).rejects.toThrow("differs");
  });
  it.each(["incomplete", "invalid"])("refuses self-hashed %s context output", async kind => {
    const outputText = kind === "invalid" ? "SYNTHETIC invalid structure" : JSON.stringify({ status: "incomplete", coveredPartIds: [], notes: [], uncertainties: [] });
    await expect(inspectSynthesisThematicChoicePreview({ ...preview, outputText, outputExcerpt: outputText,
      outputBytes: Buffer.byteLength(outputText), outputSha256: hash(outputText) }, scope, selection)).rejects.toThrow();
  });
});
