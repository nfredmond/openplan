/**
 * The fund's accounting periods, and what a person reports the fund received.
 *
 * ============================================================================
 * THE THREE STATES ARE THIS ROUTE'S RESPONSIBILITY TOO
 * ============================================================================
 *
 *   no row                     -- the period was never opened
 *   received_amount IS NULL    -- opened, and nobody has reported a receipt
 *   received_amount = 0.00     -- a person recorded that nothing arrived
 *
 * So `receivedAmount` here is a THREE-VALUED field: absent from the body means
 * "leave it as it is", explicit `null` means "clear it back to unreported", and
 * a number means that number — including `0`. An emptied `<input type=number>`
 * sends `""`, which this route reads as `null` rather than as 0, because the two
 * are different sentences about an agency's money and the browser cannot tell
 * them apart for us.
 *
 * ============================================================================
 * OPENPLAN NEVER COMPUTES AN EXPECTED RECEIPT
 * ============================================================================
 *
 * There is no projection here and no cadence-derived period generation. A
 * sales-tax projection is an economic forecast over taxable-sales growth this
 * product has no input data for, and a projected figure on a fund page will be
 * programmed against. `forecastAmount` is the AGENCY'S OWN adopted forecast,
 * typed by a person, and `forecastBasisNote` is where it came from.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import {
  insertNotReadableBackResponse,
  isWriteFailure,
  noRowsMatchedResponse,
  writeMatchedNoRows,
} from "@/lib/http/write-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { MEASURE_FUND_PERIOD_COLUMNS } from "@/lib/measures/fund";
import { authorizeMeasureWrite } from "@/lib/measures/write-authorization";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_CHECK_VIOLATION = "23514";

const paramsSchema = z.object({ measureId: z.string().uuid() });
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

/**
 * `""` means NOT SET, never 0. See the header: a cleared money input and a
 * recorded zero are different facts, and only this coercion keeps them apart
 * once the browser has flattened both to a string.
 */
function coerceOptionalMoney(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
}

const optionalMoney = z.preprocess(coerceOptionalMoney, z.union([z.number().min(0), z.null()]));

const createPeriodSchema = z.object({
  periodLabel: z.string().trim().min(1).max(120),
  fiscalYearLabel: z.string().trim().min(1).max(120),
  periodStart: isoDate,
  periodEnd: isoDate,
  forecastAmount: optionalMoney.optional(),
  forecastBasisNote: z.string().trim().max(2000).optional(),
  receivedAmount: optionalMoney.optional(),
  receivedOn: isoDate.nullish(),
  receiptSourceNote: z.string().trim().max(2000).optional(),
});

const updatePeriodSchema = z
  .object({
    periodId: z.string().uuid(),
    periodLabel: z.string().trim().min(1).max(120).optional(),
    fiscalYearLabel: z.string().trim().min(1).max(120).optional(),
    periodStart: isoDate.optional(),
    periodEnd: isoDate.optional(),
    forecastAmount: optionalMoney.optional(),
    forecastBasisNote: z.string().trim().max(2000).nullish(),
    receivedAmount: optionalMoney.optional(),
    receivedOn: isoDate.nullish(),
    receiptSourceNote: z.string().trim().max(2000).nullish(),
  })
  .refine((value) => Object.keys(value).length > 1, { message: "At least one field must be updated" });

/** The CHECK the database enforces, restated so the message names the field. */
function describeReceiptProblem(receivedAmount: number | null, receivedOn: string | null): string | null {
  if (receivedOn && receivedAmount === null) {
    return (
      "A receipt date with no amount would let this page say money arrived on a day without saying how " +
      "much. Record the amount, or clear the date."
    );
  }
  return null;
}

