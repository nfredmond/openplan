import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import {
  insertNotReadableBackResponse,
  isWriteFailure,
  noRowsMatchedResponse,
  writeMatchedNoRows,
} from "@/lib/http/write-outcome";
import {
  completeExtractionAcceptance,
  extractionProvenanceColumns,
  isOnlyExtractionProvenance,
  resolveExtractionCandidate,
} from "@/lib/rtp/extraction/acceptance";

/**
 * The performance measures of an RTP cycle: a baseline, a target, and the
 * source the baseline came from.
 *
 * WHY A BLANK BOX AND A MEASURED ZERO MUST NEVER COLLAPSE, which is the one
 * thing this file is careful about above all others. A performance measure is a
 * pair of numbers an agency will be held to — "fatalities: 0 in 2024, target 0
 * by 2035" is a real and common Vision Zero baseline, and so is "0% of bridges
 * in poor condition". `z.coerce.number()` maps `""` to `0`, so a planner who
 * left the baseline box empty would have the plan assert a baseline of zero
 * they never measured, indistinguishable from the agency that measured it. The
 * federal PM1/PM2/PM3 reporting an MPO does off these numbers makes that a
 * falsified figure rather than a cosmetic bug.
 *
 * So every numeric field here goes through `nullableNumberField`, which reads a
 * blank string as NULL and a literal `0` as zero, and the update path branches
 * on `!== undefined` rather than on truthiness — `if (value)` would drop a zero
 * on the floor in exactly the same way.
 *
 * WHY `.strict()` ON EVERY PAYLOAD. zod silently STRIPS unknown keys by
 * default, which this repo has already been bitten by: a guard "proving" an
 * import payload could not set `status` passed with the guard removed, because
 * the field never reached the code under test. A rejected unknown key is a 400
 * a caller can see and fix; a stripped one is a field somebody believes they
 * sent.
 *
 * WHY THE VALUE BOUNDS ARE HERE AND NOT ONLY IN THE DATABASE.
 * `baseline_value`/`target_value` are `NUMERIC(18, 4)` — fourteen digits before
 * the decimal point. Postgres answers `22003 numeric field value out of range`
 * past that, which would surface as an opaque 500. Bounding it in the schema
 * turns it into a 400 that names the field. Negative values are ACCEPTED on
 * purpose: a measure can legitimately be a change ("net change in VMT per
 * capita: -3.2%"), and `parseOptionalAmount` — the money parser — maps negative
 * to null, which is right for a cost and wrong here.
 */

/** Postgres unique-violation. `UNIQUE (rtp_cycle_id, measure_key)`. */
const UNIQUE_VIOLATION = "23505";

/**
 * `NUMERIC(18, 4)` holds fourteen integer digits. Stated as the largest whole
 * value rather than as `1e14` so the failure message can quote a real number.
 */
const MEASURE_VALUE_LIMIT = 99_999_999_999_999;

/** Matches the CHECK on baseline_year / target_year in 20260805000003. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

const MEASURE_SELECT =
  "id, workspace_id, rtp_cycle_id, measure_key, label, unit, baseline_value, baseline_year, target_value, target_year, data_source, notes, sort_order, created_at, updated_at";

const paramsSchema = z.object({ rtpCycleId: z.string().uuid() });

type NullableNumberOptions = {
  /** Reject a fractional value. Years and sort orders are integers. */
  integer?: boolean;
  min?: number;
  max?: number;
  /**
   * False for a NOT NULL column (`sort_order`): a blank box there is a caller
   * mistake, not an "unset", and accepting it would mean writing a value the
   * planner did not choose.
   */
  allowNull?: boolean;
  /** The field's name in the payload, for the 400 message. */
  label: string;
};

/**
 * A number a planner may leave blank, where blank means NOT MEASURED.
 *
 * Accepts a JSON number, a numeric string (HTML inputs send strings), or an
 * explicit null. `""` and whitespace become null. Anything else is a 400 — an
 * unparseable value is never quietly turned into null, because a typo'd
 * baseline silently becoming "not measured" is the same lie in the other
 * direction.
 *
 * `.optional()` is the OUTERMOST wrapper so an absent key stays absent
 * (`undefined`) instead of arriving as null — that is what lets PATCH tell
 * "leave this field alone" from "clear this field".
 */
