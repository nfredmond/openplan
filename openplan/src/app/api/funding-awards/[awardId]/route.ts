import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import {
  FUNDING_AWARD_CLOSED_SPENDING_STATUS,
  FUNDING_AWARD_MATCH_POSTURE_OPTIONS,
  FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS,
  FUNDING_AWARD_RISK_FLAG_OPTIONS,
  FUNDING_AWARD_SPENDING_STATUS_OPTIONS,
  formatFundingAwardClosureBasisLabel,
} from "@/lib/programs/catalog";
import {
  CLOSEABLE_FUNDING_AWARD_COLUMNS,
  evaluateFundingAwardCloseoutCoverage,
  rebuildFundingAwardProjectPosture,
  recordEarnedFundingAwardCloseout,
  type CloseableFundingAward,
} from "./award-closure";

/**
 * EDITING AN AWARD, including the one field that used to be a one-way door.
 *
 * THE DEFECT THIS ROUTE EXISTS FOR. `funding_awards` had a create route, a
 * close-out route, and nothing else. `spending_status` was accepted verbatim at
 * creation, `fully_spent` among its values, so an award could be born closed —
 * no coverage check, no close-out milestone, no RTP posture rebuild, the whole
 * close-out contract skipped. And with no PATCH, that was permanent: the
 * close-out route answers `already_closed` to every subsequent attempt, so a
 * mis-click on a dropdown closed an award forever, in a product whose entire
 * grants lane reports off that field.
 *
 * THE THREE WAYS THIS ROUTE CHANGES `spending_status`, and why they are three
 * and not one:
 *
 *   1. `spendingStatus` to an OPEN value (not started / active / delayed).
 *      An ordinary edit. Refused on an award that is currently closed — see 3.
 *
 *   2. `spendingStatus: "fully_spent"`. The earned close-out, and it runs
 *      through exactly the gate `POST .../closeout` runs through, because both
 *      call `evaluateFundingAwardCloseoutCoverage` and then
 *      `recordEarnedFundingAwardCloseout`. There is no second definition of
 *      "covered" and no second, lighter way to close an award: a PATCH that set
 *      the status without filing the close-out milestone would be the original
 *      defect wearing a different verb.
 *
 *   3. `recordClosedOnImport`. The one path that closes an award WITHOUT
 *      coverage, and the reason this route was allowed to exist at all: a
 *      workspace adopting OpenPlan carries awards that closed years ago, whose
 *      invoices were never in this system. Refusing to let them say so forces a
 *      worse lie — every historical award parked permanently "active", or
 *      invented invoice rows to satisfy a gate. So it is permitted, but never as
 *      a bare status value: it is its own named intent, it requires a written
 *      basis, it gets its own audit event, and it stamps
 *      `closure_basis = 'recorded_on_import'` on the row so that no later reader
 *      can mistake it for an earned close-out.
 *
 *   4. `reopen`. Discussed at `reopenIntentSchema` below.
 *
 * ROLE GATING is `programs.write` — owner, admin, member — the same action the
 * create and close-out routes use, through the same `loadProjectAccess` loader
 * the write-role guard recognises. Gating the corrective paths (re-open,
 * import-closure) behind a NARROWER role was considered and rejected: a member
 * can close an award, so a member who mis-closes one must be able to correct it,
 * or the trap this route exists to remove is simply re-set for most of the
 * workspace. What makes an undo safe is that it is named, reasoned and audited,
 * not that few people can reach it. If a future change wants a distinct action
 * for it, that belongs in `src/lib/auth/role-matrix.ts`, not in an ad-hoc role
 * comparison here.
 */

const awardIdSchema = z.object({
  awardId: z.string().uuid(),
});

