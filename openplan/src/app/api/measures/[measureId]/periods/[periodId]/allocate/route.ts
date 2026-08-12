/**
 * Applying the ordinance to one period's RECORDED receipt.
 *
 * ============================================================================
 * THIS ROUTE COMPUTES NOTHING ITSELF
 * ============================================================================
 *
 * Every figure it writes comes out of `allocateMeasureReceipt`
 * (`src/lib/measures/allocation.ts`), which is pure, exact-integer, and pinned
 * cent-for-cent by hand-derived fixtures in
 * `measure-allocation-arithmetic.test.ts`. This route reads rows, calls that
 * function, and stores what it returns. There is no arithmetic here to get
 * wrong, and that is the point: money arithmetic is this repository's named
 * hollow-code category, so it lives in one measured place.
 *
 * ============================================================================
 * TWO MODES, NEVER MIXED WITHIN A PERIOD
 * ============================================================================
 *
 *   descriptor — the rule version in force at the period's START governs, and
 *                the allocator produces every row. `computation_basis` is
 *                'descriptor' and each row records which rule version made it.
 *   manual     — the ordinance is recorded as narrative text because its split
 *                cannot be expressed as a rule, so a person enters the figures
 *                and each row carries a required rationale.
 *
 * A period is replaced wholesale rather than merged: the previous rows for the
 * period are deleted and the new set written, so a partial recompute can never
 * leave one category's figure from an old rule beside another's from a new one.
 *
 * IN ONE TRANSACTION, through `replace_measure_period_allocation`
 * (20260812000014). supabase-js has none, so the delete and the insert used to
 * be two requests and two transactions: any failure of the second left the
 * period with nothing at all. Two triggers were reachable from the product — a
 * negative category share from half-up rounding over a pool of a few cents, and
 * two manual entries colliding on `ux_measure_allocations_pooled` — and both
 * emptied the period rather than being refused. The allocator no longer
 * produces the first; the database function is what makes the second, and
 * anything else the constraints refuse, a refusal instead of a deletion.
 *
 * WHAT THE PERIOD'S OFF-THE-TOP TAKE IS DOING HERE. It is written in the same
 * transaction, into `measure_period_off_the_top`, because an annual cap can
 * only be evaluated against what the fund has already taken this year and
 * nothing recorded that. It is not a category row: an off-the-top comes out of
 * the receipt BEFORE the ordinance's categories, belongs to none of them, and a
 * reserved `category_id` would put a made-up heading into the ordinance's own
 * list on the public page.
 *
 * ============================================================================
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS THE DESIGN
 * ============================================================================
 *
 *   * NO RECORDED RECEIPT — refused, not allocated as zeros. A period nobody
 *     has reported is not a period that received nothing, and an allocation of
 *     $0.00 across every category is a sentence about an agency's money that
 *     the database does not support.
 *   * NO RULE IN FORCE at the period start — refused. Applying the oldest
 *     available split would attribute money under terms nobody had adopted yet.
 *   * A NARRATIVE RULE in descriptor mode — refused with the hand path named.
 *   * A FISCAL YEAR WHOSE PERIODS OR RECORDED TAKES COULD NOT BE READ — refused,
 *     not allocated with the cap ignored. Both reads feed the annual cap and a
 *     short answer from either understates what has already been taken, in the
 *     direction that lets the agency take more than the ordinance allows.
 *
 * The allocator's own notes (a category held undistributed because a recipient
 * has no basis figure, a pool too small to give every category a share) are
 * returned to the caller verbatim. They are caveats, not errors, and a surface
 * that could not see them would print the split as clean.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { isWriteFailure } from "@/lib/http/write-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import {
  allocateMeasureReceipt,
  isNarrativeRule,
  parseMeasureAllocationRule,
  type MeasureAllocationRule,
} from "@/lib/measures/allocation";
import {
  MEASURE_ALLOCATION_RULE_COLUMNS,
  MEASURE_FUND_PERIOD_COLUMNS,
  MEASURE_OFF_THE_TOP_COLUMNS,
  MEASURE_RECIPIENT_BASIS_VALUE_COLUMNS,
  MEASURE_RECIPIENT_COLUMNS,
  resolveAllocationRuleInForce,
} from "@/lib/measures/fund";
import {
  buildMeasureCapWindow,
  toMeasureFundPeriodRead,
  toMeasureOffTheTopTakeRead,
} from "@/lib/measures/receipts";
import { authorizeMeasureWrite } from "@/lib/measures/write-authorization";

const paramsSchema = z.object({ measureId: z.string().uuid(), periodId: z.string().uuid() });

const manualAllocationSchema = z.object({
  categoryId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "a category id must be lower-case letters, digits, hyphen or underscore"),
  recipientId: z.string().uuid().nullish(),
  amount: z.coerce.number().min(0),
  // Required by the database for a manual figure, and required here so the
  // 400 names the field rather than the constraint.
  rationale: z.string().trim().min(1).max(2000),
});

const allocateSchema = z.union([
  z.object({
    mode: z.literal("descriptor"),
    /** Which vintage of the apportionment figures the ordinance says governs. */
    basisVintageLabel: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    mode: z.literal("manual"),
    allocations: z.array(manualAllocationSchema).min(1).max(500),
  }),
]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ measureId: string; periodId: string }> }
) {
  const audit = createApiAuditLogger("measures.periods.allocate", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid measure or period id" }, { status: 400 });
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = allocateSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid allocation payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    const periodResult = await supabase
      .from("measure_fund_periods")
      .select(MEASURE_FUND_PERIOD_COLUMNS)
      .eq("id", parsedParams.data.periodId)
      .eq("measure_fund_id", authorization.fund.id)
      .maybeSingle();

    const periodFailure = classifyRouteReadFailure("the period", periodResult);
    if (periodFailure) {
      audit.error("period_lookup_failed", { message: periodFailure.message });
      return NextResponse.json(periodFailure.body, { status: periodFailure.status });
    }
    const period = periodResult.data as
      | {
          id: string;
          period_start: string;
          fiscal_year_label: string;
          received_amount: number | string | null;
        }
      | null;
    if (!period) {
      return NextResponse.json({ error: "Period not found" }, { status: 404 });
    }

    let rows: Array<Record<string, unknown>>;
    /**
     * The period's off-the-top take, written beside the category rows.
     *
     * EMPTY IN MANUAL MODE, and that is not an omission. A manual allocation is
     * a person stating what each category received under an ordinance the
     * descriptor cannot express; there is no clause list to attribute a take to,
     * and inventing one would put a figure nobody entered under a heading
     * nobody wrote. The replacement still CLEARS any take the period had, so a
     * period recomputed by hand does not keep a stale computed one.
     */
    let offTheTopRows: Array<Record<string, unknown>> = [];
    let allocationSummary: unknown = null;

    if (payload.data.mode === "manual") {
      // Every recipient named must belong to this measure. Without the check a
      // manual allocation could name a recipient of another fund in the same
      // workspace, and the composite foreign key would accept it.
      const recipientIds = [
        ...new Set(payload.data.allocations.map((entry) => entry.recipientId).filter((id): id is string => Boolean(id))),
      ];
      if (recipientIds.length > 0) {
        const recipientsResult = await supabase
          .from("measure_recipients")
          .select(MEASURE_RECIPIENT_COLUMNS)
          .eq("measure_fund_id", authorization.fund.id);
        const recipientFailure = classifyRouteReadFailure("the recipients", recipientsResult);
        if (recipientFailure) {
          audit.error("recipient_lookup_failed", { message: recipientFailure.message });
          return NextResponse.json(recipientFailure.body, { status: recipientFailure.status });
        }
        const known = new Set(((recipientsResult.data as Array<{ id: string }> | null) ?? []).map((row) => row.id));
        const unknown = recipientIds.filter((id) => !known.has(id));
        if (unknown.length > 0) {
          return NextResponse.json(
            { error: "One or more recipients are not part of this measure", unknownRecipientIds: unknown },
            { status: 400 }
          );
        }
      }

      rows = payload.data.allocations.map((entry) => ({
        workspace_id: authorization.workspaceId,
        measure_fund_id: authorization.fund.id,
        period_id: period.id,
        category_id: entry.categoryId,
        recipient_id: entry.recipientId ?? null,
        allocation_rule_id: null,
        amount: entry.amount,
        computation_basis: "manual",
        rationale: entry.rationale,
        stated_by: authorization.userId,
        stated_on: new Date().toISOString().slice(0, 10),
      }));
    } else {
      const rulesResult = await supabase
        .from("measure_allocation_rules")
        .select(MEASURE_ALLOCATION_RULE_COLUMNS)
        .eq("measure_fund_id", authorization.fund.id);
      const ruleFailure = classifyRouteReadFailure("the allocation rules", rulesResult);
      if (ruleFailure) {
        audit.error("rule_lookup_failed", { message: ruleFailure.message });
        return NextResponse.json(ruleFailure.body, { status: ruleFailure.status });
      }

      const ruleRows = ((rulesResult.data as Array<{ id: string; rule: unknown; effective_from: string }> | null) ?? []);
      const inForce = resolveAllocationRuleInForce(ruleRows, period.period_start);
      if (!inForce) {
        return NextResponse.json(
          {
            error: "No allocation rule was in force at the start of this period",
            details:
              `This measure has no recorded reading of its ordinance effective on or before ` +
              `${period.period_start}. Record the rule version that governed then — applying a later one ` +
              "would attribute this money under terms nobody had adopted yet.",
          },
          { status: 409 }
        );
      }

      let rule: MeasureAllocationRule;
      try {
        rule = parseMeasureAllocationRule(inForce.rule);
      } catch (error) {
        // A stored rule that no longer parses is a data problem the operator
        // must see, not a 500 that says the product is broken.
        const message = error instanceof Error ? error.message : "The stored allocation rule could not be read.";
        audit.error("stored_rule_unreadable", { ruleId: inForce.id, message });
        return NextResponse.json({ error: `The recorded allocation rule could not be read: ${message}` }, { status: 409 });
      }

      if (isNarrativeRule(rule)) {
        return NextResponse.json(
          {
            error: "This ordinance is recorded as narrative text",
            details:
              "Its split cannot be expressed as a rule, so its allocations are entered by hand and are " +
              "labelled staff-entered wherever they appear. Use the manual entry form for this period.",
          },
          { status: 409 }
        );
      }

      const recipientsResult = await supabase
        .from("measure_recipients")
        .select(MEASURE_RECIPIENT_COLUMNS)
        .eq("measure_fund_id", authorization.fund.id);
      const recipientFailure = classifyRouteReadFailure("the recipients", recipientsResult);
      if (recipientFailure) {
        audit.error("recipient_lookup_failed", { message: recipientFailure.message });
        return NextResponse.json(recipientFailure.body, { status: recipientFailure.status });
      }
      const recipients = ((recipientsResult.data as Array<{ id: string; is_active: boolean }> | null) ?? []);

      const basisResult = recipients.length
        ? await supabase
            .from("measure_recipient_basis_values")
            .select(MEASURE_RECIPIENT_BASIS_VALUE_COLUMNS)
            .in("recipient_id", recipients.map((recipient) => recipient.id))
        : { data: [], error: null };
      const basisFailure = classifyRouteReadFailure("the apportionment figures", basisResult);
      if (basisFailure) {
        audit.error("basis_lookup_failed", { message: basisFailure.message });
        return NextResponse.json(basisFailure.body, { status: basisFailure.status });
      }

      // ---- THE FISCAL-YEAR WINDOW AN ANNUAL OFF-THE-TOP CAP IS EVALUATED OVER
      //
      // Two reads, both load-bearing. The year's periods say WHICH periods
      // count; the recorded takes say what has ALREADY BEEN TAKEN under each
      // clause. A cap evaluated with either one short understates prior-taken,
      // and understating prior-taken is what let four quarters each take the
      // whole annual cap.
      const yearPeriodsResult = await supabase
        .from("measure_fund_periods")
        .select(MEASURE_FUND_PERIOD_COLUMNS)
        .eq("measure_fund_id", authorization.fund.id)
        .eq("fiscal_year_label", period.fiscal_year_label);
      const yearPeriodIds = ((yearPeriodsResult.data as Array<{ id: string }> | null) ?? []).map((row) => row.id);

      // Scoped by BOTH the fund and the year's period ids. `measure_fund_id`
      // alone would sum every year's takes into this year's cap; the period
      // ids alone would trust an id list this route did not itself scope.
      const takesResult = yearPeriodIds.length
        ? await supabase
            .from("measure_period_off_the_top")
            .select(MEASURE_OFF_THE_TOP_COLUMNS)
            .eq("measure_fund_id", authorization.fund.id)
            .in("period_id", yearPeriodIds)
        : { data: [], error: null };

      const capWindow = buildMeasureCapWindow({
        periodRead: toMeasureFundPeriodRead(
          yearPeriodsResult as unknown as Parameters<typeof toMeasureFundPeriodRead>[0]
        ),
        fiscalYearLabel: period.fiscal_year_label,
        takeRead: toMeasureOffTheTopTakeRead(
          takesResult as unknown as Parameters<typeof toMeasureOffTheTopTakeRead>[0]
        ),
        // This period's own take is about to be replaced. Counting it would cap
        // the period against itself, so every recompute would take less than
        // the one before it.
        excludePeriodId: period.id,
      });
      if (!capWindow.ok) {
        audit.error("cap_window_read_failed", { message: capWindow.message });
        return NextResponse.json(
          {
            error: "Could not read this fiscal year's periods and what has already been taken from them",
            hint: "This is a read failure, not an empty result. The ordinance's annual cap cannot be applied without it, so nothing was allocated.",
          },
          { status: capWindow.pending ? 503 : 500 }
        );
      }

      const outcome = allocateMeasureReceipt({
        rule,
        receiptAmount: period.received_amount,
        recipients,
        basisValues: (basisResult.data as Array<{
          recipient_id: string;
          basis_id: string;
          vintage_label: string;
          basis_value: number | string;
        }> | null) ?? [],
        basisVintageLabel: payload.data.basisVintageLabel,
        capWindow: capWindow.window,
      });

      if (!outcome.ok) {
        audit.warn("allocation_refused", { reason: outcome.reason, periodId: period.id });
        return NextResponse.json({ error: outcome.message, reason: outcome.reason }, { status: 409 });
      }

      allocationSummary = outcome.allocation;
      const statedOn = new Date().toISOString().slice(0, 10);

      // What the receipt gave up before the categories were cut. One row per
      // ordinance clause, carrying what the clause called for as well as what
      // was taken, so a later reader can say whether a cap bit without
      // recomputing an old rule version against an old receipt.
      offTheTopRows = outcome.allocation.offTheTop.map((line) => ({
        workspace_id: authorization.workspaceId,
        measure_fund_id: authorization.fund.id,
        period_id: period.id,
        off_the_top_id: line.id,
        label: line.label,
        amount: line.amount,
        uncapped_amount: line.uncappedAmount,
        cap_amount: line.capAmount,
        cap_basis: line.capBasis,
        cap_status: line.capStatus,
        allocation_rule_id: inForce.id,
        stated_by: authorization.userId,
        stated_on: statedOn,
      }));

      rows = [];
      for (const category of outcome.allocation.categories) {
        if (category.distribution.kind === "return_to_source") {
          for (const share of category.distribution.shares) {
            rows.push({
              workspace_id: authorization.workspaceId,
              measure_fund_id: authorization.fund.id,
              period_id: period.id,
              category_id: category.id,
              recipient_id: share.recipientId,
              allocation_rule_id: inForce.id,
              amount: share.amount,
              computation_basis: "descriptor",
              rationale: null,
              stated_by: authorization.userId,
              stated_on: statedOn,
            });
          }
          continue;
        }

        // Pooled, or held undistributed because a recipient has no basis
        // figure. Both are ONE row with no recipient: undistributed money is
        // allocated to the category and NOT split among the recipients that do
        // have figures, because dropping a term from the denominator inflates
        // every other share in the direction that overpays.
        rows.push({
          workspace_id: authorization.workspaceId,
          measure_fund_id: authorization.fund.id,
          period_id: period.id,
          category_id: category.id,
          recipient_id: null,
          allocation_rule_id: inForce.id,
          amount: category.programmableAmount,
          computation_basis: "descriptor",
          rationale: null,
          stated_by: authorization.userId,
          stated_on: statedOn,
        });
      }
    }

    /*
     * REPLACE WHOLESALE, IN ONE TRANSACTION.
     *
     * A merge could leave one category's figure from the old rule beside
     * another's from the new one, and nothing on the page would say the period
     * was computed under two ordinances. A DELETE and an INSERT through two
     * supabase-js calls are two transactions, and any failure of the second
     * left the period with NOTHING — which is worse than either, because the
     * money simply disappears from the fund page with no line saying it was
     * ever there.
     *
     * `replace_measure_period_allocation` (20260812000014) is SECURITY INVOKER,
     * so the caller's own row policies still decide what may be deleted and
     * inserted; `authorizeMeasureWrite` above is the first gate and RLS is the
     * one that holds if the first is ever wrong. The function additionally
     * refuses any row that does not name this period and this fund.
     *
     * The replaced counts come back for the reason the delete's `.select("id")`
     * used to exist: a recompute that replaced 12 lines and one that replaced 0
     * are different events, and only the first corrected something a person saw.
     */
    const { data: replacement, error } = await supabase.rpc("replace_measure_period_allocation", {
      p_measure_fund_id: authorization.fund.id,
      p_period_id: period.id,
      p_allocations: rows,
      p_off_the_top: offTheTopRows,
    });

    if (error && isWriteFailure(error)) {
      audit.error("replace_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json(
        {
          error: "Failed to record the allocation",
          // The one thing worth telling the caller, because it is the fact the
          // old two-statement path could not offer: nothing was lost.
          details: "This period's previous allocation was left exactly as it was; nothing was replaced.",
        },
        { status: 500 }
      );
    }

    const result = (replacement ?? {}) as {
      replaced_allocation_count?: number | null;
      replaced_off_the_top_count?: number | null;
      allocations?: unknown[] | null;
    };
    const replacedRowCount = typeof result.replaced_allocation_count === "number" ? result.replaced_allocation_count : null;

    audit.info("allocated", {
      measureId: parsedParams.data.measureId,
      periodId: period.id,
      mode: payload.data.mode,
      rowCount: rows.length,
      offTheTopRowCount: offTheTopRows.length,
      replacedRowCount,
      replacedOffTheTopRowCount:
        typeof result.replaced_off_the_top_count === "number" ? result.replaced_off_the_top_count : null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { allocations: result.allocations ?? [], allocation: allocationSummary, replacedRowCount },
      { status: 201 }
    );
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to record the allocation" }, { status: 500 });
  }
}
