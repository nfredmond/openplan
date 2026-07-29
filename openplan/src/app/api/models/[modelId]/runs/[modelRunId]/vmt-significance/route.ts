import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadModelAccess } from "@/lib/models/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  CEQA_PROJECT_TYPES,
  CEQA_REFERENCE_LABELS,
  computeCeqaVmt,
} from "@/lib/planner-pack/ceqa";
import { InsufficientDataError } from "@/lib/planner-pack/types";
import {
  buildCeqaScreeningRow,
  deriveCeqaVmtScreeningInputs,
  type CeqaVmtKpiRowLike,
} from "@/lib/models/ceqa-vmt-screen";
import { isModelingClaimStatus, strongestModelingClaimStatus } from "@/lib/models/evidence-backbone";
import {
  parseWorkspaceHomeGeography,
  resolveJurisdiction,
  homeGeographyLabel,
} from "@/lib/workspaces/home-geography";
import {
  vmtSignificanceFrameworkRegistry,
  type VmtFrameworkResolution,
} from "@/lib/planner-pack/vmt-significance-frameworks";
import {
  CALIBRATED_RESIDENT_VMT_PER_CAPITA_KPI,
  resolveVmtDeterminationRunEligibility,
  selectCalibratedVmtPerCapita,
} from "@/lib/planner-pack/vmt-determination-inputs";
import {
  VMT_SCREENING_INPUT_BASES,
  VMT_SIGNIFICANCE_SCREENING_COLUMNS,
  buildVmtSignificanceScreeningRow,
  claimTierEvidence,
  parseVmtSignificanceScreeningRow,
  type VmtClaimTierEvidence,
  type VmtScreeningInputBasis,
  type VmtSignificanceScreeningRecord,
} from "@/lib/planner-pack/vmt-screening-records";

/**
 * Persisted VMT significance determinations for one model run.
 *
 * GET returns the jurisdiction gate, the run's recorded claim tier, and the
 * saved history. POST recomputes the determination HERE — from the run's stored
 * KPIs, through the same pure engine the screen uses — and stores it.
 *
 * THE RECOMPUTE IS THE POINT, not a formality. The claim firewall keeping
 * coarser VMT out of this determination is a KPI-NAMESPACE firewall: the ITE
 * trip-generation lane deliberately publishes `project_daily_vmt_screen` and
 * friends, names disjoint from `CEQA_*_KPI_NAMES`, so its rate-based number can
 * never be consumed here. A route that accepted a VMT figure from the request
 * body would walk straight around that — any caller could post any number and
 * have it stored as a determination. So the body carries only the operator's
 * POLICY inputs (reference baseline, threshold, project type, which basis), and
 * every VMT figure is read from `model_run_kpis` by name.
 *
 * The jurisdiction gate is absolute: no registered framework for the workspace's
 * jurisdiction means no determination is stored, and the refusal names the real
 * reason. See `src/lib/planner-pack/vmt-significance-frameworks.ts` for why this
 * registry, unlike the reimbursement-profile one, has no interim default.
 *
 * THE RUN GATE IS EQUALLY ABSOLUTE, AND IT LIVES HERE RATHER THAN IN THE PANEL.
 * The model-run list only renders the screen for a succeeded AequilibraE run,
 * but that is a rendering decision — any workspace writer can call this route
 * directly. Without the same gate on the server, a `failed` or `running` run's
 * partial KPIs could be stored as a permanent, citable significance
 * determination. `resolveVmtDeterminationRunEligibility` is the shared rule, and
 * the run's status and engine are written onto the row that results, so a reader
 * years from now can audit what it was computed from.
 */

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

const saveSchema = z
  .object({
    referenceVmtPerCapita: z.number().finite().positive(),
    /** A fraction, matching the engine's contract — not a percent. */
    thresholdPct: z.number().gt(0).lt(1),
    projectType: z.enum(CEQA_PROJECT_TYPES),
    referenceLabel: z.enum(CEQA_REFERENCE_LABELS),
    inputBasis: z.enum(VMT_SCREENING_INPUT_BASES),
  })
  .strict();

type RouteContext = {
  params: Promise<{ modelId: string; modelRunId: string }>;
};

