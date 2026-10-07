import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { readSavedPlanContext, savedPlanContextSchema, planApplicabilityBlocker, type SavedPlanContext } from "./plan-context";
import { planContextSaveResultSchema, type PlanContextSave } from "./plan-context-command";
import { preparePlanContext } from "./plan-context-server";
import { getJurisdictionPlanDescriptor } from "./registry";

type Store = ReturnType<typeof createServiceRoleClient>;
export type PlanContextScope = { planId: string; workspaceId: string; actorId: string };
export class PlanContextError extends Error {
  constructor(public readonly kind: "invalid" | "forbidden" | "missing" | "conflict" | "unavailable", public readonly status: number) {
    super(kind);
  }
}

export const PLAN_CONTEXT_COLUMNS = "plan_context,plan_context_hash,descriptor_id,plan_kind_key,current_working_version_id";
const hash = z.string().regex(/^[a-f0-9]{64}$/);


/** Preserve invalid/missing projections as failures, never as historical absence. */
export async function readPlanContext(client: Store, scope: PlanContextScope) {
  const { data, error } = await client.from("land_use_plans").select(PLAN_CONTEXT_COLUMNS)
    .eq("id", scope.planId).eq("workspace_id", scope.workspaceId).maybeSingle();
  if (error) throw new PlanContextError("unavailable", 503);
  if (!data) throw new PlanContextError("missing", 404);
  const state = readSavedPlanContext(data.plan_context);
  if (state.status === "invalid"
    || (state.status === "legacy" && data.plan_context_hash !== null)
    || (state.status === "retained" && (!hash.safeParse(data.plan_context_hash).success || !isDeepStrictEqual(state.context, data.plan_context)))) {
    throw new PlanContextError("unavailable", 503);
  }
  const identity = z.object({ descriptor_id: z.string().min(1), plan_kind_key: z.string().min(1),
    current_working_version_id: z.string().uuid().nullable() }).safeParse(data);
  if (!identity.success) throw new PlanContextError("unavailable", 503);
  return { ...scope, contextState: state, contextHash: data.plan_context_hash as string | null,
    descriptorId: identity.data.descriptor_id, planKindKey: identity.data.plan_kind_key,
    versionId: identity.data.current_working_version_id };
}

function rpcError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "42501") throw new PlanContextError("forbidden", 403);
  if (error.code === "PT404") throw new PlanContextError("missing", 404);
  if (error.code === "PT409") throw new PlanContextError("conflict", 409);
  if (error.code === "PT400") throw new PlanContextError("invalid", 400);
  throw new PlanContextError("unavailable", 503);
}

/** An acknowledged command replays through the permission-checking RPC before any new lookup. */
export async function savePlanContext(client: Store, scope: PlanContextScope, command: PlanContextSave, commandText: string) {
  const lookup = await client.from("land_use_plan_context_commands").select("command_id")
    .eq("plan_id", scope.planId).eq("workspace_id", scope.workspaceId).eq("command_id", command.commandId).maybeSingle();
  if (lookup.error) throw new PlanContextError("unavailable", 503);
  let prepared: SavedPlanContext | null = null;
  if (!lookup.data) {
    const descriptor = getJurisdictionPlanDescriptor(command.descriptorId);
    if (!descriptor || !descriptor.planKinds.some(kind => kind.key === command.planKindKey)) throw new PlanContextError("conflict", 409);
    if (command.place.mode === "retained") {
      const current = await readPlanContext(client, scope);
      if (current.contextState.status !== "retained" || current.contextHash !== command.expectedContextHash
        || current.versionId !== command.versionId || current.descriptorId !== command.descriptorId || current.planKindKey !== command.planKindKey) {
        throw new PlanContextError("conflict", 409);
      }
      if (planApplicabilityBlocker(command.assessment, descriptor)) throw new PlanContextError("conflict", 409);
      prepared = savedPlanContextSchema.parse({ ...current.contextState.context, assessment: command.assessment,
        savedBy: scope.actorId, savedAt: new Date().toISOString() });
    } else {
      const result = await preparePlanContext({ place: command.place, assessment: command.assessment }, descriptor, scope.actorId);
      if (!result.ok) throw new PlanContextError(result.status === 409 ? "conflict" : result.status === 400 ? "invalid" : "unavailable", result.status);
      prepared = result.context;
    }
  }
  const { data, error } = await client.rpc("save_land_use_plan_context", {
    p_plan_id: scope.planId, p_version_id: command.versionId, p_actor_id: scope.actorId,
    p_command_id: command.commandId, p_expected_context_hash: command.expectedContextHash,
    p_command_text: commandText, p_prepared_context: prepared,
    p_expected_descriptor_id: command.descriptorId, p_expected_plan_kind_key: command.planKindKey,
  });
  rpcError(error);
  const result = planContextSaveResultSchema.safeParse(data);
  if (!result.success || !isDeepStrictEqual(result.data, data)
    || result.data.commandId !== command.commandId || result.data.versionId !== command.versionId
    || result.data.context.savedBy !== scope.actorId) throw new PlanContextError("unavailable", 503);
  return result.data;
}
