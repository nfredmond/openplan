import { isDeepStrictEqual } from "node:util";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { planCreationCommandSchema, planCreationResultSchema, matchesPlanCreation, type PlanCreationScope } from "./create-command";
import { snapshotPlanDescriptor } from "./descriptor-snapshot";
import { preparePlanContext } from "./plan-context-server";
import { getPlanKindDescriptor } from "./registry";
import { hashFrozenRecord, serializeFrozenRecord } from "./versioning";
import type { SavedPlanContext } from "./plan-context";

const statuses = { invalid: 400, forbidden: 403, conflict: 409, unavailable: 503 } as const;
export class PlanCreationError extends Error {
  readonly status: number;
  constructor(public readonly kind: keyof typeof statuses) { super(kind); this.status = statuses[kind]; }
}
type Store = ReturnType<typeof createServiceRoleClient>;

/** Recover an existing command before any new place lookup or installed-rule comparison. */
export async function createPlanWithContext(client: Store, scope: PlanCreationScope, commandText: string) {
  let raw: unknown;
  try { raw = JSON.parse(commandText); } catch { throw new PlanCreationError("invalid"); }
  const parsed = planCreationCommandSchema.safeParse(raw);
  if (!parsed.success || !isDeepStrictEqual(parsed.data, raw)) throw new PlanCreationError("invalid");
  const command = parsed.data;
  const lookup = await client.from("land_use_plan_creation_commands").select("command_id")
    .eq("workspace_id", scope.workspaceId).eq("command_id", command.commandId).maybeSingle();
  if (lookup.error || (lookup.data && lookup.data.command_id !== command.commandId)) throw new PlanCreationError("unavailable");
  let context: SavedPlanContext | null = null, descriptorText: string | null = null;
  if (!lookup.data) {
    const descriptor = getPlanKindDescriptor(command.descriptorId, command.planKindKey);
    if (!descriptor || !descriptor.planKinds.some(kind => kind.key === command.planKindKey)) throw new PlanCreationError("conflict");
    const snapshot = snapshotPlanDescriptor(descriptor, command.planKindKey);
    if (hashFrozenRecord(snapshot) !== command.expectedDescriptorHash) throw new PlanCreationError("conflict");
    const prepared = await preparePlanContext(command, snapshot, scope.actorId);
    if (!prepared.ok) throw new PlanCreationError(prepared.status === 409 ? "conflict" : prepared.status === 400 ? "invalid" : "unavailable");
    context = prepared.context; descriptorText = serializeFrozenRecord(snapshot);
  }
  const { data, error } = await client.rpc("create_land_use_plan_with_context", {
    p_workspace_id: scope.workspaceId, p_actor_id: scope.actorId, p_command_id: command.commandId,
    p_command_text: commandText, p_prepared_context: context, p_descriptor_text: descriptorText,
  });
  if (error) throw new PlanCreationError(error.code === "42501" ? "forbidden" : error.code === "PT409" ? "conflict"
    : error.code === "PT400" ? "invalid" : "unavailable");
  const result = planCreationResultSchema.safeParse(data);
  if (!result.success || !isDeepStrictEqual(result.data, data) || !matchesPlanCreation(result.data, command, scope)
    || (lookup.data && !result.data.replayed)) throw new PlanCreationError("unavailable");
  return result.data;
}