/**
 * The run's own record, as this route needs it.
 *
 * `status` and `engine_key` are not diagnostics here — they are what the
 * eligibility gate decides on and what the stored determination records, so they
 * are part of the authorized-run result rather than something re-read later.
 */
type SubjectRunRow = {
  id: string;
  run_title: string | null;
  status: string | null;
  engine_key: string | null;
};

/**
 * A discriminated union rather than an `"errorResponse" in auth` probe: TypeScript's
 * unlisted-property narrowing leaves the success arm carrying an optional
 * `errorResponse`, so the caller's early return silently widens to
 * `NextResponse | undefined` and a handler stops being provably total.
 */
type AuthorizedRun =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: { id: string };
      workspaceId: string;
      modelId: string;
      run: SubjectRunRow;
    };

async function loadAuthorizedRun(
  modelId: string,
  modelRunId: string,
  permission: "models.read" | "models.write"
): Promise<AuthorizedRun> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const access = await loadModelAccess(supabase, modelId, user.id, permission);
  if (access.error) {
    return { ok: false, response: NextResponse.json({ error: "Failed to load model" }, { status: 500 }) };
  }
  if (!access.model) {
    return { ok: false, response: NextResponse.json({ error: "Model not found" }, { status: 404 }) };
  }
  // `loadModelAccess` applies the workspace role matrix for `permission`, so a
  // viewer is refused here rather than at the database — the same gate every
  // other model-run route uses (workspace-write-role-gate-guard.test.ts).
  if (!access.membership || !access.allowed) {
    return { ok: false, response: NextResponse.json({ error: "Workspace access denied" }, { status: 403 }) };
  }

  const { data: run, error: runError } = await supabase
    .from("model_runs")
    .select("id, model_id, run_title, status, engine_key")
    .eq("id", modelRunId)
    .eq("model_id", access.model.id)
    .maybeSingle();

  if (runError) {
    return { ok: false, response: NextResponse.json({ error: "Failed to load model run" }, { status: 500 }) };
  }
  if (!run) {
    return { ok: false, response: NextResponse.json({ error: "Model run not found" }, { status: 404 }) };
  }

  // The Supabase client is untyped by repo convention, so the selected shape is
  // narrowed deliberately rather than trusted: a status or engine that is not a
  // string must read as "not recorded", which the eligibility gate refuses, not
  // as some truthy value that slips past it.
  const runRow = run as Record<string, unknown>;

  return {
    ok: true,
    supabase,
    user,
    workspaceId: access.model.workspace_id,
    modelId: access.model.id,
    run: {
      id: String(runRow.id ?? modelRunId),
      run_title: typeof runRow.run_title === "string" ? runRow.run_title : null,
      status: typeof runRow.status === "string" ? runRow.status : null,
      engine_key: typeof runRow.engine_key === "string" ? runRow.engine_key : null,
    },
  };
}

/**
 * Which framework governs this workspace, from its stated home geography.
 *
 * A FAILED READ IS NOT AN UNKNOWN JURISDICTION. Returning "you have not said
 * where you work" when the truth is "the geography query errored" would send a
 * planner to fix something that is not broken, so a read failure is its own
 * outcome and the caller answers 500 with the database's message.
 */
async function resolveWorkspaceFramework(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string
): Promise<
  { ok: false; readError: string } | { ok: true; resolution: VmtFrameworkResolution }
> {
  const { data, error } = await supabase
    .from("workspaces")
    .select(
      "home_geography_source, home_geography_kind, home_geography_ref, home_geography_label, home_country_code, home_subdivision_code"
    )
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    return { ok: false, readError: error.message };
  }

  const homeGeography = parseWorkspaceHomeGeography(data);
  const jurisdiction = resolveJurisdiction(homeGeography);

  return {
    ok: true,
    resolution: vmtSignificanceFrameworkRegistry.resolve(
      jurisdiction
        ? {
            country: jurisdiction.country,
            subdivision: jurisdiction.subdivision,
            label: homeGeographyLabel(homeGeography),
          }
        : null
    ),
  };
}

