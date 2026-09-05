import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  getJurisdictionPlanDescriptor,
  defaultApplicableRequirementKeys,
  recommendJurisdictionPlanDescriptor,
  SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS,
} from "@/lib/land-use-plans/registry";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import {
  HOME_JURISDICTION_COLUMNS,
  parseWorkspaceHomeGeography,
  resolveJurisdiction,
} from "@/lib/workspaces/home-geography";

const selectableIds = SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS.map((item) => item.id) as [string, ...string[]];
const createSchema = z.object({
  title: z.string().trim().min(1).max(180),
  descriptorId: z.enum(selectableIds),
  planKindKey: z.string().trim().min(1).max(80),
  authorityLabel: z.string().trim().min(1).max(180),
  geographyLabel: z.string().trim().min(1).max(180),
  geographyGeojson: z.record(z.string(), z.unknown()),
}).strict();

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("land-use-plans.list", request);
  audit.info("land_use_plans_list_requested");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return NextResponse.json({ error: "Failed to authenticate" }, { status: 500 });
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { membership } = await loadCurrentWorkspaceMembership(supabase, auth.user.id);
  if (!membership) return NextResponse.json({ plans: [] });

  const { data, error } = await supabase
    .from("land_use_plans")
    .select("id, workspace_id, title, descriptor_id, plan_kind_key, authority_label, geography_label, local_requirements_notice, current_working_version_id, current_adopted_version_id, created_at, updated_at, land_use_plan_versions!land_use_plan_versions_plan_id_workspace_id_fkey(id, version_number, version_kind, state, content_hash, frozen_at, published_report_id)")
    .eq("workspace_id", membership.workspace_id)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to load land use plans" }, { status: 500 });
  return NextResponse.json({ plans: data ?? [] });
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("land-use-plans.create", request);
  audit.info("land_use_plan_create_requested");
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.networkGeoJson);
  if (!body.ok) return body.response;
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid land use plan payload", issues: parsed.error.issues }, { status: 400 });
  }

  const descriptor = getJurisdictionPlanDescriptor(parsed.data.descriptorId);
  if (!descriptor || !descriptor.planKinds.some((kind) => kind.key === parsed.data.planKindKey)) {
    return NextResponse.json({ error: "The selected plan kind is not in that jurisdiction descriptor" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return NextResponse.json({ error: "Failed to authenticate" }, { status: 500 });
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { membership } = await loadCurrentWorkspaceMembership(supabase, auth.user.id);
  if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const jurisdictionResult = await supabase
    .from("workspaces")
    .select(HOME_JURISDICTION_COLUMNS)
    .eq("id", membership.workspace_id)
    .maybeSingle();
  if (jurisdictionResult.error) {
    return NextResponse.json(
      { error: "The workspace jurisdiction could not be verified; no legal bundle was attached" },
      { status: 503 }
    );
  }
  const recommendation = recommendJurisdictionPlanDescriptor(
    resolveJurisdiction(parseWorkspaceHomeGeography(jurisdictionResult.data))
  );
  if (descriptor.configured && recommendation.descriptor.id !== descriptor.id) {
    return NextResponse.json(
      {
        error: `${descriptor.jurisdictionLabel} does not match this workspace's home jurisdiction. Use the neutral workflow instead.`,
      },
      { status: 409 }
    );
  }

  const localNotice = descriptor.configured ? null : descriptor.disclosure;
  const { data: plan, error: planError } = await supabase
    .from("land_use_plans")
    .insert({
      workspace_id: membership.workspace_id,
      title: parsed.data.title,
      descriptor_id: descriptor.id,
      plan_kind_key: parsed.data.planKindKey,
      authority_label: parsed.data.authorityLabel,
      geography_label: parsed.data.geographyLabel,
      geography_geojson: parsed.data.geographyGeojson,
      local_requirements_notice: localNotice,
      created_by: auth.user.id,
    })
    .select("id, workspace_id, title")
    .single();
  if (planError || !plan) {
    return NextResponse.json({ error: "Failed to create land use plan" }, { status: 500 });
  }

  const applicableKeys = defaultApplicableRequirementKeys(descriptor);
  const { data: version, error: versionError } = await supabase
    .from("land_use_plan_versions")
    .insert({
      workspace_id: membership.workspace_id,
      plan_id: plan.id,
      version_number: 1,
      version_kind: "original",
      state: "working",
      applicable_requirement_keys: applicableKeys,
      created_by: auth.user.id,
    })
    .select("id, version_number")
    .single();
  if (versionError || !version) {
    const cleanup = await supabase.from("land_use_plans").delete().eq("id", plan.id).select("id");
    if (cleanup.error) audit.error("land_use_plan_create_cleanup_failed", { error: cleanup.error });
    return NextResponse.json({ error: "Failed to create the first working version" }, { status: 500 });
  }

  const sectionRows = descriptor.requirements.map((requirement, index) => ({
    workspace_id: membership.workspace_id,
    version_id: version.id,
    node_kind: "section",
    requirement_key: requirement.key,
    title: requirement.label,
    sort_order: index,
    created_by: auth.user.id,
  }));
  const { error: sectionsError } = await supabase.from("land_use_plan_content_nodes").insert(sectionRows);
  if (sectionsError) {
    const cleanup = await supabase.from("land_use_plans").delete().eq("id", plan.id).select("id");
    if (cleanup.error) audit.error("land_use_plan_create_cleanup_failed", { error: cleanup.error });
    return NextResponse.json({ error: "Failed to create the descriptor checklist" }, { status: 500 });
  }

  const activationResult = await supabase
    .from("land_use_plans")
    .update({ current_working_version_id: version.id })
    .eq("id", plan.id)
    .select("id")
    .maybeSingle();
  if (isWriteFailure(activationResult.error)) {
    const cleanup = await supabase.from("land_use_plans").delete().eq("id", plan.id).select("id");
    if (cleanup.error) audit.error("land_use_plan_create_cleanup_failed", { error: cleanup.error });
    return NextResponse.json({ error: "Failed to activate the working version" }, { status: 500 });
  }
  if (writeMatchedNoRows(activationResult)) return noRowsMatchedResponse({ subject: "new land use plan", targetWasVerified: true });

  return NextResponse.json({ planId: plan.id, versionId: version.id }, { status: 201 });
}
