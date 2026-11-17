import { managedCloseout } from "@/lib/grants/award-handoff-server";
import { readAssistantExecutionSource } from "@/lib/assistant/action-approval-server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { FUNDING_AWARD_CLOSED_SPENDING_STATUS } from "@/lib/programs/catalog";
import {
  CLOSEABLE_FUNDING_AWARD_COLUMNS,
  actOnFundingAwardClosure,
  evaluateFundingAwardCloseoutCoverage,
  type CloseableFundingAward,
} from "../award-closure";

/**
 * The close-out an award reaches through its requests: EARNED, when paid
 * requests cover the awarded amount, or RECONCILED, when the award finished
 * under its ceiling and the rest is released with a written note. Either way
 * every linked request must be paid or rejected first.
 *
 * The coverage arithmetic and the act of closing both live in `../award-closure`
 * so that this route and the PATCH on the award itself cannot drift into two
 * different answers to "is this covered" or two different ideas of what closing
 * does. The SQL command repeats the checks inside its transaction. The asserted,
 * import-time closure is a different act and is NOT reachable from here; see the
 * PATCH route.
 */

const awardIdSchema = z.object({
  awardId: z.string().uuid(),
});

const closeoutPayloadSchema = z
  .object({
    expectedCurrentRevisionId:z.string().uuid().optional(),
    notes: z.string().trim().max(4000).optional(),
    // earned_coverage (default): paid requests cover the ceiling.
    // reconciled_with_balance: the award finished under its ceiling; the rest
    // is released. Needs a note.
    basis: z.enum(["earned_coverage", "reconciled_with_balance"]).optional(),
  })
  .optional();

