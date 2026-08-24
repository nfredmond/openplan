import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess, loadWorkingVersion } from "@/lib/land-use-plans/api";
import { createApiAuditLogger } from "@/lib/observability/audit";

const paramsSchema = z.object({ planId: z.string().uuid() });
const payloadSchema = z.object({
  layerId: z.string().uuid(),
  layerVersionId: z.string().uuid(),
  designationSetLabel: z.string().trim().min(1).max(240),
  legendMetadata: z.record(z.string(), z.unknown()),
  policyNodeIds: z.array(z.string().uuid()).max(500).default([]),
}).strict();

type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.designations", request);
  audit.info("land_use_plan_designation_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
  if (!body.ok) return body.response;
  const parsed = payloadSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid designation payload", issues: parsed.error.issues }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const version = await loadWorkingVersion(loaded.access);
  if (!version) return NextResponse.json({ error: "Mapped designations can only be selected on a working version" }, { status: 409 });

  const { data: layerVersion, error: layerVersionError } = await loaded.access.supabase
    .from("workspace_gis_layer_versions")
    .select("id, layer_id, workspace_id, ingest_status")
    .eq("id", parsed.data.layerVersionId)
    .eq("layer_id", parsed.data.layerId)
    .eq("workspace_id", loaded.access.plan.workspace_id)
    .eq("ingest_status", "ready")
    .maybeSingle();
  if (layerVersionError) return NextResponse.json({ error: "Failed to verify the map layer version" }, { status: 500 });
  if (!layerVersion) return NextResponse.json({ error: "Select a ready version of a GIS layer in this workspace" }, { status: 400 });

  const policyIds = [...new Set(parsed.data.policyNodeIds)];
  if (policyIds.length) {
    const { data: policies, error: policiesError } = await loaded.access.supabase
      .from("land_use_plan_content_nodes")
      .select("id")
      .eq("version_id", version.id)
      .eq("node_kind", "policy")
      .in("id", policyIds);
    if (policiesError) return NextResponse.json({ error: "Failed to verify linked policies" }, { status: 500 });
    if ((policies ?? []).length !== policyIds.length) {
      return NextResponse.json({ error: "Every policy link must name a policy in this working version" }, { status: 400 });
    }
  }

  const { data: designation, error } = await loaded.access.supabase.from("land_use_plan_designations").insert({
    workspace_id: loaded.access.plan.workspace_id,
    version_id: version.id,
    layer_id: parsed.data.layerId,
    layer_version_id: parsed.data.layerVersionId,
    designation_set_label: parsed.data.designationSetLabel,
    legend_metadata: parsed.data.legendMetadata,
    created_by: loaded.access.userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: "Failed to attach mapped designations" }, { status: 500 });

  if (policyIds.length) {
    const { error: linkError } = await loaded.access.supabase.from("land_use_plan_designation_policy_links").insert(
      policyIds.map((policyNodeId) => ({
        workspace_id: loaded.access.plan.workspace_id,
        version_id: version.id,
        designation_id: designation.id,
        policy_node_id: policyNodeId,
        created_by: loaded.access.userId,
      }))
    );
    if (linkError) {
      const cleanup = await loaded.access.supabase.from("land_use_plan_designations").delete().eq("id", designation.id).select("id");
      if (cleanup.error) audit.error("land_use_plan_designation_cleanup_failed", { error: cleanup.error });
      return NextResponse.json({ error: "Failed to link designations to policies" }, { status: 500 });
    }
  }
  return NextResponse.json({ designationId: designation.id }, { status: 201 });
}
