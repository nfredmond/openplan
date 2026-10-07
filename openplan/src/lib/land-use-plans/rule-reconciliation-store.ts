import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { JurisdictionPlanDescriptor } from "./contracts";
import { matchesRuleReconciliation, ruleReconciliationCommandSchema, ruleReconciliationResultSchema, type RuleReconciliationScope } from "./rule-reconciliation-command";
import { hashFrozenRecord, serializeFrozenRecord } from "./versioning";

type Store = ReturnType<typeof createServiceRoleClient>;
const statuses = { invalid: 400, forbidden: 403, missing: 404, conflict: 409, unavailable: 503 } as const;
export class RuleReconciliationError extends Error {
  readonly status: number;
  constructor(public readonly kind: keyof typeof statuses) { super(kind); this.status = statuses[kind]; }
}

/** Discover exact recovery before consulting the current draft or installed rules. */
export async function hasRuleReconciliation(client: Store, scope: RuleReconciliationScope, commandId: string) {
  const { data, error } = await client.from("land_use_plan_rule_reconciliation_commands").select("command_id")
    .eq("plan_id", scope.planId).eq("workspace_id", scope.workspaceId).eq("command_id", commandId).maybeSingle();
  if (error || (data && data.command_id !== commandId)) throw new RuleReconciliationError("unavailable");
  return Boolean(data);
}

/** The transaction owns permissions, draft locking, preservation and the receipt. */
export async function executeRuleReconciliation(client: Store, scope: RuleReconciliationScope, commandText: string,
  descriptor: JurisdictionPlanDescriptor | null) {
  const command = ruleReconciliationCommandSchema.parse(JSON.parse(commandText));
  if (descriptor && hashFrozenRecord(descriptor) !== command.expectedDescriptorHash) throw new RuleReconciliationError("conflict");
  const { data, error } = await client.rpc("reconcile_land_use_plan_rules", {
    p_plan_id: scope.planId, p_workspace_id: scope.workspaceId, p_actor_id: scope.actorId,
    p_command_id: command.commandId, p_command_text: commandText,
    p_descriptor_text: descriptor ? serializeFrozenRecord(descriptor) : null,
  });
  if (error) {
    throw new RuleReconciliationError(error.code === "PT400" ? "invalid" : error.code === "42501" ? "forbidden"
      : error.code === "PT404" ? "missing" : error.code === "PT409" ? "conflict" : "unavailable");
  }
  const parsed = ruleReconciliationResultSchema.safeParse(data);
  if (!parsed.success || !matchesRuleReconciliation(parsed.data, scope, command)
    || (!descriptor && !parsed.data.replayed)) throw new RuleReconciliationError("unavailable");
  const result = parsed.data;
  if (descriptor && (result.addedSections.some(section => !descriptor.requirements.some(rule => rule.key === section.requirementKey))
    || descriptor.requirements.some(rule => rule.applicability !== "conditional" && !result.applicableRequirementKeys.includes(rule.key)))) {
    throw new RuleReconciliationError("unavailable");
  }
  return result;
}
