import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { BCA_ENGINE_VERSION, InsufficientDataError, computeBenefitCostAnalysis } from "@/lib/bca";
import { bcaAnalysisInputsSchema } from "@/lib/bca/schema";

const saveScreeningSchema = z
  .object({
    inputs: bcaAnalysisInputsSchema,
    contextLabel: z.string().trim().max(160).optional(),
  })
  .strict();

/**
 * Saves a screening-level BCA to the project record. The result is
 * recomputed here from the validated inputs through the pure engine —
 * the stored result_json is always server-derived, never client math.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.bca-screenings.create", request);
  const { projectId } = await context.params;

  if (!z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }

  const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
  if (!payloadBody.ok) return payloadBody.response;
  const parsed = saveScreeningSchema.safeParse(payloadBody.data);
  if (!parsed.success) {
    audit.warn("validation_failed", { issues: parsed.error.issues.slice(0, 5) });
    return NextResponse.json({ error: "Invalid BCA screening payload" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, workspace_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) {
    audit.error("project_lookup_failed", { message: projectError.message });
    return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .eq("workspace_id", project.workspace_id)
    .maybeSingle();
  if (membershipError) {
    audit.error("membership_lookup_failed", { message: membershipError.message });
    return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
  }
  if (!membership || !canAccessWorkspaceAction("programs.write", membership.role)) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  let result;
  try {
    result = computeBenefitCostAnalysis(parsed.data.inputs);
  } catch (error) {
    // Both engine tiers are operator-fixable input problems here, not 500s.
    const status = error instanceof InsufficientDataError ? 422 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The screening engine rejected these inputs" },
      { status }
    );
  }

  // Headline metrics only — annual streams are recomputable from inputs_json.
  const resultJson = {
    netPresentValue: result.netPresentValue,
    benefitCostRatio: result.benefitCostRatio,
    presentValueBenefits: result.presentValueBenefits,
    presentValueCosts: result.presentValueCosts,
    internalRateOfReturnPct: result.internalRateOfReturnPct,
    paybackYearsDiscounted: result.paybackYearsDiscounted,
    baseYear: result.baseYear,
    analysisHorizonYears: result.analysisHorizonYears,
    discountRatePct: result.discountRatePct,
    co2DiscountRatePct: result.co2DiscountRatePct,
  };

  const { data: saved, error: insertError } = await supabase
    .from("project_bca_screenings")
    .insert({
      workspace_id: project.workspace_id,
      project_id: project.id,
      inputs_json: parsed.data.inputs,
      result_json: resultJson,
      engine_version: BCA_ENGINE_VERSION,
      context_label: parsed.data.contextLabel?.trim() || null,
      created_by: user.id,
    })
    .select("id, created_at, result_json, engine_version")
    .single();
  if (insertError) {
    audit.error("insert_failed", { message: insertError.message });
    return NextResponse.json({ error: "Failed to save the screening" }, { status: 500 });
  }

  audit.info("bca_screening_saved", { projectId: project.id, screeningId: saved.id });
  return NextResponse.json({ screening: saved }, { status: 201 });
}
