/**
 * Persisted VMT significance determinations — the record shape, and the one
 * place that decides how a determination is worded when it travels.
 *
 * WHY THIS MODULE EXISTS. The significance screen is the only
 * determination-shaped output OpenPlan produces, and until `20260728000012` it
 * was computed in the browser and discarded. Persisting it is only half the
 * work: a determination is dangerous precisely because it is quotable, so
 * everything that makes it interpretable has to travel WITH it —
 *
 *   - the framework and jurisdiction it was issued under (CEQA §15064.3 is
 *     California law; the same arithmetic in Ohio determines nothing);
 *   - the modeling claim tier the run held at the time (the repo's own record
 *     documents sketch-ABM VMT running ~56% below the CARB reference, which
 *     would have produced a false "less than significant");
 *   - whether the screening or the opt-in calibrated VMT drove it.
 *
 * `summarizeVmtDetermination` is the enforcement point for that: it CANNOT
 * produce a summary line without a tier and a jurisdiction, because they are
 * required fields of its input. Any collapsed, summary, or badge rendering of a
 * determination goes through it rather than concatenating its own string, so a
 * new surface cannot accidentally ship a bare "less than significant".
 *
 * Supabase clients here are untyped by repo convention, so rows are parsed
 * defensively and cast deliberately — a column typo surfaces at runtime, and a
 * half-parsed determination must read as absent rather than as a weaker one.
 */

import { isModelingClaimStatus, type ModelingClaimStatus } from "@/lib/models/evidence-backbone";
import { CEQA_MEMO_ENGINE_VERSION } from "@/lib/models/ceqa-vmt-screen";
import type {
  CeqaProjectType,
  CeqaReferenceLabel,
  CeqaVmtResult,
  CeqaVmtScenario,
} from "@/lib/planner-pack/types";
import type { VmtDeterminationSubjectRun } from "@/lib/planner-pack/vmt-determination-inputs";
import type {
  VmtJurisdictionBasis,
  VmtResolvedJurisdiction,
  VmtSignificanceFrameworkDescriptor,
} from "@/lib/planner-pack/vmt-significance-frameworks";

/**
 * NO TABLE-NAME CONSTANT LIVES HERE ON PURPOSE.
 *
 * Callers spell `.from("vmt_significance_screenings")` literally.
 * `write-policy-coverage-guard.test.ts` resolves table names from the AST to
 * prove a caller-client write targets a table with a permissive policy for that
 * command; a `.from(SOME_CONSTANT)` is a dynamic name to that scanner, and the
 * write drops into its can't-answer-statically list instead of being checked.
 * Sharing one constant would be tidier and would cost the guard the one write it
 * exists to check.
 *
 * The table is `public.vmt_significance_screenings` and the latest-per-run view
 * is `public.vmt_significance_screenings_latest` (20260728000012).
 */

/**
 * The determination vocabulary, in database tokens.
 *
 * The ported engine words the same two outcomes as "potentially significant" /
 * "less than significant" (`CeqaVmtScenario.determination`), which is what a
 * planner reads. Tokens are what a stage gate or a report filters on, and the
 * mapping between them lives here so the two can never drift.
 */
export const VMT_DETERMINATIONS = ["less_than_significant", "potentially_significant"] as const;
export type VmtDetermination = (typeof VMT_DETERMINATIONS)[number];

/** Which VMT drove the determination. See the migration's `input_basis` comment. */
export const VMT_SCREENING_INPUT_BASES = ["screening", "calibrated"] as const;
export type VmtScreeningInputBasis = (typeof VMT_SCREENING_INPUT_BASES)[number];

/**
 * Where the recorded claim tier came from.
 *
 * `not_recorded` is a real answer, not a missing value: when no
 * `modeling_claim_decisions` row exists for a run, the tier is unknown, and
 * substituting a plausible default (screening_grade) would be inventing evidence
 * about how good the model is.
 */
