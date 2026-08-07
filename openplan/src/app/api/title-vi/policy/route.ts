import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import {
  TITLE_VI_POLICY_COLUMNS,
  titleViPolicyGaps,
  toTitleViPolicy,
  type TitleViPolicyRow,
} from "@/lib/title-vi/policy";

/**
 * A WORKSPACE'S ADOPTED TITLE VI PROGRAM — read it, and record a new adoption.
 *
 * ============================================== WHY THERE IS NO PATCH VERB
 *
 * A Title VI program is ADOPTED, not edited. An agency's board passes it, the
 * agency publishes it, and a service-equity finding must stay reproducible
 * against the version that was current when the finding was made. Editing a
 * threshold in place would silently change what past findings meant, with no
 * record that anything moved.
 *
 * So POST supersedes: the current row gets `superseded_at`, and a new row is
 * inserted with its own adoption date and adopting body. The database holds a
 * partial unique index over `workspace_id WHERE superseded_at IS NULL`, so two
 * current policies for one workspace are unstorable rather than merely
 * discouraged.
 *
 * ================================================= WHY NO DEFAULTS EXIST
 *
 * OpenPlan supplies no starting values for any threshold. FTA C 4702.1B
 * thresholds are policy an agency adopts and publishes; a number a planner did
 * not choose is a number nobody adopted, and on a published finding it would be
 * indistinguishable from one that was. GET on a workspace with no policy returns
 * `policy: null` plus the gaps, never a template.
 */

export const runtime = "nodejs";

const querySchema = z.object({ workspaceId: z.string().uuid() }).strict();

const optionalPct = z.number().min(0).max(100).nullable().optional();
const optionalNote = z.string().trim().max(4000).nullable().optional();

const adoptSchema = z
  .object({
    workspaceId: z.string().uuid(),
    adoptedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    adoptedBy: z.string().trim().min(1).max(200),
    boardActionReference: z.string().trim().max(200).nullable().optional(),
    documentUrl: z.string().trim().url().max(2048).nullable().optional(),

    minorityDefinitionMethod: z.enum(["service_area_average", "fixed_threshold"]),
    minorityThresholdPct: optionalPct,
    lowIncomeDefinitionMethod: z.enum(["service_area_average", "fixed_threshold"]),
    lowIncomeThresholdPct: optionalPct,

    // Unbounded above 100 deliberately: a threshold is a relative difference in
    // percentage points and an agency may legitimately adopt one over 100.
    disparateImpactThresholdPct: z.number().min(0).max(1000).nullable().optional(),
    disproportionateBurdenThresholdPct: z.number().min(0).max(1000).nullable().optional(),

    standardPeakHeadwayMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    standardOffpeakHeadwayMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    standardSpanHours: z.number().min(0.5).max(24).nullable().optional(),
    standardOnTimePerformancePct: optionalPct,
    standardVehicleLoadNote: optionalNote,
    standardServiceAvailabilityNote: optionalNote,
    policyAmenityDistributionNote: optionalNote,
    policyVehicleAssignmentNote: optionalNote,
  })
  .strict()
  // The same pairing the database CHECKs enforce, refused here too so a planner
  // gets a sentence instead of a constraint-violation string.
  .refine(
    (value) =>
      value.minorityDefinitionMethod === "service_area_average"
        ? value.minorityThresholdPct === null || value.minorityThresholdPct === undefined
        : typeof value.minorityThresholdPct === "number",
    {
      message:
        "A fixed minority threshold needs a percentage; the service-area-average method must not carry one.",
      path: ["minorityThresholdPct"],
    }
  )
  .refine(
    (value) =>
      value.lowIncomeDefinitionMethod === "service_area_average"
        ? value.lowIncomeThresholdPct === null || value.lowIncomeThresholdPct === undefined
        : typeof value.lowIncomeThresholdPct === "number",
    {
      message:
        "A fixed low-income threshold needs a percentage; the service-area-average method must not carry one.",
      path: ["lowIncomeThresholdPct"],
    }
  );