function nullableNumberField(options: NullableNumberOptions) {
  const { integer = false, min, max, allowNull = true, label } = options;

  return z
    .union([z.number(), z.string(), z.null()])
    .transform((value, ctx) => {
      const reject = (message: string) => {
        ctx.addIssue({ code: "custom", message: `${label}: ${message}`, path: [label] });
        return z.NEVER;
      };

      let parsed: number;
      if (value === null) {
        if (!allowNull) return reject("must be a number.");
        return null;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") {
          // THE WHOLE POINT. `Number("")` is 0; an empty box is not a zero.
          if (!allowNull) return reject("must be a number.");
          return null;
        }
        parsed = Number(trimmed);
      } else {
        parsed = value;
      }

      if (!Number.isFinite(parsed)) return reject("must be a number.");
      if (integer && !Number.isInteger(parsed)) return reject("must be a whole number.");
      if (min !== undefined && parsed < min) return reject(`must be ${min} or greater.`);
      if (max !== undefined && parsed > max) return reject(`must be ${max} or less.`);
      return parsed;
    })
    .optional();
}

/** Text a planner may leave blank. Blank is NULL, never the empty string. */
function nullableTextField(maxLength: number) {
  return z
    .union([z.string().trim().max(maxLength), z.null()])
    .transform((value) => (value === null || value === "" ? null : value))
    .optional();
}

const measureValueField = (label: string) =>
  nullableNumberField({ label, min: -MEASURE_VALUE_LIMIT, max: MEASURE_VALUE_LIMIT });

const measureYearField = (label: string) =>
  nullableNumberField({ label, integer: true, min: MIN_YEAR, max: MAX_YEAR });

const sortOrderField = () =>
  nullableNumberField({ label: "sortOrder", integer: true, min: -100000, max: 100000, allowNull: false });

const measureKeyField = z.string().trim().min(1).max(120);
const labelField = z.string().trim().min(1).max(200);

/**
 * The transcription this measure was copied from, when there was one.
 *
 * It has to be DECLARED here rather than tolerated, because both payloads are
 * `.strict()` and a strict schema answers 400 for a key it does not know. That
 * is the right default and it is why this field is spelled out: the alternative
 * — dropping `.strict()` so an unknown key is silently stripped — is the exact
 * defect this repo has already paid for, where a guard "proving" a payload
 * could not set a field passed because the field never reached the code.
 *
 * A baseline is still a measurement of the world. What makes a transcribed one
 * legitimate is not that a model produced it but that the agency's own adopted
 * document prints it on a page this row will cite, and that a person read the
 * quote and accepted it.
 */
const fromExtractionCandidateIdSchema = z.string().uuid().optional();

const createMeasureSchema = z
  .object({
    measureKey: measureKeyField,
    label: labelField,
    unit: nullableTextField(60),
    baselineValue: measureValueField("baselineValue"),
    baselineYear: measureYearField("baselineYear"),
    targetValue: measureValueField("targetValue"),
    targetYear: measureYearField("targetYear"),
    dataSource: nullableTextField(300),
    notes: nullableTextField(2000),
    sortOrder: sortOrderField(),
    fromExtractionCandidateId: fromExtractionCandidateIdSchema,
  })
  .strict();

const updateMeasureSchema = z
  .object({
    measureId: z.string().uuid(),
    measureKey: measureKeyField.optional(),
    label: labelField.optional(),
    unit: nullableTextField(60),
    baselineValue: measureValueField("baselineValue"),
    baselineYear: measureYearField("baselineYear"),
    targetValue: measureValueField("targetValue"),
    targetYear: measureYearField("targetYear"),
    dataSource: nullableTextField(300),
    notes: nullableTextField(2000),
    sortOrder: sortOrderField(),
    fromExtractionCandidateId: fromExtractionCandidateIdSchema,
  })
  .strict()
  // Provenance is not an edit: naming a transcription and changing no value is
  // still "nothing was requested", because the alternative is a measure marked
  // as transcribed from a page while its baseline is the one somebody typed.
  .refine((value) => !isOnlyExtractionProvenance(value, "measureId"), {
    message: "At least one field must be updated.",
  });

