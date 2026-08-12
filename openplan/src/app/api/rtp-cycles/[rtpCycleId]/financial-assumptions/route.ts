/**
 * The financial ledger of an RTP cycle: revenue, operations and maintenance,
 * and other cost lines, each attached to one horizon band.
 *
 * This is the write door for `rtp_financial_assumptions`, the table
 * `src/lib/rtp/fiscal-constraint.ts` reads to answer the one question a funder
 * verifies and a board votes on — 23 CFR 450.324(f)(11)'s demonstration that
 * the adopted plan can be paid for. Everything defensive in here exists because
 * a wrong number on that page is worse than no number: it produces a plan that
 * looks affordable and is not, and nobody looks again.
 *
 * THE DEFECT THIS ROUTE IS SHAPED AROUND — CROSS-CYCLE ATTRIBUTION.
 * `horizon_band_id` has a foreign key to `rtp_horizon_bands`, and a foreign key
 * asks only "does this band exist". It does NOT ask "does it belong to the
 * cycle this money is being recorded against". An agency running a 2026 RTP and
 * a 2030 RTP in one workspace has bands in both, and a stale band id — a form
 * left open on the other plan's page, a copied request, a future agent — would
 * pass the foreign key and land a revenue line in the wrong plan's wrong
 * period. The constraint check would then report both plans confidently and
 * both would be wrong, with nothing in either row to show it. So every write
 * here re-reads the band filtered by `rtp_cycle_id` AND `workspace_id` before
 * touching the ledger, and a band that does not answer that query is refused.
 *
 * WHY `loadCurrentWorkspaceMembership` RATHER THAN A WORKSPACE FROM THE BODY.
 * The workspace is never something the caller states. It is derived from the
 * session's active-workspace selection, and the cycle is then re-read filtered
 * by it — so a cycle id belonging to somebody else's workspace resolves to
 * nothing rather than to a permission check that could be got wrong.
 *
 * AMOUNTS: ABSENT IS NOT ZERO, AND NEGATIVE IS NOT SMALLER.
 * `amount` is required — a ledger line whose figure nobody knows is a line you
 * do not add yet. A negative amount is refused outright rather than stored,
 * because it does not read as an error in any total: it silently offsets a real
 * revenue or cost line somewhere else in the same sum, and the resulting
 * balance looks like arithmetic that worked.
 *
 * A LINE COPIED OUT OF AN ADOPTED PLAN COMES THROUGH THIS SAME DOOR.
 * `fromExtractionCandidateId` names a transcription a planner reviewed on the
 * document-review screen; everything else about the request is identical, and
 * so is everything this route does with it. The cross-cycle band check, the
 * amount ceiling, the negative refusal and every 400 above apply to a figure
 * read off page 112 exactly as they apply to one somebody typed — there is no
 * second writer, so there is no second set of rules to get wrong. The only
 * additions are the `extraction_candidate_id` written beside the row, which is
 * what lets a board packet print "2026 RTP, p. 112" against the number, and the
 * flip that marks the transcription reviewed.
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
import type { RtpFiscalEntryKind } from "@/lib/rtp/fiscal-constraint";
import {
  completeExtractionAcceptance,
  extractionProvenanceColumns,
  resolveExtractionCandidate,
} from "@/lib/rtp/extraction/acceptance";

/**
 * The ledger's vocabulary, keyed BY the fiscal engine's own union so the
 * COMPILER keeps the two in step rather than a convention nobody can police.
 *
 * A fourth `RtpFiscalEntryKind` added to `fiscal-constraint.ts` makes this
 * object fail to type-check until it is listed here — which is the point.
 * A kind the engine understands and this route rejects is a ledger line a
 * planner cannot record; a kind this route accepts and the engine does not is
 * money that vanishes from the constraint check without anything saying so.
 * The labels are the words a planner would use for each side of the ledger and
 * are rendered into the 400 that explains what was accepted.
 */
const ENTRY_KIND_LABELS: Record<RtpFiscalEntryKind, string> = {
  revenue: "reasonably available revenue",
  operations_maintenance: "operations and maintenance cost",
  other_cost: "other cost, such as debt service or a reserve",
};

