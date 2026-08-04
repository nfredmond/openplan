/**
 * Attributed modeling evidence for the RTP "why" engine. Summarizes a chosen
 * model run's VMT/GHG KPIs so they can be shown next to the VMT/GHG priority
 * criteria. The run is always named with the numbers — this is planner-chosen
 * attribution, screening-grade, never an auto-derived per-project forecast.
 *
 * DISCLOSE, NEVER RESTRICT. A planner may cite ANY run — any engine, any
 * status, any claim tier — because refusing a preliminary citation sends the
 * work to a spreadsheet nobody reviews. The deal is that the citation always
 * travels with its engine, status, and claim tier, and a failed or sketch-grade
 * run carries a warning the reader can see. The disclosure helpers below are
 * that deal; nothing in this module (or its callers) may block a citation.
 */

import { getManagedRunModeDefinition } from "@/lib/models/run-modes";
import {
  isModelingClaimStatus,
  modelingClaimStatusLabel,
  strongestModelingClaimStatus,
  type ModelingClaimStatus,
} from "@/lib/models/evidence-backbone";

/** KPI names read for RTP modeling evidence (see model_run_kpis). */
export const RTP_EVIDENCE_KPI_NAMES = [
  "resident_vmt_per_capita",
  "vmt_per_capita",
  "co2e_metric_tons_year",
  "co2e_kg_per_capita_day",
] as const;

export interface RtpModelingEvidenceKpiRow {
  run_id: string;
  kpi_name: string;
  value: number | null;
  /**
   * KPI scope marker from `model_run_kpis`. A geometry-scoped row (e.g. one
   * corridor's slice) is not the run's figure, and callers must select this
   * column so the run-level filter below can see it.
   */
  geometry_ref?: string | null;
}

export interface RtpModelingEvidence {
  runId: string;
  runTitle: string | null;
  residentVmtPerCapita: number | null;
  vmtPerCapita: number | null;
  ghgTonsPerYear: number | null;
  ghgKgPerCapitaDay: number | null;
  hasVmt: boolean;
  hasGhg: boolean;
  /**
   * True when the KPI read itself failed. Kept distinct from "no KPI rows",
   * because "No VMT/GHG KPIs on this run" is a statement about the run that a
   * failed read cannot establish — rendering it after a query error told a
   * planner (and, on the public plan page, the public) that evidence was
   * absent when it was only unread.
   */
  kpiReadFailed: boolean;
}

