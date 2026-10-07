import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { matchesPlanCreation, planCreationCommandSchema, planCreationResultSchema, type PlanCreationScope } from "./create-command";

export const creationStopResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("created"), result: planCreationResultSchema.refine(result => result.replayed) }).strict(),
  z.object({ outcome: z.literal("cancelled"), replayed: z.boolean(), actorId: z.string().uuid(), workspaceId: z.string().uuid(),
    commandId: z.string().uuid(), commandText: z.string().min(2).max(2_000_000), cancelledAt: z.iso.datetime() }).strict(),
]);
export type CreationStopResult = z.infer<typeof creationStopResultSchema>;

/** A stop receipt either identifies the original plan or binds cancellation to exact request bytes. */
export function verifyCreationStop(raw: unknown, scope: PlanCreationScope, commandText: string): CreationStopResult {
  const result = creationStopResultSchema.parse(raw), command = planCreationCommandSchema.parse(JSON.parse(commandText));
  if (canonicalizeActionPayload(result) !== canonicalizeActionPayload(raw)) throw new Error("The stop reply changed during validation.");
  if (result.outcome === "created") {
    if (!matchesPlanCreation(result.result, command, scope)) throw new Error("The reply identifies another creation request.");
  } else if (result.actorId !== scope.actorId || result.workspaceId !== scope.workspaceId
    || result.commandId !== command.commandId || result.commandText !== commandText) {
    throw new Error("The stop receipt does not match the retained request.");
  }
  return result;
}