const RTP_FISCAL_ENTRY_KINDS = Object.keys(ENTRY_KIND_LABELS) as [
  RtpFiscalEntryKind,
  ...RtpFiscalEntryKind[],
];

function describeAcceptedEntryKinds(): string {
  return (Object.entries(ENTRY_KIND_LABELS) as Array<[RtpFiscalEntryKind, string]>)
    .map(([kind, label]) => `${kind} (${label})`)
    .join("; ");
}

/**
 * The ceiling `amount NUMERIC(16, 2)` can hold, kept a little under the
 * column's true maximum so an over-large figure lands in a 400 a planner can
 * read instead of a Postgres `numeric field overflow` this route would have to
 * report as a server fault. Fourteen integer digits is $99 trillion — beyond
 * any regional programme, and the last magnitude a float64 still carries
 * exactly.
 */
const MAX_LEDGER_AMOUNT = 99_999_999_999_999;

const NEGATIVE_AMOUNT_MESSAGE =
  "amount must be zero or greater. A negative revenue or cost line does not read as an error in any total — it silently offsets a real line somewhere else in the same sum — so it is refused rather than stored. Record the offsetting item as its own line instead.";

const NOT_A_NUMBER_MESSAGE =
  "amount must be a number of dollars in constant (base-year) dollars. An amount nobody knows yet is a line you do not add yet, never a zero.";

const amountSchema = z
  .number({ message: NOT_A_NUMBER_MESSAGE })
  .min(0, { message: NEGATIVE_AMOUNT_MESSAGE })
  .max(MAX_LEDGER_AMOUNT, {
    message: `amount must be at most ${MAX_LEDGER_AMOUNT}; the ledger column holds fourteen digits before the decimal point.`,
  });

/**
 * A year, or nothing at all.
 *
 * An emptied year field arrives from a form as `""`. Coercing that to a number
 * gives 0, and a basis year of zero would date the money to nowhere. Empty
 * means UNSTATED, which is null — and the fiscal engine already knows what to
 * do with an unstated basis year: fall back to the cycle's, and disclose that
 * it did.
 */
const optionalYearSchema = z
  .union([
    z.number().int().min(1900).max(2200),
    z.null(),
    z.literal("").transform(() => null),
  ])
  .optional();

const optionalNotesSchema = z.union([z.string().trim().max(4000), z.null()]).optional();

const sourceNameSchema = z.string().trim().min(1).max(200);

const paramsSchema = z.object({ rtpCycleId: z.string().uuid() });

/**
 * The transcription this value was copied from, when there was one.
 *
 * Optional and absent for every hand-typed line, which is why nothing else in
 * this file changes shape: a request without it takes the identical path it
 * took before the document-ingestion lane existed.
 */
const fromExtractionCandidateIdSchema = z.string().uuid().optional();

const createAssumptionSchema = z.object({
  horizonBandId: z.string().uuid(),
  entryKind: z.enum(RTP_FISCAL_ENTRY_KINDS),
  sourceName: sourceNameSchema,
  amount: amountSchema,
  amountBasisYear: optionalYearSchema,
  notes: optionalNotesSchema,
  fromExtractionCandidateId: fromExtractionCandidateIdSchema,
});

/**
 * Everything PATCH may change. Named so the "no changes" refinement cannot
 * drift from the schema — and note what is NOT in it:
 * `fromExtractionCandidateId` is provenance, never an edit. A body naming a
 * transcription and changing no value is the ordinary "No changes were
 * requested" 400 it has always been, because the alternative is a candidate
 * marked accepted while the ledger still shows the planner's old figure.
 */
const UPDATABLE_FIELDS = [
  "horizonBandId",
  "entryKind",
  "sourceName",
  "amount",
  "amountBasisYear",
  "notes",
] as const;

