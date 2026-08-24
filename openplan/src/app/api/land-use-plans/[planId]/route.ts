import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess, loadWorkingVersion } from "@/lib/land-use-plans/api";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({ planId: z.string().uuid() });
const patchSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  authorityLabel: z.string().trim().min(1).max(180).optional(),
  geographyLabel: z.string().trim().min(1).max(180).optional(),
  geographyGeojson: z.record(z.string(), z.unknown()).optional(),
  applicableRequirementKeys: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field must be updated");

type Context = { params: Promise<{ planId: string }> };

export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.detail", request);
  audit.info("land_use_plan_detail_requested");
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(parsedParams.data.planId);
  if (!loaded.ok) return loaded.response;
  const { access } = loaded;
  const descriptor = getJurisdictionPlanDescriptor(access.plan.descriptor_id);
  if (!descriptor) return NextResponse.json({ error: "Plan descriptor is not installed" }, { status: 409 });

  const { data: versions, error: versionsError } = await access.supabase
    .from("land_use_plan_versions")
    .select("id, version_number, version_kind, state, based_on_version_id, applicable_requirement_keys, content_hash, frozen_at, frozen_by, published_report_id, created_at, updated_at")
    .eq("plan_id", access.plan.id)
    .order("version_number", { ascending: false });
  if (versionsError) return NextResponse.json({ error: "Failed to load plan versions" }, { status: 500 });
  const activeVersion = (versions ?? []).find((version) => version.id === access.plan.current_working_version_id)
    ?? (versions ?? []).find((version) => version.id === access.plan.current_adopted_version_id)
    ?? versions?.[0]
    ?? null;
  if (!activeVersion) return NextResponse.json({ error: "Plan has no version" }, { status: 409 });

  const versionId = activeVersion.id;
  const [nodes, relationships, designations, actions, reviews, decisions, reports, consultations, layers, documents, campaigns, projects, programs] = await Promise.all([
    access.supabase.from("land_use_plan_content_nodes").select("id, parent_node_id, node_kind, requirement_key, title, body, sort_order, evidence_document_id, evidence_url").eq("version_id", versionId).order("sort_order"),
    access.supabase.from("land_use_plan_relationships").select("id, related_plan_id, related_plan_label, relationship_kind, notes").eq("version_id", versionId),
    access.supabase.from("land_use_plan_designations").select("id, layer_id, layer_version_id, designation_set_label, legend_metadata, map_note, land_use_plan_designation_policy_links(policy_node_id)").eq("version_id", versionId),
    access.supabase.from("land_use_plan_implementation_actions").select("id, content_node_id, title, description, responsible_party, assignee_user_id, due_on, status, project_id, program_id, evidence_document_id").eq("version_id", versionId).order("due_on"),
    access.supabase.from("land_use_plan_review_events").select("id, event_kind, occurred_on, decision_body, engagement_campaign_id, evidence_document_id, notes, created_at").eq("version_id", versionId).order("occurred_on"),
    access.supabase.from("land_use_plan_decisions").select("id, version_id, version_content_hash, decision_kind, decision_body, instrument_type, instrument_identifier, vote, decided_on, effective_on, supporting_document_id, created_at").eq("plan_id", access.plan.id).order("decided_on", { ascending: false }),
    access.supabase.from("land_use_plan_implementation_reports").select("id, adopted_version_id, reporting_period_start, reporting_period_end, summary, content_hash, report_id, generated_at").eq("plan_id", access.plan.id).order("reporting_period_end", { ascending: false }),
    access.supabase.from("land_use_plan_consultation_records").select("id, status, evidence_document_id, confidential_notes, contains_sensitive_locations, updated_at").eq("version_id", versionId),
    access.supabase.from("workspace_gis_layers").select("id, name, current_version_id").eq("workspace_id", access.plan.workspace_id).is("archived_at", null),
    access.supabase.from("kb_documents").select("id, title, status, citation_label").eq("workspace_id", access.plan.workspace_id).eq("status", "ready").order("title"),
    access.supabase.from("engagement_campaigns").select("id, title, status").eq("workspace_id", access.plan.workspace_id).order("title"),
    access.supabase.from("projects").select("id, name, status").eq("workspace_id", access.plan.workspace_id).order("name"),
    access.supabase.from("programs").select("id, title, status").eq("workspace_id", access.plan.workspace_id).order("title"),
  ]);
  const results = { nodes, relationships, designations, actions, reviews, decisions, reports, consultations, layers, documents, campaigns, projects, programs };
  const failed = Object.entries(results).find(([, result]) => result.error);
  if (failed) return NextResponse.json({ error: `Failed to load ${failed[0]}` }, { status: 500 });

  return NextResponse.json({
    plan: access.plan,
    descriptor,
    canWrite: access.canWrite,
    versions: versions ?? [],
    activeVersion,
    ...Object.fromEntries(Object.entries(results).map(([key, result]) => [key, result.data ?? []])),
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.update", request);
  audit.info("land_use_plan_update_requested");
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.networkGeoJson);
  if (!body.ok) return body.response;
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan update", issues: parsed.error.issues }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(parsedParams.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const working = await loadWorkingVersion(loaded.access);
  if (!working) return NextResponse.json({ error: "Fork a working version before changing plan identity or applicability" }, { status: 409 });

  const planUpdates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) planUpdates.title = parsed.data.title;
  if (parsed.data.authorityLabel !== undefined) planUpdates.authority_label = parsed.data.authorityLabel;
  if (parsed.data.geographyLabel !== undefined) planUpdates.geography_label = parsed.data.geographyLabel;
  if (parsed.data.geographyGeojson !== undefined) planUpdates.geography_geojson = parsed.data.geographyGeojson;
  if (Object.keys(planUpdates).length) {
    const result = await loaded.access.supabase.from("land_use_plans").update(planUpdates).eq("id", loaded.access.plan.id).select("id").maybeSingle();
    if (isWriteFailure(result.error)) return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
    if (writeMatchedNoRows(result)) return noRowsMatchedResponse({ subject: "land use plan", targetWasVerified: true });
  }
  if (parsed.data.applicableRequirementKeys !== undefined) {
    const descriptor = getJurisdictionPlanDescriptor(loaded.access.plan.descriptor_id);
    const allowed = new Set(descriptor?.requirements.map((requirement) => requirement.key) ?? []);
    const required = descriptor?.requirements.filter((requirement) => requirement.applicability === "required").map((requirement) => requirement.key) ?? [];
    if (!parsed.data.applicableRequirementKeys.every((key) => allowed.has(key))) {
      return NextResponse.json({ error: "Applicability includes a key outside the plan descriptor" }, { status: 400 });
    }
    if (!required.every((key) => parsed.data.applicableRequirementKeys?.includes(key))) {
      return NextResponse.json({ error: "Required descriptor content cannot be marked inapplicable" }, { status: 400 });
    }
    const result = await loaded.access.supabase.from("land_use_plan_versions").update({ applicable_requirement_keys: parsed.data.applicableRequirementKeys }).eq("id", working.id).select("id").maybeSingle();
    if (isWriteFailure(result.error)) return NextResponse.json({ error: "Failed to update applicability" }, { status: 500 });
    if (writeMatchedNoRows(result)) return noRowsMatchedResponse({ subject: "working plan version", targetWasVerified: true });
  }
  return NextResponse.json({ updated: true });
}