export async function POST(request: NextRequest, context: { params: Promise<{ measureId: string }> }) {
  const audit = createApiAuditLogger("measures.periods.create", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid measure id" }, { status: 400 });
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = createPeriodSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid period payload" }, { status: 400 });
    }

    if (payload.data.periodEnd < payload.data.periodStart) {
      return NextResponse.json(
        { error: `A period must end on or after it starts, and this one runs ${payload.data.periodStart} to ${payload.data.periodEnd}.` },
        { status: 400 }
      );
    }

    const receivedAmount = payload.data.receivedAmount ?? null;
    const receivedOn = payload.data.receivedOn ?? null;
    const receiptProblem = describeReceiptProblem(receivedAmount, receivedOn);
    if (receiptProblem) return NextResponse.json({ error: receiptProblem }, { status: 400 });

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    const { data, error } = await supabase
      .from("measure_fund_periods")
      .insert({
        workspace_id: authorization.workspaceId,
        measure_fund_id: authorization.fund.id,
        period_label: payload.data.periodLabel,
        fiscal_year_label: payload.data.fiscalYearLabel,
        period_start: payload.data.periodStart,
        period_end: payload.data.periodEnd,
        forecast_amount: payload.data.forecastAmount ?? null,
        forecast_basis_note: payload.data.forecastBasisNote?.trim() || null,
        received_amount: receivedAmount,
        received_on: receivedOn,
        receipt_source_note: payload.data.receiptSourceNote?.trim() || null,
        // Only stamped when there is something to have recorded. A recorder on
        // a period with no receipt would name someone for an act nobody did.
        recorded_by: receivedAmount === null ? null : authorization.userId,
        recorded_at: receivedAmount === null ? null : new Date().toISOString(),
      })
      .select(MEASURE_FUND_PERIOD_COLUMNS)
      .single();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return NextResponse.json(
          {
            error: "This measure already has a period with that name or start date",
            details: "Open the existing period and record the receipt against it rather than opening a second one.",
          },
          { status: 409 }
        );
      }
      audit.error("insert_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to open the period" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.warn("insert_not_readable_back", { measureId: parsedParams.data.measureId });
      return insertNotReadableBackResponse({ subject: "period" });
    }

    audit.info("created", {
      measureId: parsedParams.data.measureId,
      periodId: (data as { id?: string } | null)?.id ?? null,
      receiptRecorded: receivedAmount !== null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ period: data }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to open the period" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ measureId: string }> }) {
  const audit = createApiAuditLogger("measures.periods.update", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid measure id" }, { status: 400 });
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = updatePeriodSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid period update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    // Read the row first, scoped to the fund AND the workspace just proven, so
    // the merged rules below are checked against the period AS IT WILL BE.
    const existingResult = await supabase
      .from("measure_fund_periods")
      .select(MEASURE_FUND_PERIOD_COLUMNS)
      .eq("id", payload.data.periodId)
      .eq("measure_fund_id", authorization.fund.id)
      .maybeSingle();

    const readFailure = classifyRouteReadFailure("the period", existingResult);
    if (readFailure) {
      audit.error("period_lookup_failed", { message: readFailure.message });
      return NextResponse.json(readFailure.body, { status: readFailure.status });
    }
    const existing = existingResult.data as
      | { id: string; period_start: string; period_end: string; received_amount: number | string | null }
      | null;
    if (!existing) {
      return NextResponse.json({ error: "Period not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (payload.data.periodLabel !== undefined) updates.period_label = payload.data.periodLabel;
    if (payload.data.fiscalYearLabel !== undefined) updates.fiscal_year_label = payload.data.fiscalYearLabel;
    if (payload.data.periodStart !== undefined) updates.period_start = payload.data.periodStart;
    if (payload.data.periodEnd !== undefined) updates.period_end = payload.data.periodEnd;
    if (payload.data.forecastAmount !== undefined) updates.forecast_amount = payload.data.forecastAmount;
    if (payload.data.forecastBasisNote !== undefined) {
      updates.forecast_basis_note = payload.data.forecastBasisNote?.trim() || null;
    }
    if (payload.data.receiptSourceNote !== undefined) {
      updates.receipt_source_note = payload.data.receiptSourceNote?.trim() || null;
    }

    const receiptTouched = payload.data.receivedAmount !== undefined || payload.data.receivedOn !== undefined;
    const mergedReceivedAmount =
      payload.data.receivedAmount !== undefined
        ? payload.data.receivedAmount
        : existing.received_amount === null || existing.received_amount === undefined
          ? null
          : Number(existing.received_amount);
    const mergedReceivedOn = payload.data.receivedOn !== undefined ? payload.data.receivedOn ?? null : undefined;

    if (payload.data.receivedAmount !== undefined) {
      updates.received_amount = payload.data.receivedAmount;
      // Clearing the amount clears the date with it, or the CHECK would refuse
      // the write with a constraint name no planner can act on.
      if (payload.data.receivedAmount === null) updates.received_on = null;
    }
    if (payload.data.receivedOn !== undefined) updates.received_on = payload.data.receivedOn ?? null;

    if (receiptTouched) {
      const effectiveReceivedOn =
        mergedReceivedOn !== undefined
          ? mergedReceivedOn
          : payload.data.receivedAmount === null
            ? null
            : (updates.received_on as string | null | undefined) ?? null;
      const receiptProblem = describeReceiptProblem(
        mergedReceivedAmount,
        payload.data.receivedAmount === null ? null : effectiveReceivedOn
      );
      if (receiptProblem) return NextResponse.json({ error: receiptProblem }, { status: 400 });

      // Re-stamped on every receipt edit: the record names whoever last
      // reported the figure, not whoever first opened the period.
      updates.recorded_by = mergedReceivedAmount === null ? null : authorization.userId;
      updates.recorded_at = mergedReceivedAmount === null ? null : new Date().toISOString();
    }

    const mergedStart = (payload.data.periodStart ?? existing.period_start) as string;
    const mergedEnd = (payload.data.periodEnd ?? existing.period_end) as string;
    if (mergedEnd < mergedStart) {
      return NextResponse.json(
        { error: `A period must end on or after it starts, and this edit would make it run ${mergedStart} to ${mergedEnd}.` },
        { status: 400 }
      );
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("measure_fund_periods")
      .update(updates)
      .eq("id", existing.id)
      .select(MEASURE_FUND_PERIOD_COLUMNS)
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return NextResponse.json(
          { error: "Another period of this measure already uses that name or start date" },
          { status: 409 }
        );
      }
      if (error.code === POSTGRES_CHECK_VIOLATION) {
        return NextResponse.json(
          { error: "The database refused this period: check the dates and that a receipt date has an amount." },
          { status: 400 }
        );
      }
      audit.error("update_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to update the period" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.error("update_matched_no_rows", { periodId: existing.id });
      return noRowsMatchedResponse({ subject: "period", targetWasVerified: true });
    }

    audit.info("updated", {
      measureId: parsedParams.data.measureId,
      periodId: existing.id,
      receiptTouched,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ period: data });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update the period" }, { status: 500 });
  }
}