const updateAssumptionSchema = z
  .object({
    assumptionId: z.string().uuid(),
    horizonBandId: z.string().uuid().optional(),
    entryKind: z.enum(RTP_FISCAL_ENTRY_KINDS).optional(),
    sourceName: sourceNameSchema.optional(),
    amount: amountSchema.optional(),
    amountBasisYear: optionalYearSchema,
    notes: optionalNotesSchema,
    fromExtractionCandidateId: fromExtractionCandidateIdSchema,
  })
  .refine((value) => UPDATABLE_FIELDS.some((field) => value[field] !== undefined), {
    message: "No changes were requested",
  });

const deleteAssumptionSchema = z.object({ assumptionId: z.string().uuid() });

const ASSUMPTION_COLUMNS =
  "id, workspace_id, rtp_cycle_id, horizon_band_id, entry_kind, source_name, amount, amount_basis_year, notes, created_at, updated_at";

type RouteContext = { params: Promise<{ rtpCycleId: string }> };
type RouteSupabase = Awaited<ReturnType<typeof createClient>>;
type RouteAudit = ReturnType<typeof createApiAuditLogger>;

/** The Postgres codes this route can say something specific about. */
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

type PostgrestErrorLike = { code?: string | null; message?: string | null } | null | undefined;

/**
 * A write the database refused, reported as what it was.
 *
 * The two named codes are both reachable through an ordinary race rather than
 * through a bug: a band deleted between this route's verification and its
 * insert gives 23503, and a value the CHECK constraints reject gives 23514.
 * Collapsing either into "Failed to save" would send a planner looking for a
 * server outage that did not happen.
 */