export const VMT_CLAIM_STATUS_SOURCES = ["recorded_claim_decision", "not_recorded"] as const;
export type VmtClaimStatusSource = (typeof VMT_CLAIM_STATUS_SOURCES)[number];

/** The app-shaped record. Snake_case stays in the row builders and parsers. */
export type VmtSignificanceScreeningRecord = {
  id: string;
  workspaceId: string;
  modelRunId: string | null;
  countyRunId: string | null;

  frameworkId: string;
  frameworkName: string;
  frameworkVersion: string;

  jurisdictionCountry: string;
  jurisdictionSubdivision: string | null;
  jurisdictionLabel: string;
  jurisdictionBasis: VmtJurisdictionBasis;

  claimStatus: ModelingClaimStatus | null;
  claimStatusSource: VmtClaimStatusSource;

  inputBasis: VmtScreeningInputBasis;
  vmtKpiName: string;
  populationKpiName: string | null;
  scenarioId: string;

  determination: VmtDetermination;
  mitigationRequired: boolean;
  vmtPerCapita: number;
  thresholdVmtPerCapita: number;
  referenceVmtPerCapita: number;
  thresholdPct: number;
  referenceLabel: string;
  projectType: string;

  engineVersion: string;
  createdAt: string | null;
};

/**
 * Select list for a persisted determination.
 *
 * Deliberately excludes `inputs_json` / `result_json`: those hold the full
 * screening record for reproducibility and are not needed to render or cite a
 * determination. Selecting them on every panel open would drag the whole history
 * over the wire for no gain.
 */
export const VMT_SIGNIFICANCE_SCREENING_COLUMNS = [
  "id",
  "workspace_id",
  "model_run_id",
  "county_run_id",
  "framework_id",
  "framework_name",
  "framework_version",
  "jurisdiction_country",
  "jurisdiction_subdivision",
  "jurisdiction_label",
  "jurisdiction_basis",
  "claim_status",
  "claim_status_source",
  "input_basis",
  "vmt_kpi_name",
  "population_kpi_name",
  "scenario_id",
  "determination",
  "mitigation_required",
  "vmt_per_capita",
  "threshold_vmt_per_capita",
  "reference_vmt_per_capita",
  "threshold_pct",
  "reference_label",
  "project_type",
  "engine_version",
  "created_at",
].join(", ");

/** The engine that produced the arithmetic, stamped on every stored row. */
export const VMT_SIGNIFICANCE_ENGINE_VERSION = CEQA_MEMO_ENGINE_VERSION;

/** The engine's wording → the stored token. */
export function determinationToken(scenario: Pick<CeqaVmtScenario, "significant">): VmtDetermination {
  return scenario.significant ? "potentially_significant" : "less_than_significant";
}

/** The stored token → the wording a planner reads. Sentence case; callers style it. */
export function determinationLabel(determination: VmtDetermination): string {
  return determination === "potentially_significant"
    ? "Potentially significant"
    : "Less than significant";
}

/** Human label for a claim tier, or the honest absence. Mirrors the county-run evidence panel. */
export function claimStatusLabel(status: ModelingClaimStatus | null): string {
  switch (status) {
    case "claim_grade_passed":
      return "Claim-grade";
    case "calibrated_to_counts":
      return "Calibrated to counts";
    case "screening_grade":
      return "Screening-grade";
    case "prototype_only":
      return "Prototype-only";
    default:
      // Not a fallback for an unrecognised tier — `claimStatus` is null exactly
      // when no claim decision exists for the run, and saying so is the point.
      return "Claim tier not recorded";
  }
}

/** How the determination's input basis reads next to it. */
export function inputBasisLabel(inputBasis: VmtScreeningInputBasis): string {
  return inputBasis === "calibrated" ? "calibrated (count-tuned) VMT" : "screening VMT";
}

