/**
 * The horizon bands of an RTP cycle — the periods a financial element programmes
 * money across.
 *
 * WHY THE YEAR RULES ARE RESTATED HERE rather than left to the database.
 * `20260805000003_rtp_financial_element.sql` already refuses an out-of-order
 * band and an escalation year outside its own band, so nothing invalid can be
 * stored either way. But a CHECK-constraint violation arrives at the browser as
 * `new row for relation "rtp_horizon_bands" violates check constraint
 * "rtp_horizon_bands_escalation_within_band"`, which tells a planner nothing
 * about what to change. These checks exist to convert that into a sentence that
 * names the rule and the two numbers that broke it. They are a SECOND line, not
 * the only one — the database remains the authority.
 *
 * WHY A DELETE THAT IS REFUSED IS A 409 AND NOT A 500.
 * `rtp_financial_assumptions.horizon_band_id` is ON DELETE RESTRICT on purpose:
 * a band is a period of a financial plan a board may already have adopted, and
 * deleting one that still carries revenue or O&M lines would silently remove
 * money from the fiscal-constraint check. Postgres refuses with SQLSTATE 23503.
 * That refusal is the SYSTEM WORKING, and it is the planner's to resolve — move
 * the lines to another period or remove them — so it answers 409 with the
 * blocking lines named. Reporting it as 500 would tell a planner the product is
 * broken when in fact it just protected their financial element.
 *
 * WHAT A SUCCESSFUL DELETE STILL COSTS, disclosed rather than hidden.
 * `project_rtp_cycle_links.horizon_band_id` is ON DELETE SET NULL, not RESTRICT.
 * So deleting a band that no ledger line references still detaches every project
 * programmed into that period, and each becomes an `unbanded_constrained_project`
 * blocker in `buildRtpFiscalConstraint`. The response says how many, because a
 * planner who deletes a period and then finds their plan reads "not determined"
 * with no explanation has been failed by silence.
 */
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
import type { RtpHorizonBandInput } from "@/lib/rtp/fiscal-constraint";

type RouteSupabase = Awaited<ReturnType<typeof createClient>>;
type ApiAudit = ReturnType<typeof createApiAuditLogger>;

type RouteContext = { params: Promise<{ rtpCycleId: string }> };

/**
 * SQLSTATE codes this route reads. Postgres cannot say "a revenue line still
 * points at this band" in words a planner understands; the code is how the
 * route knows to say it for them.
 */
const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";
const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * The year window, mirroring the CHECK constraints in
 * `20260805000003_rtp_financial_element.sql`. Wide on purpose: an RTP horizon
 * is 20–30 years, some agencies band a plan against a historical baseline year,
 * and nothing here is jurisdiction-specific.
 */
const YEAR_MIN = 1900;
const YEAR_MAX = 2200;

/**
 * The vocabulary comes from the fiscal-constraint engine's own type rather than
 * being retyped, and `satisfies` makes the two impossible to drift apart: a
 * third basis added to `RtpHorizonBandInput["costEstimateBasis"]` fails to
 * compile here until this route accepts it too, and a value accepted here that
 * the engine does not know fails the same way.
 */
type CostEstimateBasis = RtpHorizonBandInput["costEstimateBasis"];

const COST_ESTIMATE_BASIS_MEMBERS = {
  itemized: true,
  banded: true,
} satisfies Record<CostEstimateBasis, true>;

const COST_ESTIMATE_BASES = Object.keys(COST_ESTIMATE_BASIS_MEMBERS) as [
  CostEstimateBasis,
  ...CostEstimateBasis[],
];

/** Mirrors the column DEFAULT. Stated once so the route and the schema agree. */
const DEFAULT_COST_ESTIMATE_BASIS: CostEstimateBasis = "itemized";

/**
 * Every column this route hands back. Kept as one constant so the create, the
 * update and the read-back cannot disagree about what a band is — a projection
 * that omits a column a surface renders is invisible to a mocked test and shows
 * up as `undefined` on the page.
 */
