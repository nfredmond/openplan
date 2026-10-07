import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { planFreezeCommandSchema } from "@/lib/land-use-plans/freeze-command";
import { executePlanFreeze, hasPlanFreezeCommand, PlanFreezeError } from "@/lib/land-use-plans/freeze-store";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";
import { buildFrozenSnapshot, loadLandUsePlanAccess, loadWorkingVersion } from "@/lib/land-use-plans/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { buildPublicDraftBlockers } from "@/lib/land-use-plans/workflow";

const paramsSchema = z.object({ planId: z.string().uuid() }).strict();
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.freeze", request);
  audit.info("land_use_plan_freeze_requested");
  try {
    const { planId } = paramsSchema.parse(await context.params);
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      throw new PlanFreezeError("forbidden");
    }
    try { requireProviderBrowserOrigin(request); } catch { throw new PlanFreezeError("forbidden"); }
    const loaded = await loadLandUsePlanAccess(planId, { write: true });
    if (!loaded.ok) { loaded.response.headers.set("Cache-Control", headers["Cache-Control"]); return loaded.response; }
    const { access } = loaded;
    if (request.headers.get("x-openplan-expected-user") !== access.userId
      || request.headers.get("x-openplan-expected-workspace") !== access.plan.workspace_id) throw new PlanFreezeError("forbidden");
    const body = await readBytesWithLimitStreaming(request, 8192);
    if (!body.ok) { body.response.headers.set("Cache-Control", headers["Cache-Control"]); return body.response; }
    let commandText: string;
    try { commandText = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes); }
    catch { throw new PlanFreezeError("invalid"); }
    const command = planFreezeCommandSchema.parse(JSON.parse(commandText));
    const scope = { planId, workspaceId: access.plan.workspace_id, actorId: access.userId };
    const service = createServiceRoleClient();
    if (await hasPlanFreezeCommand(service, scope, command.commandId)) {
      const result = await executePlanFreeze(service, scope, command, commandText, null);
      audit.info("land_use_plan_freeze_recovered", { planId, commandId: command.commandId, versionId: result.versionId });
      return NextResponse.json(result, { headers });
    }
    const version = await loadWorkingVersion(access);
    if (!version || version.id !== command.versionId || version.draft_revision !== command.expectedDraftRevision) throw new PlanFreezeError("conflict");
    const descriptor = getJurisdictionPlanDescriptor(access.plan.descriptor_id);
    if (!descriptor || hashFrozenRecord(descriptor) !== command.expectedDescriptorHash) throw new PlanFreezeError("conflict");
    const requiresConsultation = descriptor.processSteps.some(
      (step) => step.key === "tribal_consultation" && step.required,
    );

    const [nodes, designations, actions, processRecords, consultation] = await Promise.all([
      loaded.access.supabase.from("land_use_plan_content_nodes").select("requirement_key, body").eq("version_id", version.id).eq("node_kind", "section"),
      loaded.access.supabase.from("land_use_plan_designations").select("id").eq("version_id", version.id).limit(1),
      loaded.access.supabase.from("land_use_plan_implementation_actions").select("id").eq("version_id", version.id).limit(1),
      loaded.access.supabase.from("land_use_plan_process_records").select("process_key, status").eq("version_id", version.id),
      loaded.access.supabase.from("land_use_plan_consultation_records").select("status").eq("version_id", version.id).maybeSingle(),
    ]);
    if (nodes.error || designations.error || actions.error || processRecords.error || consultation.error) {
      throw new PlanFreezeError("unavailable");
    }
    const completedRequirementKeys = (nodes.data ?? [])
      .filter((node) => Boolean(node.body?.trim()))
      .map((node) => node.requirement_key)
      .filter((key): key is string => Boolean(key));
    const requiredReviewPrerequisiteKeys = descriptor.processSteps
      .filter((step) => step.required && step.reviewPrerequisite)
      .map((step) => step.key);
    const completedProcessKeys = (processRecords.data ?? [])
      .filter((record) => record.status === "complete")
      .map((record) => record.process_key);
    const blockers = buildPublicDraftBlockers({
      descriptor,
      applicableRequirementKeys: version.applicable_requirement_keys ?? [],
      completedRequirementKeys,
      hasDesignation: (designations.data ?? []).length > 0,
      hasImplementationAction: (actions.data ?? []).length > 0,
      requiredReviewPrerequisiteKeys,
      completedProcessKeys,
      requiresConsultation,
      consultationStatus: consultation.data?.status ?? null,
    });
    if (blockers.length) return NextResponse.json({ kind: "conflict", error: "The public draft is not ready to freeze", blockers }, { status: 409, headers });

    const frozen = await buildFrozenSnapshot(loaded.access, version);
    if (!frozen) throw new PlanFreezeError("unavailable");
    const result = await executePlanFreeze(service, scope, command, commandText, frozen.snapshot);
    audit.info("land_use_plan_freeze_retained", { planId, commandId: command.commandId, versionId: result.versionId, replayed: result.replayed });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers });
  } catch (error) {
    const failed = error instanceof PlanFreezeError ? error : error instanceof z.ZodError || error instanceof SyntaxError
      ? new PlanFreezeError("invalid") : new PlanFreezeError("unavailable");
    audit.warn("land_use_plan_freeze_unconfirmed", { kind: failed.kind });
    const messages = {
      invalid: "The saved freeze request is invalid. Keep a copy before reviewing the current draft.",
      forbidden: "Current staff access in the same account and workspace is required. Freezing requires a human decision.",
      missing: "This plan is no longer available in the selected workspace.",
      conflict: "The working plan or checklist changed. Keep the request and review the current draft before starting another freeze.",
      unavailable: "OpenPlan could not confirm the freeze. Keep this exact request and check again before starting another freeze.",
    };
    return NextResponse.json({ kind: failed.kind, error: messages[failed.kind] }, { status: failed.status, headers });
  }
}
