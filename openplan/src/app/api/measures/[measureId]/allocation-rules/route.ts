/**
 * Recording what the ordinance says the money splits into.
 *
 * THE RULE IS DATA AND THIS IS THE DOOR IT COMES THROUGH. `allocation.ts`
 * declares the closed descriptor vocabulary and `parseMeasureAllocationRule`
 * THROWS on anything malformed — the `createReimbursementProfileRegistry`
 * precedent, where every failure is a registration bug rather than a runtime
 * condition. This route catches that throw and turns it into a 400 whose body
 * is the parser's own sentence, because "category percentages must sum to
 * exactly 100 — they sum to 99.9" is the only message that tells a clerk what
 * to fix.
 *
 * WHY THERE IS NO PATCH. `measure_allocation_rules` has no UPDATE policy: a
 * rule version is what an ordinance said on a date. Amending an ordinance
 * inserts a new effective-dated row and the old one stays, because every
 * allocation computed under it points at it (`allocation_rule_id`, ON DELETE
 * RESTRICT). Editing the row in place would silently restate the provenance of
 * money already distributed.
 *
 * AN ORDINANCE THE DESCRIPTOR CANNOT EXPRESS is stored as
 * `{ version: 1, kind: "narrative", text }` and its allocations are entered by
 * hand, labelled staff-entered everywhere they appear. Blocking those agencies
 * was rejected; presenting hand figures as computed was rejected harder.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { insertNotReadableBackResponse, isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { parseMeasureAllocationRule } from "@/lib/measures/allocation";
import { MEASURE_ALLOCATION_RULE_COLUMNS } from "@/lib/measures/fund";
import { authorizeMeasureWrite } from "@/lib/measures/write-authorization";

const POSTGRES_UNIQUE_VIOLATION = "23505";

const paramsSchema = z.object({ measureId: z.string().uuid() });

const createRuleSchema = z.object({
  // Unknown, not a schema: `parseMeasureAllocationRule` owns the vocabulary and
  // restating it here would be a second definition of the ordinance form.
  rule: z.unknown(),
  effectiveFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  adoptedNote: z.string().trim().min(1).max(2000),
  statedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: NextRequest, context: { params: Promise<{ measureId: string }> }) {
  const audit = createApiAuditLogger("measures.allocation_rules.create", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid measure id" }, { status: 400 });
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.normalJson);
    if (!body.ok) return body.response;
    if (body.parseError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payload = createRuleSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid allocation rule payload" }, { status: 400 });
    }

    let rule;
    try {
      rule = parseMeasureAllocationRule(payload.data.rule);
    } catch (error) {
      // The parser's own words. A generic "invalid rule" would leave a clerk
      // with an ordinance in one hand and no idea which line the form rejected.
      const message = error instanceof Error ? error.message : "The allocation rule could not be read.";
      audit.warn("rule_rejected", { measureId: parsedParams.data.measureId, message });
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeMeasureWrite(supabase as unknown as Parameters<typeof authorizeMeasureWrite>[0], audit, parsedParams.data.measureId);
    if (!authorization.ok) return authorization.response;

    const { data, error } = await supabase
      .from("measure_allocation_rules")
      .insert({
        workspace_id: authorization.workspaceId,
        measure_fund_id: authorization.fund.id,
        rule,
        effective_from: payload.data.effectiveFrom,
        adopted_note: payload.data.adoptedNote,
        // Who read the ordinance this way. Never the agent, never inferred.
        stated_by: authorization.userId,
        stated_on: payload.data.statedOn,
      })
      .select(MEASURE_ALLOCATION_RULE_COLUMNS)
      .single();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return NextResponse.json(
          {
            error: "This measure already has a rule version effective on that date",
            details:
              "Two readings of an ordinance taking effect the same day would make every allocation from " +
              "that date ambiguous. Use a different effective date, or delete the existing version if no " +
              "allocation has been computed from it.",
          },
          { status: 409 }
        );
      }
      audit.error("insert_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to record the allocation rule" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.warn("insert_not_readable_back", { measureId: parsedParams.data.measureId });
      return insertNotReadableBackResponse({ subject: "allocation rule" });
    }

    audit.info("created", {
      measureId: parsedParams.data.measureId,
      ruleId: (data as { id?: string } | null)?.id ?? null,
      isNarrative: "kind" in rule && rule.kind === "narrative",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ allocationRule: data }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to record the allocation rule" }, { status: 500 });
  }
}