type RouteContext = {
  params: Promise<{ awardId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-awards.closeout", request);
  const startedAt = Date.now();

  try {
    const params = await context.params;
    const parsedParams = awardIdSchema.safeParse(params);

    if (!parsedParams.success) {
      audit.warn("validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid award identifier" }, { status: 400 });
    }

    const payloadJsonBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadJsonBody.ok) return payloadJsonBody.response;

    const payloadJson = payloadJsonBody.data;
    const parsedPayload = closeoutPayloadSchema.safeParse(payloadJson ?? undefined);
    if (!parsedPayload.success) {
      audit.warn("validation_failed", { issues: parsedPayload.error.issues });
      return NextResponse.json({ error: "Invalid closeout payload" }, { status: 400 });
    }
    const notes = parsedPayload.data?.notes?.trim() || null;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: award, error: awardError } = await supabase
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

    if (!award) {
      return NextResponse.json({ error: "Funding award not found" }, { status: 404 });
    }

    // The select string above is not schema-checked (Supabase clients here are
    // deliberately untyped), so the row is cast at the one place it enters typed
    // code rather than at each use.
    const closeableAward = award as unknown as CloseableFundingAward;

    const access = await loadProjectAccess(supabase, closeableAward.project_id, user.id, "programs.write");
    if (access.error) {
      audit.error("funding_award_project_access_failed", {
        awardId: closeableAward.id,
        projectId: closeableAward.project_id,
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

    const basis = parsedPayload.data?.basis ?? "earned_coverage";

    if (closeableAward.latest_handoff_revision_id) {
      if (basis !== "earned_coverage") return NextResponse.json({error:"An award with award conditions closes on paid coverage through its version-bound close-out."},{status:422});
      if (readAssistantExecutionSource(request)!=="manual") return NextResponse.json({error:"Managed closeout requires a manual operation; no registered agent action covers it."},{status:403});
      return managedCloseout({actorId:user.id,awardId:closeableAward.id,expectedRevisionId:parsedPayload.data?.expectedCurrentRevisionId,event:"earned_coverage",note:notes});
    }
    const evaluation = await evaluateFundingAwardCloseoutCoverage({
      supabase,
      award: closeableAward,
    });

    if (evaluation.outcome === "read_failed") {
      audit.error("funding_award_invoice_load_failed", {
        awardId: closeableAward.id,
        message: evaluation.message,
        code: evaluation.code,
      });
      return NextResponse.json({ error: "Failed to load linked invoices" }, { status: 500 });
    }

    const { coverage } = evaluation;

    // "Already closed" is settled BEFORE the coverage gate, and the order is
    // load-bearing now that an award can be recorded as closed on import. Such
    // an award is closed and has no paid invoices at all, so a coverage-first
    // route would answer a planner clicking Close out with "coverage is short" —
    // a refusal that is arithmetically true and, about the thing they asked,
    // false. Nothing is written on this branch either way, so the gate has
    // nothing to protect here.
    if (closeableAward.spending_status === FUNDING_AWARD_CLOSED_SPENDING_STATUS) {
      audit.info("funding_award_closeout_already_complete", {
        awardId: closeableAward.id,
        projectId: closeableAward.project_id,
        closureBasis: closeableAward.closure_basis ?? null,
        awardedAmount: coverage.awardedAmount,
        paidAmount: coverage.paidAmount,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          awardId: closeableAward.id,
          status: "already_closed",
          // How it became closed, not only that it is. An award recorded as
          // closed on import answers this route with `already_closed` exactly
          // like an earned one does, and before the basis existed those two
          // responses were indistinguishable — which is how an asserted closure
          // came to read as a verified one on every surface downstream.
          closureBasis: closeableAward.closure_basis ?? null,
          coverage,
        },
        { status: 200 }
      );
    }

    if (evaluation.openCount > 0) {
      audit.warn("funding_award_closeout_blocked_open_requests", {
        awardId: closeableAward.id,
        openCount: evaluation.openCount,
      });
      return NextResponse.json(
        {
          error: "Close-out needs every linked request paid or rejected",
          details: `${evaluation.openCount} linked ${evaluation.openCount === 1 ? "request is" : "requests are"} still a draft, in review, submitted or approved for payment. Mark each one paid or rejected, or unlink a draft that will not be sent.`,
          openCount: evaluation.openCount,
          coverage,
        },
        { status: 422 }
      );
    }

    if (basis === "earned_coverage" && !evaluation.earned) {
      audit.warn("funding_award_closeout_blocked", {
        awardId: closeableAward.id,
        projectId: closeableAward.project_id,
        awardedAmount: coverage.awardedAmount,
        paidAmount: coverage.paidAmount,
        outstandingAmount: coverage.outstandingAmount,
      });
      return NextResponse.json(
        {
          error: "Closeout requires 100% paid invoice coverage against the awarded amount",
          coverage,
        },
        { status: 422 }
      );
    }

    if (basis === "reconciled_with_balance" && !evaluation.reconcilable) {
      return NextResponse.json(
        {
          error:
            coverage.awardedAmount > 0
              ? "Paid requests reach the award ceiling; use the ordinary close-out"
              : "Record a positive award ceiling before closing with a balance released",
          coverage,
        },
        { status: 422 }
      );
    }

    if (basis === "reconciled_with_balance" && !notes) {
      return NextResponse.json(
        { error: "Closing with a balance released needs a note saying why the rest is not claimed", coverage },
        { status: 422 }
      );
    }

    if (basis === "earned_coverage" && coverage.paidAmount > coverage.awardedAmount && !notes) {
      return NextResponse.json(
        {
          error: "Paid requests exceed the award ceiling; state the basis (for example, an amendment) in the close-out note",
          coverage,
        },
        { status: 422 }
      );
    }

    const act = await actOnFundingAwardClosure({
      supabase,
      award: closeableAward,
      userId: user.id,
      event: basis,
      note: notes,
      audit,
    });

    if (act.outcome === "refused") {
      return NextResponse.json({ error: act.message, details: act.detail ?? undefined, coverage }, { status: act.status });
    }

    if (act.result.status === "already_closed") {
      return NextResponse.json(
        { awardId: closeableAward.id, status: "already_closed", closureBasis: act.result.closureBasis ?? null, coverage },
        { status: 200 }
      );
    }

    audit.info("funding_award_closeout_route_completed", {
      awardId: closeableAward.id,
      projectId: closeableAward.project_id,
      userId: user.id,
      closureBasis: basis,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        awardId: closeableAward.id,
        closureBasis: basis,
        coverage,
        closedAt: act.result.closedAt ?? null,
        releasedAmount: typeof act.result.released === "string" ? Number(act.result.released) : null,
        milestoneFiled: act.result.milestoneFiled === true,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("funding_award_closeout_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error during funding award closeout" }, { status: 500 });
  }
}
