import { isDeepStrictEqual } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { planCreationCommandSchema } from "@/lib/land-use-plans/create-command";
import { createPlanWithContext, PlanCreationError } from "@/lib/land-use-plans/create-store";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { createApiAuditLogger } from "@/lib/observability/audit";

const privateHeaders = { "Cache-Control": "private, no-store" };
const messages = {
  invalid: "Review the plan title, area, responsible bodies and assessment. Keep your draft.",
  forbidden: "Current staff access in the same account and workspace is required. Staff must assess plan authority.",
  conflict: "The reviewed rules or saved request changed. Keep the exact request and check its outcome before starting another plan.",
  unavailable: "OpenPlan could not confirm creation. Keep the exact request and retry it before starting another plan.",
};

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

/** Retain one plan-owned creation command before acknowledging any of its writes. */
export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("land-use-plans.create", request);
  try {
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) {
      throw new PlanCreationError("forbidden");
    }
    try { requireProviderBrowserOrigin(request); } catch { throw new PlanCreationError("forbidden"); }
    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) throw new PlanCreationError("unavailable");
    if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
    const { membership } = await loadCurrentWorkspaceMembership(supabase, auth.user.id);
    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) throw new PlanCreationError("forbidden");
    if (request.headers.get("x-openplan-expected-user") !== auth.user.id
      || request.headers.get("x-openplan-expected-workspace") !== membership.workspace_id) throw new PlanCreationError("forbidden");
    const body = await readBytesWithLimitStreaming(request, 2_000_000);
    if (!body.ok) {
      body.response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
      return body.response;
    }
    let commandText: string;
    let raw: unknown;
    try { commandText = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes); raw = JSON.parse(commandText); }
    catch { throw new PlanCreationError("invalid"); }
    const parsed = planCreationCommandSchema.safeParse(raw);
    if (!parsed.success || !isDeepStrictEqual(parsed.data, raw)) throw new PlanCreationError("invalid");
    const result = await createPlanWithContext(createServiceRoleClient(), {
      actorId: auth.user.id, workspaceId: membership.workspace_id,
    }, commandText);
    audit.info("land_use_plan_creation_retained", { planId: result.planId, versionId: result.versionId, commandId: result.commandId, replayed: result.replayed });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: privateHeaders });
  } catch (error) {
    const failed = error instanceof PlanCreationError ? error : new PlanCreationError("unavailable");
    audit.warn("land_use_plan_creation_unconfirmed", { kind: failed.kind });
    return NextResponse.json({ kind: failed.kind, error: messages[failed.kind] }, { status: failed.status, headers: privateHeaders });
  }
}
