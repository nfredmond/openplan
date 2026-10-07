import { z } from "zod";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const revision = z.number().int().min(0).max(2_147_483_647);
export const ruleReconciliationScopeSchema = z.object({ actorId: uuid, workspaceId: uuid, planId: uuid }).strict();
export type RuleReconciliationScope = z.infer<typeof ruleReconciliationScopeSchema>;

export const ruleReconciliationCommandSchema = z.object({
  operation: z.literal("reconcile"), commandId: uuid, versionId: uuid,
  expectedDraftRevision: revision, expectedDescriptorHash: hash,
}).strict();
export type RuleReconciliationCommand = z.infer<typeof ruleReconciliationCommandSchema>;

export const ruleReconciliationResultSchema = ruleReconciliationScopeSchema.extend({
  replayed: z.boolean(), commandId: uuid, versionId: uuid,
  previousDraftRevision: revision, draftRevision: revision, descriptorHash: hash,
  addedSections: z.array(z.object({ id: uuid, requirementKey: z.string().min(1).max(120) }).strict()),
  applicableRequirementKeys: z.array(z.string().min(1)),
  reconciledAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((result, context) => {
  if (result.draftRevision < result.previousDraftRevision
    || result.draftRevision - result.previousDraftRevision < result.addedSections.length
    || new Set(result.addedSections.map(section => section.id)).size !== result.addedSections.length
    || new Set(result.addedSections.map(section => section.requirementKey)).size !== result.addedSections.length) {
    context.addIssue({ code: "custom", message: "The reconciliation receipt has inconsistent changes" });
  }
});
export type RuleReconciliationResult = z.infer<typeof ruleReconciliationResultSchema>;

/** A receipt confirms only its exact command and authenticated plan scope. */
export function matchesRuleReconciliation(result: RuleReconciliationResult, scope: RuleReconciliationScope, command: RuleReconciliationCommand) {
  return result.actorId === scope.actorId && result.workspaceId === scope.workspaceId && result.planId === scope.planId
    && result.commandId === command.commandId && result.versionId === command.versionId
    && result.previousDraftRevision === command.expectedDraftRevision && result.descriptorHash === command.expectedDescriptorHash;
}