const BAND_COLUMNS =
  "id, workspace_id, rtp_cycle_id, label, start_year, end_year, escalation_target_year, cost_estimate_basis, sort_order, created_by, created_at, updated_at";

/**
 * An emptied `<input type="number">` sends `""`, and `""` means NOT SET — never
 * 0 and never 1900. Numeric strings are accepted for the same reason: the value
 * arrives from a text input, and making the form responsible for `Number()`
 * would turn the seam between this route and its editor into a source of
 * unexplained 400s. Anything else falls through unchanged so zod rejects it.
 */
function coerceOptionalYearInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
}

const yearSchema = z.number().int().min(YEAR_MIN).max(YEAR_MAX);
const nullableYearSchema = z.preprocess(coerceOptionalYearInput, z.union([yearSchema, z.null()]));
const requiredYearSchema = z.preprocess(coerceOptionalYearInput, yearSchema);

const labelSchema = z.string().trim().min(1).max(160);
const sortOrderSchema = z.number().int().min(0).max(9999);

const paramsSchema = z.object({ rtpCycleId: z.string().uuid() });

const createBandSchema = z.object({
  label: labelSchema,
  startYear: requiredYearSchema,
  endYear: requiredYearSchema,
  escalationTargetYear: nullableYearSchema.optional(),
  costEstimateBasis: z.enum(COST_ESTIMATE_BASES).optional(),
  sortOrder: sortOrderSchema.optional(),
});

const updateBandSchema = z
  .object({
    bandId: z.string().uuid(),
    label: labelSchema.optional(),
    startYear: requiredYearSchema.optional(),
    endYear: requiredYearSchema.optional(),
    escalationTargetYear: nullableYearSchema.optional(),
    costEstimateBasis: z.enum(COST_ESTIMATE_BASES).optional(),
    sortOrder: sortOrderSchema.optional(),
  })
  .refine(
    (value) =>
      Object.entries(value).some(([key, item]) => key !== "bandId" && item !== undefined),
    { message: "At least one field must be updated" }
  );

const deleteBandSchema = z.object({ bandId: z.string().uuid() });

type BandYears = {
  startYear: number;
  endYear: number;
  escalationTargetYear: number | null;
};

/**
 * The band's year rules, in a sentence. Returns null when the years are
 * coherent.
 *
 * `escalationYearWasSupplied` changes only the WORDING, and it matters: a
 * planner narrowing a band's range does not think of themselves as having
 * touched the escalation year, so the message has to point at the field they
 * did not edit rather than at the one they did.
 */
function describeBandYearProblem(
  years: BandYears,
  escalationYearWasSupplied: boolean
): string | null {
  const { startYear, endYear, escalationTargetYear } = years;

  if (endYear < startYear) {
    return (
      `A horizon period must end in the same year it starts or later, and this one runs ` +
      `${startYear} to ${endYear}. Set the end year to ${startYear} or later.`
    );
  }

  if (
    escalationTargetYear !== null &&
    (escalationTargetYear < startYear || escalationTargetYear > endYear)
  ) {
    if (escalationYearWasSupplied) {
      return (
        `The escalation target year must fall inside the period it belongs to, and ` +
        `${escalationTargetYear} is outside ${startYear}–${endYear}. Leave it empty to use the ` +
        `midpoint of the period instead.`
      );
    }
    return (
      `This period already has an escalation target year of ${escalationTargetYear}, which would ` +
      `fall outside the new range ${startYear}–${endYear}. Change or clear the escalation target ` +
      `year in the same edit.`
    );
  }

  return null;
}