async function loadRunKpis(
  supabase: Awaited<ReturnType<typeof createClient>>,
  modelRunId: string
): Promise<{ kpis: CeqaVmtKpiRowLike[]; error: string | null }> {
  const { data, error } = await supabase
    .from("model_run_kpis")
    .select("kpi_name, kpi_label, value, unit, geometry_ref")
    .eq("run_id", modelRunId);

  if (error) {
    return { kpis: [], error: error.message };
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return {
    kpis: rows.map((row) => ({
      kpi_name: String(row.kpi_name ?? ""),
      kpi_label: typeof row.kpi_label === "string" ? row.kpi_label : null,
      value: typeof row.value === "number" ? row.value : null,
      unit: typeof row.unit === "string" ? row.unit : null,
      geometry_ref: typeof row.geometry_ref === "string" ? row.geometry_ref : null,
    })),
    error: null,
  };
}

/**
 * The run's recorded modeling claim tier — and, just as importantly, whether the
 * READ succeeded.
 *
 * WHY THIS DOES NOT CALL `loadModelRunClaimStatuses`. That helper is deliberately
 * best-effort: on a query error it returns an empty map, and its callers are
 * panels that then fall back to an availability posture. Here the same silence
 * would be a false statement written into an APPEND-ONLY table —
 * `claim_status_source = 'not_recorded'` asserts that no modeling claim decision
 * exists for this run, and a run that is actually recorded `prototype_only`
 * would have that warning erased into a vaguer "not recorded" that nothing can
 * later correct. A failed read is a failure, so it is refused rather than
 * degraded. The tier RANKING still belongs to the evidence backbone
 * (`strongestModelingClaimStatus`), so ordering keeps one home.
 */
async function loadRunClaimTier(
  supabase: Awaited<ReturnType<typeof createClient>>,
  modelRunId: string
): Promise<{ ok: false; readError: string } | { ok: true; claimTier: VmtClaimTierEvidence }> {
  const { data, error } = await supabase
    .from("modeling_claim_decisions")
    .select("model_run_id, claim_status")
    .eq("model_run_id", modelRunId);

  if (error) {
    return { ok: false, readError: error.message };
  }

  const statuses = ((data ?? []) as Array<{ claim_status: unknown }>)
    .map((row) => row.claim_status)
    .filter(isModelingClaimStatus);

  return { ok: true, claimTier: claimTierEvidence(strongestModelingClaimStatus(statuses)) };
}

async function loadSavedScreenings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  modelRunId: string
): Promise<{
  records: VmtSignificanceScreeningRecord[];
  unreadableCount: number;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("vmt_significance_screenings")
    .select(VMT_SIGNIFICANCE_SCREENING_COLUMNS)
    .eq("model_run_id", modelRunId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    return { records: [], unreadableCount: 0, error: error.message };
  }

  const rows = (data ?? []) as unknown[];
  const records = rows
    .map(parseVmtSignificanceScreeningRow)
    .filter((record): record is VmtSignificanceScreeningRecord => record !== null);

  // A row this code cannot parse is reported, not hidden. Silently showing a
  // shorter history would let a determination disappear without anyone noticing.
  return { records, unreadableCount: rows.length - records.length, error: null };
}

// GET /api/models/[modelId]/runs/[modelRunId]/vmt-significance
export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("model_runs.vmt_significance.read", req);
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
  }

  const auth = await loadAuthorizedRun(
    parsedParams.data.modelId,
    parsedParams.data.modelRunId,
    "models.read"
  );
  if (!auth.ok) return auth.response;

  const framework = await resolveWorkspaceFramework(auth.supabase, auth.workspaceId);
  if (!framework.ok) {
    audit.error("workspace_geography_read_failed", { message: framework.readError });
    return NextResponse.json(
      {
        error: "Could not read this workspace's home geography",
        details:
          "The jurisdiction a VMT significance determination would be issued under could not be " +
          `established because the workspace geography query failed: ${framework.readError}. ` +
          "No determination is shown, because guessing the jurisdiction is the one thing this screen must not do.",
      },
      { status: 500 }
    );
  }

  const [claimTier, saved] = await Promise.all([
    loadRunClaimTier(auth.supabase, parsedParams.data.modelRunId),
    loadSavedScreenings(auth.supabase, parsedParams.data.modelRunId),
  ]);

  if (!claimTier.ok) {
    audit.error("modeling_claim_decisions_read_failed", { message: claimTier.readError });
    return NextResponse.json(
      {
        error: "Could not read this run's modeling claim tier",
        details:
          "How strongly a determination from this run may be claimed could not be established " +
          `because the claim-decision query failed: ${claimTier.readError}. Reporting it as "not ` +
          'recorded" would state that no claim decision exists, which this request cannot know.',
      },
      { status: 500 }
    );
  }

  if (saved.error) {
    audit.error("saved_screenings_read_failed", { message: saved.error });
    return NextResponse.json(
      {
        error: "Could not read the saved determinations for this run",
        details: saved.error,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    run_id: parsedParams.data.modelRunId,
    framework: framework.resolution,
    claimTier: claimTier.claimTier,
    screenings: saved.records,
    unreadable_screening_count: saved.unreadableCount,
  });
}

