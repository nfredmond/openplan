import { z } from "zod";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const revision = z.number().int().min(0).max(2_147_483_647);

export const planFreezeCommandSchema = z.object({
  state: z.literal("public_review"), commandId: uuid, versionId: uuid,
  expectedDraftRevision: revision, expectedDescriptorHash: hash,
}).strict();
export type PlanFreezeCommand = z.infer<typeof planFreezeCommandSchema>;

export const planFreezeResultSchema = z.object({
  replayed: z.boolean(), commandId: uuid, versionId: uuid, draftRevision: revision,
  contentHash: hash, frozenAt: z.iso.datetime({ offset: true }), reviewEventId: uuid,
}).strict();
export type PlanFreezeResult = z.infer<typeof planFreezeResultSchema>;

export function matchesPlanFreezeCommand(result: PlanFreezeResult, command: PlanFreezeCommand) {
  return result.commandId === command.commandId && result.versionId === command.versionId
    && result.draftRevision === command.expectedDraftRevision;
}
