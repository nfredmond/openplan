/**
 * Scaffold an RTP cycle's horizon periods FROM ITS OWN DECLARED HORIZON.
 *
 * This is the one band-creation shape the 2026-08-05 analysis permitted the
 * Planner Agent to propose, and the reason it is a DEDICATED route rather
 * than a mode on the sibling POST is the whole design: the sibling's body
 * schema is exactly the field set this action must make unsupplyable (label,
 * years, escalation year, basis, sort order). Here the body carries a
 * PROFILE KEY and nothing else. Every year is computed from
 * `rtp_cycles.horizon_start_year/horizon_end_year` — refusing when the cycle
 * has not declared them — labels are derived from those years, and
 * `escalation_target_year` is written as the literal `null` below with NO
 * code path able to set it.
 *
 * WHY THE NULL IS LOAD-BEARING. A band's escalation target year is what flips
 * `expenditureYearAssumed` to false in `buildRtpFiscalConstraint`, and that
 * flag is what keeps the "midpoint of the period was assumed" caveat on the
 * PUBLIC draft-review document. A scaffold that could supply the year would
 * be deleting a caveat on a public page — the machine-translation refusal
 * wearing this module's clothes. `rtp-scaffolded-bands-carry-no-escalation-
 * year.test.ts` pins both the literal and the absence of any body path to it.
 *
 * WHY AN OCCUPIED CYCLE IS REFUSED rather than merged into. The scaffold's
 * honesty rests on the agency editing what it created; scaffolding INTO a
 * cycle that already has periods would interleave derived bands with authored
 * ones (and 23P01/23505 would refuse most of them anyway, leaving a partial
 * scaffold). "This plan already has periods" is a true sentence and the safe
 * one, so it is the answer — and it also makes the assistant's offer honest,
 * because the offer keys on the fiscal engine's `no_horizon_bands` blocker.
 *
 * The refusal is count-then-insert, not a database constraint, so it has a
 * race window: a manual band created through the sibling POST between the
 * count and the insert coexists with the scaffold IF it lies entirely
 * outside the declared horizon (an in-horizon band necessarily overlaps a
 * scaffold that covers the whole horizon, and the 23P01 exclusion then
 * rejects the scaffold's single atomic insert in full). The window is
 * accepted rather than locked away: nothing is lost, every scaffolded row
 * still carries the null escalation year, and the plan simply holds one
 * authored out-of-horizon band beside the derived ones — a state the band
 * editor renders honestly.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  readAssistantExecutionSource,
  verifyAssistantActionApproval,
  type AssistantApprovalVerification,
} from "@/lib/assistant/action-approval-server";
import { assistantActionAuditIdentity, withAssistantActionAudit } from "@/lib/observability/action-audit";
import { refuseOutOfScopeAgentRequest } from "@/lib/assistant/agent-request-scope";
import { USER_AUTHORED } from "@/lib/assistant/agent-principal";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { isWriteFailure } from "@/lib/http/write-outcome";
import { authorizeRtpCycleWrite } from "@/lib/rtp/cycle-write-authorization";
import {
  getHorizonBandingProfile,
  HORIZON_BANDING_PROFILE_KEYS,
} from "@/lib/rtp/horizon-banding-profiles";

type RouteContext = { params: Promise<{ rtpCycleId: string }> };

const paramsSchema = z.object({ rtpCycleId: z.string().uuid() });

/**
 * The whole body. `workspaceId` is accepted because the action payload carries
 * it, but the write below never reads it — scoping comes from what the route
 * PROVES (membership + the cycle row). There is deliberately no label, year,
 * escalation, basis or sort field to accept.
 */
const bodySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  bandingProfileKey: z.enum(HORIZON_BANDING_PROFILE_KEYS),
});

