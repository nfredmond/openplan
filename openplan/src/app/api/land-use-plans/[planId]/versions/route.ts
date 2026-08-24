import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess } from "@/lib/land-use-plans/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({ planId: z.string().uuid() });
const payloadSchema = z.object({ baseVersionId: z.string().uuid().optional() }).strict();
type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.versions", request);
  audit.info("land_use_plan_version_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return body.response;
  const parsed = payloadSchema.safeParse(body.data ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Invalid version request" }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const { access } = loaded;
  if (access.plan.current_working_version_id) {
    return NextResponse.json({ error: "This plan already has a working version" }, { status: 409 });
  }

  let baseQuery = access.supabase.from("land_use_plan_versions").select("id, version_number, applicable_requirement_keys").eq("plan_id", access.plan.id).neq("state", "working");
  if (parsed.data.baseVersionId) baseQuery = baseQuery.eq("id", parsed.data.baseVersionId);
  const { data: bases, error: baseError } = await baseQuery.order("version_number", { ascending: false }).limit(1);
  const base = bases?.[0];
  if (baseError || !base) return NextResponse.json({ error: "No frozen version is available to amend" }, { status: 409 });

  const { data: allVersions, error: allVersionsError } = await access.supabase.from("land_use_plan_versions").select("version_number").eq("plan_id", access.plan.id).order("version_number", { ascending: false }).limit(1);
  if (allVersionsError) return NextResponse.json({ error: "Failed to determine the next version number" }, { status: 500 });
  const nextNumber = (allVersions?.[0]?.version_number ?? 0) + 1;
  const { data: version, error: versionError } = await access.supabase.from("land_use_plan_versions").insert({
    workspace_id: access.plan.workspace_id,
    plan_id: access.plan.id,
    version_number: nextNumber,
    version_kind: "amendment",
    state: "working",
    based_on_version_id: base.id,
    applicable_requirement_keys: base.applicable_requirement_keys,
    created_by: access.userId,
  }).select("id").single();
  if (versionError || !version) return NextResponse.json({ error: "Failed to fork working version" }, { status: 500 });
  const versionId = version.id;

  async function abandon(message: string) {
    const cleanup = await access.supabase.from("land_use_plan_versions").delete().eq("id", versionId).select("id");
    if (cleanup.error) audit.error("land_use_plan_version_cleanup_failed", { error: cleanup.error });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const [nodesResult, relationshipsResult, designationsResult, actionsResult] = await Promise.all([
    access.supabase.from("land_use_plan_content_nodes").select("id, parent_node_id, node_kind, requirement_key, title, body, sort_order, evidence_document_id, evidence_url").eq("version_id", base.id).order("sort_order"),
    access.supabase.from("land_use_plan_relationships").select("related_plan_id, related_plan_label, relationship_kind, notes").eq("version_id", base.id),
    access.supabase.from("land_use_plan_designations").select("id, layer_id, layer_version_id, designation_set_label, legend_metadata, land_use_plan_designation_policy_links(policy_node_id)").eq("version_id", base.id),
    access.supabase.from("land_use_plan_implementation_actions").select("content_node_id, title, description, responsible_party, assignee_user_id, due_on, project_id, program_id, evidence_document_id").eq("version_id", base.id),
  ]);
  if (nodesResult.error || relationshipsResult.error || designationsResult.error || actionsResult.error) return abandon("Failed to read the version being amended");

  const nodeIdMap = new Map<string, string>();
  for (const node of nodesResult.data ?? []) nodeIdMap.set(node.id, randomUUID());
  if ((nodesResult.data ?? []).length) {
    const { error } = await access.supabase.from("land_use_plan_content_nodes").insert((nodesResult.data ?? []).map((node) => ({
      id: nodeIdMap.get(node.id), workspace_id: access.plan.workspace_id, version_id: versionId,
      parent_node_id: node.parent_node_id ? nodeIdMap.get(node.parent_node_id) ?? null : null,
      node_kind: node.node_kind, requirement_key: node.requirement_key, title: node.title, body: node.body,
      sort_order: node.sort_order, evidence_document_id: node.evidence_document_id, evidence_url: node.evidence_url,
      created_by: access.userId,
    })));
    if (error) return abandon("Failed to copy plan content into the amendment");
  }
  if ((relationshipsResult.data ?? []).length) {
    const { error } = await access.supabase.from("land_use_plan_relationships").insert((relationshipsResult.data ?? []).map((item) => ({
      ...item, workspace_id: access.plan.workspace_id, plan_id: access.plan.id, version_id: versionId, created_by: access.userId,
    })));
    if (error) return abandon("Failed to copy plan relationships into the amendment");
  }
  for (const designation of designationsResult.data ?? []) {
    const newDesignationId = randomUUID();
    const { error } = await access.supabase.from("land_use_plan_designations").insert({
      id: newDesignationId, workspace_id: access.plan.workspace_id, version_id: versionId,
      layer_id: designation.layer_id, layer_version_id: designation.layer_version_id,
      designation_set_label: designation.designation_set_label, legend_metadata: designation.legend_metadata,
      created_by: access.userId,
    });
    if (error) return abandon("Failed to copy mapped designations into the amendment");
    const links = designation.land_use_plan_designation_policy_links ?? [];
    if (links.length) {
      const { error: linksError } = await access.supabase.from("land_use_plan_designation_policy_links").insert(links.flatMap((link: { policy_node_id: string }) => {
        const policyNodeId = nodeIdMap.get(link.policy_node_id);
        return policyNodeId ? [{ workspace_id: access.plan.workspace_id, version_id: versionId, designation_id: newDesignationId, policy_node_id: policyNodeId, created_by: access.userId }] : [];
      }));
      if (linksError) return abandon("Failed to copy designation policy links into the amendment");
    }
  }
  if ((actionsResult.data ?? []).length) {
    const { error } = await access.supabase.from("land_use_plan_implementation_actions").insert((actionsResult.data ?? []).map((item) => ({
      ...item, workspace_id: access.plan.workspace_id, version_id: versionId,
      content_node_id: item.content_node_id ? nodeIdMap.get(item.content_node_id) ?? null : null,
      status: "not_started", created_by: access.userId,
    })));
    if (error) return abandon("Failed to copy implementation actions into the amendment");
  }
  const activateResult = await access.supabase.from("land_use_plans").update({ current_working_version_id: versionId }).eq("id", access.plan.id).select("id").maybeSingle();
  if (isWriteFailure(activateResult.error)) return abandon("Failed to activate the amendment");
  if (writeMatchedNoRows(activateResult)) return noRowsMatchedResponse({ subject: "land use plan", targetWasVerified: true });
  return NextResponse.json({ versionId, versionNumber: nextNumber }, { status: 201 });
}