/**
 * The claim-tier sentence that rides with an UNSAVED (on-screen or exported)
 * determination. One definition on purpose: the screen panel and the downloaded
 * memo must state the tier — or its honest absence — in the same words, so the
 * artifact that leaves the tool can never claim more than the screen it came
 * from. `undefined`/`null` means the surface never read the tier, which is a
 * different fact from "read it and found none recorded", and both absences are
 * stated rather than left blank.
 */
export function describeClaimTierForDetermination(
  claimTier: VmtClaimTierEvidence | null | undefined
): string {
  if (!claimTier) {
    return "not established on this surface. The run's recorded claim tier is not read here, so how strongly this determination may be claimed is unknown.";
  }
  if (claimTier.claimStatusSource === "recorded_claim_decision") {
    return `${claimStatusLabel(claimTier.claimStatus)} — recorded for this run.`;
  }
  return "not recorded for this run. No modeling claim decision exists, so OpenPlan will not assume a tier for it.";
}

/**
 * Everything a determination must carry to be shown anywhere at all.
 *
 * All five fields are REQUIRED (the tier may be null, but the field may not be
 * omitted, and `claimStatusSource` says which). That is the guard: a caller
 * cannot summarize a determination it does not know the framework, jurisdiction,
 * tier, and basis of.
 */
export type VmtDeterminationSummaryInput = {
  determination: VmtDetermination;
  frameworkName: string;
  jurisdictionLabel: string;
  claimStatus: ModelingClaimStatus | null;
  claimStatusSource: VmtClaimStatusSource;
  inputBasis: VmtScreeningInputBasis;
};

/**
 * The one-line form of a determination, for any collapsed or summary surface.
 *
 * "Potentially significant — CEQA §15064.3 VMT significance screening
 *  (California, United States) · screening-grade · screening VMT"
 *
 * The separators are cosmetic; the four facts are not. A determination that
 * travels without its tier and its jurisdiction is exactly the overclaim the
 * claim firewall exists to prevent.
 */
export function summarizeVmtDetermination(input: VmtDeterminationSummaryInput): string {
  const tier =
    input.claimStatusSource === "recorded_claim_decision"
      ? claimStatusLabel(input.claimStatus).toLowerCase()
      : "claim tier not recorded";

  return [
    determinationLabel(input.determination),
    `— ${input.frameworkName} (${input.jurisdictionLabel})`,
    `· ${tier}`,
    `· ${inputBasisLabel(input.inputBasis)}`,
  ].join(" ");
}

/** The strongest tier recorded for a run, plus how we know. Null tier ⇒ not recorded. */
export type VmtClaimTierEvidence = {
  claimStatus: ModelingClaimStatus | null;
  claimStatusSource: VmtClaimStatusSource;
};

/**
 * Turn whatever `loadModelRunClaimStatuses` found into the pair persisted on a
 * determination.
 *
 * Kept as a named function rather than inlined at the call site so the "absent
 * means not recorded, never screening_grade" decision has one home — the
 * temptation to default to `screening_grade` is real, and it would put a tier on
 * a determination that has no evidence for one.
 *
 * The vocabulary is re-validated rather than trusted: `loadModelRunClaimStatuses`
 * reads an untyped Supabase row, so a value from a newer schema must land as
 * "not recorded" rather than as an unknown tier travelling on a determination.
 */
export function claimTierEvidence(status: ModelingClaimStatus | null | undefined): VmtClaimTierEvidence {
  if (!status || !isModelingClaimStatus(status)) {
    return { claimStatus: null, claimStatusSource: "not_recorded" };
  }
  return { claimStatus: status, claimStatusSource: "recorded_claim_decision" };
}

/**
 * What a surface sends to ask for a determination to be saved.
 *
 * Notice what is NOT here: any VMT figure. The operator supplies POLICY (the
 * reference baseline, the cut line, the project type, which basis), and the
 * server reads every VMT number from the run's stored KPIs by name. A payload
 * carrying VMT would be a way around the KPI-namespace firewall that keeps
 * rate-based and uncalibrated numbers out of this determination.
 */
