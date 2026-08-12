import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { rebuildProjectRtpPosture } from "@/lib/projects/rtp-posture-writeback";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  FUNDING_AWARD_CLOSED_SPENDING_STATUS,
  FUNDING_AWARD_MATCH_POSTURE_OPTIONS,
  FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS,
  FUNDING_AWARD_RISK_FLAG_OPTIONS,
} from "@/lib/programs/catalog";

const FUNDING_AWARD_MATCH_POSTURES = FUNDING_AWARD_MATCH_POSTURE_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];
/**
 * Creation accepts only the OPEN statuses. `fully_spent` used to be here, taken
 * verbatim from a dropdown and written straight into the row, so an award could
 * be created already closed: no invoice-coverage check, no close-out milestone,
 * no RTP posture rebuild — the entire close-out contract skipped at birth, and
 * (until the PATCH route existed) permanently, because close-out answers
 * `already_closed` to every subsequent attempt.
 *
 * A brand-new award cannot earn a close-out anyway: invoices link to an award by
 * id, so a record that does not exist yet has coverage of exactly zero. The only
 * honest way to create a closed award is therefore to SAY that is what you are
 * doing — `recordClosedOnImport` below.
 */
const FUNDING_AWARD_OPEN_SPENDING_STATUSES = FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS.map(
  (option) => option.value
) as [string, ...string[]];
const FUNDING_AWARD_RISK_FLAGS = FUNDING_AWARD_RISK_FLAG_OPTIONS.map((option) => option.value) as [
  string,
  ...string[],
];

const listFundingAwardsSchema = z.object({
  projectId: z.string().uuid().optional(),
});

/**
 * The one way to create an award that is already closed, and it is an act rather
 * than a value.
 *
 * A workspace adopting OpenPlan carries history: awards that closed years ago,
 * whose reimbursement records were never in this system and never will be.
 * Refusing to let them record that would force a worse falsification — every
 * historical award parked permanently "active", or invented invoices to satisfy
 * a coverage gate. So it is allowed, named, audited under its own event, and
 * stamped on the row as `closure_basis = 'recorded_on_import'` so that no later
 * reader, report or export can mistake it for a close-out this product verified.
 *
 * The note is required and must not be blank — the same requirement the
 * `funding_awards_imported_closure_states_its_basis` CHECK enforces in the
 * database. This is the only path that declares an award closed with no
 * evidence; the minimum price is a sentence saying on what basis.
 */
const recordClosedOnImportSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

const createFundingAwardSchema = z.object({
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  awardedAmount: z.number().min(0),
  matchAmount: z.number().min(0).optional(),
  matchPosture: z.enum(FUNDING_AWARD_MATCH_POSTURES).optional(),
  obligationDueAt: z.string().datetime().optional(),
  /**
   * The LAPSE date — when the funds must be expended, which is a different
   * deadline from `obligationDueAt` with a different consequence. Optional and
   * never derived: OpenPlan has no way to know a program's lapse rule, and a
   * date it invented would be one an agency plans around.
   *
   * Unlike the obligation date this writes NO mirror milestone. The obligation
   * milestone exists for the project timeline and /my-work already de-duplicates
   * it against the award; a second auto-milestone here would put the same lapse
   * on a planner's list twice.
   */
  expenditureDeadlineAt: z.string().datetime().optional(),
  spendingStatus: z.enum(FUNDING_AWARD_OPEN_SPENDING_STATUSES).optional(),
  riskFlag: z.enum(FUNDING_AWARD_RISK_FLAGS).optional(),
  notes: z.string().trim().max(4000).optional(),
  recordClosedOnImport: recordClosedOnImportSchema.optional(),
});

