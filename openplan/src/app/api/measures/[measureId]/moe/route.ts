/**
 * Maintenance of effort — two figures, recorded, and no verdict.
 *
 * Most self-help ordinances forbid a recipient from replacing its own local
 * spending with measure money. This route records what the ordinance requires
 * of one body in one year and what that body reported spending. It computes
 * nothing: `buildMeasureMoeSummary` derives the difference at read time, only
 * where BOTH figures are present, and answers `not_determined` otherwise.
 *
 * BOTH FIGURES ARE OPTIONAL ON EVERY WRITE, and that is the point. The required
 * figure comes from the ordinance and the reported figure from the recipient's
 * own audited accounts; they arrive months apart. A route that demanded both
 * would push someone into typing a placeholder, and a placeholder in a
 * maintenance-of-effort record is a compliance statement nobody made.
 *
 * WHICH MAKES "NOT SENT" AND "SENT AS NULL" TWO DIFFERENT INSTRUCTIONS, and
 * until 2026-08-12 this route collapsed them: `requiredAmount ?? null` wrote a
 * literal NULL for a field nobody mentioned, so the March write carrying the
 * reported figure erased the required figure entered in September — the exact
 * thing the months-apart design exists to allow. The rule is stated at the row
 * literal below and pinned by `measure-moe-upsert.test.ts`.
 *
 * There is no verdict column to write and no verdict field in this payload —
 * see the migration header on why a computed compliance judgement with nowhere
 * to store it is exactly the tier-guard blind spot already recorded against the
 * RTP fiscal verdict.
 *
 * `statedBy` and `statedOn` are re-stamped on every write, from the session and
 * the request date, so the record always names who LAST stated it rather than
 * whoever opened the row.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { insertNotReadableBackResponse, isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { MEASURE_MOE_COLUMNS } from "@/lib/measures/claims";
import { MEASURE_RECIPIENT_COLUMNS } from "@/lib/measures/fund";
import { authorizeMeasureWrite } from "@/lib/measures/write-authorization";

const paramsSchema = z.object({ measureId: z.string().uuid() });

/** `""` means NOT SET, never 0 — the same three-valued rule as a receipt. */
function coerceOptionalMoney(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
}

const optionalMoney = z.preprocess(coerceOptionalMoney, z.union([z.number().min(0), z.null()]));

const upsertMoeSchema = z.object({
  recipientId: z.string().uuid(),
  fiscalYearLabel: z.string().trim().min(1).max(120),
  requiredAmount: optionalMoney.optional(),
  reportedAmount: optionalMoney.optional(),
  basisNote: z.string().trim().min(1).max(2000),
  statedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: NextRequest, context: { params: Promise<{ measureId: string }> }) {
  const audit = createApiAuditLogger("measures.moe.upsert", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid measure id" }, { status: 400 });

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = upsertMoeSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid maintenance-of-effort payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

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
    const recipient = recipientResult.data as { id: string } | null;
    if (!recipient) return NextResponse.json({ error: "Recipient not found" }, { status: 404 });

    /*
     * ============================================================================
     * "NOT SENT" AND "SENT AS NULL" ARE DIFFERENT INSTRUCTIONS
     * ============================================================================
     *
     * This route existed to let the two figures arrive months apart, and it
     * destroyed the first one every time the second arrived: `requiredAmount ??
     * null` writes a literal NULL for a field the caller never mentioned, so
     * recording the reported figure in March erased the required figure entered
     * in September. A maintenance-of-effort record with the required side blank
     * reads as "the ordinance asks nothing of this city", on a page a citizens'
     * oversight committee reads.
     *
     * The repo's PATCH routes distinguish the two with `!== undefined` and a
     * partial update object (`periods/route.ts:239-266`,
     * `recipients/route.ts:174-180`). The same rule, expressed for an UPSERT:
     * a column ABSENT from the payload is absent from PostgREST's column list,
     * so it takes its default on INSERT and is left untouched by the
     * `ON CONFLICT DO UPDATE` on the existing row. A column present with `null`
     * is written as NULL, which is how a figure is deliberately withdrawn.
     *
     * That PostgREST behaviour is the load-bearing half and it is not a
     * behaviour a mocked client can demonstrate, so it was checked against the
     * live local stack as well — see the mutation note in
     * `measure-claim-routes.test.ts`. `zod`'s `.optional()` is what preserves
     * `undefined` this far: `optionalMoney.optional()` yields `number | null |
     * undefined`, and the three are three different answers.
     */
    const row: Record<string, unknown> = {
      workspace_id: authorization.workspaceId,
      measure_fund_id: authorization.fund.id,
      recipient_id: recipient.id,
      fiscal_year_label: payload.data.fiscalYearLabel,
      basis_note: payload.data.basisNote,
      stated_by: authorization.userId,
      stated_on: payload.data.statedOn,
      updated_at: new Date().toISOString(),
    };
    if (payload.data.requiredAmount !== undefined) row.required_amount = payload.data.requiredAmount;
    if (payload.data.reportedAmount !== undefined) row.reported_amount = payload.data.reportedAmount;

    // UPSERT on the (recipient, year) uniqueness, because the two figures
    // arrive at different times of the year and the second one must not be a
    // 409 the person has to work around.
    const { data, error } = await supabase
      .from("measure_moe_records")
      .upsert(row, { onConflict: "recipient_id,fiscal_year_label" })
      .select(MEASURE_MOE_COLUMNS)
      .single();

    if (error && isWriteFailure(error)) {
      audit.error("upsert_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to record the maintenance-of-effort figures" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      return insertNotReadableBackResponse({ subject: "maintenance-of-effort record" });
    }

    audit.info("recorded", {
      measureId: parsedParams.data.measureId,
      recipientId: recipient.id,
      fiscalYearLabel: payload.data.fiscalYearLabel,
      hasRequired: payload.data.requiredAmount !== undefined && payload.data.requiredAmount !== null,
      hasReported: payload.data.reportedAmount !== undefined && payload.data.reportedAmount !== null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ moeRecord: data }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to record the maintenance-of-effort figures" }, { status: 500 });
  }
}