export type VmtDeterminationSaveRequest = {
  referenceVmtPerCapita: number;
  /** A fraction, matching the engine's contract — not a percent. */
  thresholdPct: number;
  projectType: CeqaProjectType;
  referenceLabel: CeqaReferenceLabel;
  inputBasis: VmtScreeningInputBasis;
};

/** Which run a determination belongs to. Exactly one, matching the table's CHECK. */
export type VmtScreeningSubject =
  | { kind: "model_run"; modelRunId: string }
  | { kind: "county_run"; countyRunId: string };

export type BuildVmtScreeningRowInput = {
  workspaceId: string;
  subject: VmtScreeningSubject;
  framework: VmtSignificanceFrameworkDescriptor;
  jurisdiction: VmtResolvedJurisdiction;
  jurisdictionBasis: VmtJurisdictionBasis;
  claimTier: VmtClaimTierEvidence;
  inputBasis: VmtScreeningInputBasis;
  vmtKpiName: string;
  populationKpiName?: string | null;
  /**
   * The subject run's own state at the moment the determination was issued.
   *
   * WHY IT IS RECORDED, AND WHY IT IS REQUIRED. The route refuses to compute a
   * determination from a run that has not succeeded or from an engine whose VMT
   * may not carry one — but a refusal leaves no trace on the rows that WERE
   * written, so nothing downstream could tell whether a stored determination had
   * ever been checked. This table is append-only and its rows are meant to be
   * cited years later, by which time the `model_runs` row may say something
   * different (a relaunch, a status correction) or be gone entirely. So the
   * answer to "what was this computed from" is kept on the determination itself
   * rather than joined for.
   *
   * It rides inside `inputs_json` because `20260728000012` is already written
   * and shipped, and `inputs_json` is precisely that migration's reproducibility
   * record. A future migration promoting it to a column would be a widening, not
   * a correction.
   */
  subjectRun: VmtDeterminationSubjectRun;
  /** The server-recomputed engine result. Never client arithmetic. */
  result: CeqaVmtResult;
  createdBy: string;
};

/**
 * Build the database row for one determination.
 *
 * Throws when the engine produced no scenario: a determination row whose
 * determination is absent would be a record of nothing, and the caller must
 * report the insufficiency instead of storing an empty one.
 */
export function buildVmtSignificanceScreeningRow(
  input: BuildVmtScreeningRowInput
): Record<string, unknown> {
  const scenario = input.result.scenarios[0];
  if (!scenario) {
    throw new Error(
      "The VMT significance engine returned no scenario, so there is no determination to store."
    );
  }

  return {
    workspace_id: input.workspaceId,
    model_run_id: input.subject.kind === "model_run" ? input.subject.modelRunId : null,
    county_run_id: input.subject.kind === "county_run" ? input.subject.countyRunId : null,

    framework_id: input.framework.frameworkId,
    framework_name: input.framework.frameworkName,
    framework_version: input.framework.version,

    jurisdiction_country: input.jurisdiction.country,
    jurisdiction_subdivision: input.jurisdiction.subdivision,
    // The framework's own label is the authority on what the jurisdiction is
    // called; the workspace's label for its home geography is a place inside it
    // (a county, a city), not the jurisdiction whose law was applied.
    jurisdiction_label: input.framework.jurisdiction.label,
    jurisdiction_basis: input.jurisdictionBasis,

    claim_status: input.claimTier.claimStatus,
    claim_status_source: input.claimTier.claimStatusSource,

    input_basis: input.inputBasis,
    vmt_kpi_name: input.vmtKpiName,
    population_kpi_name: input.populationKpiName ?? null,
    scenario_id: scenario.scenario_id,

    determination: determinationToken(scenario),
    mitigation_required: scenario.mitigation_required,
    vmt_per_capita: scenario.vmt_per_capita,
    threshold_vmt_per_capita: scenario.threshold_vmt_per_capita,
    reference_vmt_per_capita: input.result.reference_vmt_per_capita,
    threshold_pct: input.result.threshold_pct,
    reference_label: input.result.reference_label,
    project_type: input.result.project_type,

    // The full screening record, so a stored determination stays reproducible
    // even after the descriptor or the engine changes.
    inputs_json: {
      vmtKpiName: input.vmtKpiName,
      populationKpiName: input.populationKpiName ?? null,
      inputBasis: input.inputBasis,
      // The run this was computed from, as it stood at issue time. See
      // `subjectRun` on BuildVmtScreeningRowInput for why the row keeps its own
      // copy instead of trusting a later read of `model_runs`.
      subjectRun: {
        status: input.subjectRun.status,
        engineKey: input.subjectRun.engineKey,
      },
      referenceVmtPerCapita: input.result.reference_vmt_per_capita,
      thresholdPct: input.result.threshold_pct,
      projectType: input.result.project_type,
      referenceLabel: input.result.reference_label,
      frameworkId: input.framework.frameworkId,
      frameworkVersion: input.framework.version,
      jurisdiction: input.jurisdiction,
      workspaceHomeGeographyLabel: input.jurisdiction.label,
    },
    result_json: input.result,
    engine_version: VMT_SIGNIFICANCE_ENGINE_VERSION,
    created_by: input.createdBy,
  };
}