type CycleAuthorization =
  | { ok: true; workspaceId: string; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Authenticate, resolve the caller's CURRENT workspace, and prove the cycle in
 * the URL belongs to it — in that order, before any write.
 *
 * The workspace is never taken from the request. It is read from the caller's
 * own membership and then used to SCOPE the cycle lookup, so a cycle in another
 * workspace is not found rather than found-and-refused. That answers 404 for
 * both "no such cycle" and "someone else's cycle", which is deliberate: a
 * distinguishable 403 would confirm the existence of other workspaces' cycles
 * to anyone willing to iterate uuids.
 */
async function authorizeCycleWrite(
  supabase: RouteSupabase,
  audit: ApiAudit,
  rtpCycleId: string
): Promise<CycleAuthorization> {
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

  // A failed read and an empty read are the same `null` here, and answering
  // "RTP cycle not found" to a query that never ran would send a planner
  // looking for a cycle that is sitting right there.
  const readFailure = classifyRouteReadFailure("the RTP cycle", cycleResult);
  if (readFailure) {
    audit.error("cycle_lookup_failed", { rtpCycleId, message: readFailure.message });
    return { ok: false, response: NextResponse.json(readFailure.body, { status: readFailure.status }) };
  }

  if (!cycleResult.data) {
    return { ok: false, response: NextResponse.json({ error: "RTP cycle not found" }, { status: 404 }) };
  }

  return { ok: true, workspaceId: membership.workspace_id, userId: user.id };
}

type StoredBand = {
  id: string;
  start_year: number;
  end_year: number;
  escalation_target_year: number | null;
};

/** Reads one band, scoped to the cycle AND the workspace that was just proven. */
async function loadBand(
  supabase: RouteSupabase,
  audit: ApiAudit,
  args: { bandId: string; rtpCycleId: string; workspaceId: string }
): Promise<{ ok: true; band: StoredBand } | { ok: false; response: NextResponse }> {
  const bandResult = await supabase
    .from("rtp_horizon_bands")
    .select(BAND_COLUMNS)
    .eq("id", args.bandId)
    .eq("rtp_cycle_id", args.rtpCycleId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  const readFailure = classifyRouteReadFailure("the horizon period", bandResult);
  if (readFailure) {
    audit.error("band_lookup_failed", { bandId: args.bandId, message: readFailure.message });
    return { ok: false, response: NextResponse.json(readFailure.body, { status: readFailure.status }) };
  }

  if (!bandResult.data) {
    return { ok: false, response: NextResponse.json({ error: "Horizon period not found" }, { status: 404 }) };
  }

  return { ok: true, band: bandResult.data as unknown as StoredBand };
}

/** The 409 body for a band a ledger line still points at, with the lines named. */
async function describeBlockingLedgerLines(
  supabase: RouteSupabase,
  bandId: string
): Promise<{ error: string; details: string; blockingLineCount: number | null }> {
  const generic =
    "Revenue or cost lines in this plan's financial element are still assigned to this period. " +
    "Move them to another period or remove them, then delete this period.";

  const linesResult = await supabase
    .from("rtp_financial_assumptions")
    .select("id, entry_kind, source_name", { count: "exact" })
    .eq("horizon_band_id", bandId)
    .limit(5);

  const rows = (linesResult?.data ?? null) as Array<{ source_name?: string | null }> | null;
  const count = typeof linesResult?.count === "number" ? linesResult.count : null;

  if (linesResult?.error || count === null || !rows) {
    // Best-effort enrichment only. The refusal itself is already established by
    // the database; failing to name the lines must not turn it into a 500.
    return { error: "This period still has money assigned to it", details: generic, blockingLineCount: null };
  }

  const names = rows
    .map((row) => (typeof row.source_name === "string" ? row.source_name.trim() : ""))
    .filter((name) => name.length > 0);

  const named =
    names.length === 0
      ? ""
      : ` (${names.join(", ")}${count > names.length ? `, and ${count - names.length} more` : ""})`;

  return {
    error: "This period still has money assigned to it",
    details:
      `${count} revenue or cost ${count === 1 ? "line is" : "lines are"} still assigned to this period` +
      `${named}. Move ${count === 1 ? "it" : "them"} to another period or remove ${count === 1 ? "it" : "them"}, ` +
      "then delete this period.",
    blockingLineCount: count,
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.horizon_bands.create", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payload = createBandSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid horizon period payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeCycleWrite(supabase, audit, parsedParams.data.rtpCycleId);
    if (!authorization.ok) return authorization.response;

    const escalationTargetYear = payload.data.escalationTargetYear ?? null;
    const yearProblem = describeBandYearProblem(
      {
        startYear: payload.data.startYear,
        endYear: payload.data.endYear,
        escalationTargetYear,
      },
      true
    );
    if (yearProblem) {
      audit.warn("year_validation_failed", { rtpCycleId: parsedParams.data.rtpCycleId });
      return NextResponse.json({ error: yearProblem }, { status: 400 });
    }

    const insertPayload = {
      // Both scoping columns come from what the route PROVED, never from the
      // body: the workspace from the caller's membership, the cycle from the URL
      // after it was confirmed to sit in that workspace.
      workspace_id: authorization.workspaceId,
      rtp_cycle_id: parsedParams.data.rtpCycleId,
      label: payload.data.label,
      start_year: payload.data.startYear,
      end_year: payload.data.endYear,
      escalation_target_year: escalationTargetYear,
      cost_estimate_basis: payload.data.costEstimateBasis ?? DEFAULT_COST_ESTIMATE_BASIS,
      sort_order: payload.data.sortOrder ?? 0,
      created_by: authorization.userId,
    };

    const { data, error } = await supabase
      .from("rtp_horizon_bands")
      .insert(insertPayload)
      .select(BAND_COLUMNS)
      .single();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return NextResponse.json(
          {
            error: "A period with this name already exists in this plan",
            details:
              "Two periods sharing one name would make every cost and revenue line ambiguous about which " +
              "period it belongs to. Give this one a different name.",
          },
          { status: 409 }
        );
      }
      audit.error("insert_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to create the horizon period" }, { status: 500 });
    }

    // An INSERT that answers PGRST116 WROTE THE ROW and could not read it back.
    // Reporting failure here is how duplicates get made.
    if (writeMatchedNoRows({ data, error })) {
      audit.warn("insert_not_readable_back", { rtpCycleId: parsedParams.data.rtpCycleId });
      return insertNotReadableBackResponse({ subject: "horizon period" });
    }

    audit.info("created", {
      rtpCycleId: parsedParams.data.rtpCycleId,
      bandId: (data as { id?: string } | null)?.id ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ band: data });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to create the horizon period" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.horizon_bands.update", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payload = updateBandSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid horizon period update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeCycleWrite(supabase, audit, parsedParams.data.rtpCycleId);
    if (!authorization.ok) return authorization.response;

    const existing = await loadBand(supabase, audit, {
      bandId: payload.data.bandId,
      rtpCycleId: parsedParams.data.rtpCycleId,
      workspaceId: authorization.workspaceId,
    });
    if (!existing.ok) return existing.response;

    // The rules are checked against the band AS IT WILL BE, not against the
    // fields this request happened to carry. Narrowing a band's range can push
    // a stored escalation year outside it, and a check that only looked at the
    // submitted fields would let that reach the database as a raw constraint
    // error.
    const escalationYearWasSupplied = payload.data.escalationTargetYear !== undefined;
    const merged: BandYears = {
      startYear: payload.data.startYear ?? existing.band.start_year,
      endYear: payload.data.endYear ?? existing.band.end_year,
      escalationTargetYear: escalationYearWasSupplied
        ? payload.data.escalationTargetYear ?? null
        : existing.band.escalation_target_year,
    };

    const yearProblem = describeBandYearProblem(merged, escalationYearWasSupplied);
    if (yearProblem) {
      audit.warn("year_validation_failed", { bandId: existing.band.id });
      return NextResponse.json({ error: yearProblem }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (payload.data.label !== undefined) updates.label = payload.data.label;
    if (payload.data.startYear !== undefined) updates.start_year = payload.data.startYear;
    if (payload.data.endYear !== undefined) updates.end_year = payload.data.endYear;
    if (escalationYearWasSupplied) {
      updates.escalation_target_year = payload.data.escalationTargetYear ?? null;
    }
    if (payload.data.costEstimateBasis !== undefined) {
      updates.cost_estimate_basis = payload.data.costEstimateBasis;
    }
    if (payload.data.sortOrder !== undefined) updates.sort_order = payload.data.sortOrder;

    // Unreachable today — the schema's refine already rejects a body carrying
    // nothing but `bandId`, and every field it accepts is mapped above. It is
    // kept because the failure it catches is silent: a field added to the schema
    // and not to this mapping would be accepted, written nowhere, and answered
    // 200, which reads to a planner as a saved edit that quietly did not happen.
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("rtp_horizon_bands")
      .update(updates)
      .eq("id", existing.band.id)
      .select(BAND_COLUMNS)
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return NextResponse.json(
          {
            error: "A period with this name already exists in this plan",
            details:
              "Two periods sharing one name would make every cost and revenue line ambiguous about which " +
              "period it belongs to. Give this one a different name.",
          },
          { status: 409 }
        );
      }
      audit.error("update_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to update the horizon period" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      // The band was read through this same caller's client moments ago and the
      // role check passed, so zero matched rows is the database refusing a write
      // the application believed was allowed — not a missing band.
      audit.error("update_matched_no_rows", {
        rtpCycleId: parsedParams.data.rtpCycleId,
        bandId: existing.band.id,
      });
      return noRowsMatchedResponse({ subject: "horizon period", targetWasVerified: true });
    }

    audit.info("updated", {
      rtpCycleId: parsedParams.data.rtpCycleId,
      bandId: existing.band.id,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ band: data });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update the horizon period" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.horizon_bands.delete", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }

    const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    if (body.parseError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const payload = deleteBandSchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid horizon period delete payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const authorization = await authorizeCycleWrite(supabase, audit, parsedParams.data.rtpCycleId);
    if (!authorization.ok) return authorization.response;

    const existing = await loadBand(supabase, audit, {
      bandId: payload.data.bandId,
      rtpCycleId: parsedParams.data.rtpCycleId,
      workspaceId: authorization.workspaceId,
    });
    if (!existing.ok) return existing.response;

    // Counted BEFORE the delete, because ON DELETE SET NULL destroys the
    // evidence: afterwards nothing records which projects used to sit here.
    const linkCountResult = await supabase
      .from("project_rtp_cycle_links")
      .select("id", { count: "exact", head: true })
      .eq("horizon_band_id", existing.band.id);

    const projectLinksUnassigned =
      linkCountResult?.error || typeof linkCountResult?.count !== "number"
        ? null
        : linkCountResult.count;

    const { data: deleted, error } = await supabase
      .from("rtp_horizon_bands")
      .delete()
      .eq("id", existing.band.id)
      .select("id")
      .maybeSingle();

    if (error?.code === POSTGRES_FOREIGN_KEY_VIOLATION) {
      // The RESTRICT fired. This is the database protecting an adopted financial
      // element, not a fault — 409, with the blocking lines named.
      const conflict = await describeBlockingLedgerLines(supabase, existing.band.id);
      audit.warn("delete_blocked_by_financial_lines", {
        rtpCycleId: parsedParams.data.rtpCycleId,
        bandId: existing.band.id,
        blockingLineCount: conflict.blockingLineCount,
      });
      return NextResponse.json(conflict, { status: 409 });
    }

    if (error && isWriteFailure(error)) {
      audit.error("delete_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to delete the horizon period" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data: deleted, error })) {
      audit.error("delete_matched_no_rows", {
        rtpCycleId: parsedParams.data.rtpCycleId,
        bandId: existing.band.id,
      });
      return noRowsMatchedResponse({ subject: "horizon period", targetWasVerified: true });
    }

    audit.info("deleted", {
      rtpCycleId: parsedParams.data.rtpCycleId,
      bandId: existing.band.id,
      projectLinksUnassigned,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      ok: true,
      bandId: existing.band.id,
      /**
       * How many programmed projects lost their period assignment. Null means
       * the count could not be read — which the surface must render as unknown,
       * never as zero.
       */
      projectLinksUnassigned,
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to delete the horizon period" }, { status: 500 });
  }
}