// POST /api/models/[modelId]/runs/[modelRunId]/vmt-significance
export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const audit = createApiAuditLogger("model_runs.vmt_significance.write", req);
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
  }

  // AUTHENTICATE, AUTHORIZE, THEN VALIDATE — the order every neighbouring route
  // uses. Validating first answered 400 to a caller who was never allowed to be
  // here, which both leaks that the route exists and tells an anonymous caller
  // what payload shape to try next. Who you are is decided before what you sent
  // is examined.
  const auth = await loadAuthorizedRun(
    parsedParams.data.modelId,
    parsedParams.data.modelRunId,
    "models.write"
  );
  if (!auth.ok) return auth.response;

  const body = await readJsonOrNullWithLimit(req, BODY_LIMITS.normalJson);
  if (!body.ok) return body.response;
  const parsed = saveSchema.safeParse(body.data);
  if (!parsed.success) {
    audit.warn("validation_failed", { issues: parsed.error.issues.slice(0, 5) });
    return NextResponse.json(
      { error: "Invalid VMT significance screening payload", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 }
    );
  }

  // THE RUN GATE. A determination is permanent and citable; a run that has not
  // succeeded has partial KPIs, and an engine outside the eligible set has KPIs
  // whose VMT may not carry a determination at all. The two refusals are kept
  // apart because a planner acts differently on each — one is worth waiting out,
  // the other never will be. 409 says "not in this state"; 422 says "not from
  // this engine, ever".
  const eligibility = resolveVmtDeterminationRunEligibility({
    status: auth.run.status,
    engineKey: auth.run.engine_key,
  });
  if (!eligibility.ok) {
    audit.warn("vmt_determination_refused_ineligible_run", {
      modelRunId: parsedParams.data.modelRunId,
      kind: eligibility.kind,
      runStatus: auth.run.status,
      engineKey: auth.run.engine_key,
    });
    return NextResponse.json(
      {
        error:
          eligibility.kind === "run_not_succeeded"
            ? "This model run has not succeeded, so no determination may be stored from it"
            : "This run's engine cannot support a VMT significance determination",
        kind: eligibility.kind,
        reason: eligibility.reason,
        run_status: auth.run.status,
        engine_key: auth.run.engine_key,
      },
      { status: eligibility.kind === "run_not_succeeded" ? 409 : 422 }
    );
  }

  const framework = await resolveWorkspaceFramework(auth.supabase, auth.workspaceId);
  if (!framework.ok) {
    audit.error("workspace_geography_read_failed", { message: framework.readError });
    return NextResponse.json(
      {
        error: "Could not read this workspace's home geography",
        details:
          "A determination cannot be saved without establishing which jurisdiction's rules it is issued " +
          `under, and that query failed: ${framework.readError}.`,
      },
      { status: 500 }
    );
  }

  // THE JURISDICTION GATE. Every non-covered arm carries a complete sentence
  // explaining itself; the route hands it through verbatim rather than
  // paraphrasing, so the planner reads the registry's actual reason.
  const resolution = framework.resolution;
  if (resolution.kind !== "covered") {
    audit.warn("vmt_determination_refused_no_framework", {
      modelRunId: parsedParams.data.modelRunId,
      kind: resolution.kind,
    });
    return NextResponse.json(
      {
        error: "No VMT significance framework governs this workspace's jurisdiction",
        reason: resolution.reason,
        framework: resolution,
      },
      { status: 422 }
    );
  }

  const { kpis, error: kpiError } = await loadRunKpis(auth.supabase, parsedParams.data.modelRunId);
  if (kpiError) {
    audit.error("model_run_kpis_lookup_failed", { message: kpiError });
    return NextResponse.json({ error: "Failed to load the run's stored KPIs" }, { status: 500 });
  }

  const inputBasis: VmtScreeningInputBasis = parsed.data.inputBasis;
  const screeningInputs = deriveCeqaVmtScreeningInputs(kpis);
  // A blank or whitespace-only run title is a real thing a planner can type, and
  // the engine drops a scenario whose id trims to empty — which used to surface
  // as an unhandled throw from the row builder rather than as a reason.
  const scenarioId = auth.run.run_title?.trim() || parsedParams.data.modelRunId;

  let vmtKpiName: string;
  let populationKpiName: string | null = null;
  let screeningRow;

  if (inputBasis === "calibrated") {
    // ONE definition, shared with the panel. When the two sides disagreed about
    // what counts as the calibrated figure, the screen displayed a calibrated
    // determination that this route then refused — honest here, and a lie there.
    const calibrated = selectCalibratedVmtPerCapita(kpis);
    if (!calibrated) {
      return NextResponse.json(
        {
          error: "This run stores no calibrated VMT",
          details:
            `A calibrated-basis determination reads the run-level \`${CALIBRATED_RESIDENT_VMT_PER_CAPITA_KPI}\` KPI, ` +
            "which this run does not have. Calibrated VMT comes from the count-calibration demand-nudge " +
            "stage; it is never estimated from the screening VMT.",
        },
        { status: 422 }
      );
    }
    vmtKpiName = calibrated.kpiName;
    screeningRow = {
      scenario_id: scenarioId,
      population: 1,
      daily_vmt: calibrated.vmtPerCapita,
    };
  } else {
    if (screeningInputs.status === "no-vmt-kpi" || screeningInputs.status === "missing-population") {
      return NextResponse.json(
        {
          error: "This run cannot supply a VMT significance input",
          details:
            screeningInputs.status === "missing-population"
              ? `This run stores a total daily VMT KPI (\`${screeningInputs.vmtKpiName}\`) but no population KPI, so per-capita VMT cannot be computed. OpenPlan will not estimate it.`
              : "No VMT-family KPI is stored for this run. OpenPlan never estimates VMT from trips or any other proxy.",
        },
        { status: 422 }
      );
    }
    vmtKpiName = screeningInputs.vmtKpiName;
    populationKpiName =
      screeningInputs.status === "total-with-population" ? screeningInputs.populationKpiName : null;
    screeningRow = buildCeqaScreeningRow(screeningInputs, scenarioId);
  }

  let result;
  try {
    result = computeCeqaVmt([screeningRow], {
      referenceVmtPerCapita: parsed.data.referenceVmtPerCapita,
      projectType: parsed.data.projectType,
      referenceLabel: parsed.data.referenceLabel,
      thresholdPct: parsed.data.thresholdPct,
    });
  } catch (error) {
    // Both tiers are operator-fixable input problems, not server faults.
    const status = error instanceof InsufficientDataError ? 422 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The screening engine rejected these inputs" },
      { status }
    );
  }

  // THE STORED REFERENCE IS THE ROUNDED ONE. `computeCeqaVmt` keeps three
  // decimal places, so a reference below 0.0005 arrives at the table as 0 and
  // trips `reference_vmt_per_capita > 0` — which surfaced as a generic "Failed
  // to save the determination" 500 naming nothing the planner could act on. The
  // engine's own `> 0` check passes because it sees the unrounded input, so the
  // refusal belongs here, where the rounding has happened.
  if (!(result.reference_vmt_per_capita > 0)) {
    audit.warn("vmt_determination_refused_reference_rounds_to_zero", {
      modelRunId: parsedParams.data.modelRunId,
      referenceVmtPerCapita: parsed.data.referenceVmtPerCapita,
    });
    return NextResponse.json(
      {
        error: "This reference baseline cannot be recorded",
        details:
          `A stored determination keeps its reference baseline to three decimal places, and ${parsed.data.referenceVmtPerCapita} ` +
          `rounds to ${result.reference_vmt_per_capita} there. Recording a reference of 0 would describe a cut line nobody ` +
          "supplied and make the determination unreadable, so nothing was saved. Enter a reference baseline of at least " +
          "0.001 VMT per capita — a regional or citywide per-capita average is normally in the tens.",
      },
      { status: 422 }
    );
  }

  // The engine drops any row it cannot screen (an empty scenario id, a
  // non-positive population) rather than throwing, so an empty scenario list is
  // reachable. The row builder throws on it; a throw here would be a 500 that
  // names nothing, and there is a real reason to give instead.
  if (result.scenarios.length === 0) {
    audit.warn("vmt_determination_refused_no_scenario", {
      modelRunId: parsedParams.data.modelRunId,
    });
    return NextResponse.json(
      {
        error: "The screening engine produced no determination for this run",
        details:
          "The run's stored VMT and population could not be screened into a scenario, so there is no " +
          "determination to record and nothing was saved. This is a defect to report rather than an " +
          "input to correct — the KPI set passed the checks above.",
      },
      { status: 422 }
    );
  }

  // A determination may not be stored with a tier this request could not read:
  // the row is append-only, so a wrong `claim_status_source` is permanent.
  const claimTier = await loadRunClaimTier(auth.supabase, parsedParams.data.modelRunId);
  if (!claimTier.ok) {
    audit.error("modeling_claim_decisions_read_failed", { message: claimTier.readError });
    return NextResponse.json(
      {
        error: "Could not read this run's modeling claim tier",
        details:
          "A determination records the claim tier it was computed at, and that query failed: " +
          `${claimTier.readError}. Nothing was saved — storing it as "not recorded" would assert ` +
          "that this run has no claim decision, which this request cannot know.",
      },
      { status: 500 }
    );
  }

  const row = buildVmtSignificanceScreeningRow({
    workspaceId: auth.workspaceId,
    subject: { kind: "model_run", modelRunId: parsedParams.data.modelRunId },
    framework: resolution.framework,
    jurisdiction: resolution.jurisdiction,
    jurisdictionBasis: resolution.basis,
    claimTier: claimTier.claimTier,
    inputBasis,
    vmtKpiName,
    populationKpiName,
    // The gate above passed, and the row records what it passed ON. A future
    // reader auditing a stored determination should not have to trust that this
    // check existed when the row was written — it can read the run's status and
    // engine off the determination itself.
    subjectRun: { status: auth.run.status, engineKey: auth.run.engine_key },
    result,
    createdBy: auth.user.id,
  });

  const { data: saved, error: insertError } = await auth.supabase
    .from("vmt_significance_screenings")
    .insert(row)
    .select(VMT_SIGNIFICANCE_SCREENING_COLUMNS)
    .maybeSingle();

  if (insertError) {
    audit.error("vmt_significance_insert_failed", {
      modelRunId: parsedParams.data.modelRunId,
      message: insertError.message,
      code: insertError.code ?? null,
    });
    return NextResponse.json({ error: "Failed to save the determination" }, { status: 500 });
  }

  const record = parseVmtSignificanceScreeningRow(saved);
  if (!record) {
    // The INSERT succeeded (no error) but the row could not be read back or
    // parsed. Reporting a failure here would invite a retry that stores a second
    // determination — see `insertNotReadableBackResponse` for the same reasoning.
    audit.warn("vmt_significance_insert_not_readable_back", {
      modelRunId: parsedParams.data.modelRunId,
    });
    return NextResponse.json(
      {
        created: true,
        screening: null,
        details:
          "The determination was saved, but this request could not read it back. Nothing needs to be " +
          "retried; retrying would store a second determination. Reopen the screen to see the saved history.",
      },
      { status: 201 }
    );
  }

  audit.info("vmt_significance_determination_saved", {
    modelRunId: parsedParams.data.modelRunId,
    screeningId: record.id,
    frameworkId: record.frameworkId,
    determination: record.determination,
    claimStatusSource: record.claimStatusSource,
    inputBasis: record.inputBasis,
  });

  return NextResponse.json({ created: true, screening: record }, { status: 201 });
}
