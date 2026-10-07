import { z } from "zod";
import { synthesisContextOutputSchema } from "./synthesis-context-output";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const sequence = z.number().int().nonnegative().safe();
const target = z.string().regex(/^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export const synthesisThematicChoiceSelectionSchema = z.object({ requestId: id, contextRequestId: id,
  throughSequence: sequence, targetRecordId: target }).strict();
const choiceSchema = z.object({ schemaVersion: z.literal(1), targetRecordId: target, contextRequestId: id,
  selectionSequence: sequence, historyManifestSha256: hash, finalCaptureSha256: hash, finalResultSha256: hash }).strict();
export const synthesisThematicChoiceCommandSchema = synthesisThematicChoiceSelectionSchema.extend({
  expected: z.object({ requestIntentSha256: hash, thematicSha256: hash, choiceText: z.string().max(4096) }).strict(),
}).strict().superRefine((command, ctx) => {
  let raw: unknown;
  try { raw = JSON.parse(command.expected.choiceText); } catch { ctx.addIssue({ code: "custom", message: "Unreadable context choice" }); return; }
  const choice = choiceSchema.safeParse(raw);
  if (!choice.success || choice.data.targetRecordId !== command.targetRecordId || choice.data.contextRequestId !== command.contextRequestId ||
    choice.data.selectionSequence !== command.throughSequence || command.requestId === command.contextRequestId ||
    new TextEncoder().encode(command.expected.choiceText).byteLength > 4096) {
    ctx.addIssue({ code: "custom", message: "Inspected context choice differs" });
  }
});
export type SynthesisThematicChoiceCommand = z.infer<typeof synthesisThematicChoiceCommandSchema>;
export const synthesisThematicChoicePreviewSchema = z.object({ schemaVersion: z.literal(1), campaignId: id, workspaceId: id,
  actorId: id, command: synthesisThematicChoiceCommandSchema, choiceSha256: hash, cancelled: z.boolean(),
  outputText: z.string().max(4_194_304), outputExcerpt: z.string().max(1600), outputExcerptTruncated: z.boolean(), outputBytes: z.number().int().positive().max(4_194_304),
  outputSha256: hash, interpretation: z.literal("machine_unreviewed"),
}).strict();
export const synthesisThematicChoiceReceiptSchema = z.object({ schemaVersion: z.literal(1), campaignId: id, workspaceId: id,
  requestId: id, targetRecordId: target, choiceText: z.string().max(4096), choiceSha256: hash, createdBy: id,
  createdAt: z.string().datetime({ offset: true }), replayed: z.boolean(),
}).strict();
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
  byte => byte.toString(16).padStart(2, "0")).join("");
type Scope = { campaignId: string; workspaceId: string; actorId: string };

/** Verify the reply to the exact inspected command before browser custody clears.
 * These byte checks supplement authenticated native custody, not authorship.
 */
export async function inspectSynthesisThematicChoiceReceipt(raw: unknown, scope: Scope, rawCommand: SynthesisThematicChoiceCommand) {
  const command = synthesisThematicChoiceCommandSchema.parse(rawCommand), record = synthesisThematicChoiceReceiptSchema.parse(raw);
  if (record.campaignId !== scope.campaignId || record.workspaceId !== scope.workspaceId || record.createdBy !== scope.actorId ||
    record.requestId !== command.requestId || record.targetRecordId !== command.targetRecordId ||
    record.choiceText !== command.expected.choiceText || record.choiceSha256 !== await digest(record.choiceText)) {
    throw new Error("Saved thematic choice differs from the inspected command");
  }
  return record;
}

/** Verify complete original output before displaying its notes or downloading it.
 * Checksums and the frozen structure do not establish semantic correctness.
 */
export async function inspectSynthesisThematicChoicePreview(raw: unknown, scope: Scope,
  rawSelection: z.infer<typeof synthesisThematicChoiceSelectionSchema>) {
  const selection = synthesisThematicChoiceSelectionSchema.parse(rawSelection), preview = synthesisThematicChoicePreviewSchema.parse(raw);
  if (preview.campaignId !== scope.campaignId || preview.workspaceId !== scope.workspaceId || preview.actorId !== scope.actorId ||
    (Object.keys(selection) as Array<keyof typeof selection>).some(key => selection[key] !== preview.command[key]) ||
    preview.choiceSha256 !== await digest(preview.command.expected.choiceText) ||
    preview.outputExcerpt !== preview.outputText.slice(0, 1600) || preview.outputExcerptTruncated !== (preview.outputText.length > 1600) ||
    preview.outputBytes !== new TextEncoder().encode(preview.outputText).byteLength || preview.outputSha256 !== await digest(preview.outputText)) {
    throw new Error("Inspected thematic choice differs from the selected context");
  }
  const output = synthesisContextOutputSchema.parse(JSON.parse(preview.outputText));
  if (output.status !== "complete") throw new Error("Inspected context output is incomplete");
  return preview;
}
