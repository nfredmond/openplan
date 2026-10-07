import { getPlanKindDescriptor } from "@/lib/land-use-plans/registry";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";
import { planContextDraft } from "@/lib/land-use-plans/plan-context-draft";
import { savedPlanContextSchema } from "@/lib/land-use-plans/plan-context";
import { placeOfRecordFromCapturedArea } from "@/lib/geographies/study-area-capture";
import type { CreationDraft } from "@/lib/land-use-plans/create-recovery";
import type { PlanCreationResult } from "@/lib/land-use-plans/create-command";

export const creationId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const creationScope = { actorId: creationId(1), workspaceId: creationId(2) };
export const creationGeometry = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] as [number, number][][] };
export function creationCommandFixture() {
  const descriptor = getPlanKindDescriptor("local-unconfigured", "community")!;
  return { commandId: creationId(3), title: "SYNTHETIC plan", authorityLabel: "SYNTHETIC display body", descriptorId: descriptor.id,
    planKindKey: "community", expectedDescriptorHash: hashFrozenRecord(descriptor), place: { mode: "uploaded" as const, label: "SYNTHETIC area", geometry: creationGeometry },
    assessment: { authorities: [{ id: creationId(4), label: "SYNTHETIC body", role: "Sponsor", kind: "tribal_government", jurisdiction: null, sourceUrls: [] }],
      applicability: { status: "unresolved" as const, explanation: "SYNTHETIC unresolved authority. No legal finding." } } };
}
export function creationReceiptFixture(): PlanCreationResult {
  const command = creationCommandFixture();
  return { ...creationScope, replayed: false, commandId: command.commandId, planId: creationId(5), versionId: creationId(6),
    context: { schemaVersion: 1, place: savedPlanContextSchema.shape.place.parse(placeOfRecordFromCapturedArea(command.place)), assessment: command.assessment,
      savedBy: creationScope.actorId, savedAt: "2026-10-07T12:00:00.123456Z" }, contextHash: "a".repeat(64),
    descriptorHash: command.expectedDescriptorHash, descriptorId: command.descriptorId, planKindKey: command.planKindKey, title: command.title, authorityLabel: command.authorityLabel };
}
export function creationDraftFixture(): CreationDraft {
  const command = creationCommandFixture(), context = planContextDraft(creationReceiptFixture().context, { authority: "", geography: "" });
  context.place.mode = "uploaded";
  return { ...creationScope, schemaVersion: 1, kind: "draft", instanceId: creationId(7), savedAt: "2026-10-07T12:00:00Z",
    fields: { title: command.title, authorityLabel: command.authorityLabel, descriptorId: command.descriptorId,
      planKindKey: command.planKindKey, descriptorHash: command.expectedDescriptorHash, context } };
}
