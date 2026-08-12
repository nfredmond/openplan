import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { RTP_PORTFOLIO_ROLE_OPTIONS } from "@/lib/rtp/catalog";
import { parsePriorityScores } from "@/lib/rtp/priority-scoring";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import {
  completeExtractionAcceptance,
  extractionProvenanceColumns,
  resolveExtractionCandidate,
} from "@/lib/rtp/extraction/acceptance";

const PORTFOLIO_ROLES = RTP_PORTFOLIO_ROLE_OPTIONS.map((option) => option.value) as [string, ...string[]];

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const priorityScoresSchema = z.record(z.string(), z.number());

/**
 * A text box a planner emptied means UNSET, and it must arrive as null.
 *
 * This is the ONLY coercion these payloads make, and it goes to null — never to
 * zero. `z.coerce.number()`, which the invoicing routes use for money, turns ""
 * into 0; here that would turn "nobody has costed this project yet" into "this
 * project costs nothing", and the fiscal-constraint check would sum it as a
 * priced line. A non-blank string is still REJECTED rather than coerced, so a
 * caller sending "12" is told so instead of being quietly accommodated into a
 * number nobody typed.
 */
function blankToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

/**
 * The year bounds the migration's CHECK constraints accept
 * (20260805000003_rtp_financial_element.sql). Mirrored here so a mistyped year
 * is a readable 400 rather than a raw constraint violation wearing a 500.
 */
const EARLIEST_BASIS_YEAR = 1900;
const LATEST_BASIS_YEAR = 2200;

/**
 * `estimated_cost` is NUMERIC(16, 2) — fourteen digits ahead of the point, so
 * the column tops out at 99,999,999,999,999.99. A larger figure is a Postgres
 * numeric overflow, which arrives as an opaque 500. This is the COLUMN'S
 * CAPACITY, not a policy about how much a plan may program.
 *
 * Kept identical to `MAX_LEDGER_AMOUNT` in the financial-assumptions route,
 * which bounds `rtp_financial_assumptions.amount` — the same NUMERIC(16, 2).
 * The two are the revenue side and the cost side of one fiscal-constraint
 * subtraction, and a ceiling that differed between them would let a plan
 * program a cost it could not book the revenue for.
 */
const MAX_PROGRAMMED_COST = 99_999_999_999_999;

/**
 * The cost programmed for this project IN THIS CYCLE, in constant dollars.
 *
 * NULL MEANS UNPRICED, and that is a different answer from 0. The migration
 * says so and the fiscal-constraint arithmetic depends on it: a cycle with
 * twelve of forty projects uncosted has to report twelve uncosted projects, not
 * a total that looks complete and a verdict of "fiscally constrained". So
 * nothing here coerces an absent value into a number, and the assignment below
 * passes the parsed value through untouched — never `|| null`, which turns a
 * genuine zero into "unpriced", and never `?? 0`, which does the reverse.
 */
const programmedCostSchema = z.preprocess(
  blankToNull,
  z
    .number()
    .min(0, "Programmed cost cannot be negative. Leave it blank for a project that is not costed yet.")
    .max(MAX_PROGRAMMED_COST, "Programmed cost is larger than this field can store.")
    .nullable()
);

/** The year `estimatedCost` is expressed in. Null falls back to the cycle's basis year, disclosed by the reading surface. */
const costBasisYearSchema = z.preprocess(
  blankToNull,
  z
    .number()
    .int("Cost basis year must be a whole year, such as 2026.")
    .min(EARLIEST_BASIS_YEAR, `Cost basis year must be between ${EARLIEST_BASIS_YEAR} and ${LATEST_BASIS_YEAR}.`)
    .max(LATEST_BASIS_YEAR, `Cost basis year must be between ${EARLIEST_BASIS_YEAR} and ${LATEST_BASIS_YEAR}.`)
    .nullable()
);

/** Which period of the plan this project's cost sits in. Verified against the link's own cycle before it is stored. */
const horizonBandIdSchema = z.preprocess(blankToNull, z.string().uuid().nullable());

