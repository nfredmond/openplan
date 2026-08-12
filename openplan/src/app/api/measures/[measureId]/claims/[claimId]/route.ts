/**
 * Deciding a claim — and the one place in this lane where money leaves a public
 * fund.
 *
 * ============================================================================
 * THIS IS THE PART THAT IS NOT A MIRROR
 * ============================================================================
 *
 * Everywhere else in this lane, the reimbursement seam simply runs backwards
 * and the shapes carry over. Here the agency DECIDES rather than requests, and
 * three things follow that have no counterpart on the invoice side:
 *
 *   1. A STRICTER GATE. `invoices.write` — owner or admin — not
 *      `programs.write`. This is the same authority the product already uses
 *      for money movement on the other side of the seam, chosen over a new
 *      `measures.decide` action so the role matrix answers "who may move money"
 *      once rather than in two places that can drift.
 *   2. AN AUTHOR ON EVERY DECISION. `decided_by` and `decided_at` are written
 *      by this route from the authenticated caller, never from the body, and
 *      the database CHECKs that they are present for every state past
 *      submitted. An oversight committee reading this a year later must be able
 *      to see who decided.
 *   3. A DENIAL MUST SAY WHY. Required here so the 400 names the field, and
 *      CHECKed in the database so no other writer can skip it.
 *
 * `paid` additionally requires `paidOn`. On the invoice side a paid row may
 * carry no date and `buildAwardDrawdownLedger` compensates with a
 * `paidWithNoDateCount` on every read; this table refuses the row instead.
 *
 * ============================================================================
 * THE LIFECYCLE IS A TABLE, AND IT IS CHECKED
 * ============================================================================
 *
 * `MEASURE_CLAIM_TRANSITIONS` in `claims.ts` says which moves are legal, and
 * this route refuses the rest with both states named. `paid` and `denied` are
 * terminal: un-paying a claim is a refund, which is a new movement of public
 * money with its own record, not the deletion of the old one.
 *
 * DELETE removes a DRAFT only — and the refusal is in the row-level policy
 * (`measure_claims_delete`), not merely here, so a second writer inherits it.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import {
  formatMeasureClaimStatusLabel,
  isAllowedMeasureClaimTransition,
  measureClaimStatusRequiresDecider,
  MEASURE_CLAIM_COLUMNS,
  MEASURE_CLAIM_TRANSITIONS,
  type MeasureClaimStatus,
} from "@/lib/measures/claims";
import { authorizeMeasureWrite } from "@/lib/measures/write-authorization";

const paramsSchema = z.object({ measureId: z.string().uuid(), claimId: z.string().uuid() });

/**
 * States a MEMBER may set, and states that need an owner or admin.
 *
 * Submitting and withdrawing are the claimant's side of the exchange and stay
 * on `programs.write`. Everything that commits the fund needs the money gate.
 */
const MEMBER_SETTABLE_STATUSES = ["submitted", "withdrawn"] as const satisfies readonly MeasureClaimStatus[];

const patchClaimSchema = z
  .object({
    status: z.enum(["submitted", "under_review", "approved", "paid", "denied", "withdrawn"]).optional(),
    decisionNote: z.string().trim().max(4000).optional(),
    denialReason: z.string().trim().max(4000).optional(),
    paidOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    paymentReference: z.string().trim().max(120).optional(),
    /** Editing the request itself — permitted only while it is still a draft. */
    amount: z.coerce.number().min(0).optional(),
    retentionPercent: z.coerce.number().min(0).max(100).optional(),
    retentionAmount: z.coerce.number().min(0).optional(),
    description: z.string().trim().max(4000).nullish(),
    claimReference: z.string().trim().max(120).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });

type StoredClaim = {
  id: string;
  status: string;
  amount: number | string;
  recipient_id: string;
  category_id: string;
  fiscal_year_label: string;
  submitted_on: string | null;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ measureId: string; claimId: string }> }
) {
  const audit = createApiAuditLogger("measures.claims.decide", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid measure or claim id" }, { status: 400 });

    const body = await readJsonWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = patchClaimSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid claim update payload" }, { status: 400 });
    }

    const nextStatus = payload.data.status;
    const editsTheRequest =
      payload.data.amount !== undefined ||
      payload.data.retentionPercent !== undefined ||
      payload.data.retentionAmount !== undefined ||
      payload.data.description !== undefined ||
      payload.data.claimReference !== undefined;

    // WHICH GATE. Anything that commits the fund needs the money gate; the
    // claimant-side moves and draft edits stay on the ordinary content gate.
    // Decided BEFORE the row is read, so the choice is a property of the
    // REQUEST rather than something a later branch can forget.
    const needsMoneyGate = Boolean(
      nextStatus && !(MEMBER_SETTABLE_STATUSES as readonly string[]).includes(nextStatus)
    );

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId, {
      action: needsMoneyGate ? "invoices.write" : "programs.write",
      intent: nextStatus ? `Setting this claim to ${formatMeasureClaimStatusLabel(nextStatus)}` : undefined,
    });
    if (!authorization.ok) return authorization.response;

    const existingResult = await supabase
      .from("measure_claims")
      .select(MEASURE_CLAIM_COLUMNS)
      .eq("id", parsedParams.data.claimId)
      .eq("measure_fund_id", authorization.fund.id)
      .maybeSingle();
    const readFailure = classifyRouteReadFailure("the claim", existingResult);
    if (readFailure) {
      audit.error("claim_lookup_failed", { message: readFailure.message });
      return NextResponse.json(readFailure.body, { status: readFailure.status });
    }
    const existing = existingResult.data as StoredClaim | null;
    if (!existing) return NextResponse.json({ error: "Claim not found" }, { status: 404 });

    const updates: Record<string, unknown> = {};

    /* EDITING THE REQUEST ITSELF ------------------------------------- */
    if (editsTheRequest) {
      if (existing.status !== "draft") {
        return NextResponse.json(
          {
            error: "A submitted claim's amount cannot be edited",
            details:
              `This claim is ${formatMeasureClaimStatusLabel(existing.status)}. What a public body asked ` +
              "for is part of the record. Deny it with a reason and have a corrected claim filed, or " +
              "have the recipient withdraw it.",
          },
          { status: 409 }
        );
      }
      if (payload.data.amount !== undefined) updates.amount = payload.data.amount;
      if (payload.data.retentionPercent !== undefined) updates.retention_percent = payload.data.retentionPercent;
      if (payload.data.retentionAmount !== undefined) updates.retention_amount = payload.data.retentionAmount;
      if (payload.data.description !== undefined) updates.description = payload.data.description?.trim() || null;
      if (payload.data.claimReference !== undefined) {
        updates.claim_reference = payload.data.claimReference?.trim() || null;
      }
    }

    /* THE TRANSITION -------------------------------------------------- */
    if (nextStatus) {
      if (!isAllowedMeasureClaimTransition(existing.status, nextStatus)) {
        const allowed = MEASURE_CLAIM_TRANSITIONS[existing.status as MeasureClaimStatus] ?? [];
        audit.warn("illegal_transition", { from: existing.status, to: nextStatus, claimId: existing.id });
        return NextResponse.json(
          {
            error: `A ${formatMeasureClaimStatusLabel(existing.status)} claim cannot become ${formatMeasureClaimStatusLabel(nextStatus)}`,
            details:
              allowed.length === 0
                ? `${formatMeasureClaimStatusLabel(existing.status)} is final. Reversing it is a new record — ` +
                  "a refund, or a fresh claim — not an edit of this one."
                : `From here it can become: ${allowed.map(formatMeasureClaimStatusLabel).join(", ")}.`,
            allowedNextStatuses: allowed,
          },
          { status: 409 }
        );
      }

      if (nextStatus === "denied" && !payload.data.denialReason?.trim()) {
        return NextResponse.json(
          {
            error: "Say why this claim is being denied",
            details:
              "The claimant is a separate public body with its own council to answer to. A refusal with no " +
              "reason cannot be appealed or corrected.",
          },
          { status: 400 }
        );
      }

      if (nextStatus === "paid" && !payload.data.paidOn) {
        return NextResponse.json(
          {
            error: "Record the date this claim was paid",
            details:
              "Money leaving a public fund is dated. Without the date, no year-scoped view of this fund can " +
              "count the payment, and the oversight record cannot say when it happened.",
          },
          { status: 400 }
        );
      }

      updates.status = nextStatus;

      // A claim leaving draft still has a submission date: the day it left.
      // Better than a null the CHECK would refuse with a constraint name nobody
      // can act on. No `nextStatus !== "draft"` guard, because the schema does
      // not accept `draft` as a target — a claim is never un-submitted.
      if (!existing.submitted_on) {
        updates.submitted_on = new Date().toISOString().slice(0, 10);
      }

      if (measureClaimStatusRequiresDecider(nextStatus)) {
        // FROM THE SESSION, NEVER FROM THE BODY. A decision author a caller
        // could name is not an author.
        updates.decided_by = authorization.userId;
        updates.decided_at = new Date().toISOString();
      }

      if (nextStatus === "denied") updates.denial_reason = payload.data.denialReason?.trim();
      if (nextStatus === "paid") {
        updates.paid_on = payload.data.paidOn;
        updates.payment_reference = payload.data.paymentReference?.trim() || null;
      }
    }

    if (payload.data.decisionNote !== undefined) {
      updates.decision_note = payload.data.decisionNote.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("measure_claims")
      .update(updates)
      .eq("id", existing.id)
      .select(MEASURE_CLAIM_COLUMNS)
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("update_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to update the claim" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.error("update_matched_no_rows", { claimId: existing.id });
      return noRowsMatchedResponse({ subject: "claim", targetWasVerified: true });
    }

    // The audit line for a decision. Deliberately carries the amount and both
    // states: this is the record an operator reads in host logs when an
    // oversight committee asks who approved a payment and when.
    audit.info(nextStatus ? "decided" : "updated", {
      measureId: parsedParams.data.measureId,
      claimId: existing.id,
      recipientId: existing.recipient_id,
      categoryId: existing.category_id,
      fiscalYearLabel: existing.fiscal_year_label,
      fromStatus: existing.status,
      toStatus: nextStatus ?? existing.status,
      amount: existing.amount,
      decidedBy: measureClaimStatusRequiresDecider(nextStatus ?? "") ? authorization.userId : null,
      role: authorization.role,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ claim: data });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update the claim" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ measureId: string; claimId: string }> }
) {
  const audit = createApiAuditLogger("measures.claims.delete", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid measure or claim id" }, { status: 400 });

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    const existingResult = await supabase
      .from("measure_claims")
      .select(MEASURE_CLAIM_COLUMNS)
      .eq("id", parsedParams.data.claimId)
      .eq("measure_fund_id", authorization.fund.id)
      .maybeSingle();
    const readFailure = classifyRouteReadFailure("the claim", existingResult);
    if (readFailure) {
      audit.error("claim_lookup_failed", { message: readFailure.message });
      return NextResponse.json(readFailure.body, { status: readFailure.status });
    }
    const existing = existingResult.data as StoredClaim | null;
    if (!existing) return NextResponse.json({ error: "Claim not found" }, { status: 404 });

    // Said here in words, and enforced by the DELETE policy regardless. If this
    // branch were ever deleted the database would still refuse, and the route
    // would answer the disclosed 500 from `noRowsMatchedResponse` — loudly
    // wrong rather than quietly destructive.
    if (existing.status !== "draft") {
      return NextResponse.json(
        {
          error: "A submitted claim cannot be deleted",
          details:
            `This claim is ${formatMeasureClaimStatusLabel(existing.status)}. Withdraw or deny it instead — ` +
            "both leave the claim and its reason on the record, which is what an oversight committee reads.",
        },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from("measure_claims")
      .delete()
      .eq("id", existing.id)
      .select("id")
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("delete_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to delete the draft claim" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.error("delete_matched_no_rows", { claimId: existing.id });
      return noRowsMatchedResponse({ subject: "claim", targetWasVerified: true });
    }

    audit.info("deleted", { measureId: parsedParams.data.measureId, claimId: existing.id });
    return NextResponse.json({ ok: true, claimId: existing.id });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to delete the draft claim" }, { status: 500 });
  }
}
