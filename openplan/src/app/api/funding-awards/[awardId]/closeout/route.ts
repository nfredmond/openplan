import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadProjectAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { noRowsMatchedResponse } from "@/lib/http/write-outcome";
import { FUNDING_AWARD_CLOSED_SPENDING_STATUS } from "@/lib/programs/catalog";
import {
  CLOSEABLE_FUNDING_AWARD_COLUMNS,
  evaluateFundingAwardCloseoutCoverage,
  recordEarnedFundingAwardCloseout,
  type CloseableFundingAward,
} from "../award-closure";

/**
 * The EARNED close-out: an award becomes fully spent because its paid invoices
 * cover the awarded amount, verified here rather than asserted by the caller.
 *
 * The coverage arithmetic and the act of closing both live in `../award-closure`
 * so that this route and the PATCH on the award itself cannot drift into two
 * different answers to "is this covered" or two different ideas of what closing
 * does. The asserted, import-time closure is a different act and is NOT reachable
 * from here — see the PATCH route.
 */

const awardIdSchema = z.object({
  awardId: z.string().uuid(),
});

const closeoutPayloadSchema = z
  .object({
    notes: z.string().trim().max(4000).optional(),
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

    if (!evaluation.earned) {
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

    const closeout = await recordEarnedFundingAwardCloseout({
      supabase,
      award: closeableAward,
      userId: user.id,
      notes,
      coverage,
      audit,
    });

    if (closeout.outcome === "write_failed") {
      return NextResponse.json({ error: "Failed to update funding award" }, { status: 500 });
    }

    if (closeout.outcome === "no_rows_matched") {
      return noRowsMatchedResponse({ subject: "funding award", targetWasVerified: true });
    }

    audit.info("funding_award_closeout_route_completed", {
      awardId: closeableAward.id,
      projectId: closeableAward.project_id,
      userId: user.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        awardId: closeableAward.id,
        closureBasis: "earned_coverage",
        coverage,
        closedAt: closeout.closedAt,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("funding_award_closeout_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error during funding award closeout" }, { status: 500 });
  }
}
