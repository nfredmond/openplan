import type { createServiceRoleClient } from "@/lib/supabase/server";
import { matchesPlanFreezeCommand, planFreezeResultSchema, type PlanFreezeCommand } from "./freeze-command";
import { hashFrozenRecord, serializeFrozenPlanContent, serializeFrozenRecord, type FrozenPlanContent } from "./versioning";

type Store = ReturnType<typeof createServiceRoleClient>;
export type PlanFreezeScope = { planId: string; workspaceId: string; actorId: string };
const statuses = { invalid: 400, forbidden: 403, missing: 404, conflict: 409, unavailable: 503 } as const;
export class PlanFreezeError extends Error {
  readonly status: number;
  constructor(public readonly kind: keyof typeof statuses) { super(kind); this.status = statuses[kind]; }
}

/** Discover recovery before loading any new working version or installed rules. */
export async function hasPlanFreezeCommand(client: Store, scope: PlanFreezeScope, commandId: string) {
  const { data, error } = await client.from("land_use_plan_freeze_commands").select("command_id")
    .eq("plan_id", scope.planId).eq("workspace_id", scope.workspaceId).eq("command_id", commandId).maybeSingle();
  if (error || (data && data.command_id !== commandId)) throw new PlanFreezeError("unavailable");
  return Boolean(data);
}

/** The database rechecks current permission and commits all freeze writes together. */
export async function executePlanFreeze(client: Store, scope: PlanFreezeScope, command: PlanFreezeCommand,
  commandText: string, snapshot: FrozenPlanContent | null) {
  if (snapshot && (!snapshot.descriptorSnapshot || hashFrozenRecord(snapshot.descriptorSnapshot) !== command.expectedDescriptorHash)) {
    throw new PlanFreezeError("conflict");
  }
  const { data, error } = await client.rpc("freeze_land_use_plan_version", {
    p_plan_id: scope.planId, p_version_id: command.versionId, p_actor_id: scope.actorId, p_command_id: command.commandId,
    p_expected_draft_revision: command.expectedDraftRevision, p_command_text: commandText,
    p_snapshot_text: snapshot ? serializeFrozenPlanContent(snapshot) : null,
    p_descriptor_text: snapshot ? serializeFrozenRecord(snapshot.descriptorSnapshot) : null,
  });
  if (error) {
    const kind = error.code === "PT400" ? "invalid" : error.code === "42501" ? "forbidden"
      : error.code === "PT404" ? "missing" : error.code === "PT409" ? "conflict" : "unavailable";
    throw new PlanFreezeError(kind);
  }
  const result = planFreezeResultSchema.safeParse(data);
  if (!result.success || !matchesPlanFreezeCommand(result.data, command)
    || (!snapshot && !result.data.replayed)
    || (snapshot && result.data.contentHash !== hashFrozenRecord(snapshot))) throw new PlanFreezeError("unavailable");
  return result.data;
}
