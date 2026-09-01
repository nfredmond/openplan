import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { buildFrozenSnapshot, loadLandUsePlanAccess, loadWorkingVersion } from "@/lib/land-use-plans/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { buildPublicDraftBlockers } from "@/lib/land-use-plans/workflow";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({ planId: z.string().uuid() });
const payloadSchema = z.object({ state: z.literal("public_review") }).strict();
type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.freeze", request);
  audit.info("land_use_plan_freeze_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const parsed = payloadSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid freeze request" }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const version = await loadWorkingVersion(loaded.access);
  if (!version) return NextResponse.json({ error: "No working version is available to freeze" }, { status: 409 });
  const descriptor = getJurisdictionPlanDescriptor(loaded.access.plan.descriptor_id);
  if (!descriptor) return NextResponse.json({ error: "Plan descriptor is not installed" }, { status: 409 });
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
    return NextResponse.json({ error: "Failed to check public-draft readiness" }, { status: 500 });
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
    applicableRequirementKeys: version.applicable_requirement_keys ?? [],
    completedRequirementKeys,
    hasDesignation: (designations.data ?? []).length > 0,
    hasImplementationAction: (actions.data ?? []).length > 0,
    requiredReviewPrerequisiteKeys,
    completedProcessKeys,
    requiresConsultation,
    consultationStatus: consultation.data?.status ?? null,
  });
  if (blockers.length) return NextResponse.json({ error: "The public draft is not ready to freeze", blockers }, { status: 409 });

  const frozen = await buildFrozenSnapshot(loaded.access, version);
  if (!frozen) return NextResponse.json({ error: "Failed to assemble the frozen plan content" }, { status: 500 });
  const frozenAt = new Date().toISOString();
  const { data: updated, error } = await loaded.access.supabase
    .from("land_use_plan_versions")
    .update({
      state: "public_review",
      content_hash: frozen.hash,
      frozen_snapshot: frozen.snapshot,
      frozen_at: frozenAt,
      frozen_by: loaded.access.userId,
    })
    .eq("id", version.id)
    .eq("state", "working")
    .select("id")
    .maybeSingle();
  if (isWriteFailure(error)) return NextResponse.json({ error: "Failed to freeze public draft" }, { status: 500 });
  if (writeMatchedNoRows({ data: updated, error })) return noRowsMatchedResponse({ subject: "working plan version", targetWasVerified: true });

  const planUpdate = await loaded.access.supabase.from("land_use_plans").update({ current_working_version_id: null }).eq("id", loaded.access.plan.id).select("id").maybeSingle();
  if (planUpdate.error || !planUpdate.data) return NextResponse.json({ error: "The plan version froze, but the working pointer could not be cleared" }, { status: 500 });
  await loaded.access.supabase.from("land_use_plan_review_events").insert({
    workspace_id: loaded.access.plan.workspace_id,
    version_id: version.id,
    event_kind: "public_draft",
    occurred_on: frozenAt.slice(0, 10),
    notes: `Frozen public draft ${frozen.hash}`,
    created_by: loaded.access.userId,
  });
  return NextResponse.json({ versionId: version.id, contentHash: frozen.hash, frozenAt });
}