const deleteMeasureSchema = z.object({ measureId: z.string().uuid() }).strict();

type RouteContext = { params: Promise<{ rtpCycleId: string }> };

type AuditLogger = ReturnType<typeof createApiAuditLogger>;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type WriteContext = {
  supabase: SupabaseServerClient;
  userId: string;
  workspaceId: string;
  role: string;
  cycleId: string;
};

/**
 * Session -> current workspace -> the cycle, in that order, refusing at the
 * first step that does not hold.
 *
 * The cycle is read with BOTH `id` and `workspace_id` pinned, so a cycle id
 * from another workspace is indistinguishable from one that does not exist —
 * the enumeration boundary the rest of this repo keeps. The `workspace_id`
 * written to the row therefore comes from the caller's membership and never
 * from the request.
 */
async function resolveWriteContext(
  audit: AuditLogger,
  rtpCycleId: string
): Promise<{ ok: true; context: WriteContext } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  let membershipResult;
  try {
    membershipResult = await loadCurrentWorkspaceMembership(supabase, user.id);
  } catch (error) {
    audit.error("membership_lookup_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 }),
    };
  }

  const membership = membershipResult.membership;
  if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const cycleResult = await supabase
    .from("rtp_cycles")
    .select("id, workspace_id")
    .eq("id", rtpCycleId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  // A read that FAILED reaches the same `!data` branch as a read that found
  // nothing. Answering "RTP cycle not found" on a failed read tells a planner
  // their plan does not exist while it sits open in the tab they clicked from.
  const cycleFailure = classifyRouteReadFailure("the RTP cycle", cycleResult);
  if (cycleFailure) {
    audit.error("cycle_lookup_failed", { rtpCycleId, message: cycleFailure.message });
    return { ok: false, response: NextResponse.json(cycleFailure.body, { status: cycleFailure.status }) };
  }

  const cycle = cycleResult.data as { id: string } | null;
  if (!cycle) {
    return { ok: false, response: NextResponse.json({ error: "RTP cycle not found" }, { status: 404 }) };
  }

  return {
    ok: true,
    context: {
      supabase,
      userId: user.id,
      workspaceId: membership.workspace_id,
      role: membership.role,
      cycleId: cycle.id,
    },
  };
}

/** The measure, verified to live in THIS cycle and THIS workspace. */
async function loadMeasureInCycle(
  audit: AuditLogger,
  context: WriteContext,
  measureId: string
): Promise<
  { ok: true; measure: { id: string; measure_key: string } } | { ok: false; response: NextResponse }
> {
  const measureResult = await context.supabase
    .from("rtp_performance_measures")
    .select("id, measure_key")
    .eq("id", measureId)
    .eq("rtp_cycle_id", context.cycleId)
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();

  const failure = classifyRouteReadFailure("the performance measure", measureResult);
  if (failure) {
    audit.error("measure_lookup_failed", { measureId, message: failure.message });
    return { ok: false, response: NextResponse.json(failure.body, { status: failure.status }) };
  }

  const measure = measureResult.data as { id: string; measure_key: string } | null;
  if (!measure) {
    return { ok: false, response: NextResponse.json({ error: "Performance measure not found" }, { status: 404 }) };
  }

  return { ok: true, measure };
}

