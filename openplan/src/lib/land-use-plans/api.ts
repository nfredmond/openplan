import { NextResponse } from "next/server";

import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createClient } from "@/lib/supabase/server";
import { hashFrozenPlanContent, type FrozenPlanContent } from "./versioning";

export type LandUsePlanAccess = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  plan: {
    id: string;
    workspace_id: string;
    title: string;
    descriptor_id: string;
    plan_kind_key: string;
    authority_label: string;
    geography_label: string;
    geography_geojson: Record<string, unknown> | null;
    current_working_version_id: string | null;
    current_adopted_version_id: string | null;
  };
  canWrite: boolean;
};

export async function loadLandUsePlanAccess(
  planId: string,
  options: { write?: boolean } = {}
): Promise<{ ok: true; access: LandUsePlanAccess } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const authResult = await supabase.auth.getUser();
  if (authResult.error) {
    return { ok: false, response: NextResponse.json({ error: "Failed to authenticate" }, { status: 500 }) };
  }
  const auth = authResult.data;
  if (!auth.user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: plan, error: planError } = await supabase
    .from("land_use_plans")
    .select("id, workspace_id, title, descriptor_id, plan_kind_key, authority_label, geography_label, geography_geojson, current_working_version_id, current_adopted_version_id")
    .eq("id", planId)
    .maybeSingle();
  if (planError) {
    return { ok: false, response: NextResponse.json({ error: "Failed to load land use plan" }, { status: 500 }) };
  }
  if (!plan) {
    return { ok: false, response: NextResponse.json({ error: "Land use plan not found" }, { status: 404 }) };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", plan.workspace_id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (membershipError) {
    return { ok: false, response: NextResponse.json({ error: "Failed to resolve workspace role" }, { status: 500 }) };
  }
  const canWrite = Boolean(membership && canAccessWorkspaceAction("plans.write", membership.role));
  if (options.write && !canWrite) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return {
    ok: true,
    access: { supabase, userId: auth.user.id, plan, canWrite },
  };
}

export async function loadWorkingVersion(access: LandUsePlanAccess) {
  if (!access.plan.current_working_version_id) return null;
  const result = await access.supabase
    .from("land_use_plan_versions")
    .select("id, workspace_id, plan_id, version_number, version_kind, state, based_on_version_id, applicable_requirement_keys, content_hash, frozen_at")
    .eq("id", access.plan.current_working_version_id)
    .eq("plan_id", access.plan.id)
    .eq("state", "working")
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data ?? null;
}

export async function buildFrozenSnapshot(
  access: LandUsePlanAccess,
  version: {
    id: string;
    version_number: number;
    version_kind: string;
    based_on_version_id: string | null;
    applicable_requirement_keys: string[];
  }
): Promise<{ snapshot: FrozenPlanContent; hash: string } | null> {
  const supabase = access.supabase;
  const [nodes, relationships, designations, actions] = await Promise.all([
    supabase
      .from("land_use_plan_content_nodes")
      .select("id, parent_node_id, node_kind, requirement_key, title, body, sort_order, evidence_document_id, evidence_url")
      .eq("version_id", version.id)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("land_use_plan_relationships")
      .select("id, related_plan_id, related_plan_label, relationship_kind, notes")
      .eq("version_id", version.id)
      .order("id", { ascending: true }),
    supabase
      .from("land_use_plan_designations")
      .select("id, layer_id, layer_version_id, designation_set_label, legend_metadata, public_field_keys, legend_field, map_note, land_use_plan_designation_policy_links(policy_node_id)")
      .eq("version_id", version.id)
      .order("id", { ascending: true }),
    supabase
      .from("land_use_plan_implementation_actions")
      .select("id, content_node_id, title, description, responsible_party, due_on, status, project_id, program_id, evidence_document_id")
      .eq("version_id", version.id)
      .order("id", { ascending: true }),
  ]);
  if (nodes.error || relationships.error || designations.error || actions.error) return null;

  const layerVersionIds = (designations.data ?? []).map((designation) => designation.layer_version_id);
  const layerVersions = layerVersionIds.length
    ? await supabase
        .from("workspace_gis_layer_versions")
        .select("id, feature_hash, feature_hash_computed_at, feature_count, bbox, geometry_kinds")
        .in("id", layerVersionIds)
    : { data: [], error: null };
  if (layerVersions.error) return null;
  const layerVersionById = new Map((layerVersions.data ?? []).map((version) => [version.id, version]));
  const frozenDesignations = (designations.data ?? []).map((designation) => ({
    ...designation,
    layer_version_evidence: layerVersionById.get(designation.layer_version_id) ?? null,
  }));
  if (frozenDesignations.some((designation) => !designation.layer_version_evidence?.feature_hash)) return null;

  const snapshot: FrozenPlanContent = {
    plan: {
      id: access.plan.id,
      descriptorId: access.plan.descriptor_id,
      planKindKey: access.plan.plan_kind_key,
      title: access.plan.title,
      authorityLabel: access.plan.authority_label,
      geographyLabel: access.plan.geography_label,
    },
    version: {
      id: version.id,
      versionNumber: version.version_number,
      versionKind: version.version_kind,
      basedOnVersionId: version.based_on_version_id,
      applicableRequirementKeys: version.applicable_requirement_keys ?? [],
    },
    nodes: nodes.data ?? [],
    relationships: relationships.data ?? [],
    designations: frozenDesignations,
    implementationActions: actions.data ?? [],
  };
  return { snapshot, hash: hashFrozenPlanContent(snapshot) };
}