function ledgerWriteFailureResponse(error: PostgrestErrorLike, verb: "save" | "update"): NextResponse {
  if (error?.code === FOREIGN_KEY_VIOLATION) {
    return NextResponse.json(
      {
        error: "That horizon band is no longer part of this plan",
        details:
          "The period this line belongs to was removed while the line was being saved, so nothing was written. Reload the financial plan and choose a period that still exists.",
      },
      { status: 409 },
    );
  }

  if (error?.code === CHECK_VIOLATION) {
    return NextResponse.json(
      {
        error: "The ledger refused one of these values",
        details:
          "Something in this line is outside what the financial ledger accepts — an amount below zero, an empty source name, or a basis year outside 1900–2200. Nothing was saved.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ error: `Failed to ${verb} this financial assumption` }, { status: 500 });
}

type WritableCycle = {
  userId: string;
  workspaceId: string;
  role: string;
  cycleId: string;
};

type Resolved<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

/**
 * Who is asking, which workspace they are working in, and whether this cycle is
 * one of that workspace's — in that order, and never from the request body.
 *
 * The cycle read is filtered by `workspace_id`, so a cycle id from another
 * workspace resolves to no row and answers 404. That is deliberate rather than
 * a 403: distinguishing "not yours" from "does not exist" would confirm the
 * existence of other agencies' plans to anyone willing to guess ids.
 */
async function resolveWritableCycle(
  supabase: RouteSupabase,
  audit: RouteAudit,
  rtpCycleId: string,
): Promise<Resolved<WritableCycle>> {
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

  // A read that FAILED reaches the same `!cycle` branch a read that found
  // nothing reaches. Answering 404 for both would tell a planner their own
  // adopted plan does not exist, on the strength of a question the database
  // never answered.
  const cycleFailure = classifyRouteReadFailure("the RTP cycle", cycleResult, {
    pendingError: "The RTP financial plan schema is not available yet",
    pendingHint: "Apply Supabase migration 20260805000003, then try again.",
  });
  if (cycleFailure) {
    audit.error("cycle_lookup_failed", {
      rtpCycleId,
      workspaceId: membership.workspace_id,
      message: cycleFailure.message,
    });
    return { ok: false, response: NextResponse.json(cycleFailure.body, { status: cycleFailure.status }) };
  }

  const cycle = cycleResult.data as { id: string; workspace_id: string } | null;
  if (!cycle) {
    return { ok: false, response: NextResponse.json({ error: "RTP cycle not found" }, { status: 404 }) };
  }

  return {
    ok: true,
    value: {
      userId: user.id,
      workspaceId: membership.workspace_id,
      role: membership.role,
      cycleId: cycle.id,
    },
  };
}

/**
 * THE CROSS-CYCLE CHECK. The most load-bearing query in this file.
 *
 * The band is re-read filtered by BOTH `rtp_cycle_id` and `workspace_id`, so a
 * band that exists — and therefore satisfies the foreign key perfectly well —
 * but belongs to another plan cycle answers no row and is refused. Dropping
 * either filter would let money be attributed to a period of a plan the
 * planner is not looking at, and every fiscal-constraint figure computed
 * afterwards on either plan would be wrong with nothing in the data to show it.
 */
async function resolveHorizonBandInCycle(
  supabase: RouteSupabase,
  audit: RouteAudit,
  cycle: WritableCycle,
  horizonBandId: string,
): Promise<Resolved<string>> {
  const bandResult = await supabase
    .from("rtp_horizon_bands")
    .select("id, rtp_cycle_id, workspace_id")
    .eq("id", horizonBandId)
    .eq("rtp_cycle_id", cycle.cycleId)
    .eq("workspace_id", cycle.workspaceId)
    .maybeSingle();

  const bandFailure = classifyRouteReadFailure("the horizon band", bandResult, {
    pendingError: "The RTP financial plan schema is not available yet",
    pendingHint: "Apply Supabase migration 20260805000003, then try again.",
  });
  if (bandFailure) {
    audit.error("horizon_band_lookup_failed", {
      rtpCycleId: cycle.cycleId,
      horizonBandId,
      message: bandFailure.message,
    });
    return { ok: false, response: NextResponse.json(bandFailure.body, { status: bandFailure.status }) };
  }

  const band = bandResult.data as { id: string } | null;
  if (!band) {
    audit.warn("horizon_band_not_in_cycle", { rtpCycleId: cycle.cycleId, horizonBandId });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "That period is not part of this plan",
          details:
            "The horizon band this line was going to be recorded against belongs to a different plan cycle, or no longer exists. Nothing was saved — money recorded against another plan's period would make both plans' fiscal-constraint figures wrong.",
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, value: band.id };
}

/** The parsed request body, or the 400/413 that says why there isn't one. */
async function readLedgerBody(request: NextRequest, audit: RouteAudit): Promise<Resolved<unknown>> {
  const body = await readJsonWithLimit(request, BODY_LIMITS.smallJson);
  if (!body.ok) return { ok: false, response: body.response };

  if (body.parseError) {
    audit.warn("body_parse_failed", { message: body.parseError.message });
    return {
      ok: false,
      response: NextResponse.json({ error: "The request body was not valid JSON" }, { status: 400 }),
    };
  }

  return { ok: true, value: body.data };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.financial_assumptions.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }

    const body = await readLedgerBody(request, audit);
    if (!body.ok) return body.response;

    const payload = createAssumptionSchema.safeParse(body.value);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        {
          error: "Invalid financial assumption payload",
          details: payload.error.issues.map((issue) => issue.message).join(" "),
          acceptedEntryKinds: describeAcceptedEntryKinds(),
        },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const cycle = await resolveWritableCycle(supabase, audit, routeParams.data.rtpCycleId);
    if (!cycle.ok) return cycle.response;

    const band = await resolveHorizonBandInCycle(supabase, audit, cycle.value, payload.data.horizonBandId);
    if (!band.ok) return band.response;

    // Resolved BEFORE the insert, so a transcription that is not this plan's,
    // is already reviewed, or was staged for another part of the plan refuses
    // without writing anything. Answers `{ candidate: null }` for the ordinary
    // hand-typed line and issues no query at all.
    const candidate = await resolveExtractionCandidate({
      supabase: supabase as unknown as Parameters<typeof resolveExtractionCandidate>[0]["supabase"],
      audit,
      candidateId: payload.data.fromExtractionCandidateId,
      targetKind: "financial_line",
      rtpCycleId: cycle.value.cycleId,
      workspaceId: cycle.value.workspaceId,
    });
    if (!candidate.ok) return candidate.response;

    const { data, error } = await supabase
      .from("rtp_financial_assumptions")
      .insert({
        // Every scoping column is set from what the server resolved, never from
        // the body — the body names only which band, and that has just been
        // proven to belong to this cycle in this workspace.
        workspace_id: cycle.value.workspaceId,
        rtp_cycle_id: cycle.value.cycleId,
        horizon_band_id: band.value,
        entry_kind: payload.data.entryKind,
        source_name: payload.data.sourceName,
        amount: payload.data.amount,
        amount_basis_year: payload.data.amountBasisYear ?? null,
        notes: payload.data.notes || null,
        created_by: cycle.value.userId,
        ...extractionProvenanceColumns(candidate.candidate),
      })
      .select(ASSUMPTION_COLUMNS)
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("insert_failed", { error: error.message, code: error.code ?? null });
      return ledgerWriteFailureResponse(error, "save");
    }

    if (writeMatchedNoRows({ data, error })) {
      // An INSERT that reads back nothing means the row LANDED and the select
      // after it could not see it. Reporting a failure here is how duplicate
      // revenue lines get made.
      audit.warn("insert_not_readable_back", {
        rtpCycleId: cycle.value.cycleId,
        workspaceId: cycle.value.workspaceId,
      });
      return insertNotReadableBackResponse({ subject: "financial assumption" });
    }

    const acceptance = await completeExtractionAcceptance({
      audit,
      candidate: candidate.candidate,
      acceptedRowId: (data as { id?: string } | null)?.id,
      reviewedBy: cycle.value.userId,
      context: { rtpCycleId: cycle.value.cycleId },
    });

    audit.info("created", {
      rtpCycleId: cycle.value.cycleId,
      horizonBandId: band.value,
      entryKind: payload.data.entryKind,
      extractionCandidateId: candidate.candidate?.id ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ assumption: data, ...acceptance });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to save this financial assumption" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.financial_assumptions.update", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }

    const body = await readLedgerBody(request, audit);
    if (!body.ok) return body.response;

    const payload = updateAssumptionSchema.safeParse(body.value);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        {
          error: "Invalid financial assumption update payload",
          details: payload.error.issues.map((issue) => issue.message).join(" "),
          acceptedEntryKinds: describeAcceptedEntryKinds(),
        },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const cycle = await resolveWritableCycle(supabase, audit, routeParams.data.rtpCycleId);
    if (!cycle.ok) return cycle.response;

    const existingResult = await supabase
      .from("rtp_financial_assumptions")
      .select("id, rtp_cycle_id, workspace_id")
      .eq("id", payload.data.assumptionId)
      .eq("rtp_cycle_id", cycle.value.cycleId)
      .eq("workspace_id", cycle.value.workspaceId)
      .maybeSingle();

    const existingFailure = classifyRouteReadFailure("the financial assumption", existingResult);
    if (existingFailure) {
      audit.error("assumption_lookup_failed", {
        rtpCycleId: cycle.value.cycleId,
        assumptionId: payload.data.assumptionId,
        message: existingFailure.message,
      });
      return NextResponse.json(existingFailure.body, { status: existingFailure.status });
    }

    const existing = existingResult.data as { id: string } | null;
    if (!existing) {
      return NextResponse.json({ error: "Financial assumption not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    if (payload.data.horizonBandId !== undefined) {
      // Re-verified on every update, not only on create. A line moved between
      // periods is exactly where a stale band id from the other plan arrives.
      const band = await resolveHorizonBandInCycle(supabase, audit, cycle.value, payload.data.horizonBandId);
      if (!band.ok) return band.response;
      updates.horizon_band_id = band.value;
    }

    if (payload.data.entryKind !== undefined) updates.entry_kind = payload.data.entryKind;
    if (payload.data.sourceName !== undefined) updates.source_name = payload.data.sourceName;
    if (payload.data.amount !== undefined) updates.amount = payload.data.amount;
    if (payload.data.amountBasisYear !== undefined) updates.amount_basis_year = payload.data.amountBasisYear;
    if (payload.data.notes !== undefined) updates.notes = payload.data.notes || null;

    // The reconciliation case: the adopted document disagrees with a figure
    // already in the ledger, and the planner is taking the document's. The line
    // now cites the page it came from, replacing whatever provenance it had —
    // which for a hand-typed line was none.
    const candidate = await resolveExtractionCandidate({
      supabase: supabase as unknown as Parameters<typeof resolveExtractionCandidate>[0]["supabase"],
      audit,
      candidateId: payload.data.fromExtractionCandidateId,
      targetKind: "financial_line",
      rtpCycleId: cycle.value.cycleId,
      workspaceId: cycle.value.workspaceId,
    });
    if (!candidate.ok) return candidate.response;
    Object.assign(updates, extractionProvenanceColumns(candidate.candidate));

    const { data, error } = await supabase
      .from("rtp_financial_assumptions")
      .update(updates)
      .eq("id", existing.id)
      // Scoped again on the way out, so a row that moved cycles between the
      // read above and this write cannot be edited through this cycle's door.
      .eq("rtp_cycle_id", cycle.value.cycleId)
      .eq("workspace_id", cycle.value.workspaceId)
      .select(ASSUMPTION_COLUMNS)
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("update_failed", { error: error.message, code: error.code ?? null });
      return ledgerWriteFailureResponse(error, "update");
    }

    if (writeMatchedNoRows({ data, error })) {
      audit.error("update_matched_no_rows", {
        rtpCycleId: cycle.value.cycleId,
        assumptionId: existing.id,
        role: cycle.value.role,
      });
      return noRowsMatchedResponse({ subject: "financial assumption", targetWasVerified: true });
    }

    const acceptance = await completeExtractionAcceptance({
      audit,
      candidate: candidate.candidate,
      acceptedRowId: existing.id,
      reviewedBy: cycle.value.userId,
      context: { rtpCycleId: cycle.value.cycleId },
    });

    audit.info("updated", {
      rtpCycleId: cycle.value.cycleId,
      assumptionId: existing.id,
      fields: Object.keys(updates),
      extractionCandidateId: candidate.candidate?.id ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ assumption: data, ...acceptance });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update this financial assumption" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.financial_assumptions.delete", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }

    const body = await readLedgerBody(request, audit);
    if (!body.ok) return body.response;

    const payload = deleteAssumptionSchema.safeParse(body.value);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid delete payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const cycle = await resolveWritableCycle(supabase, audit, routeParams.data.rtpCycleId);
    if (!cycle.ok) return cycle.response;

    const existingResult = await supabase
      .from("rtp_financial_assumptions")
      .select("id, rtp_cycle_id, workspace_id")
      .eq("id", payload.data.assumptionId)
      .eq("rtp_cycle_id", cycle.value.cycleId)
      .eq("workspace_id", cycle.value.workspaceId)
      .maybeSingle();

    const existingFailure = classifyRouteReadFailure("the financial assumption", existingResult);
    if (existingFailure) {
      audit.error("assumption_lookup_failed", {
        rtpCycleId: cycle.value.cycleId,
        assumptionId: payload.data.assumptionId,
        message: existingFailure.message,
      });
      return NextResponse.json(existingFailure.body, { status: existingFailure.status });
    }

    const existing = existingResult.data as { id: string } | null;
    if (!existing) {
      return NextResponse.json({ error: "Financial assumption not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("rtp_financial_assumptions")
      .delete()
      .eq("id", existing.id)
      .eq("rtp_cycle_id", cycle.value.cycleId)
      .eq("workspace_id", cycle.value.workspaceId)
      .select("id")
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("delete_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to remove this financial assumption" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      // The row was read through the caller's own client a moment ago and the
      // role check passed, so a delete that matched nothing is the database
      // refusing a write the application believed was allowed.
      audit.error("delete_matched_no_rows", {
        rtpCycleId: cycle.value.cycleId,
        assumptionId: existing.id,
        role: cycle.value.role,
      });
      return noRowsMatchedResponse({ subject: "financial assumption", targetWasVerified: true });
    }

    audit.info("deleted", {
      rtpCycleId: cycle.value.cycleId,
      assumptionId: existing.id,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, assumptionId: existing.id });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to remove this financial assumption" }, { status: 500 });
  }
}
