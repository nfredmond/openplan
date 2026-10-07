import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { placeOfRecordFromCapturedArea } from "@/lib/geographies/study-area-capture";
import { TIGERWEB_GEOGRAPHY_SOURCE, subdivisionCodeFromTigerwebGeoid } from "@/lib/workspaces/home-geography";
import { planContextCommandSchema } from "./plan-context-command";
import { savedPlanContextSchema } from "./plan-context";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const planCreationCommandSchema = planContextCommandSchema.extend({
  commandId: z.string().uuid(), title: z.string().trim().min(1).max(180),
  authorityLabel: z.string().trim().min(1).max(180),
  descriptorId: z.string().min(1).max(120), planKindKey: z.string().min(1).max(120),
  expectedDescriptorHash: hash,
}).strict();
export type PlanCreationCommand = z.infer<typeof planCreationCommandSchema>;
export type PlanCreationScope = { actorId: string; workspaceId: string };
export const planCreationResultSchema = z.object({
  replayed: z.boolean(), commandId: z.string().uuid(), actorId: z.string().uuid(), workspaceId: z.string().uuid(),
  planId: z.string().uuid(), versionId: z.string().uuid(), context: savedPlanContextSchema,
  contextHash: hash, descriptorHash: hash, descriptorId: z.string().min(1), planKindKey: z.string().min(1),
  title: z.string().min(1), authorityLabel: z.string().min(1),
}).strict();
export type PlanCreationResult = z.infer<typeof planCreationResultSchema>;

/** Normalize before retaining the request; its original bytes remain the retry identity. */
export function serializePlanCreation(value: unknown): string {
  return JSON.stringify(planCreationCommandSchema.parse(value));
}

/** A receipt confirms this case's facts, not legal sufficiency or an adopting decision. */
export function matchesPlanCreation(result: PlanCreationResult, command: PlanCreationCommand, scope: PlanCreationScope): boolean {
  const same = (a: unknown, b: unknown) => canonicalizeActionPayload(a) === canonicalizeActionPayload(b);
  if (result.commandId !== command.commandId || result.actorId !== scope.actorId || result.workspaceId !== scope.workspaceId
    || result.context.savedBy !== scope.actorId || result.descriptorId !== command.descriptorId
    || result.planKindKey !== command.planKindKey || result.descriptorHash !== command.expectedDescriptorHash
    || result.title !== command.title || result.authorityLabel !== command.authorityLabel
    || !same(result.context.assessment, command.assessment)) return false;
  const place = result.context.place;
  if (command.place.mode !== "place") return same(place, placeOfRecordFromCapturedArea(command.place));
  return place.source === TIGERWEB_GEOGRAPHY_SOURCE && place.kind === command.place.kind && place.ref === command.place.geoid
    && place.label === command.place.label && place.countryCode === "US"
    && place.subdivisionCode === subdivisionCodeFromTigerwebGeoid(command.place.kind, command.place.geoid);
}