const FUNDING_AWARD_MATCH_POSTURES = FUNDING_AWARD_MATCH_POSTURE_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];
const FUNDING_AWARD_SPENDING_STATUSES = FUNDING_AWARD_SPENDING_STATUS_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];
const FUNDING_AWARD_OPEN_SPENDING_STATUSES = FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS.map(
  (option) => option.value
) as [string, ...string[]];
const FUNDING_AWARD_RISK_FLAGS = FUNDING_AWARD_RISK_FLAG_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];

/**
 * The asserted closure. The note is REQUIRED and must not be blank, matching the
 * `funding_awards_imported_closure_states_its_basis` CHECK: this is the only way
 * to declare an award closed with no evidence, and the minimum price of that is
 * a sentence saying on whose authority. A blank one would leave a later reader
 * with a closure, an author, a date — and no account of any of it.
 */
const recordClosedOnImportSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

/**
 * THE RE-OPEN, and the argument for allowing it.
 *
 * The case against is real: a close-out is a compliance statement, and letting
 * it be undone means the statement can be withdrawn. The case for is stronger,
 * on two counts.
 *
 * First, the defect being fixed here is that a closure was uncorrectable. Adding
 * a way to assert a closure without earning it, and NOT adding a way to undo
 * one, would leave the trap exactly where it was and add a faster route into it.
 *
 * Second, and more importantly, awards genuinely do re-open. A funder
 * de-obligates. An audit claws money back. An amendment adds scope to a closed
 * phase. A final invoice is rejected after sign-off. A system that cannot
 * represent that forces the planner to falsify something else — usually a
 * duplicate award record — which is a worse corruption of the register than the
 * one it avoids.
 *
 * So it is allowed, and it is expensive on purpose: its own named intent, a
 * required written reason, a required destination status (the route will not
 * guess whether a re-opened award is "active" or "delayed" — that is a claim
 * about the work, and only the planner knows it), its own audit event, and three
 * columns on the row that SURVIVE a later re-close. The close-out milestone
 * already filed on the project is deliberately left in place: it records that a
 * close-out happened on a date, which stays true, and deleting it would erase
 * the very history this is trying to preserve.
 */
const reopenIntentSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  spendingStatus: z.enum(FUNDING_AWARD_OPEN_SPENDING_STATUSES),
});

const patchFundingAwardSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    awardedAmount: z.number().min(0).optional(),
    matchAmount: z.number().min(0).optional(),
    matchPosture: z.enum(FUNDING_AWARD_MATCH_POSTURES).optional(),
    // Nullable, not merely optional: clearing an obligation date is a real edit,
    // and `undefined` (leave alone) has to stay distinguishable from `null`
    // (there is no obligation deadline).
    obligationDueAt: z.string().datetime().nullable().optional(),
    /**
     * The lapse date — when an unspent balance goes back to the funder
     * (`expenditure_deadline_at`, 20260812000010).
     *
     * It was accepted at creation and NOWHERE ELSE, which made the whole
     * expenditure-reminder lane unreachable for every award that already
     * existed: there was no request that could give one a lapse date, ever.
     * Nullable for the same reason `obligationDueAt` is — clearing a deadline
     * that no longer applies is a real edit, and `undefined` (leave alone) must
     * stay distinguishable from `null` (there is none).
     */
    expenditureDeadlineAt: z.string().datetime().nullable().optional(),
    spendingStatus: z.enum(FUNDING_AWARD_SPENDING_STATUSES).optional(),
    riskFlag: z.enum(FUNDING_AWARD_RISK_FLAGS).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    /**
     * The close-out note, which is NOT `notes`. `notes` is a column on the
     * award; this becomes the close-out milestone's summary. They were briefly
     * the same field, which meant a planner editing an award's notes while
     * closing it wrote a compliance sign-off they never composed.
     */
    closeoutNote: z.string().trim().max(4000).optional(),
    recordClosedOnImport: recordClosedOnImportSchema.optional(),
    reopen: reopenIntentSchema.optional(),
  })
  .strict();