/**
 * Exactly the body keys the `create_rtp_horizon_bands_from_cycle_horizon`
 * action maps onto this endpoint. The approval hash covers the action the
 * route rebuilds, not the request body, so a request smuggling extra keys
 * would hash identically to what the planner approved — this is where those
 * keys are refused instead.
 */
const AGENT_SCAFFOLD_BODY_KEYS = ["workspaceId", "bandingProfileKey"];

const BAND_COLUMNS =
  "id, rtp_cycle_id, label, start_year, end_year, escalation_target_year, cost_estimate_basis, sort_order";

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.horizon_bands.scaffold", request);
  const startedAt = Date.now();

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid RTP cycle id" }, { status: 400 });
    }
    const rtpCycleId = parsedParams.data.rtpCycleId;

    const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;

    const payload = bodySchema.safeParse(body.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        {
          error: "Invalid scaffold payload",
          hint: `bandingProfileKey must be one of: ${HORIZON_BANDING_PROFILE_KEYS.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    // Checked against the RAW body, before any database work: zod has already
    // stripped unknown keys from `payload.data`, and a scope check over the
    // stripped object would approve everything it was written to catch.
    const executionSource = readAssistantExecutionSource(request);
    const agentSourced = executionSource === "planner_agent_quick_link";
    const scopeRefusal = refuseOutOfScopeAgentRequest({
      executionSource,
      body: body.data,
      allowedKeys: AGENT_SCAFFOLD_BODY_KEYS,
      actionKind: "create_rtp_horizon_bands_from_cycle_horizon",
    });
    if (scopeRefusal) {
      audit.warn("agent_request_out_of_scope", {
        rtpCycleId,
        rejectedKeys: scopeRefusal.rejectedKeys,
      });
      return NextResponse.json({ error: scopeRefusal.error, details: scopeRefusal.details }, { status: 400 });
    }

    const supabase = await createClient();
    // The cast is the repo's untyped-client convention: comparing the full
    // client generic against the lib's structural type trips TS2589.
    const authorization = await authorizeRtpCycleWrite(
      supabase as unknown as Parameters<typeof authorizeRtpCycleWrite>[0],
      audit,
      rtpCycleId,
      { cycleColumns: "id, workspace_id, horizon_start_year, horizon_end_year" }
    );
    if (!authorization.ok) return authorization.response;

    const horizonStartYear = authorization.cycle.horizon_start_year;
    const horizonEndYear = authorization.cycle.horizon_end_year;
    if (typeof horizonStartYear !== "number" || typeof horizonEndYear !== "number") {
      // The rtp_cycles CHECK makes the pair null together, so one message
      // covers both. 422: the request was well-formed; the CYCLE is not ready.
      return NextResponse.json(
        {
          error: "This plan has not declared its horizon years yet",
          details:
            "Periods are derived from the plan's own horizon, so there is nothing to derive them from. " +
            "Set the horizon start and end years on the RTP cycle, then scaffold its periods.",
        },
        { status: 422 }
      );
    }

    // An occupied cycle is refused, not merged into — see the header.
    const existingBands = await supabase
      .from("rtp_horizon_bands")
      .select("id", { count: "exact", head: true })
      .eq("rtp_cycle_id", rtpCycleId)
      .eq("workspace_id", authorization.workspaceId);
    const bandCountFailure = classifyRouteReadFailure("the plan's existing periods", {
      data: [],
      error: existingBands.error,
    });
    if (bandCountFailure) {
      audit.error("existing_band_count_failed", { rtpCycleId, message: bandCountFailure.message });
      return NextResponse.json(bandCountFailure.body, { status: bandCountFailure.status });
    }
    if ((existingBands.count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: "This plan already has horizon periods",
          details:
            "Scaffolding writes a fresh set of periods for an empty plan. This plan already has " +
            `${existingBands.count} — edit them in the periods editor instead.`,
        },
        { status: 409 }
      );
    }

    /**
     * Approval evidence, verified against the action this route rebuilds from
     * what it PROVED: the workspace from the caller's membership, the cycle
     * from the URL after it was confirmed to sit in that workspace, and the
     * profile key from the parsed body. An approval minted for one plan or one
     * profile cannot execute another.
     */
    const serviceSupabase = agentSourced ? createServiceRoleClient() : null;
    let approval: AssistantApprovalVerification = {
      approvalId: null,
      inputHash: null,
      executionSource: "manual",
      authorship: USER_AUTHORED,
    };

    if (agentSourced && serviceSupabase) {
      try {
        approval = await verifyAssistantActionApproval({
          request,
          serviceSupabase,
          userId: authorization.userId,
          workspaceId: authorization.workspaceId,
          action: {
            kind: "create_rtp_horizon_bands_from_cycle_horizon",
            workspaceId: authorization.workspaceId,
            rtpCycleId,
            bandingProfileKey: payload.data.bandingProfileKey,
          },
        });
      } catch (approvalError) {
        audit.warn("agent_approval_rejected", { rtpCycleId });
        return NextResponse.json(
          { error: approvalError instanceof Error ? approvalError.message : "Planner Agent approval failed" },
          { status: 403 }
        );
      }
    }

    const profile = getHorizonBandingProfile(payload.data.bandingProfileKey);
    const scaffolds = profile.computeBands(horizonStartYear, horizonEndYear);

    const rows = scaffolds.map((band, index) => ({
      workspace_id: authorization.workspaceId,
      rtp_cycle_id: rtpCycleId,
      label: band.label,
      start_year: band.startYear,
      end_year: band.endYear,
      /**
       * THE LITERAL, not a value. There is no field in the body schema, the
       * action payload, or the profile output that could carry an escalation
       * year, and this line is the only expression that decides the column.
       * Supplying a year would flip `expenditureYearAssumed` and delete the
       * public document's "midpoint assumed" caveat — see the header.
       */
      escalation_target_year: null,
      sort_order: index,
      created_by: authorization.userId,
    }));

    // ONE insert for the whole scaffold, so a refusal refuses all of it and a
    // partial set of periods cannot land.
    const insertBands = async () =>
      await supabase.from("rtp_horizon_bands").insert(rows).select(BAND_COLUMNS);

    const { data: inserted, error: insertError } =
      agentSourced && serviceSupabase
        ? await withAssistantActionAudit(
            serviceSupabase,
            {
              actionKind: "create_rtp_horizon_bands_from_cycle_horizon",
              workspaceId: authorization.workspaceId,
              userId: authorization.userId,
              ...assistantActionAuditIdentity(approval),
              inputSummary: {
                rtpCycleId,
                bandingProfileKey: payload.data.bandingProfileKey,
                horizonStartYear,
                horizonEndYear,
                // The derived periods themselves, so the ledger shows exactly
                // what the scaffold wrote without a second lookup.
                bands: scaffolds.map((band) => band.label),
              },
            },
            insertBands
          )
        : await insertBands();

    if (insertError && isWriteFailure(insertError)) {
      audit.error("scaffold_insert_failed", {
        rtpCycleId,
        message: insertError.message,
        code: insertError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to scaffold the horizon periods" }, { status: 500 });
    }

    const bands = (inserted ?? []) as Array<Record<string, unknown>>;
    if (bands.length !== rows.length) {
      // The insert answered without error but could not read everything back.
      // The rows were written; saying "failed" here is how duplicates get made.
      audit.warn("scaffold_not_fully_readable_back", {
        rtpCycleId,
        expected: rows.length,
        readBack: bands.length,
      });
    }

    audit.info("scaffolded", {
      rtpCycleId,
      bandingProfileKey: payload.data.bandingProfileKey,
      bandCount: rows.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      { bands, bandingProfileKey: payload.data.bandingProfileKey },
      { status: 201 }
    );
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: "Unexpected error while scaffolding horizon periods" },
      { status: 500 }
    );
  }
}
