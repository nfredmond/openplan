import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { computeNetInvoiceAmount, computeRetentionAmount } from "@/lib/invoicing/invoice-records";
import { isValidPosture, resolveReimbursementProfile } from "@/lib/invoicing/reimbursement-profile-binding";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { parseWorkspaceHomeGeography, resolveJurisdiction } from "@/lib/workspaces/home-geography";

const createBillingInvoiceSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  fundingAwardId: z.string().uuid().optional(),
  invoiceNumber: z.string().trim().min(1).max(120),
  consultantName: z.string().trim().max(160).optional(),
  billingBasis: z.enum(["lump_sum", "time_and_materials", "cost_plus", "milestone", "progress_payment"]).optional(),
  status: z.enum(["draft", "internal_review", "submitted", "approved_for_payment", "paid", "rejected"]).optional(),
  periodStart: z.string().trim().max(30).optional(),
  periodEnd: z.string().trim().max(30).optional(),
  invoiceDate: z.string().trim().max(30).optional(),
  dueDate: z.string().trim().max(30).optional(),
  amount: z.coerce.number().min(0),
  retentionPercent: z.coerce.number().min(0).max(100).optional(),
  supportingDocsStatus: z.enum(["pending", "partial", "complete", "accepted"]).optional(),
  submittedTo: z.string().trim().max(160).optional(),
  // No enum here on purpose: the valid posture vocabulary belongs to the
  // resolved reimbursement profile, not to a jurisdiction baked into a schema.
  // The handler validates the posture against the profile's own options.
  reimbursementProfileId: z.string().trim().min(1).max(120).optional(),
  reimbursementPosture: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(4000).optional(),
});

const INVOICE_SELECT_LEGACY =
  "id, workspace_id, project_id, funding_award_id, invoice_number, consultant_name, billing_basis, status, period_start, period_end, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at";

// caltrans_posture stays selected as the legacy read fallback for rows that
// predate the profile backfill.
const INVOICE_SELECT =
  `${INVOICE_SELECT_LEGACY}, reimbursement_profile_id, reimbursement_posture, reimbursement_profile_selection`;

/** PostgREST's shapes for "this deployment has not applied the profile-columns migration yet". */
function looksLikePendingProfileSchema(message: string | null | undefined): boolean {
  return /could not find the .* column|column .* does not exist|schema cache/i.test(message ?? "");
}

/**
 * The CHECK vocabulary of the legacy caltrans_posture column (20260321000033).
 * On a database that predates 20260727000009, that column is the ONLY place a
 * posture can be recorded — so the pending-schema fallback writes the user's
 * validated posture into it when the CHECK can store it, and refuses when it
 * cannot. Letting the column's DEFAULT fill in would silently record a posture
 * the user did not choose. This is a fact about the deployed schema, not a
 * jurisdiction assumption: it goes away entirely once the migration is applied.
 */