/** The columns every award response echoes back. */
const FUNDING_AWARD_COLUMNS =
  "id, workspace_id, project_id, program_id, funding_opportunity_id, title, awarded_amount, match_amount, match_posture, obligation_due_at, expenditure_deadline_at, spending_status, risk_flag, notes, closure_basis, closed_at, closed_by, closure_note, reopened_at, reopened_by, reopen_reason, created_at, updated_at";

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("funding-awards.list", request);
  const startedAt = Date.now();

  try {
    const parsed = listFundingAwardsSchema.safeParse({
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
    });

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let query = supabase
      .from("funding_awards")
      .select(`${FUNDING_AWARD_COLUMNS}, funding_opportunities(id, title), programs(id, title)`);

    if (parsed.data.projectId) {
      query = query.eq("project_id", parsed.data.projectId);
    }

    query = query.order("updated_at", { ascending: false });

    const { data, error } = await query;
    if (error) {
      audit.error("funding_awards_list_failed", { message: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to load funding awards" }, { status: 500 });
    }

    return NextResponse.json({ awards: data ?? [] });
  } catch (error) {
    audit.error("funding_awards_list_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while loading funding awards" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("funding-awards.create", request);
  const startedAt = Date.now();

  try {
    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;
    const payload = payloadBody.data;

    // Caught before the schema so the refusal can say what actually happened.
    // `fully_spent` is no longer in the create enum, and a bare "Invalid funding
    // award payload" would leave a planner who genuinely is importing a closed
    // award with no idea that the product supports exactly that, by a different
    // name. A refusal that names its real reason has to name the way through.
    if (
      typeof payload === "object" &&
      payload !== null &&
      (payload as Record<string, unknown>).spendingStatus === FUNDING_AWARD_CLOSED_SPENDING_STATUS
    ) {
      audit.warn("funding_award_bare_closed_status_refused", {});
      return NextResponse.json(
        {
          error: "An award cannot be created already closed by choosing a spending status",
          details:
            "Being fully spent is the outcome of a close-out — paid invoices covering the awarded " +
            "amount, a close-out milestone on the project, the project's funding posture rebuilt — and " +
            "a new award has no invoices linked to it yet. Create the award open and close it out when " +
            "its reimbursements are paid, or, if it closed outside OpenPlan, send a " +
            "`recordClosedOnImport` intent with a written basis. That records the closure as your " +
            "statement rather than as verified coverage, and says so permanently on the record.",
        },
        { status: 422 }
      );
    }

    const parsed = createFundingAwardSchema.safeParse(payload);

    if (!parsed.success) {
      audit.warn("validation_failed", { issues: parsed.error.issues });
      return NextResponse.json({ error: "Invalid funding award payload" }, { status: 400 });
    }

    if (parsed.data.recordClosedOnImport && parsed.data.spendingStatus) {
      // Two statements about the same field. Picking a winner would mean
      // guessing which one the caller meant, about the field that decides
      // whether the award reads as closed.
      audit.warn("funding_award_conflicting_closure_intents", {
        spendingStatus: parsed.data.spendingStatus,
      });
      return NextResponse.json(
        {
          error: "Conflicting spending-status intents",
          details:
            "This request both sets a spending status and records the award as closed on import. Send " +
            "one or the other, so the record states what was actually decided.",
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

    const access = await loadProjectAccess(supabase, parsed.data.projectId, user.id, "programs.write");
    if (access.error) {
      audit.error("funding_award_project_access_failed", {
        projectId: parsed.data.projectId,
        userId: user.id,
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

    const importedClosure = parsed.data.recordClosedOnImport ?? null;
    const importedClosureAtIso = importedClosure ? new Date().toISOString() : null;

    const { data: award, error } = await supabase
      .from("funding_awards")
      .insert({
        workspace_id: access.project.workspace_id,
        project_id: access.project.id,
        funding_opportunity_id: parsed.data.opportunityId ?? null,
        program_id: parsed.data.programId ?? null,
        title: parsed.data.title.trim(),
        awarded_amount: parsed.data.awardedAmount,
        match_amount: parsed.data.matchAmount ?? 0,
        match_posture: parsed.data.matchPosture ?? "partial",
        obligation_due_at: parsed.data.obligationDueAt ?? null,
        expenditure_deadline_at: parsed.data.expenditureDeadlineAt ?? null,
        // The status and the closure provenance are written together, never
        // apart: the schema's coherence CHECK refuses `fully_spent` with no
        // basis, so an asserted closure carries its own account or the insert
        // fails loudly instead of producing a closure nobody can explain.
        spending_status: importedClosure
          ? FUNDING_AWARD_CLOSED_SPENDING_STATUS
          : parsed.data.spendingStatus ?? "not_started",
        closure_basis: importedClosure ? "recorded_on_import" : null,
        closed_at: importedClosureAtIso,
        closed_by: importedClosure ? user.id : null,
        closure_note: importedClosure ? importedClosure.note : null,
        risk_flag: parsed.data.riskFlag ?? "none",
        notes: parsed.data.notes?.trim() || null,
        created_by: user.id,
      })
      .select(FUNDING_AWARD_COLUMNS)
      .single();

    if (error || !award) {
      audit.error("funding_award_insert_failed", {
        projectId: parsed.data.projectId,
        userId: user.id,
        message: error?.message ?? "unknown",
        code: error?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to create funding award" }, { status: 500 });
    }

    audit.info("funding_award_created", {
      awardId: award.id,
      userId: user.id,
      workspaceId: access.project.workspace_id,
      closureBasis: importedClosure ? "recorded_on_import" : null,
      durationMs: Date.now() - startedAt,
    });

    if (importedClosure) {
      // Its own event, distinct from creation and from
      // `funding_award_closeout_completed`. An award that was born closed on
      // someone's word is a materially different thing from one this product
      // closed on verified coverage, and an audit trail that logs them under the
      // same code loses exactly the distinction the row was just given.
      audit.info("funding_award_recorded_closed_on_import", {
        awardId: award.id,
        projectId: access.project.id,
        workspaceId: access.project.workspace_id,
        userId: user.id,
        closureBasis: "recorded_on_import",
        closureNote: importedClosure.note,
        closedAt: importedClosureAtIso,
      });
    }

    if (parsed.data.obligationDueAt) {
      const obligationTargetDate = parsed.data.obligationDueAt.slice(0, 10);
      const { error: milestoneError } = await supabase.from("project_milestones").insert({
        project_id: access.project.id,
        funding_award_id: award.id,
        title: `Obligation: ${parsed.data.title.trim()}`,
        summary: "Auto-generated from funding award obligation deadline.",
        milestone_type: "obligation",
        phase_code: "programming",
        status: "scheduled",
        target_date: obligationTargetDate,
        created_by: user.id,
      });

      if (milestoneError) {
        audit.warn("funding_award_obligation_milestone_failed", {
          awardId: award.id,
          projectId: access.project.id,
          message: milestoneError.message,
          code: milestoneError.code ?? null,
        });
      } else {
        audit.info("funding_award_obligation_milestone_created", {
          awardId: award.id,
          projectId: access.project.id,
          targetDate: obligationTargetDate,
        });
      }
    }

    const postureResult = await rebuildProjectRtpPosture({
      supabase,
      projectId: access.project.id,
      workspaceId: access.project.workspace_id,
    });

    if (postureResult.error) {
      audit.warn("rtp_posture_rebuild_failed", {
        awardId: award.id,
        projectId: access.project.id,
        workspaceId: access.project.workspace_id,
        message: postureResult.error.message,
        code: postureResult.error.code ?? null,
      });
    } else {
      audit.info("rtp_posture_rebuilt", {
        awardId: award.id,
        projectId: access.project.id,
        workspaceId: access.project.workspace_id,
        status: postureResult.posture?.status ?? "unknown",
        pipelineStatus: postureResult.posture?.pipelineStatus ?? "unknown",
        committedFundingAmount: postureResult.posture?.committedFundingAmount ?? 0,
        fundingNeedAmount: postureResult.posture?.fundingNeedAmount ?? 0,
      });
    }

    return NextResponse.json(
      {
        awardId: award.id,
        award,
        closureBasis: importedClosure ? "recorded_on_import" : null,
        // Said in the response, not only stored on the row, so a client cannot
        // report this outcome in the words it uses for an earned close-out.
        ...(importedClosure
          ? {
              details:
                "Created and recorded as closed on your statement. No invoice coverage was checked and " +
                "no close-out milestone was filed, and this award will read as an imported closure " +
                "wherever it is shown.",
            }
          : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("funding_award_create_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while creating funding award" }, { status: 500 });
  }
}
