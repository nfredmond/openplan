/**
 * The apportionment figures — stated by a person, sourced by name.
 *
 * ============================================================================
 * OPENPLAN NEVER FETCHES A POPULATION AND USES IT AS A DIVISOR
 * ============================================================================
 *
 * This route has no Census client, no ACS lookup, and no reference figure shown
 * beside the input. That is a product decision, not an omission (memo Q1,
 * default built: no auto-fill and no reference figure).
 *
 * The reason is specific. An ordinance names its OWN source — "the Department
 * of Finance E-1 estimate as of January 1" — and that figure is frequently not
 * the one a general-purpose demographic API returns for the same place and
 * year. A convenience figure on screen next to an empty input gets copied into
 * it, and the copy is then a legal apportionment basis nobody checked against
 * the ordinance. `basis_source_note` is NOT NULL for the same reason: a figure
 * with no stated source is a number somebody typed.
 *
 * ============================================================================
 * WHY THERE IS NO PATCH
 * ============================================================================
 *
 * `measure_recipient_basis_values` has no UPDATE policy. A stated figure with a
 * named source, a stater and a date is a RECORD. Restating it means recording a
 * new vintage — or, when the first entry was simply wrong, deleting that row and
 * inserting the right one, which leaves `stated_by`/`stated_on` truthful either
 * way. An in-place edit would leave a person's name against a number they never
 * stated.
 *
 * A missing figure is never zero. If any ACTIVE recipient lacks a value for the
 * vintage in force, `allocateMeasureReceipt` reports the whole category as
 * undistributed rather than splitting it among the recipients that do have one:
 * dropping a term from the denominator inflates every other share, silently and
 * in the direction that overpays.
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
import { MEASURE_RECIPIENT_BASIS_VALUE_COLUMNS, MEASURE_RECIPIENT_COLUMNS } from "@/lib/measures/fund";
import { authorizeMeasureWrite } from "@/lib/measures/write-authorization";

const POSTGRES_UNIQUE_VIOLATION = "23505";

const paramsSchema = z.object({ measureId: z.string().uuid() });

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "a basis id must be lower-case letters, digits, hyphen or underscore");

const createBasisValueSchema = z.object({
  recipientId: z.string().uuid(),
  basisId: idSchema,
  vintageLabel: z.string().trim().min(1).max(120),
  // NUMERIC(18,4): a basis is not always a count — lane miles and area are real
  // numbers, and rounding a divisor changes every share.
  basisValue: z.coerce.number().min(0),
  basisSourceNote: z.string().trim().min(1).max(2000),
  statedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const deleteBasisValueSchema = z.object({ basisValueId: z.string().uuid() });

/** Confirms the recipient belongs to THIS measure, not merely to the workspace. */
async function loadRecipient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  audit: ReturnType<typeof createApiAuditLogger>,
  args: { recipientId: string; measureFundId: string }
): Promise<{ ok: true; recipient: { id: string } } | { ok: false; response: NextResponse }> {
  const result = await supabase
    .from("measure_recipients")
    .select(MEASURE_RECIPIENT_COLUMNS)
    .eq("id", args.recipientId)
    .eq("measure_fund_id", args.measureFundId)
    .maybeSingle();

  const readFailure = classifyRouteReadFailure("the recipient", result);
  if (readFailure) {
    audit.error("recipient_lookup_failed", { message: readFailure.message });
    return { ok: false, response: NextResponse.json(readFailure.body, { status: readFailure.status }) };
  }
  if (!result.data) {
    return { ok: false, response: NextResponse.json({ error: "Recipient not found" }, { status: 404 }) };
  }
  return { ok: true, recipient: result.data as { id: string } };
}

export async function POST(request: NextRequest, context: { params: Promise<{ measureId: string }> }) {
  const audit = createApiAuditLogger("measures.basis_values.create", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid measure id" }, { status: 400 });

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = createBasisValueSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid apportionment figure payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    const recipient = await loadRecipient(supabase, audit, {
      recipientId: payload.data.recipientId,
      measureFundId: authorization.fund.id,
    });
    if (!recipient.ok) return recipient.response;

    const { data, error } = await supabase
      .from("measure_recipient_basis_values")
      .insert({
        workspace_id: authorization.workspaceId,
        recipient_id: recipient.recipient.id,
        basis_id: payload.data.basisId,
        vintage_label: payload.data.vintageLabel,
        basis_value: payload.data.basisValue,
        basis_source_note: payload.data.basisSourceNote,
        // Never the agent, never inferred: whoever states an apportionment
        // figure is the person answerable for it.
        stated_by: authorization.userId,
        stated_on: payload.data.statedOn,
      })
      .select(MEASURE_RECIPIENT_BASIS_VALUE_COLUMNS)
      .single();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return NextResponse.json(
          {
            error: "This recipient already has that figure for that vintage",
            details:
              "A figure with a named source and a stater is a record rather than a field. To correct it, " +
              "delete the existing entry and add the right one, or record a new vintage.",
          },
          { status: 409 }
        );
      }
      audit.error("insert_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to record the apportionment figure" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.warn("insert_not_readable_back", { measureId: parsedParams.data.measureId });
      return insertNotReadableBackResponse({ subject: "apportionment figure" });
    }

    audit.info("created", {
      measureId: parsedParams.data.measureId,
      recipientId: recipient.recipient.id,
      basisId: payload.data.basisId,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ basisValue: data }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to record the apportionment figure" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ measureId: string }> }) {
  const audit = createApiAuditLogger("measures.basis_values.delete", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid measure id" }, { status: 400 });

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = deleteBasisValueSchema.safeParse(body.data);
    if (!payload.success) {
      return NextResponse.json({ error: "Invalid delete payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    // Scoped through the workspace the authorization proved. The row's own
    // composite foreign key guarantees its recipient shares that workspace, so
    // a figure belonging to another fund in another tenant cannot match.
    const { data, error } = await supabase
      .from("measure_recipient_basis_values")
      .delete()
      .eq("id", payload.data.basisValueId)
      .eq("workspace_id", authorization.workspaceId)
      .select("id")
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("delete_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to remove the apportionment figure" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      // Not verified by a prior read on purpose: a 404 here is the ordinary
      // answer to "does this figure exist and may you touch it", and a
      // distinguishable 403 would confirm other workspaces' rows.
      return noRowsMatchedResponse({ subject: "apportionment figure", targetWasVerified: false });
    }

    audit.info("deleted", { measureId: parsedParams.data.measureId, basisValueId: payload.data.basisValueId });
    return NextResponse.json({ ok: true, basisValueId: payload.data.basisValueId });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to remove the apportionment figure" }, { status: 500 });
  }
}