/** `jurisdiction_country` → `jurisdictionCountry`. */
function camelKey(snakeKey: string): string {
  return snakeKey.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * Read a column by its database name, accepting the camelCase spelling too.
 *
 * WHY BOTH. This parser sits on two different boundaries. On the server it reads
 * a PostgREST row, which is snake_case. In the browser it re-validates the JSON
 * the API route sent, and that JSON is the already-parsed
 * `VmtSignificanceScreeningRecord`, which is camelCase. Reading only snake_case
 * made every stored determination parse as `null` in the browser: the saved
 * history silently rendered as empty, and every successful save reported itself
 * as "saved but could not be read back — do not retry". A determination
 * disappearing quietly is precisely the silent degrade this module exists to
 * prevent, so the one parser accepts the one record in either spelling rather
 * than two parsers drifting apart.
 */
function pick(record: Record<string, unknown>, key: string): unknown {
  const direct = record[key];
  if (direct !== undefined) return direct;
  return record[camelKey(key)];
}

function text(record: Record<string, unknown>, key: string): string | null {
  const value = pick(record, key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(record: Record<string, unknown>, key: string): number | null {
  const value = pick(record, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // Postgres NUMERIC arrives as a string through PostgREST when it exceeds the
  // JSON-safe range; parsing it here keeps a real number from rendering as NaN.
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isDetermination(value: unknown): value is VmtDetermination {
  return typeof value === "string" && (VMT_DETERMINATIONS as readonly string[]).includes(value);
}

function isInputBasis(value: unknown): value is VmtScreeningInputBasis {
  return typeof value === "string" && (VMT_SCREENING_INPUT_BASES as readonly string[]).includes(value);
}

function isClaimStatusSource(value: unknown): value is VmtClaimStatusSource {
  return typeof value === "string" && (VMT_CLAIM_STATUS_SOURCES as readonly string[]).includes(value);
}

/**
 * Coerce a selected row into a record, or `null` when it is not one.
 *
 * Strict on purpose. A row missing its determination, framework, jurisdiction,
 * or claim-status provenance is not a weaker determination to be rendered with
 * blanks — it is a row this code does not understand, and rendering it would put
 * an unlabeled determination in front of a planner. Callers drop nulls and say
 * how many they dropped rather than silently showing fewer.
 */
export function parseVmtSignificanceScreeningRow(row: unknown): VmtSignificanceScreeningRecord | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;

  const id = text(record, "id");
  const workspaceId = text(record, "workspace_id");
  const frameworkId = text(record, "framework_id");
  const frameworkName = text(record, "framework_name");
  const frameworkVersion = text(record, "framework_version");
  const jurisdictionCountry = text(record, "jurisdiction_country");
  const jurisdictionLabel = text(record, "jurisdiction_label");
  const jurisdictionBasis = text(record, "jurisdiction_basis");
  const vmtKpiName = text(record, "vmt_kpi_name");
  const scenarioId = text(record, "scenario_id");
  const referenceLabel = text(record, "reference_label");
  const projectType = text(record, "project_type");
  const engineVersion = text(record, "engine_version");

  const determination = pick(record, "determination");
  const inputBasis = pick(record, "input_basis");
  const claimStatusSource = pick(record, "claim_status_source");
  const rawClaimStatus = pick(record, "claim_status");
  const mitigationRequired = pick(record, "mitigation_required");

  const vmtPerCapita = num(record, "vmt_per_capita");
  const thresholdVmtPerCapita = num(record, "threshold_vmt_per_capita");
  const referenceVmtPerCapita = num(record, "reference_vmt_per_capita");
  const thresholdPct = num(record, "threshold_pct");

  if (
    !id ||
    !workspaceId ||
    !frameworkId ||
    !frameworkName ||
    !frameworkVersion ||
    !jurisdictionCountry ||
    !jurisdictionLabel ||
    jurisdictionBasis !== "workspace_home_geography" ||
    !vmtKpiName ||
    !scenarioId ||
    !referenceLabel ||
    !projectType ||
    !engineVersion ||
    !isDetermination(determination) ||
    !isInputBasis(inputBasis) ||
    !isClaimStatusSource(claimStatusSource) ||
    // Strict, for the same reason as every other field: `mitigation_required` is
    // NOT NULL in the table, so anything else means this is not the row shape
    // this code understands. Coercing it would render "no mitigation required"
    // for a determination whose own token says otherwise.
    typeof mitigationRequired !== "boolean" ||
    vmtPerCapita === null ||
    thresholdVmtPerCapita === null ||
    referenceVmtPerCapita === null ||
    thresholdPct === null
  ) {
    return null;
  }

  // A tier that is present but unrecognised is not silently downgraded to
  // "not recorded" — that would hide a vocabulary drift. It fails the parse.
  const claimStatus = rawClaimStatus === null || rawClaimStatus === undefined ? null : rawClaimStatus;
  if (claimStatus !== null && !isModelingClaimStatus(claimStatus)) return null;
  if (claimStatusSource === "recorded_claim_decision" && claimStatus === null) return null;
  if (claimStatusSource === "not_recorded" && claimStatus !== null) return null;

  return {
    id,
    workspaceId,
    modelRunId: text(record, "model_run_id"),
    countyRunId: text(record, "county_run_id"),
    frameworkId,
    frameworkName,
    frameworkVersion,
    jurisdictionCountry,
    jurisdictionSubdivision: text(record, "jurisdiction_subdivision"),
    jurisdictionLabel,
    jurisdictionBasis: "workspace_home_geography",
    claimStatus,
    claimStatusSource,
    inputBasis,
    vmtKpiName,
    populationKpiName: text(record, "population_kpi_name"),
    scenarioId,
    determination,
    mitigationRequired,
    vmtPerCapita,
    thresholdVmtPerCapita,
    referenceVmtPerCapita,
    thresholdPct,
    referenceLabel,
    projectType,
    engineVersion,
    createdAt: text(record, "created_at"),
  };
}

/** The summary line for a stored determination — the same one every surface uses. */
export function summarizeRecord(record: VmtSignificanceScreeningRecord): string {
  return summarizeVmtDetermination({
    determination: record.determination,
    frameworkName: record.frameworkName,
    jurisdictionLabel: record.jurisdictionLabel,
    claimStatus: record.claimStatus,
    claimStatusSource: record.claimStatusSource,
    inputBasis: record.inputBasis,
  });
}