function membershipResponse(kind: "schema_pending" | "not_member" | "error"): NextResponse {
  if (kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Title VI schema is not available yet",
        hint: "Apply the latest Supabase migrations, then try again.",
      },
      { status: 503 }
    );
  }
  if (kind === "error") {
    return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
  }
  // Never 403: confirming the workspace exists is an enumeration oracle.
  return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("titleVi.policy.read", request);

  try {
    const query = querySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json({ error: "Invalid workspace" }, { status: 400 });
    }
    const { workspaceId } = query.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, workspaceId);
    if (!membership.ok) {
      if (membership.kind === "error") {
        audit.error("membership_lookup_failed", { message: membership.message });
      }
      return membershipResponse(membership.kind);
    }

    // BOTH filters are load-bearing and neither is redundant with RLS: the
    // workspace scope is the tenant boundary, and `superseded_at IS NULL` is
    // what makes this the CURRENT adoption rather than an arbitrary historical
    // one that would silently change every threshold a finding was measured at.
    const result = await supabase
      .from("title_vi_policies")
      .select(TITLE_VI_POLICY_COLUMNS)
      .eq("workspace_id", workspaceId)
      .is("superseded_at", null)
      .maybeSingle();

    const failure = classifyRouteReadFailure("Title VI policy", result, {
      pendingError: "Title VI schema is not available yet",
      pendingHint: "Apply the latest Supabase migrations, then try again.",
    });
    if (failure) {
      audit.error("policy_read_failed", { message: failure.message });
      return NextResponse.json(failure.body, { status: failure.status });
    }

    const row = result.data as unknown as TitleViPolicyRow | null;
    const policy = row ? toTitleViPolicy(row) : null;

    return NextResponse.json({
      policy,
      // Never a template. The gaps say what is missing; they do not fill it in.
      gaps: titleViPolicyGaps(policy),
      canEdit: !isReadOnlyWorkspaceRole(membership.role),
    });
  } catch (error) {
    audit.error("unexpected", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Failed to read the Title VI policy" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("titleVi.policy.adopt", request);

  try {
    const body = await readJsonWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) {
      return body.response;
    }

    const parsed = adoptSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid Title VI policy", detail: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membership = await checkWorkspaceMembership(supabase, user.id, input.workspaceId);
    if (!membership.ok) {
      if (membership.kind === "error") {
        audit.error("membership_lookup_failed", { message: membership.message });
      }
      return membershipResponse(membership.kind);
    }
    if (isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Your role cannot adopt a Title VI policy for this workspace" },
        { status: 403 }
      );
    }

    // Supersede first, and OBSERVE WHAT IT TOUCHED. An UPDATE matching zero
    // rows is reported by PostgREST as success with no data, so without the
    // `.select()` this could not tell "there was no previous policy" (fine)
    // from "RLS filtered the previous policy out and it is still current"
    // (not fine — the insert below would then hit the partial unique index and
    // the planner would see an opaque failure instead of the real reason).
    const supersede = await supabase
      .from("title_vi_policies")
      .update({ superseded_at: new Date().toISOString() })
      .eq("workspace_id", input.workspaceId)
      .is("superseded_at", null)
      .select("id");

    if (supersede.error) {
      audit.error("supersede_failed", { message: supersede.error.message });
      return NextResponse.json(
        { error: "Could not supersede the previous Title VI policy" },
        { status: 500 }
      );
    }
    const superseded = (supersede.data ?? []) as Array<{ id: string }>;
    audit.info("title_vi_policy_superseded", {
      workspaceId: input.workspaceId,
      supersededCount: superseded.length,
    });

    const inserted = await supabase
      .from("title_vi_policies")
      .insert({
        workspace_id: input.workspaceId,
        adopted_on: input.adoptedOn,
        adopted_by: input.adoptedBy,
        board_action_reference: input.boardActionReference ?? null,
        document_url: input.documentUrl ?? null,
        minority_definition_method: input.minorityDefinitionMethod,
        minority_threshold_pct: input.minorityThresholdPct ?? null,
        low_income_definition_method: input.lowIncomeDefinitionMethod,
        low_income_threshold_pct: input.lowIncomeThresholdPct ?? null,
        disparate_impact_threshold_pct: input.disparateImpactThresholdPct ?? null,
        disproportionate_burden_threshold_pct: input.disproportionateBurdenThresholdPct ?? null,
        standard_peak_headway_minutes: input.standardPeakHeadwayMinutes ?? null,
        standard_offpeak_headway_minutes: input.standardOffpeakHeadwayMinutes ?? null,
        standard_span_hours: input.standardSpanHours ?? null,
        standard_on_time_performance_pct: input.standardOnTimePerformancePct ?? null,
        standard_vehicle_load_note: input.standardVehicleLoadNote ?? null,
        standard_service_availability_note: input.standardServiceAvailabilityNote ?? null,
        policy_amenity_distribution_note: input.policyAmenityDistributionNote ?? null,
        policy_vehicle_assignment_note: input.policyVehicleAssignmentNote ?? null,
        created_by: user.id,
      })
      .select(TITLE_VI_POLICY_COLUMNS)
      .maybeSingle();

    if (inserted.error) {
      audit.error("adopt_failed", { message: inserted.error.message });
      return NextResponse.json({ error: "Could not record the Title VI policy" }, { status: 500 });
    }
    // Zero matched rows on an INSERT…RETURNING under RLS is reported as success
    // with no data. Treating that as adopted would tell a planner their program
    // is recorded when nothing was written.
    if (!inserted.data) {
      audit.error("adopt_matched_no_rows", { workspaceId: input.workspaceId });
      return NextResponse.json(
        { error: "The Title VI policy could not be recorded for this workspace" },
        { status: 500 }
      );
    }

    const policy = toTitleViPolicy(inserted.data as unknown as TitleViPolicyRow);
    audit.info("title_vi_policy_adopted", {
      workspaceId: input.workspaceId,
      policyId: policy.id,
      adoptedOn: policy.adoptedOn,
    });

    return NextResponse.json({ policy, gaps: titleViPolicyGaps(policy), canEdit: true }, { status: 201 });
  } catch (error) {
    audit.error("unexpected", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Failed to record the Title VI policy" }, { status: 500 });
  }
}
