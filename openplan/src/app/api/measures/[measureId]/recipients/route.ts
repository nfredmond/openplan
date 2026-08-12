/**
 * The bodies that claim against a measure fund.
 *
 * WHY NOT `invoicing_clients`. That table means "who this workspace bills"
 * (20260727000010). A city that is both a client of the agency's consulting arm
 * and a sub-recipient of its measure would occupy one row carrying two opposite
 * directions of money. The kind vocabulary and the no-DELETE posture are copied;
 * the table is not.
 *
 * THERE IS NO DELETE HERE, and there is no DELETE policy on the table either. A
 * body that has been paid public money must keep appearing on the record that
 * paid it. `isActive: false` retires it: the recipient stops appearing in
 * apportionment and may not file new claims, and every historic allocation
 * keeps its payee. `inactiveNote` says why, because "why did this city stop
 * receiving money" is the first question an oversight committee asks.
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
import { MEASURE_RECIPIENT_COLUMNS, MEASURE_RECIPIENT_KINDS } from "@/lib/measures/fund";
import { authorizeMeasureWrite } from "@/lib/measures/write-authorization";

const POSTGRES_UNIQUE_VIOLATION = "23505";

const paramsSchema = z.object({ measureId: z.string().uuid() });
const kindValues = MEASURE_RECIPIENT_KINDS.map((entry) => entry.value) as [string, ...string[]];

const createRecipientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  recipientKind: z.enum(kindValues).optional(),
  externalReference: z.string().trim().max(120).optional(),
});

const updateRecipientSchema = z
  .object({
    recipientId: z.string().uuid(),
    name: z.string().trim().min(1).max(200).optional(),
    recipientKind: z.enum(kindValues).optional(),
    externalReference: z.string().trim().max(120).nullish(),
    isActive: z.boolean().optional(),
    inactiveNote: z.string().trim().max(2000).nullish(),
  })
  .refine((value) => Object.keys(value).length > 1, { message: "At least one field must be updated" });

export async function POST(request: NextRequest, context: { params: Promise<{ measureId: string }> }) {
  const audit = createApiAuditLogger("measures.recipients.create", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid measure id" }, { status: 400 });

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = createRecipientSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid recipient payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    const { data, error } = await supabase
      .from("measure_recipients")
      .insert({
        workspace_id: authorization.workspaceId,
        measure_fund_id: authorization.fund.id,
        name: payload.data.name,
        recipient_kind: payload.data.recipientKind ?? "other",
        external_reference: payload.data.externalReference?.trim() || null,
      })
      .select(MEASURE_RECIPIENT_COLUMNS)
      .single();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return NextResponse.json(
          {
            error: "This measure already has a recipient with that name",
            details:
              "Two recipients sharing a name would make every allocation and claim ambiguous about which " +
              "body it belongs to. If the earlier one was retired, reactivate it rather than adding a second.",
          },
          { status: 409 }
        );
      }
      audit.error("insert_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to add the recipient" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.warn("insert_not_readable_back", { measureId: parsedParams.data.measureId });
      return insertNotReadableBackResponse({ subject: "recipient" });
    }

    audit.info("created", {
      measureId: parsedParams.data.measureId,
      recipientId: (data as { id?: string } | null)?.id ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ recipient: data }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to add the recipient" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ measureId: string }> }) {
  const audit = createApiAuditLogger("measures.recipients.update", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) return NextResponse.json({ error: "Invalid measure id" }, { status: 400 });

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const payload = updateRecipientSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid recipient update payload" }, { status: 400 });
    }

    // Retiring a recipient removes it from every future apportionment, which
    // changes what every other jurisdiction receives. A note is required so the
    // record says why, rather than leaving a silent change in a public split.
    if (payload.data.isActive === false && !payload.data.inactiveNote?.trim()) {
      return NextResponse.json(
        {
          error: "Say why this recipient is being retired",
          details:
            "Retiring a recipient changes what every other jurisdiction receives from this measure. The " +
            "reason goes on the record beside the change.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    const existingResult = await supabase
      .from("measure_recipients")
      .select(MEASURE_RECIPIENT_COLUMNS)
      .eq("id", payload.data.recipientId)
      .eq("measure_fund_id", authorization.fund.id)
      .maybeSingle();

    const readFailure = classifyRouteReadFailure("the recipient", existingResult);
    if (readFailure) {
      audit.error("recipient_lookup_failed", { message: readFailure.message });
      return NextResponse.json(readFailure.body, { status: readFailure.status });
    }
    const existing = existingResult.data as { id: string } | null;
    if (!existing) return NextResponse.json({ error: "Recipient not found" }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (payload.data.name !== undefined) updates.name = payload.data.name;
    if (payload.data.recipientKind !== undefined) updates.recipient_kind = payload.data.recipientKind;
    if (payload.data.externalReference !== undefined) {
      updates.external_reference = payload.data.externalReference?.trim() || null;
    }
    if (payload.data.isActive !== undefined) updates.is_active = payload.data.isActive;
    if (payload.data.inactiveNote !== undefined) updates.inactive_note = payload.data.inactiveNote?.trim() || null;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("measure_recipients")
      .update(updates)
      .eq("id", existing.id)
      .select(MEASURE_RECIPIENT_COLUMNS)
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return NextResponse.json(
          { error: "Another recipient of this measure already uses that name" },
          { status: 409 }
        );
      }
      audit.error("update_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to update the recipient" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.error("update_matched_no_rows", { recipientId: existing.id });
      return noRowsMatchedResponse({ subject: "recipient", targetWasVerified: true });
    }

    audit.info("updated", {
      measureId: parsedParams.data.measureId,
      recipientId: existing.id,
      retired: payload.data.isActive === false,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ recipient: data });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update the recipient" }, { status: 500 });
  }
}
