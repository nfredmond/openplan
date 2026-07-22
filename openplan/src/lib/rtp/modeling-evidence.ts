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
): RtpModelingEvidence {
  const byName = new Map(kpiRows.filter((row) => row.run_id === runId).map((row) => [row.kpi_name, row.value]));
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
  return parts.length > 0 ? `${parts.join(" · ")} (screening-grade)` : "No VMT/GHG KPIs on this run.";
}
