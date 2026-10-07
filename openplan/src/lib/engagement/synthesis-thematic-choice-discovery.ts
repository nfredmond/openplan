import { z } from "zod";
import { synthesisContinuationPageSchema } from "./synthesis-continuation-records";
import { synthesisThematicChoiceReceiptSchema, synthesisThematicChoiceCommandSchema } from "./synthesis-thematic-choice-command";
import { synthesisRequestHistoryPageSchema, verifySynthesisRequestHistory, type SynthesisRequestHistoryCursor } from "./synthesis-request-history";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const thematicInputScopeSchema = z.object({ campaignId: id, workspaceId: id, sourceId: id, sourceSha256: hash,
  requestId: id, actorId: id, requestIntentSha256: hash }).strict();
export type ThematicInputScope = z.infer<typeof thematicInputScopeSchema>;
const receipt = synthesisThematicChoiceReceiptSchema.omit({ replayed: true }).extend({ replayed: z.boolean().optional() });
export const thematicContributionPageSchema = thematicInputScopeSchema.extend({ schemaVersion: z.literal(1), thematicSha256: hash,
  page: synthesisContinuationPageSchema, choices: z.array(receipt.nullable()).max(25),
}).strict().superRefine((value, ctx) => {
  if (value.page.campaignId !== value.campaignId || value.page.workspaceId !== value.workspaceId ||
    value.page.parent.sourceId !== value.sourceId || value.page.parent.sourceSha256 !== value.sourceSha256 ||
    value.choices.length !== value.page.entries.length || value.choices.some((choice, index) => choice && (
      choice.requestId !== value.requestId || choice.campaignId !== value.campaignId || choice.workspaceId !== value.workspaceId ||
      choice.createdBy !== value.actorId || choice.targetRecordId !== value.page.entries[index].recordId))) {
    ctx.addIssue({ code: "custom", message: "Thematic contribution accounting differs" });
  }
});
export const thematicContextPageSchema = thematicInputScopeSchema.extend({ schemaVersion: z.literal(1), thematicSha256: hash,
  targetRecordId: z.string(), parentRequestId: id, history: synthesisRequestHistoryPageSchema, eligibleRequestIds: z.array(id).max(25),
}).strict();
const sameScope = (value: ThematicInputScope, scope: ThematicInputScope) => (Object.keys(thematicInputScopeSchema.shape) as Array<keyof ThematicInputScope>).every(field => value[field] === scope[field]);
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");

/** A saved choice identifies requested input, not an input seal or approved wording. */
export async function inspectThematicContributionPage(raw: unknown, rawScope: ThematicInputScope, offset: number) {
  const scope = thematicInputScopeSchema.parse(rawScope), result = thematicContributionPageSchema.parse(raw);
  if (!sameScope(result, scope) || result.page.offset !== offset) throw new Error("Thematic contribution source differs");
  for (const choice of result.choices) if (choice) {
    if (await digest(choice.choiceText) !== choice.choiceSha256) throw new Error("Saved context choice bytes differ");
    const selected = z.object({ contextRequestId: id, selectionSequence: z.number() }).parse(JSON.parse(choice.choiceText));
    synthesisThematicChoiceCommandSchema.parse({ requestId: scope.requestId, targetRecordId: choice.targetRecordId,
      contextRequestId: selected.contextRequestId, throughSequence: selected.selectionSequence,
      expected: { requestIntentSha256: scope.requestIntentSha256, thematicSha256: result.thematicSha256, choiceText: choice.choiceText } });
  }
  return result;
}

/** Cursor continuity belongs to the whole native history page, including pages
 * with no eligible context. Filtering must never falsely end discovery early.
 */
export function inspectThematicContextPage(raw: unknown, rawScope: ThematicInputScope, targetRecordId: string,
  before: SynthesisRequestHistoryCursor | null) {
  const scope = thematicInputScopeSchema.parse(rawScope), result = thematicContextPageSchema.parse(raw);
  const history = verifySynthesisRequestHistory(result.history, { campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    sourceId: scope.sourceId, sourceSha256: scope.sourceSha256 }, before);
  if (!sameScope(result, scope) || result.targetRecordId !== targetRecordId || new Set(result.eligibleRequestIds).size !== result.eligibleRequestIds.length ||
    result.eligibleRequestIds.some(requestId => !history.entries.some(entry => entry.requestId === requestId && entry.stage === "context" && entry.parentRequestId === result.parentRequestId))) {
    throw new Error("Eligible context discovery differs");
  }
  return result;
}
