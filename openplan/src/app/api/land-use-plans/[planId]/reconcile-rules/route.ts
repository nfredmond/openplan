import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadLandUsePlanAccess, loadWorkingVersion } from "@/lib/land-use-plans/api";
import { getPlanKindDescriptor } from "@/lib/land-use-plans/registry";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";
import { ruleReconciliationCommandSchema } from "@/lib/land-use-plans/rule-reconciliation-command";
import { executeRuleReconciliation, hasRuleReconciliation, RuleReconciliationError } from "@/lib/land-use-plans/rule-reconciliation-store";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({ planId: z.string().uuid() }).strict();
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.reconcile-rules", request);
  try {
    const { planId } = paramsSchema.parse(await context.params);
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      throw new RuleReconciliationError("forbidden");
    }
    try { requireProviderBrowserOrigin(request); } catch { throw new RuleReconciliationError("forbidden"); }
    const loaded = await loadLandUsePlanAccess(planId, { write: true });
    if (!loaded.ok) { loaded.response.headers.set("Cache-Control", headers["Cache-Control"]); return loaded.response; }
    const { access } = loaded;
    if (request.headers.get("x-openplan-expected-user") !== access.userId
      || request.headers.get("x-openplan-expected-workspace") !== access.plan.workspace_id) throw new RuleReconciliationError("forbidden");
    const body = await readBytesWithLimitStreaming(request, 8192);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let commandText: string;
    try { commandText = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes); }
    catch { throw new RuleReconciliationError("invalid"); }
    const command = ruleReconciliationCommandSchema.parse(JSON.parse(commandText));
    const scope = { actorId: access.userId, workspaceId: access.plan.workspace_id, planId };
    const service = createServiceRoleClient();
    let descriptor = null;
    if (!await hasRuleReconciliation(service, scope, command.commandId)) {
      const version = await loadWorkingVersion(access);
      if (!version || version.id !== command.versionId || version.draft_revision !== command.expectedDraftRevision) throw new RuleReconciliationError("conflict");
      descriptor = getPlanKindDescriptor(access.plan.descriptor_id, access.plan.plan_kind_key);
      if (!descriptor || hashFrozenRecord(descriptor) !== command.expectedDescriptorHash) throw new RuleReconciliationError("conflict");
    }
    const result = await executeRuleReconciliation(service, scope, commandText, descriptor);
    audit.info("land_use_plan_rules_reconciled", { planId, commandId: command.commandId, versionId: result.versionId, replayed: result.replayed });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers });
  } catch (error) {
    const failed = error instanceof RuleReconciliationError ? error : error instanceof z.ZodError || error instanceof SyntaxError
      ? new RuleReconciliationError("invalid") : new RuleReconciliationError("unavailable");
    audit.warn("land_use_plan_rules_unconfirmed", { kind: failed.kind });
    const messages = {
      invalid: "The saved reconciliation request is invalid. Keep a copy before reviewing the current draft.",
      forbidden: "Current staff access in the same account and workspace is required. A planner must review this checklist change.",
      missing: "This plan is no longer available in the selected workspace.",
      conflict: "The working draft or rules changed. Keep the request and review the current draft before starting another reconciliation.",
      unavailable: "OpenPlan could not confirm the reconciliation. Keep this exact request and retry after checking the connection.",
    };
    return NextResponse.json({ kind: failed.kind, error: messages[failed.kind] }, { status: failed.status, headers });
  }
}
