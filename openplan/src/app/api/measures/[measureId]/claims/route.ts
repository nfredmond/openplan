/**
 * Filing a claim against a measure fund.
 *
 * ============================================================================
 * ELIGIBILITY IS THE MEASURE'S OWN ANSWER
 * ============================================================================
 *
 * There is no category list in this file, in `claims.ts`, or anywhere else in
 * the repository. The categories come from the allocation rule version IN FORCE
 * AT THE CLAIM'S OWN PERIOD — not the newest rule, because an ordinance amended
 * in July does not retroactively change what June's money could be spent on.
 *
 * When the measure's rule is narrative text (an ordinance the descriptor's
 * closed vocabulary cannot express), the categories are the distinct ones a
 * person has already entered by hand into `measure_allocations`. That keeps an
 * unusual ordinance usable rather than blocked, and it is still the measure's
 * own answer rather than this route's.
 *
 * A refusal names what the measure DOES declare. "Invalid category" and nothing
 * else sends a clerk to read an ordinance PDF and guess at a spelling.
 *
 * ============================================================================
 * WHAT THIS ROUTE MAY NOT DO
 * ============================================================================
 *
 * It cannot approve, deny or pay. `status` accepts only `draft` or `submitted`
 * — filing is the claimant's act; deciding is the agency's, needs an owner or
 * admin, and lives in `claims/[claimId]/route.ts` where the decision author is
 * recorded. A create endpoint that accepted `status: "paid"` would be a way to
 * pay a claim with no decision on the record, which is exactly the shape the
 * agent refusal for this lane is written against.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { insertNotReadableBackResponse, isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { parseMeasureAllocationRule, type MeasureAllocationRule } from "@/lib/measures/allocation";
import {
  checkMeasureClaimEligibility,
  resolveMeasureClaimCategories,
  MEASURE_CLAIM_COLUMNS,
} from "@/lib/measures/claims";
import {
  MEASURE_ALLOCATION_COLUMNS,
  MEASURE_ALLOCATION_RULE_COLUMNS,
  MEASURE_FUND_PERIOD_COLUMNS,
  MEASURE_RECIPIENT_COLUMNS,
  resolveAllocationRuleInForce,
} from "@/lib/measures/fund";
import { authorizeMeasureWrite } from "@/lib/measures/write-authorization";

const POSTGRES_UNIQUE_VIOLATION = "23505";

const paramsSchema = z.object({ measureId: z.string().uuid() });

const createClaimSchema = z.object({
  recipientId: z.string().uuid(),
  periodId: z.string().uuid(),
  // No enum: the vocabulary belongs to the measure's own ordinance, and a list
  // here would be a second, wrong one.
  categoryId: z.string().trim().min(1).max(64),
  claimReference: z.string().trim().max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  amount: z.coerce.number().min(0),
  retentionPercent: z.coerce.number().min(0).max(100).optional(),
  retentionAmount: z.coerce.number().min(0).optional(),
  /** Filing only. Deciding is a different route with a stricter gate. */
  status: z.enum(["draft", "submitted"]).optional(),
  submittedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ measureId: string }> }) {
  const audit = createApiAuditLogger("measures.claims.create", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid measure id" }, { status: 400 });

    const body = await readJsonWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = createClaimSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid claim payload" }, { status: 400 });
    }

    const status = payload.data.status ?? "draft";
    const submittedOn = status === "draft" ? null : payload.data.submittedOn ?? new Date().toISOString().slice(0, 10);

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    /* THE PERIOD — it carries the date the rule version is resolved from, and
       the fiscal year the claim is bucketed under. */
    const periodResult = await supabase
      .from("measure_fund_periods")
      .select(MEASURE_FUND_PERIOD_COLUMNS)
      .eq("id", payload.data.periodId)
      .eq("measure_fund_id", authorization.fund.id)
      .maybeSingle();
    const periodFailure = classifyRouteReadFailure("the period", periodResult);
    if (periodFailure) {
      audit.error("period_lookup_failed", { message: periodFailure.message });
      return NextResponse.json(periodFailure.body, { status: periodFailure.status });
    }
    const period = periodResult.data as { id: string; period_start: string; fiscal_year_label: string } | null;
    if (!period) return NextResponse.json({ error: "Period not found" }, { status: 404 });

    /* THE RECIPIENT — and whether it is still allowed to file. */
    const recipientResult = await supabase
      .from("measure_recipients")
      .select(MEASURE_RECIPIENT_COLUMNS)
      .eq("id", payload.data.recipientId)
      .eq("measure_fund_id", authorization.fund.id)
      .maybeSingle();
    const recipientFailure = classifyRouteReadFailure("the recipient", recipientResult);
    if (recipientFailure) {
      audit.error("recipient_lookup_failed", { message: recipientFailure.message });
      return NextResponse.json(recipientFailure.body, { status: recipientFailure.status });
    }
    const recipient = recipientResult.data as { id: string; name: string; is_active: boolean } | null;
    if (!recipient) return NextResponse.json({ error: "Recipient not found" }, { status: 404 });

    /* WHAT THE MEASURE SAYS ITS MONEY IS FOR. */
    const rulesResult = await supabase
      .from("measure_allocation_rules")
      .select(MEASURE_ALLOCATION_RULE_COLUMNS)
      .eq("measure_fund_id", authorization.fund.id);
    const ruleFailure = classifyRouteReadFailure("the allocation rules", rulesResult);
    if (ruleFailure) {
      audit.error("rule_lookup_failed", { message: ruleFailure.message });
      return NextResponse.json(ruleFailure.body, { status: ruleFailure.status });
    }
    const inForce = resolveAllocationRuleInForce(
      ((rulesResult.data as Array<{ id: string; rule: unknown; effective_from: string }> | null) ?? []),
      period.period_start
    );

    let rule: MeasureAllocationRule | null = null;
    if (inForce) {
      try {
        rule = parseMeasureAllocationRule(inForce.rule);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unreadable";
        audit.error("stored_rule_unreadable", { ruleId: inForce.id, message });
        return NextResponse.json(
          { error: `The allocation rule in force for this period could not be read: ${message}` },
          { status: 409 }
        );
      }
    }

    // The hand-entered fallback: a narrative ordinance's categories are the
    // ones somebody has actually allocated to. Read only when needed, so the
    // ordinary path costs one query fewer.
    let recordedAllocationCategoryIds: string[] = [];
    if (!rule || ("kind" in rule && rule.kind === "narrative")) {
      const allocationsResult = await supabase
        .from("measure_allocations")
        .select(MEASURE_ALLOCATION_COLUMNS)
        .eq("measure_fund_id", authorization.fund.id);
      const allocationFailure = classifyRouteReadFailure("the recorded allocations", allocationsResult);
      if (allocationFailure) {
        audit.error("allocation_lookup_failed", { message: allocationFailure.message });
        return NextResponse.json(allocationFailure.body, { status: allocationFailure.status });
      }
      recordedAllocationCategoryIds = ((allocationsResult.data as Array<{ category_id: string }> | null) ?? []).map(
        (row) => row.category_id
      );
    }

    const categories = resolveMeasureClaimCategories({ rule, recordedAllocationCategoryIds });
    if (!categories.ok) {
      audit.warn("no_categories_recorded", { measureId: parsedParams.data.measureId });
      return NextResponse.json({ error: categories.message, reason: categories.reason }, { status: 409 });
    }

    const eligibility = checkMeasureClaimEligibility({
      categories: categories.categories,
      categoryId: payload.data.categoryId,
      recipient,
    });
    if (!eligibility.ok) {
      audit.warn("claim_ineligible", {
        measureId: parsedParams.data.measureId,
        reason: eligibility.reason,
        categoryId: payload.data.categoryId,
      });
      return NextResponse.json(
        {
          error: eligibility.message,
          reason: eligibility.reason,
          declaredCategoryIds: eligibility.declaredCategoryIds,
          categorySource: categories.source,
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("measure_claims")
      .insert({
        workspace_id: authorization.workspaceId,
        measure_fund_id: authorization.fund.id,
        recipient_id: recipient.id,
        period_id: period.id,
        // Denormalized from the PERIOD, never from the body: a claim that named
        // its own fiscal year could be bucketed against a year its period does
        // not belong to, and every annual total would quietly disagree with the
        // receipt ledger.
        fiscal_year_label: period.fiscal_year_label,
        category_id: eligibility.category.id,
        claim_reference: payload.data.claimReference?.trim() || null,
        description: payload.data.description?.trim() || null,
        amount: payload.data.amount,
        retention_percent: payload.data.retentionPercent ?? 0,
        retention_amount: payload.data.retentionAmount ?? 0,
        status,
        submitted_on: submittedOn,
        created_by: authorization.userId,
      })
      .select(MEASURE_CLAIM_COLUMNS)
      .single();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return NextResponse.json(
          {
            error: "This recipient already has a claim with that reference number",
            details: "Two claims sharing a reference could both be paid against one request.",
          },
          { status: 409 }
        );
      }
      audit.error("insert_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to file the claim" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.warn("insert_not_readable_back", { measureId: parsedParams.data.measureId });
      return insertNotReadableBackResponse({ subject: "claim" });
    }

    audit.info("created", {
      measureId: parsedParams.data.measureId,
      claimId: (data as { id?: string } | null)?.id ?? null,
      recipientId: recipient.id,
      categoryId: eligibility.category.id,
      categorySource: categories.source,
      status,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ claim: data, categorySource: categories.source }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to file the claim" }, { status: 500 });
  }
}