const LEGACY_POSTURE_COLUMN_CHECK_VALUES = new Set([
  "local_agency_consulting",
  "federal_aid_candidate",
  "deferred_exact_forms",
]);

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("billing.invoices.create", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const payload = payloadBody.data;
    const parsed = createBillingInvoiceSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid invoice payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      audit.warn("unauthorized", { durationMs: Date.now() - startedAt });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membershipQuery = supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: membership, error: membershipError } = await membershipQuery;

    if (membershipError || !membership) {
      audit.warn("workspace_membership_missing", {
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        message: membershipError?.message ?? null,
      });
      return NextResponse.json({ error: "Workspace access not found" }, { status: 403 });
    }

    if (!canAccessWorkspaceAction("invoices.write", membership.role)) {
      audit.warn("forbidden", {
        workspaceId: parsed.data.workspaceId,
        userId: user.id,
        role: membership.role,
      });
      return NextResponse.json({ error: "Owner or admin role required for invoice writes" }, { status: 403 });
    }

    if (parsed.data.projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id, workspace_id")
        .eq("id", parsed.data.projectId)
        .single();

      if (projectError || !project || project.workspace_id !== parsed.data.workspaceId) {
        audit.warn("project_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          projectId: parsed.data.projectId,
          message: projectError?.message ?? null,
        });
        return NextResponse.json({ error: "Project is not available in the requested workspace" }, { status: 400 });
      }
    }

    let effectiveProjectId = parsed.data.projectId ?? null;
    if (parsed.data.fundingAwardId) {
      const { data: fundingAward, error: fundingAwardError } = await supabase
        .from("funding_awards")
        .select("id, workspace_id, project_id")
        .eq("id", parsed.data.fundingAwardId)
        .single();

      if (fundingAwardError || !fundingAward || fundingAward.workspace_id !== parsed.data.workspaceId) {
        audit.warn("funding_award_workspace_mismatch", {
          workspaceId: parsed.data.workspaceId,
          fundingAwardId: parsed.data.fundingAwardId,
          message: fundingAwardError?.message ?? null,
        });
        return NextResponse.json({ error: "Funding award is not available in the requested workspace" }, { status: 400 });
      }

      if (effectiveProjectId && fundingAward.project_id && effectiveProjectId !== fundingAward.project_id) {
        return NextResponse.json({ error: "Funding award must match the selected project" }, { status: 400 });
      }

      effectiveProjectId = effectiveProjectId ?? fundingAward.project_id ?? null;
    }

    // Which reimbursement profile governs this record: an explicit request
    // outranks geography, the workspace's own home geography matches a
    // registered profile, and only then does the labeled interim default
    // apply. A failed geography read (e.g. columns pending on an older
    // deployment) resolves as "jurisdiction unknown", which is a fallback
    // reason — never a licence to guess.
    const workspaceGeographyRead = await supabase
      .from("workspaces")
      .select("home_geography_source, home_geography_kind, home_geography_ref, home_country_code, home_subdivision_code")
      .eq("id", parsed.data.workspaceId)
      .maybeSingle();

    const profileResolution = resolveReimbursementProfile({
      requestedProfileId: parsed.data.reimbursementProfileId,
      workspaceJurisdiction: resolveJurisdiction(
        parseWorkspaceHomeGeography(workspaceGeographyRead.error ? null : workspaceGeographyRead.data)
      ),
    });

    if (profileResolution.kind === "unknown_profile") {
      audit.warn("unknown_reimbursement_profile", {
        workspaceId: parsed.data.workspaceId,
        requestedProfileId: profileResolution.requestedProfileId,
      });
      return NextResponse.json(
        {
          error: `Unknown reimbursement profile: ${profileResolution.requestedProfileId}`,
          availableProfiles: profileResolution.available.map((profile) => profile.profileId),
        },
        { status: 400 }
      );
    }

    const profileBinding = profileResolution.binding;
    const requestedPosture = parsed.data.reimbursementPosture;

    if (requestedPosture && !isValidPosture(profileBinding.postureOptions, requestedPosture)) {
      audit.warn("reimbursement_posture_not_in_profile", {
        workspaceId: parsed.data.workspaceId,
        profileId: profileBinding.profileId,
        requestedPosture,
      });
      return NextResponse.json(
        {
          error: `Reimbursement posture "${requestedPosture}" is not part of the ${profileBinding.profileName} profile`,
          validPostures: profileBinding.postureOptions.map((option) => option.postureId),
        },
        { status: 400 }
      );
    }

    const reimbursementPosture = requestedPosture ?? profileBinding.defaultPostureId;

    const amount = parsed.data.amount;
    const retentionPercent = parsed.data.retentionPercent ?? 0;
    const retentionAmount = computeRetentionAmount(amount, retentionPercent);
    const netAmount = computeNetInvoiceAmount(amount, retentionAmount, retentionPercent);

    // caltrans_posture is deliberately not written on the primary path: its DB
    // DEFAULT keeps the legacy column valid while the profile columns carry
    // the real record. The pending-schema fallback below is the one exception,
    // because there the legacy column is the only place the posture can live.
    const legacyShapeInsert = {
      workspace_id: parsed.data.workspaceId,
      project_id: effectiveProjectId,
      funding_award_id: parsed.data.fundingAwardId ?? null,
      invoice_number: parsed.data.invoiceNumber,
      consultant_name: parsed.data.consultantName?.trim() || null,
      billing_basis: parsed.data.billingBasis ?? "time_and_materials",
      status: parsed.data.status ?? "draft",
      period_start: parsed.data.periodStart?.trim() || null,
      period_end: parsed.data.periodEnd?.trim() || null,
      invoice_date: parsed.data.invoiceDate?.trim() || null,
      due_date: parsed.data.dueDate?.trim() || null,
      amount,
      retention_percent: retentionPercent,
      retention_amount: retentionAmount,
      net_amount: netAmount,
      supporting_docs_status: parsed.data.supportingDocsStatus ?? "pending",
      submitted_to: parsed.data.submittedTo?.trim() || null,
      notes: parsed.data.notes?.trim() || null,
      created_by: user.id,
    };

    let { data, error } = await supabase
      .from("billing_invoice_records")
      .insert({
        ...legacyShapeInsert,
        reimbursement_profile_id: profileBinding.profileId,
        reimbursement_posture: reimbursementPosture,
        reimbursement_profile_selection: profileBinding.selection,
      })
      .select(INVOICE_SELECT)
      .single();

    if (error && looksLikePendingProfileSchema(error.message)) {
      // This deployment's database predates the profile columns. Keep the
      // write working in the legacy shape — but only when the legacy column
      // can store the posture the user actually validated. Recording a
      // different posture than the one chosen is never acceptable, so a
      // posture outside the legacy CHECK refuses with the migration to apply.
      if (!LEGACY_POSTURE_COLUMN_CHECK_VALUES.has(reimbursementPosture)) {
        audit.warn("reimbursement_profile_columns_pending_posture_unstorable", {
          workspaceId: parsed.data.workspaceId,
          profileId: profileBinding.profileId,
          reimbursementPosture,
          message: error.message,
        });
        return NextResponse.json(
          {
            error: `This deployment's database predates the reimbursement-profile columns, and its legacy posture column cannot store "${reimbursementPosture}". Apply migration 20260727000009_invoicing_reimbursement_profiles, then retry — the record was not saved under a posture you did not choose.`,
          },
          { status: 503 }
        );
      }

      audit.warn("reimbursement_profile_columns_pending", {
        workspaceId: parsed.data.workspaceId,
        message: error.message,
      });
      ({ data, error } = await supabase
        .from("billing_invoice_records")
        .insert({ ...legacyShapeInsert, caltrans_posture: reimbursementPosture })
        .select(INVOICE_SELECT_LEGACY)
        .single());
    }

    if (error) {
      audit.error("billing_invoice_insert_failed", {
        message: error.message,
        code: error.code ?? null,
        workspaceId: parsed.data.workspaceId,
      });
      return NextResponse.json({ error: "Failed to create invoice record", details: error.message }, { status: 500 });
    }

    audit.info("billing_invoice_created", {
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId ?? null,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ invoice: data }, { status: 201 });
  } catch (error) {
    audit.error("billing_invoice_create_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });

    return NextResponse.json({ error: "Unexpected error while creating invoice record" }, { status: 500 });
  }
}
