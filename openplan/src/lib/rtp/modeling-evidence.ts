/**
 * Attributed modeling evidence for the RTP "why" engine. Summarizes a chosen
 * model run's VMT/GHG KPIs so they can be shown next to the VMT/GHG priority
 * criteria. The run is always named with the numbers — this is planner-chosen
 * attribution, screening-grade, never an auto-derived per-project forecast.
 */

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