/** The 409 body, in the planner's words rather than Postgres's. */
function duplicateMeasureKeyResponse(measureKey: string): NextResponse {
  return NextResponse.json(
    {
      error: `This RTP cycle already has a performance measure with the key "${measureKey}".`,
      details:
        "A measure key is how a plan addresses one measure across its baseline, its target and its reporting, " +
        "so two measures cannot share one. Give this measure a different key, or edit the existing measure instead.",
    },
    { status: 409 }
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.performance_measures.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) {
      audit.warn("invalid_json", { message: body.parseError.message });
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payload = createMeasureSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        { error: "Invalid performance measure payload", issues: payload.error.issues },
        { status: 400 }
      );
    }

    const resolved = await resolveWriteContext(audit, routeParams.data.rtpCycleId);
    if (!resolved.ok) return resolved.response;
    const { supabase, userId, workspaceId, cycleId } = resolved.context;

    const candidate = await resolveExtractionCandidate({
      supabase: supabase as unknown as Parameters<typeof resolveExtractionCandidate>[0]["supabase"],
      audit,
      candidateId: payload.data.fromExtractionCandidateId,
      targetKind: "performance_measure",
      rtpCycleId: cycleId,
      workspaceId,
    });
    if (!candidate.ok) return candidate.response;

    const insertPayload = {
      workspace_id: workspaceId,
      rtp_cycle_id: cycleId,
      measure_key: payload.data.measureKey,
      label: payload.data.label,
      unit: payload.data.unit ?? null,
      // `?? null` and NOT `|| null`: a baseline of 0 is a measurement.
      baseline_value: payload.data.baselineValue ?? null,
      baseline_year: payload.data.baselineYear ?? null,
      target_value: payload.data.targetValue ?? null,
      target_year: payload.data.targetYear ?? null,
      data_source: payload.data.dataSource ?? null,
      notes: payload.data.notes ?? null,
      // sort_order is NOT NULL DEFAULT 0 — a display ordering, not a
      // measurement, so an absent one really is 0.
      sort_order: payload.data.sortOrder ?? 0,
      created_by: userId,
      ...extractionProvenanceColumns(candidate.candidate),
    };

    const { data, error } = await supabase
      .from("rtp_performance_measures")
      .insert(insertPayload)
      .select(MEASURE_SELECT)
      .single();

    if (error && isWriteFailure(error)) {
      if (error.code === UNIQUE_VIOLATION) {
        audit.warn("duplicate_measure_key", { rtpCycleId: cycleId, measureKey: payload.data.measureKey });
        return duplicateMeasureKeyResponse(payload.data.measureKey);
      }
      audit.error("insert_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to create the performance measure" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      // The INSERT landed and the read-back could not see it. Reporting a
      // failure here would have the caller retry a write that already
      // succeeded, and the retry would then 409 against its own row.
      audit.warn("insert_not_readable_back", { rtpCycleId: cycleId, measureKey: payload.data.measureKey });
      return insertNotReadableBackResponse({ subject: "performance measure" });
    }

    const acceptance = await completeExtractionAcceptance({
      audit,
      candidate: candidate.candidate,
      acceptedRowId: (data as { id?: string } | null)?.id,
      reviewedBy: userId,
      context: { rtpCycleId: cycleId },
    });

    audit.info("created", {
      rtpCycleId: cycleId,
      measureKey: payload.data.measureKey,
      extractionCandidateId: candidate.candidate?.id ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ measure: data, ...acceptance }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to create the performance measure" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.performance_measures.update", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) {
      audit.warn("invalid_json", { message: body.parseError.message });
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payload = updateMeasureSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        { error: "Invalid performance measure update payload", issues: payload.error.issues },
        { status: 400 }
      );
    }

    const resolved = await resolveWriteContext(audit, routeParams.data.rtpCycleId);
    if (!resolved.ok) return resolved.response;
    const writeContext = resolved.context;

    const found = await loadMeasureInCycle(audit, writeContext, payload.data.measureId);
    if (!found.ok) return found.response;

    // `!== undefined` throughout, deliberately. `if (payload.data.baselineValue)`
    // would skip a baseline of 0 and leave the old value in place, which is the
    // same collapse the schema exists to prevent, one layer down.
    const updates: Record<string, unknown> = {};
    if (payload.data.measureKey !== undefined) updates.measure_key = payload.data.measureKey;
    if (payload.data.label !== undefined) updates.label = payload.data.label;
    if (payload.data.unit !== undefined) updates.unit = payload.data.unit;
    if (payload.data.baselineValue !== undefined) updates.baseline_value = payload.data.baselineValue;
    if (payload.data.baselineYear !== undefined) updates.baseline_year = payload.data.baselineYear;
    if (payload.data.targetValue !== undefined) updates.target_value = payload.data.targetValue;
    if (payload.data.targetYear !== undefined) updates.target_year = payload.data.targetYear;
    if (payload.data.dataSource !== undefined) updates.data_source = payload.data.dataSource;
    if (payload.data.notes !== undefined) updates.notes = payload.data.notes;
    if (payload.data.sortOrder !== undefined) updates.sort_order = payload.data.sortOrder;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    // Only once a real edit is established. The reconciliation case: the
    // adopted document's baseline differs from the one in the plan, and the
    // planner is taking the document's and citing its page.
    const candidate = await resolveExtractionCandidate({
      supabase: writeContext.supabase as unknown as Parameters<
        typeof resolveExtractionCandidate
      >[0]["supabase"],
      audit,
      candidateId: payload.data.fromExtractionCandidateId,
      targetKind: "performance_measure",
      rtpCycleId: writeContext.cycleId,
      workspaceId: writeContext.workspaceId,
    });
    if (!candidate.ok) return candidate.response;
    Object.assign(updates, extractionProvenanceColumns(candidate.candidate));

    const { data, error } = await writeContext.supabase
      .from("rtp_performance_measures")
      .update(updates)
      .eq("id", found.measure.id)
      .eq("rtp_cycle_id", writeContext.cycleId)
      .eq("workspace_id", writeContext.workspaceId)
      .select(MEASURE_SELECT)
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      if (error.code === UNIQUE_VIOLATION) {
        const attemptedKey = payload.data.measureKey ?? found.measure.measure_key;
        audit.warn("duplicate_measure_key", { rtpCycleId: writeContext.cycleId, measureKey: attemptedKey });
        return duplicateMeasureKeyResponse(attemptedKey);
      }
      audit.error("update_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to update the performance measure" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      // The row was read a moment ago through this same caller's client and the
      // role check passed, so zero matched rows means the database refused a
      // write the application believed was allowed — or the measure was deleted
      // mid-request. Nothing was saved either way.
      audit.error("update_matched_no_rows", {
        rtpCycleId: writeContext.cycleId,
        measureId: found.measure.id,
        role: writeContext.role,
      });
      return noRowsMatchedResponse({ subject: "performance measure", targetWasVerified: true });
    }

    const acceptance = await completeExtractionAcceptance({
      audit,
      candidate: candidate.candidate,
      acceptedRowId: found.measure.id,
      reviewedBy: writeContext.userId,
      context: { rtpCycleId: writeContext.cycleId },
    });

    audit.info("updated", {
      rtpCycleId: writeContext.cycleId,
      measureId: found.measure.id,
      extractionCandidateId: candidate.candidate?.id ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ measure: data, ...acceptance });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update the performance measure" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.performance_measures.delete", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) {
      audit.warn("invalid_json", { message: body.parseError.message });
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payload = deleteMeasureSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid delete payload" }, { status: 400 });
    }

    const resolved = await resolveWriteContext(audit, routeParams.data.rtpCycleId);
    if (!resolved.ok) return resolved.response;
    const writeContext = resolved.context;

    const found = await loadMeasureInCycle(audit, writeContext, payload.data.measureId);
    if (!found.ok) return found.response;

    // `.select()` on the DELETE so a delete that matched nothing is
    // distinguishable from one that removed the row. Without it PostgREST
    // reports success for both, and a planner is told a measure was removed
    // that is still in their adopted plan.
    const { data, error } = await writeContext.supabase
      .from("rtp_performance_measures")
      .delete()
      .eq("id", found.measure.id)
      .eq("rtp_cycle_id", writeContext.cycleId)
      .eq("workspace_id", writeContext.workspaceId)
      .select("id")
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("delete_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to remove the performance measure" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.error("delete_matched_no_rows", {
        rtpCycleId: writeContext.cycleId,
        measureId: found.measure.id,
        role: writeContext.role,
      });
      return noRowsMatchedResponse({ subject: "performance measure", targetWasVerified: true });
    }

    audit.info("deleted", {
      rtpCycleId: writeContext.cycleId,
      measureId: found.measure.id,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, measureId: found.measure.id });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to remove the performance measure" }, { status: 500 });
  }
}