function num(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Build the VMT/GHG evidence for one run from its KPI rows. Pure; the caller
 * fetches `model_run_kpis` filtered to RTP_EVIDENCE_KPI_NAMES.
 */
export function summarizeRtpModelingEvidence(
  runId: string,
  runTitle: string | null,
  kpiRows: RtpModelingEvidenceKpiRow[],
  options?: { kpiReadFailed?: boolean },
): RtpModelingEvidence {
  const kpiReadFailed = options?.kpiReadFailed ?? false;
  // Run-level rows only: a geometry-scoped row (one corridor, one zone group)
  // is a slice of the run, not the run's VMT/GHG — the same rule the CEQA
  // screen's findRunLevelKpi applies. Enforced here, in the one pure function
  // both surfaces call, rather than by each caller remembering a query filter.
  const byName = new Map(
    kpiRows
      .filter((row) => row.run_id === runId && !row.geometry_ref)
      .map((row) => [row.kpi_name, row.value])
  );
  const residentVmtPerCapita = num(byName.get("resident_vmt_per_capita"));
  const vmtPerCapita = num(byName.get("vmt_per_capita"));
  const ghgTonsPerYear = num(byName.get("co2e_metric_tons_year"));
  const ghgKgPerCapitaDay = num(byName.get("co2e_kg_per_capita_day"));

  return {
    runId,
    runTitle,
    residentVmtPerCapita,
    vmtPerCapita,
    ghgTonsPerYear,
    ghgKgPerCapitaDay,
    hasVmt: residentVmtPerCapita !== null || vmtPerCapita !== null,
    hasGhg: ghgTonsPerYear !== null || ghgKgPerCapitaDay !== null,
    kpiReadFailed,
  };
}

/** Short one-line summary of a run's VMT/GHG evidence, e.g. for a badge/caption. */
export function formatRtpModelingEvidenceLine(evidence: RtpModelingEvidence): string {
  const parts: string[] = [];
  const vmt = evidence.residentVmtPerCapita ?? evidence.vmtPerCapita;
  if (vmt !== null) {
    const label = evidence.residentVmtPerCapita !== null ? "resident VMT/capita" : "VMT/capita";
    parts.push(`${label} ${vmt.toLocaleString(undefined, { maximumFractionDigits: 1 })}`);
  }
  if (evidence.ghgTonsPerYear !== null) {
    parts.push(`GHG ${evidence.ghgTonsPerYear.toLocaleString(undefined, { maximumFractionDigits: 0 })} t CO₂e/yr`);
  } else if (evidence.ghgKgPerCapitaDay !== null) {
    parts.push(`GHG ${evidence.ghgKgPerCapitaDay.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg CO₂e/capita·day`);
  }
  if (parts.length > 0) {
    return `${parts.join(" · ")} (screening-grade)`;
  }
  // "No KPIs" is a claim about the run; a failed read cannot make it.
  return evidence.kpiReadFailed
    ? "This run's VMT/GHG KPIs could not be read — a lookup failure, not evidence that the run has none."
    : "No VMT/GHG KPIs on this run.";
}

/**
 * What a reader must know about a cited run before trusting its numbers:
 * which engine produced it, whether it completed, and the claim tier its
 * evidence holds. Rendered beside EVERY model-run citation on the public plan
 * page and in the evidence-run picker — a run's title alone cannot distinguish
 * a calibrated run from a failed sketch.
 */
export interface RtpEvidenceRunDisclosure {
  engineKey: string | null;
  status: string | null;
  claimStatus: ModelingClaimStatus | null;
  /**
   * True when the claim-decision read itself failed. "Could not be read" and
   * "not recorded" are different facts (same rule as kpiReadFailed above), and
   * the disclosure states whichever one is true.
   */
  claimReadFailed: boolean;
  /** True when the model_runs read itself failed — engine/status unknown, not absent. */
  runReadFailed: boolean;
}

function formatRunStatusLabel(status: string): string {
  const words = status.split(/[_-]+/).filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One line naming the cited run's engine, status, and claim tier, e.g.
 * "Sketch Activity Model · Succeeded · Screening-grade". Absences are stated,
 * never blanked, and a failed lookup is named as a lookup failure.
 */
export function formatRtpEvidenceRunDisclosureLine(disclosure: RtpEvidenceRunDisclosure): string {
  const engine = disclosure.engineKey
    ? getManagedRunModeDefinition(disclosure.engineKey).engineLabel
    : disclosure.runReadFailed
      ? "Engine could not be read"
      : "Engine not recorded";
  const status = disclosure.status
    ? formatRunStatusLabel(disclosure.status)
    : disclosure.runReadFailed
      ? "Status could not be read"
      : "Status not recorded";
  const tier = disclosure.claimReadFailed
    ? "Claim tier could not be read"
    : modelingClaimStatusLabel(disclosure.claimStatus);
  return `${engine} · ${status} · ${tier}`;
}

/**
 * Non-blocking caveats for a cited run. Empty when the run completed and is
 * not sketch-grade. These warn the READER; they never refuse the CITATION —
 * disclosure is the fix, restriction is not (see the module header).
 */
export function rtpEvidenceRunWarnings(disclosure: RtpEvidenceRunDisclosure): string[] {
  const warnings: string[] = [];
  if (disclosure.status && disclosure.status !== "succeeded") {
    warnings.push(
      disclosure.status === "failed"
        ? "This cited run failed — it did not finish, so its figures may be missing or unreliable. The citation is kept so readers can see exactly what was cited."
        : `This cited run has status "${formatRunStatusLabel(disclosure.status)}" — it has not completed successfully, so its figures may be incomplete. The citation is kept so readers can see exactly what was cited.`
    );
  }
  // The engine's caveat comes from the engine registry, never from a key named
  // here. This function used to test `engineKey === "sketch_abm"` and carry that
  // engine's 56%-below-CARB figure as a literal, which was wrong twice: it baked
  // one engine's identity into RTP citation logic, and it meant ADDING an engine
  // produced citations with no caveat at all — silently, with nothing failing.
  // Deriving it inverts that: a new engine arrives already disclosed, and the
  // caveat a reader sees beside a citation is the same sentence the reports and
  // comparison boards show, because there is one source for it.
  if (disclosure.engineKey) {
    warnings.push(getManagedRunModeDefinition(disclosure.engineKey).caveatSummary);
  }
  return warnings;
}

/** The model_runs columns the disclosure renders. One definition, so a caller cannot drop a column the line needs. */
export type RtpEvidenceRunRow = { id: string; run_title: string; engine_key: string | null; status: string | null };

type EvidenceQueryResult = { data: unknown; error: unknown };
/** Structural client type — cast the real (deliberately untyped) client with `as unknown as RtpEvidenceSupabaseLike`. */
export type RtpEvidenceSupabaseLike = {
  from(table: string): {
    select(columns: string): { in(column: string, values: string[]): PromiseLike<EvidenceQueryResult> };
  };
};

/**
 * Load everything both citation surfaces (the public plan page and the
 * evidence-run picker) must disclose about a set of runs: title, engine,
 * status, and the strongest recorded claim tier. Shared on purpose — a
 * capability that lives inside one of its two callers gets reimplemented
 * wrongly by the other. `knownRuns` lets a caller that already fetched some
 * rows (the picker's succeeded-runs window) skip re-fetching them; only the
 * missing ids are read. READ-ONLY: nothing here writes a tier.
 */
export async function loadRtpEvidenceRunDisclosures(
  supabase: RtpEvidenceSupabaseLike,
  runIds: string[],
  options?: { knownRuns?: RtpEvidenceRunRow[] }
): Promise<{
  titleByRunId: Map<string, string>;
  claimReadFailed: boolean;
  claimTierFor: (runId: string) => ModelingClaimStatus | null;
  disclosureFor: (runId: string) => RtpEvidenceRunDisclosure;
  /** `knownRuns` in the shape the evidence-run picker offers them, each carrying its disclosure fields. */
  pickerRuns: Array<{
    id: string;
    title: string;
    engineKey: string;
    status: string | null;
    claimStatus: ModelingClaimStatus | null;
    claimReadFailed: boolean;
  }>;
}> {
  const knownRuns = options?.knownRuns ?? [];
  const knownIds = new Set(knownRuns.map((run) => run.id));
  const missingIds = Array.from(new Set(runIds.filter((id) => !knownIds.has(id))));
  const claimIds = Array.from(new Set([...knownIds, ...runIds]));

  const [runResult, claimResult] = await Promise.all([
    missingIds.length
      ? supabase.from("model_runs").select("id, run_title, engine_key, status").in("id", missingIds)
      : Promise.resolve({ data: [], error: null } as EvidenceQueryResult),
    claimIds.length
      ? supabase.from("modeling_claim_decisions").select("model_run_id, claim_status").in("model_run_id", claimIds)
      : Promise.resolve({ data: [], error: null } as EvidenceQueryResult),
  ]);

  const runReadFailed = Boolean(runResult.error);
  const allRuns = [...knownRuns, ...(((runResult.data ?? []) as RtpEvidenceRunRow[]))];
  const runById = new Map(allRuns.map((run) => [run.id, run]));

  // Strongest recorded tier per run. "Could not be read" stays distinct from
  // "not recorded" — the same rule kpiReadFailed enforces above.
  const claimReadFailed = Boolean(claimResult.error);
  const tiersByRun = new Map<string, ModelingClaimStatus[]>();
  for (const row of (claimResult.data ?? []) as Array<{ model_run_id: string | null; claim_status: unknown }>) {
    if (!row.model_run_id || !isModelingClaimStatus(row.claim_status)) continue;
    const list = tiersByRun.get(row.model_run_id) ?? [];
    list.push(row.claim_status);
    tiersByRun.set(row.model_run_id, list);
  }

  const claimTierFor = (runId: string) => strongestModelingClaimStatus(tiersByRun.get(runId) ?? []);
  return {
    titleByRunId: new Map(allRuns.map((run) => [run.id, run.run_title])),
    claimReadFailed,
    claimTierFor,
    pickerRuns: knownRuns.map((run) => ({
      id: run.id,
      title: run.run_title,
      engineKey: run.engine_key ?? "",
      status: run.status,
      claimStatus: claimTierFor(run.id),
      claimReadFailed,
    })),
    disclosureFor: (runId: string) => {
      const meta = runById.get(runId);
      return {
        engineKey: meta?.engine_key ?? null,
        status: meta?.status ?? null,
        claimStatus: claimTierFor(runId),
        claimReadFailed,
        runReadFailed: !meta && runReadFailed,
      };
    },
  };
}