/**
 * The transcription this link's cost, basis year, role or period was copied
 * from, when there was one.
 *
 * THE PAIRING ARGUMENT, because this is the delicate one. An assistant action
 * that assigns a project to a horizon band stays refused, and the refusal is
 * not about unverified ids — it is that the PAIRING is authored content: the
 * schema records which period a project is planned for nowhere else, and the
 * band sets the escalation exponent. None of that changes here. What changes is
 * where the pairing comes from: when the adopted plan's own project table
 * prints "Project X — Constrained — 2023–2032 — $12.4M", copying that row
 * records a judgement the agency already made and its board ratified, on a page
 * this link will cite by number and quote verbatim.
 *
 * And the project is never inferred. A `programmed_project` candidate stages a
 * NAME STRING; a person binds it to a project, which is why `projectId` here
 * still comes from the URL and never from anything a model produced.
 */
const fromExtractionCandidateIdSchema = z.string().uuid().optional();

const createLinkSchema = z.object({
  rtpCycleId: z.string().uuid(),
  portfolioRole: z.enum(PORTFOLIO_ROLES).optional(),
  priorityRationale: z.string().trim().max(2000).optional(),
  priorityScores: priorityScoresSchema.optional(),
  horizonBandId: horizonBandIdSchema.optional(),
  estimatedCost: programmedCostSchema.optional(),
  costBasisYear: costBasisYearSchema.optional(),
  fromExtractionCandidateId: fromExtractionCandidateIdSchema,
});

const updateLinkSchema = z.object({
  linkId: z.string().uuid(),
  portfolioRole: z.enum(PORTFOLIO_ROLES).optional(),
  priorityRationale: z.string().trim().max(2000).nullable().optional(),
  priorityScores: priorityScoresSchema.optional(),
  evidenceModelRunId: z.string().uuid().nullable().optional(),
  horizonBandId: horizonBandIdSchema.optional(),
  estimatedCost: programmedCostSchema.optional(),
  costBasisYear: costBasisYearSchema.optional(),
  fromExtractionCandidateId: fromExtractionCandidateIdSchema,
});

const deleteLinkSchema = z.object({
  linkId: z.string().uuid(),
});

/**
 * The columns every handler reads back, in one place.
 *
 * The three financial columns are here because a mocked Supabase client returns
 * its fixture for whatever was asked, so a projection that forgets a column
 * leaves every test green and hands the client `undefined` — the defect class
 * `public-engagement-page.test.tsx` asserts against. The route test asserts on
 * this string.
 */
const LINK_RESULT_COLUMNS =
  "id, project_id, rtp_cycle_id, portfolio_role, priority_rationale, priority_scores, evidence_model_run_id, horizon_band_id, estimated_cost, cost_basis_year, created_at";

/**
 * The zod messages a planner can act on, joined into one line.
 *
 * WHY THE 400 GAINED A `details`. "Invalid RTP link update payload" was the
 * whole answer to typing a negative cost, and it names neither the field nor
 * the reason. The messages authored above are written for that reader; zod's
 * own defaults only ever describe ids the interface supplies, never a value a
 * planner typed.
 */
function describeValidationIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
): string {
  return issues
    .map((issue) => (issue.path.length ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message))
    .join(" ");
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type RouteAuditLogger = ReturnType<typeof createApiAuditLogger>;

/**
 * Refuse a horizon band that does not belong to THIS link's cycle.
 *
 * WHY THIS IS NOT OPTIONAL. A band is a period of one plan's financial element.
 * Writing another cycle's band onto this link would attribute the project's
 * cost to a period of a DIFFERENT plan — the money would leave one cycle's
 * fiscal-constraint arithmetic and land in another's, and both totals would
 * look perfectly ordinary afterwards. Nothing downstream can detect it, because
 * a band id is a band id.
 *
 * Shared by POST and PATCH deliberately. A verification that lives inside one
 * of its two callers gets reimplemented differently by the other, and the two
 * doors onto the same column then disagree about what is allowed.
 *
 * Returns the response to send, or null when the band is usable.
 */
async function refuseHorizonBandOutsideCycle(options: {
  supabase: SupabaseServerClient;
  audit: RouteAuditLogger;
  bandId: string;
  rtpCycleId: string;
  workspaceId: string;
  context: Record<string, unknown>;
}): Promise<NextResponse | null> {
  const bandResult = await options.supabase
    .from("rtp_horizon_bands")
    .select("id, rtp_cycle_id, workspace_id")
    .eq("id", options.bandId)
    .maybeSingle();

  // Same reasoning as the evidence-run read below: only a read that SUCCEEDED
  // and found nothing establishes "that band is not in this cycle". A failed
  // read reaching the same branch would tell a planner their band does not
  // exist while it sits in the picker they chose it from.
  const bandFailure = classifyRouteReadFailure("horizon band", bandResult, {
    pendingError: "RTP financial schema is not available yet",
    pendingHint: "Apply migration 20260805000003_rtp_financial_element.sql, then try again.",
  });
  if (bandFailure) {
    options.audit.error("horizon_band_lookup_failed", {
      ...options.context,
      horizonBandId: options.bandId,
      message: bandFailure.message,
    });
    return NextResponse.json(bandFailure.body, { status: bandFailure.status });
  }

  const band = bandResult.data as { id: string; rtp_cycle_id: string; workspace_id: string } | null;

  // One message for "no such band", "another cycle's band" and "another
  // workspace's band". Separating them would confirm the existence of rows the
  // caller cannot see, which is the enumeration leak PR #25 closed.
  if (!band || band.workspace_id !== options.workspaceId || band.rtp_cycle_id !== options.rtpCycleId) {
    options.audit.warn("horizon_band_rejected", {
      ...options.context,
      horizonBandId: options.bandId,
      expectedRtpCycleId: options.rtpCycleId,
      bandRtpCycleId: band?.rtp_cycle_id ?? null,
      bandWorkspaceMatched: band ? band.workspace_id === options.workspaceId : null,
    });
    return NextResponse.json(
      {
        error: "Horizon band not found in this RTP cycle",
        details:
          "A horizon band belongs to one plan cycle. Storing this project's cost against a band from " +
          "another cycle would attribute the money to a period of a different plan, so nothing was saved.",
      },
      { status: 400 }
    );
  }

  return null;
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.rtp_links.create", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = createLinkSchema.safeParse(payloadBody.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        { error: "Invalid RTP link payload", details: describeValidationIssues(payload.error.issues) },
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

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, workspace_id, name")
      .eq("id", routeParams.data.projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("workspace_id", project.workspace_id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", { error: membershipError.message, workspaceId: project.workspace_id });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
    }

    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: cycle, error: cycleError } = await supabase
      .from("rtp_cycles")
      .select("id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year")
      .eq("id", payload.data.rtpCycleId)
      .single();

    if (cycleError || !cycle) {
      return NextResponse.json({ error: "RTP cycle not found" }, { status: 404 });
    }

    if (cycle.workspace_id !== project.workspace_id) {
      return NextResponse.json({ error: "RTP cycle must belong to the same workspace" }, { status: 400 });
    }

    if (payload.data.horizonBandId) {
      const bandRefusal = await refuseHorizonBandOutsideCycle({
        supabase,
        audit,
        bandId: payload.data.horizonBandId,
        rtpCycleId: cycle.id,
        workspaceId: project.workspace_id,
        context: { projectId: project.id, rtpCycleId: cycle.id },
      });
      if (bandRefusal) return bandRefusal;
    }

    const candidate = await resolveExtractionCandidate({
      supabase: supabase as unknown as Parameters<typeof resolveExtractionCandidate>[0]["supabase"],
      audit,
      candidateId: payload.data.fromExtractionCandidateId,
      targetKind: "programmed_project",
      rtpCycleId: cycle.id,
      workspaceId: project.workspace_id,
    });
    if (!candidate.ok) return candidate.response;

    const { data, error } = await supabase
      .from("project_rtp_cycle_links")
      .insert({
        workspace_id: project.workspace_id,
        project_id: project.id,
        rtp_cycle_id: cycle.id,
        portfolio_role: payload.data.portfolioRole ?? "candidate",
        priority_rationale: payload.data.priorityRationale || null,
        priority_scores: parsePriorityScores(payload.data.priorityScores),
        horizon_band_id: payload.data.horizonBandId ?? null,
        // `?? null`, never `|| null`: a project deliberately programmed at zero
        // dollars in this cycle is a priced project, and `||` would file it as
        // unpriced.
        estimated_cost: payload.data.estimatedCost ?? null,
        cost_basis_year: payload.data.costBasisYear ?? null,
        created_by: user.id,
        ...extractionProvenanceColumns(candidate.candidate),
      })
      .select(LINK_RESULT_COLUMNS)
      .single();

    if (error) {
      // A deployment that has the code and not 20260805000003 asks for columns
      // that do not exist yet. That is a setup step, not a server fault, and
      // saying so is the difference between an operator running one migration
      // and an operator reading "Failed to create RTP link" with nowhere to go.
      const pendingSchema = looksLikePendingSchema(error.message);
      const status = pendingSchema ? 503 : error.code === "23505" ? 409 : 500;
      audit.error("insert_failed", { error: error.message, code: error.code ?? null, status });
      if (pendingSchema) {
        return NextResponse.json(
          {
            error: "RTP financial schema is not available yet",
            hint: "Apply migration 20260805000003_rtp_financial_element.sql, then try again.",
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: status === 409 ? "This project is already linked to that RTP cycle" : "Failed to create RTP link" },
        { status }
      );
    }

    const acceptance = await completeExtractionAcceptance({
      audit,
      candidate: candidate.candidate,
      acceptedRowId: (data as { id?: string } | null)?.id,
      reviewedBy: user.id,
      context: { projectId: project.id, rtpCycleId: cycle.id },
    });

    audit.info("created", {
      projectId: project.id,
      rtpCycleId: cycle.id,
      extractionCandidateId: candidate.candidate?.id ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      link: {
        ...data,
        cycle,
      },
      ...acceptance,
    });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to create RTP link" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.rtp_links.update", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const payload = updateLinkSchema.safeParse(payloadBody.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json(
        { error: "Invalid RTP link update payload", details: describeValidationIssues(payload.error.issues) },
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

    // `rtp_cycle_id` is projected because the horizon-band check below compares
    // against it. It is read from the STORED row rather than taken from the
    // request: a cycle id in the body would let a caller name the cycle their
    // band belongs to and defeat the check entirely.
    const { data: link, error: linkError } = await supabase
      .from("project_rtp_cycle_links")
      .select("id, project_id, workspace_id, rtp_cycle_id")
      .eq("id", payload.data.linkId)
      .eq("project_id", routeParams.data.projectId)
      .maybeSingle();

    if (linkError) {
      audit.error("link_lookup_failed", { error: linkError.message });
      return NextResponse.json({ error: "Failed to load RTP link" }, { status: 500 });
    }
    if (!link) {
      return NextResponse.json({ error: "RTP link not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("workspace_id", link.workspace_id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", { error: membershipError.message, workspaceId: link.workspace_id });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
    }
    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};
    if (payload.data.portfolioRole !== undefined) updates.portfolio_role = payload.data.portfolioRole;
    if (payload.data.priorityRationale !== undefined) {
      updates.priority_rationale = payload.data.priorityRationale?.trim() || null;
    }
    if (payload.data.priorityScores !== undefined) {
      updates.priority_scores = parsePriorityScores(payload.data.priorityScores);
    }
    if (payload.data.evidenceModelRunId !== undefined) {
      if (payload.data.evidenceModelRunId === null) {
        updates.evidence_model_run_id = null;
      } else {
        const runResult = await supabase
          .from("model_runs")
          .select("id, workspace_id")
          .eq("id", payload.data.evidenceModelRunId)
          .maybeSingle();

        // "Model run not found in this workspace" is a statement about what
        // this workspace holds, and only a read that SUCCEEDED and found no
        // row establishes it. A failed read reaches the same `!run` branch, so
        // it used to tell a planner their run does not exist — while the run
        // sat right there in the picker they chose it from — and refuse to
        // attach the evidence an RTP portfolio decision rests on.
        const runFailure = classifyRouteReadFailure("model run", runResult);
        if (runFailure) {
          audit.error("evidence_model_run_lookup_failed", {
            projectId: routeParams.data.projectId,
            linkId: link.id,
            modelRunId: payload.data.evidenceModelRunId,
            message: runFailure.message,
          });
          return NextResponse.json(runFailure.body, { status: runFailure.status });
        }

        const run = runResult.data;
        if (!run || run.workspace_id !== link.workspace_id) {
          return NextResponse.json({ error: "Model run not found in this workspace" }, { status: 400 });
        }
        updates.evidence_model_run_id = run.id;
      }
    }

    // The three financial fields all distinguish ABSENT from an explicit null,
    // and the distinction is the feature: an absent key leaves the stored value
    // alone, while `null` clears it. `payload.data.X !== undefined` is what
    // separates them — a truthiness test here would make "clear this cost" and
    // "set this cost to zero" indistinguishable from "do not touch this cost".
    if (payload.data.horizonBandId !== undefined) {
      if (payload.data.horizonBandId === null) {
        updates.horizon_band_id = null;
      } else {
        const bandRefusal = await refuseHorizonBandOutsideCycle({
          supabase,
          audit,
          bandId: payload.data.horizonBandId,
          rtpCycleId: link.rtp_cycle_id,
          workspaceId: link.workspace_id,
          context: { projectId: routeParams.data.projectId, linkId: link.id },
        });
        if (bandRefusal) return bandRefusal;
        updates.horizon_band_id = payload.data.horizonBandId;
      }
    }
    if (payload.data.estimatedCost !== undefined) {
      // Assigned through, deliberately. `|| null` would file a project
      // programmed at zero dollars as unpriced; `?? 0` would price every
      // project a planner cleared. Null reaches the column as null and means
      // UNPRICED there too.
      updates.estimated_cost = payload.data.estimatedCost;
    }
    if (payload.data.costBasisYear !== undefined) {
      updates.cost_basis_year = payload.data.costBasisYear;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    // AFTER the "nothing to change" refusal, deliberately. Provenance is never
    // an edit on its own: a link marked as transcribed from p.44 while its cost
    // is still the one somebody typed would be a citation to a figure the
    // document does not contain. The cycle comes from the STORED link row, the
    // same place the horizon-band check reads it from and for the same reason.
    const candidate = await resolveExtractionCandidate({
      supabase: supabase as unknown as Parameters<typeof resolveExtractionCandidate>[0]["supabase"],
      audit,
      candidateId: payload.data.fromExtractionCandidateId,
      targetKind: "programmed_project",
      rtpCycleId: link.rtp_cycle_id,
      workspaceId: link.workspace_id,
    });
    if (!candidate.ok) return candidate.response;
    Object.assign(updates, extractionProvenanceColumns(candidate.candidate));

    const { data, error } = await supabase
      .from("project_rtp_cycle_links")
      .update(updates)
      .eq("id", link.id)
      .select(LINK_RESULT_COLUMNS)
      // `maybeSingle`, not `single`. Until 20260728000010 this table had a
      // RESTRICTIVE writer gate and no PERMISSIVE UPDATE policy, so every update
      // matched zero rows — the defect `@/lib/http/write-outcome` was extracted
      // from, which now reports that outcome honestly in either spelling.
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("update_failed", { error: error.message, code: error.code ?? null });
      // Same setup-versus-fault distinction the insert makes above.
      if (looksLikePendingSchema(error.message)) {
        return NextResponse.json(
          {
            error: "RTP financial schema is not available yet",
            hint: "Apply migration 20260805000003_rtp_financial_element.sql, then try again.",
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: "Failed to update RTP link" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data, error })) {
      // The link was readable a moment ago and the caller passed both the
      // membership and the `plans.write` role check, so no matched row means
      // the database refused a write the application believed was allowed, or
      // the link was deleted concurrently. Nothing was saved either way.
      audit.error("update_matched_no_rows", {
        projectId: routeParams.data.projectId,
        linkId: link.id,
        role: membership.role ?? null,
      });
      return noRowsMatchedResponse({ subject: "RTP link", targetWasVerified: true });
    }

    const acceptance = await completeExtractionAcceptance({
      audit,
      candidate: candidate.candidate,
      acceptedRowId: link.id,
      reviewedBy: user.id,
      context: { projectId: routeParams.data.projectId, linkId: link.id },
    });

    audit.info("updated", {
      projectId: routeParams.data.projectId,
      linkId: link.id,
      extractionCandidateId: candidate.candidate?.id ?? null,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ link: data, ...acceptance });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update RTP link" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const audit = createApiAuditLogger("projects.rtp_links.delete", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      audit.warn("params_validation_failed", { issues: routeParams.error.issues });
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = deleteLinkSchema.safeParse(payloadBody.data);
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid delete payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: link, error: linkError } = await supabase
      .from("project_rtp_cycle_links")
      .select("id, project_id, workspace_id")
      .eq("id", payload.data.linkId)
      .eq("project_id", routeParams.data.projectId)
      .maybeSingle();

    if (linkError) {
      audit.error("link_lookup_failed", { error: linkError.message });
      return NextResponse.json({ error: "Failed to load RTP link" }, { status: 500 });
    }

    if (!link) {
      return NextResponse.json({ error: "RTP link not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("workspace_id", link.workspace_id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", { error: membershipError.message, workspaceId: link.workspace_id });
      return NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 });
    }

    if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // `.select("id").maybeSingle()`, not a bare `.delete().eq()`.
    //
    // A bare delete answers `error: null` when it matched ZERO rows, so the
    // handler below would report `{ ok: true }` and write `audit.info("deleted")`
    // for a deletion that never happened — a success message and a ledger entry
    // for a row still sitting in the table. The same defect the PATCH handler
    // above was fixed for, in the one shape where the caller has no returned
    // record to notice the absence of.
    //
    // `"id"` rather than LINK_RESULT_COLUMNS on purpose: a DELETE hands the
    // caller no record, so nothing needs the financial columns — and asking for
    // them would make every delete 503 "schema is not available yet" on a
    // deployment that has not run 20260805000003. A delete must not depend on a
    // migration it does not write through.
    const { data: deleted, error } = await supabase
      .from("project_rtp_cycle_links")
      .delete()
      .eq("id", link.id)
      .select("id")
      .maybeSingle();

    if (error && isWriteFailure(error)) {
      audit.error("delete_failed", { error: error.message, code: error.code ?? null });
      return NextResponse.json({ error: "Failed to remove RTP link" }, { status: 500 });
    }

    if (writeMatchedNoRows({ data: deleted, error })) {
      // `targetWasVerified: true` — the link was read back through the CALLER's
      // own client a few lines above and the caller passed both the membership
      // and the `plans.write` role check. Zero rows here therefore means the
      // database refused a delete the application believed was allowed (a
      // missing permissive DELETE policy is the usual cause) or the link was
      // removed by someone else while this request was in flight. Either way
      // nothing this request did changed anything, and saying "ok" would be
      // false.
      audit.error("delete_matched_no_rows", {
        projectId: routeParams.data.projectId,
        linkId: link.id,
        role: membership.role ?? null,
      });
      return noRowsMatchedResponse({ subject: "RTP link", targetWasVerified: true });
    }

    audit.info("deleted", { projectId: routeParams.data.projectId, linkId: link.id, durationMs: Date.now() - startedAt });
    return NextResponse.json({ ok: true });
  } catch (error) {
    audit.error("unhandled_error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to remove RTP link" }, { status: 500 });
  }
}
