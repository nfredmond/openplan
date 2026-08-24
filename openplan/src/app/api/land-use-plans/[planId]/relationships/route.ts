import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess, loadWorkingVersion } from "@/lib/land-use-plans/api";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({ planId: z.string().uuid() });
const payloadSchema = z.object({
  relatedPlanId: z.string().uuid().nullable().optional(),
  relatedPlanLabel: z.string().trim().min(1).max(240),
  relationshipKind: z.enum(["parent", "child", "overlapping", "supersedes", "implements"]),
  notes: z.string().max(10_000).nullable().optional(),
}).strict();
type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.relationships", request);
  audit.info("land_use_plan_relationship_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
  if (!body.ok) return body.response;
  const parsed = payloadSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan relationship", issues: parsed.error.issues }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const version = await loadWorkingVersion(loaded.access);
  if (!version) return NextResponse.json({ error: "Relationships can only change on a working version" }, { status: 409 });
  if (parsed.data.relatedPlanId) {
    const { data: related, error: relatedError } = await loaded.access.supabase.from("land_use_plans").select("id").eq("id", parsed.data.relatedPlanId).eq("workspace_id", loaded.access.plan.workspace_id).maybeSingle();
    if (relatedError) return NextResponse.json({ error: "Failed to verify the related plan" }, { status: 500 });
    if (!related || related.id === loaded.access.plan.id) return NextResponse.json({ error: "Related plan must be another plan in this workspace" }, { status: 400 });
  }
  const { data, error } = await loaded.access.supabase.from("land_use_plan_relationships").insert({
    workspace_id: loaded.access.plan.workspace_id,
    plan_id: loaded.access.plan.id,
    version_id: version.id,
    related_plan_id: parsed.data.relatedPlanId ?? null,
    related_plan_label: parsed.data.relatedPlanLabel,
    relationship_kind: parsed.data.relationshipKind,
    notes: parsed.data.notes ?? null,
    created_by: loaded.access.userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: "Failed to record plan relationship" }, { status: 500 });
  return NextResponse.json({ relationshipId: data.id }, { status: 201 });
}