/** Payload keys that describe an ordinary column edit rather than an intent. */
const FIELD_EDIT_KEYS = [
  "title",
  "awardedAmount",
  "matchAmount",
  "matchPosture",
  "obligationDueAt",
  "expenditureDeadlineAt",
  "riskFlag",
  "notes",
] as const;

type RouteContext = {
  params: Promise<{ awardId: string }>;
};

/** The columns every response echoes back, so a client never has to re-read. */
const PATCH_RESPONSE_COLUMNS = CLOSEABLE_FUNDING_AWARD_COLUMNS;

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-awards.update", request);
  const startedAt = Date.now();

  try {
    const params = await context.params;
    const parsedParams = awardIdSchema.safeParse(params);

    if (!parsedParams.success) {
      audit.warn("validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid award identifier" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsed = patchFundingAwardSchema.safeParse(payloadBody.data ?? {});
    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid funding award payload" }, { status: 400 });
    }

    const payload = parsed.data;

    // Two statements about the same field in one request. Picking a winner would
    // mean guessing which one the caller meant, and the field in question is the
    // one that decides whether an award reads as closed.
    const closureIntents = [
      payload.spendingStatus !== undefined ? "spendingStatus" : null,
      payload.recordClosedOnImport ? "recordClosedOnImport" : null,
      payload.reopen ? "reopen" : null,
    ].filter((intent): intent is string => intent !== null);

    if (closureIntents.length > 1) {
      audit.warn("funding_award_conflicting_closure_intents", { intents: closureIntents });
      return NextResponse.json(
        {
          error: "Conflicting spending-status intents",
          details: `This request carries more than one instruction about the award's spending status (${closureIntents.join(
            ", "
          )}). Send exactly one, so the record states what was actually decided.`,
        },
        { status: 400 }
      );
    }

    // A close-out note with no close-out would be accepted, stored nowhere, and
    // reported as success — which is how a planner ends up believing they filed
    // a sign-off that does not exist.
    if (payload.closeoutNote !== undefined && payload.spendingStatus !== FUNDING_AWARD_CLOSED_SPENDING_STATUS) {
      return NextResponse.json(
        {
          error: "A close-out note belongs to a close-out",
          details:
            "`closeoutNote` becomes the close-out milestone's summary, and this request is not closing " +
            "the award. Use `notes` for the award's own notes, or send `spendingStatus: \"fully_spent\"`.",
        },
        { status: 400 }
      );
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json(
        {
          error: "Nothing to change",
          details: "This request named no field to update, so nothing was saved.",
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

    const { data: awardRow, error: awardError } = await supabase
      .from("funding_awards")
      .select(CLOSEABLE_FUNDING_AWARD_COLUMNS)
      .eq("id", parsedParams.data.awardId)
      .maybeSingle();

    if (awardError) {
      audit.error("funding_award_load_failed", {
        awardId: parsedParams.data.awardId,
        message: awardError.message,
        code: awardError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load funding award" }, { status: 500 });
    }

    if (!awardRow) {
      return NextResponse.json({ error: "Funding award not found" }, { status: 404 });
    }

    // The `.select()` string above is not checked against the schema — Supabase
    // clients here are deliberately untyped — so the row is cast once, where it
    // enters typed code, rather than at each use.
    const award = awardRow as unknown as CloseableFundingAward;

    const access = await loadProjectAccess(supabase, award.project_id, user.id, "programs.write");
    if (access.error) {
      audit.error("funding_award_project_access_failed", {
        awardId: award.id,
        projectId: award.project_id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify project access" }, { status: 500 });
    }

    if (!access.project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const isClosed = award.spending_status === FUNDING_AWARD_CLOSED_SPENDING_STATUS;

    if (payload.reopen) {
      return await handleReopen({ supabase, audit, award, isClosed, user, payload, startedAt });
    }

    if (payload.recordClosedOnImport) {
      return await handleRecordClosedOnImport({
        supabase,
        audit,
        award,
        isClosed,
        user,
        payload,
        startedAt,
      });
    }

    if (payload.spendingStatus === FUNDING_AWARD_CLOSED_SPENDING_STATUS) {
      // Field edits are refused ALONGSIDE an earned close-out rather than merged
      // into it. The close-out writes through the shared
      // `recordEarnedFundingAwardCloseout`, which owns its own UPDATE, so
      // carrying edits into it would mean either a second write (two statements,
      // one of which can fail after the other landed) or edits quietly dropped.
      // A refusal that names the two requests is better than either.
      const alsoEditing = FIELD_EDIT_KEYS.filter((key) => payload[key] !== undefined);
      if (alsoEditing.length > 0) {
        audit.warn("funding_award_closeout_with_field_edits_refused", { fields: alsoEditing });
        return NextResponse.json(
          {
            error: "Closing an award is its own act",
            details: `This request also edits ${alsoEditing.join(
              ", "
            )}. Send those edits first, then close the award, so neither is applied on the strength of the other.`,
          },
          { status: 400 }
        );
      }

      return await handleEarnedCloseout({ supabase, audit, award, isClosed, user, payload, startedAt });
    }

    // A bare status change AWAY from closed. Refused, and the refusal names the
    // intent that does the job: silently letting a status edit reverse a
    // compliance sign-off would leave an award that had been closed, then
    // wasn't, with nothing on the row to say a close-out ever happened.
    if (isClosed && payload.spendingStatus !== undefined) {
      audit.warn("funding_award_bare_reopen_refused", {
        awardId: award.id,
        requestedStatus: payload.spendingStatus,
        closureBasis: award.closure_basis ?? null,
      });
      return NextResponse.json(
        {
          error: "A closed award cannot be re-opened by a status edit",
          details:
            "This award is recorded as fully spent, and changing that is not an ordinary field edit — " +
            "it withdraws a close-out. Send a `reopen` intent with a written reason and the status the " +
            "award returns to, so the re-opening is on the record.",
          closureBasis: award.closure_basis ?? null,
        },
        { status: 409 }
      );
    }

    return await handleFieldEdit({ supabase, audit, award, isClosed, user, payload, startedAt });
  } catch (error) {
    audit.error("funding_award_update_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while updating funding award" }, { status: 500 });
  }
}

type HandlerInput = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  audit: ReturnType<typeof createApiAuditLogger>;
  award: CloseableFundingAward;
  isClosed: boolean;
  user: { id: string };
  payload: z.infer<typeof patchFundingAwardSchema>;
  startedAt: number;
};

/**
 * The ordinary, non-status fields of the payload, as a database patch.
 *
 * Built by presence rather than by value so that `null` (clear this) and
 * `undefined` (leave it alone) stay different things all the way to the write.
 */
function buildFieldPatch(payload: z.infer<typeof patchFundingAwardSchema>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (payload.title !== undefined) patch.title = payload.title.trim();
  if (payload.awardedAmount !== undefined) patch.awarded_amount = payload.awardedAmount;
  if (payload.matchAmount !== undefined) patch.match_amount = payload.matchAmount;
  if (payload.matchPosture !== undefined) patch.match_posture = payload.matchPosture;
  if (payload.obligationDueAt !== undefined) patch.obligation_due_at = payload.obligationDueAt;
  if (payload.expenditureDeadlineAt !== undefined) patch.expenditure_deadline_at = payload.expenditureDeadlineAt;
  if (payload.riskFlag !== undefined) patch.risk_flag = payload.riskFlag;
  if (payload.notes !== undefined) patch.notes = payload.notes ? payload.notes.trim() : null;

  return patch;
}

/**
 * Whether this patch moves money, and therefore whether the project's RTP
 * funding posture is now stale.
 *
 * Only the amounts and the risk/obligation signals feed the posture
 * (`buildProjectFundingStackSummary`), so a title or notes edit does not need a
 * rebuild. Rebuilding on every edit would be harmless but dishonest in a
 * different way: the audit log would claim a posture recomputation happened
 * because of a typo fix.
 */
function patchAffectsFundingPosture(patch: Record<string, unknown>): boolean {
  return (
    "awarded_amount" in patch ||
    "match_amount" in patch ||
    "risk_flag" in patch ||
    "obligation_due_at" in patch
  );
}

async function applyFundingAwardPatch({
  supabase,
  audit,
  award,
  patch,
  auditEvent,
  auditContext,
}: {
  supabase: HandlerInput["supabase"];
  audit: HandlerInput["audit"];
  award: CloseableFundingAward;
  patch: Record<string, unknown>;
  auditEvent: string;
  auditContext: Record<string, unknown>;
}): Promise<{ outcome: "failed"; response: NextResponse } | { outcome: "saved"; award: unknown }> {
  const updateResult = await supabase
    .from("funding_awards")
    .update(patch)
    .eq("id", award.id)
    .eq("workspace_id", award.workspace_id)
    .select(PATCH_RESPONSE_COLUMNS)
    .maybeSingle();

  if (isWriteFailure(updateResult.error)) {
    audit.error("funding_award_update_failed", {
      awardId: award.id,
      message: updateResult.error?.message ?? "unknown",
      code: updateResult.error?.code ?? null,
    });
    return {
      outcome: "failed",
      response: NextResponse.json({ error: "Failed to update funding award" }, { status: 500 }),
    };
  }

  // This route read the row through the caller's own client and passed the
  // membership and role checks before writing, so zero matched rows is not "no
  // such award" — it is the database refusing a write the application believed
  // was allowed, which write-outcome.ts answers as a disclosed 500.
  if (writeMatchedNoRows(updateResult)) {
    audit.error("funding_award_update_matched_no_rows", {
      awardId: award.id,
      workspaceId: award.workspace_id,
    });
    return {
      outcome: "failed",
      response: noRowsMatchedResponse({ subject: "funding award", targetWasVerified: true }),
    };
  }

  audit.info(auditEvent, auditContext);

  return { outcome: "saved", award: updateResult.data };
}

async function handleFieldEdit({
  supabase,
  audit,
  award,
  user,
  payload,
  startedAt,
}: HandlerInput): Promise<NextResponse> {
  const patch = buildFieldPatch(payload);

  if (payload.spendingStatus !== undefined) {
    patch.spending_status = payload.spendingStatus;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      {
        error: "Nothing to change",
        details: "This request named no field to update, so nothing was saved.",
      },
      { status: 400 }
    );
  }

  const result = await applyFundingAwardPatch({
    supabase,
    audit,
    award,
    patch,
    auditEvent: "funding_award_updated",
    auditContext: {
      awardId: award.id,
      projectId: award.project_id,
      userId: user.id,
      fields: Object.keys(patch),
      durationMs: Date.now() - startedAt,
    },
  });

  if (result.outcome === "failed") return result.response;

  if (patchAffectsFundingPosture(patch)) {
    await rebuildFundingAwardProjectPosture({ supabase, award, audit });
  }

  return NextResponse.json({ awardId: award.id, award: result.award }, { status: 200 });
}

async function handleEarnedCloseout({
  supabase,
  audit,
  award,
  isClosed,
  user,
  payload,
  startedAt,
}: HandlerInput): Promise<NextResponse> {
  const evaluation = await evaluateFundingAwardCloseoutCoverage({ supabase, award });

  if (evaluation.outcome === "read_failed") {
    audit.error("funding_award_invoice_load_failed", {
      awardId: award.id,
      message: evaluation.message,
      code: evaluation.code,
    });
    return NextResponse.json({ error: "Failed to load linked invoices" }, { status: 500 });
  }

  const { coverage } = evaluation;

  if (isClosed) {
    audit.info("funding_award_closeout_already_complete", {
      awardId: award.id,
      projectId: award.project_id,
      closureBasis: award.closure_basis ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        awardId: award.id,
        status: "already_closed",
        closureBasis: award.closure_basis ?? null,
        coverage,
      },
      { status: 200 }
    );
  }

  if (!evaluation.earned) {
    audit.warn("funding_award_closeout_blocked", {
      awardId: award.id,
      projectId: award.project_id,
      awardedAmount: coverage.awardedAmount,
      paidAmount: coverage.paidAmount,
      outstandingAmount: coverage.outstandingAmount,
    });
    // The refusal names the one legitimate alternative rather than leaving the
    // planner to conclude the product cannot record their situation. It does NOT
    // suggest it as a way around the gate: the sentence says what the import
    // path actually records, so choosing it is choosing to be marked as an
    // assertion.
    return NextResponse.json(
      {
        error: "Closeout requires 100% paid invoice coverage against the awarded amount",
        details:
          "If this award closed outside OpenPlan and its invoices were never recorded here, send a " +
          "`recordClosedOnImport` intent with a written basis instead. That marks the award closed on " +
          "your statement rather than on verified coverage, and says so permanently on the record.",
        coverage,
      },
      { status: 422 }
    );
  }

  const closeout = await recordEarnedFundingAwardCloseout({
    supabase,
    award,
    userId: user.id,
    notes: payload.closeoutNote?.trim() || null,
    coverage,
    audit,
  });

  if (closeout.outcome === "write_failed") {
    return NextResponse.json({ error: "Failed to update funding award" }, { status: 500 });
  }

  if (closeout.outcome === "no_rows_matched") {
    return noRowsMatchedResponse({ subject: "funding award", targetWasVerified: true });
  }

  audit.info("funding_award_closed_via_patch", {
    awardId: award.id,
    projectId: award.project_id,
    userId: user.id,
    closureBasis: "earned_coverage",
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(
    {
      awardId: award.id,
      closureBasis: "earned_coverage",
      coverage,
      closedAt: closeout.closedAt,
    },
    { status: 200 }
  );
}

async function handleRecordClosedOnImport({
  supabase,
  audit,
  award,
  isClosed,
  user,
  payload,
  startedAt,
}: HandlerInput): Promise<NextResponse> {
  const intent = payload.recordClosedOnImport;
  if (!intent) {
    // Unreachable through PATCH, which only routes here when the intent is
    // present; kept as a total function rather than a non-null assertion.
    return NextResponse.json({ error: "Missing import-closure intent" }, { status: 400 });
  }

  if (isClosed) {
    audit.warn("funding_award_import_closure_refused_already_closed", {
      awardId: award.id,
      closureBasis: award.closure_basis ?? null,
    });
    return NextResponse.json(
      {
        error: "This award is already recorded as fully spent",
        details: `Its closure is on record as “${formatFundingAwardClosureBasisLabel(
          award.closure_basis
        )}”. Recording a second closure over it would overwrite that provenance. Re-open the award first if the existing closure is wrong.`,
        closureBasis: award.closure_basis ?? null,
      },
      { status: 409 }
    );
  }

  const closedAtIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    ...buildFieldPatch(payload),
    spending_status: FUNDING_AWARD_CLOSED_SPENDING_STATUS,
    closure_basis: "recorded_on_import",
    closed_at: closedAtIso,
    closed_by: user.id,
    closure_note: intent.note,
  };

  const result = await applyFundingAwardPatch({
    supabase,
    audit,
    award,
    patch,
    // Its own event, distinct from `funding_award_closeout_completed`. An
    // asserted closure and an earned one must not share an audit code, or the
    // log loses the distinction the row was just given.
    auditEvent: "funding_award_recorded_closed_on_import",
    auditContext: {
      awardId: award.id,
      projectId: award.project_id,
      workspaceId: award.workspace_id,
      userId: user.id,
      closureBasis: "recorded_on_import",
      closureNote: intent.note,
      closedAt: closedAtIso,
      durationMs: Date.now() - startedAt,
    },
  });

  if (result.outcome === "failed") return result.response;

  // The posture rebuild runs; the close-out MILESTONE deliberately does not. A
  // milestone titled "Closeout" with status complete is a compliance sign-off on
  // this project's timeline, and nobody performed one — the workspace stated that
  // one happened elsewhere, before OpenPlan. Filing it anyway would put a
  // manufactured record on the project, which is the exact failure this whole
  // change exists to prevent.
  await rebuildFundingAwardProjectPosture({ supabase, award, audit });

  return NextResponse.json(
    {
      awardId: award.id,
      closureBasis: "recorded_on_import",
      closedAt: closedAtIso,
      closureNote: intent.note,
      // Said plainly in the response, not only in the row, so a client cannot
      // render this outcome with the same words it uses for an earned close-out.
      details:
        "Recorded as closed on your statement. No invoice coverage was checked and no close-out " +
        "milestone was filed, and this award will read as an imported closure wherever it is shown.",
      award: result.award,
    },
    { status: 200 }
  );
}

async function handleReopen({
  supabase,
  audit,
  award,
  isClosed,
  user,
  payload,
  startedAt,
}: HandlerInput): Promise<NextResponse> {
  const intent = payload.reopen;
  if (!intent) {
    return NextResponse.json({ error: "Missing reopen intent" }, { status: 400 });
  }

  if (!isClosed) {
    return NextResponse.json(
      {
        error: "This award is not closed",
        details:
          "Re-opening withdraws a close-out, and this award has none to withdraw. Change its spending " +
          "status directly instead.",
        spendingStatus: award.spending_status,
      },
      { status: 409 }
    );
  }

  const reopenedAtIso = new Date().toISOString();
  const priorClosureBasis = award.closure_basis ?? null;

  // The closure columns are cleared because the award is no longer closed and
  // the schema's coherence CHECK requires them to move together. What is NOT
  // cleared is the re-open trio: it survives a later re-close, so the fact that
  // this award was once closed and then re-opened stays legible on the row for
  // good. The prior basis is carried into the audit event, since the row can no
  // longer hold it.
  const patch: Record<string, unknown> = {
    ...buildFieldPatch(payload),
    spending_status: intent.spendingStatus,
    closure_basis: null,
    closed_at: null,
    closed_by: null,
    closure_note: null,
    reopened_at: reopenedAtIso,
    reopened_by: user.id,
    reopen_reason: intent.reason,
  };

  const result = await applyFundingAwardPatch({
    supabase,
    audit,
    award,
    patch,
    auditEvent: "funding_award_reopened",
    auditContext: {
      awardId: award.id,
      projectId: award.project_id,
      workspaceId: award.workspace_id,
      userId: user.id,
      priorClosureBasis,
      priorClosedAt: award.closed_at ?? null,
      reopenReason: intent.reason,
      reopenedAt: reopenedAtIso,
      spendingStatus: intent.spendingStatus,
      durationMs: Date.now() - startedAt,
    },
  });

  if (result.outcome === "failed") return result.response;

  await rebuildFundingAwardProjectPosture({ supabase, award, audit });

  return NextResponse.json(
    {
      awardId: award.id,
      status: "reopened",
      priorClosureBasis,
      reopenedAt: reopenedAtIso,
      spendingStatus: intent.spendingStatus,
      // Disclosed rather than quietly true: any close-out milestone already
      // filed on the project stays filed. It records that a close-out happened
      // on a date, which is still a fact; deleting it would erase history to
      // make the project timeline tidier.
      details:
        "Re-opened. Any close-out milestone already filed on this project is left in place — it records " +
        "that a close-out happened, which re-opening does not undo.",
      award: result.award,
    },
    { status: 200 }
  );
}
