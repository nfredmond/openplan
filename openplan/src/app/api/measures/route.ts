/**
 * Setting up the measure fund behind a `local_measure` program record.
 *
 * WHY THIS ROUTE EXISTS AT ALL, stated plainly because it was nearly left out.
 * `measure_funds` has a `UNIQUE program_id` and everything else in this lane
 * hangs off a fund row. Without a door that creates one, the schema, the
 * allocator, the claim ledger and the oversight page would all be complete,
 * tested, and unreachable — this repository's most expensive recurring defect
 * (`every-api-route-has-a-caller.test.ts`, eleven recorded instances). The
 * caller is `measure-fund-setup.tsx` on `/programs/[programId]/measure`.
 *
 * WHAT IT REFUSES. A program whose `program_type` is not `local_measure`. The
 * measure is a program record (product non-negotiable #2 — deepen the modules,
 * do not add one), and attaching a fund to an RTIP row would put a tax fund's
 * ordinance on a program that has none.
 *
 * NOTHING HERE NAMES A PLACE. `currencyCode` is required with no default, for
 * the reason the column has no DEFAULT: a `'USD'` fallback is a country
 * assumption, and this architecture may not assume the US.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { insertNotReadableBackResponse, isWriteFailure, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import {
  MEASURE_FUND_COLUMNS,
  MEASURE_RECEIPT_CADENCES,
  MEASURE_SUNSET_POSTURES,
} from "@/lib/measures/fund";

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * The vocabularies come from the catalog rather than being retyped, and the
 * `satisfies` on the tuple makes drift a compile error: a cadence added to the
 * catalog and not to the CHECK (or the reverse) fails here before it can reach
 * a form.
 */
const cadenceValues = MEASURE_RECEIPT_CADENCES.map((entry) => entry.value) as [string, ...string[]];
const sunsetValues = MEASURE_SUNSET_POSTURES.map((entry) => entry.value) as [string, ...string[]];

const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date (YYYY-MM-DD)");

const createMeasureSchema = z.object({
  programId: z.string().uuid(),
  ordinanceReference: z.string().trim().max(240).optional(),
  rateLabel: z.string().trim().max(120).optional(),
  adoptedOn: isoDate.optional(),
  effectiveFrom: isoDate.optional(),
  sunsetPosture: z.enum(sunsetValues).optional(),
  sunsetOn: isoDate.optional(),
  receiptCadence: z.enum(cadenceValues),
  // Required, uppercase, three letters — ISO 4217 shape, not a list of
  // currencies this product blesses.
  currencyCode: z.string().trim().regex(/^[A-Za-z]{3}$/),
  fiscalYearNote: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("measures.create", request);
  const startedAt = Date.now();

  try {
    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payload = createMeasureSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid measure fund payload" }, { status: 400 });
    }

    // A dated sunset needs its date and an undated posture must not carry one —
    // the same rule the column CHECK enforces, restated here only so the
    // message names the field instead of the constraint.
    const sunsetPosture = payload.data.sunsetPosture ?? "not_recorded";
    const sunsetOn = payload.data.sunsetOn ?? null;
    if ((sunsetPosture === "dated") !== (sunsetOn !== null)) {
      return NextResponse.json(
        {
          error:
            sunsetPosture === "dated"
              ? "A measure that sunsets on a date needs that date."
              : "Clear the sunset date, or say the ordinance sets one — an empty date cannot mean 'never expires'.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const membershipResult = await loadCurrentWorkspaceMembership(supabase, user.id);
    const membership = membershipResult.membership;
    if (!membership || !canAccessWorkspaceAction("programs.write", membership.role)) {
      audit.warn("forbidden", { role: membership?.role ?? null });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Scoped to the caller's workspace, so someone else's program is not found
    // rather than found-and-refused.
    const programResult = await supabase
      .from("programs")
      .select("id, workspace_id, title, program_type")
      .eq("id", payload.data.programId)
      .eq("workspace_id", membership.workspace_id)
      .maybeSingle();

    const readFailure = classifyRouteReadFailure("the program", programResult);
    if (readFailure) {
      audit.error("program_lookup_failed", { message: readFailure.message });
      return NextResponse.json(readFailure.body, { status: readFailure.status });
    }

    const program = programResult.data as { id: string; title?: string | null; program_type?: string | null } | null;
    if (!program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    if (program.program_type !== "local_measure") {
      audit.warn("program_type_mismatch", { programType: program.program_type ?? null });
      return NextResponse.json(
        {
          error: "This program is not a local measure",
          details:
            "A measure fund records an ordinance, its receipts and the claims against it. Change the " +
            "program's type to Local measure first, or set the fund up on the program that is one.",
        },
        { status: 400 }
      );
    }

    const insertPayload = {
      // From what the route PROVED, never from the body.
      workspace_id: membership.workspace_id,
      program_id: program.id,
      ordinance_reference: payload.data.ordinanceReference?.trim() || null,
      rate_label: payload.data.rateLabel?.trim() || null,
      adopted_on: payload.data.adoptedOn ?? null,
      effective_from: payload.data.effectiveFrom ?? null,
      sunset_posture: sunsetPosture,
      sunset_on: sunsetOn,
      receipt_cadence: payload.data.receiptCadence,
      currency_code: payload.data.currencyCode.toUpperCase(),
      fiscal_year_note: payload.data.fiscalYearNote?.trim() || null,
      created_by: user.id,
    };

    const { data, error } = await supabase
      .from("measure_funds")
      .insert(insertPayload)
      .select(MEASURE_FUND_COLUMNS)
      .single();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        // The UNIQUE on program_id. Two fund rows on one program would be two
        // answers to what the ordinance said.
        return NextResponse.json(
          {
            error: "This program already has a measure fund",
            details: "Open it from the program page rather than setting up a second one.",
          },
          { status: 409 }
        );
      }
      audit.error("insert_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to set up the measure fund" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.warn("insert_not_readable_back", { programId: program.id });
      return insertNotReadableBackResponse({ subject: "measure fund" });
    }

    audit.info("created", {
      programId: program.id,
      measureId: (data as { id?: string } | null)?.id ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ measure: data }, { status: 201 });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to set up the measure fund" }, { status: 500 });
  }
}
